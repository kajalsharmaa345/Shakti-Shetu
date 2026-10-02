// ShaktiSetu backend: Express REST API + static frontend.
require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { db, DATA_DIR } = require('./db');

const PROD = process.env.NODE_ENV === 'production';
const PORT = process.env.PORT || 3000;
const SECRET = process.env.JWT_SECRET || (() => {
  if (PROD) { console.error('JWT_SECRET is required in production'); process.exit(1); }
  console.warn('[warn] JWT_SECRET not set, using an insecure dev secret.');
  return 'dev-secret-change-me';
})();
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const app = express();
app.set('trust proxy', 1);
app.use(helmet({
  hsts: PROD,
  crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' }, // needed for Google sign-in popup
  contentSecurityPolicy: {
    directives: {
      upgradeInsecureRequests: PROD ? [] : null, // plain http (localhost / LAN testing) must keep working
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", 'https://accounts.google.com/gsi/client'],
      frameSrc: ['https://accounts.google.com/gsi/'],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', 'https://accounts.google.com/gsi/style'],
      fontSrc: ['https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:', 'blob:'],
      mediaSrc: ["'self'", 'blob:'],
      connectSrc: ["'self'", 'https://accounts.google.com/gsi/'],
    },
  },
  // camera, mic, location & motion are needed by this app
  crossOriginEmbedderPolicy: false,
}));
app.use((req, res, next) => {
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self), geolocation=(self), accelerometer=(self)');
  next();
});
app.use(cors({ origin: process.env.CORS_ORIGIN || false }));
app.use(express.json({ limit: '100kb' }));

/* ---------- helpers ---------- */
const emailRe = /^\S+@\S+\.\S+$/;
const phoneRe = /^\+?\d{10,13}$/;
const clean = (s, n = 100) => String(s ?? '').trim().slice(0, n);
const cleanPhone = (s) => String(s ?? '').replace(/[\s-]/g, '');
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const sign = (uid) => jwt.sign({ uid }, SECRET, { expiresIn: '30d' });
const pub = (u) => ({
  id: u.id, name: u.name, email: u.email, phone: u.phone,
  fake: { name: u.fake_name, num: u.fake_number },
  settings: { shake: !!u.shake, voice: !!u.voice },
});
const getUser = (id) => db.prepare('SELECT * FROM users WHERE id = ?').get(id);
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function auth(req, res, next) {
  const h = req.headers.authorization || '';
  try {
    req.uid = jwt.verify(h.startsWith('Bearer ') ? h.slice(7) : '', SECRET).uid;
    if (!getUser(req.uid)) throw new Error('no user');
    next();
  } catch { res.status(401).json({ error: 'Please log in again.' }); }
}

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many attempts. Try again in a few minutes.' } });
const apiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 600, standardHeaders: true, legacyHeaders: false });
app.use('/api', apiLimiter);

/* ---------- health ---------- */
app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

/* ---------- auth ---------- */
app.post('/api/auth/signup', authLimiter, wrap(async (req, res) => {
  const name = clean(req.body.name), email = clean(req.body.email, 200).toLowerCase();
  const phone = cleanPhone(req.body.phone), password = String(req.body.password || '');
  if (!name) return res.status(400).json({ error: 'Name is required.' });
  if (!emailRe.test(email)) return res.status(400).json({ error: 'Enter a valid email.' });
  if (!phoneRe.test(phone)) return res.status(400).json({ error: 'Enter a valid phone number.' });
  if (password.length < 6 || password.length > 72) return res.status(400).json({ error: 'Password must be 6-72 characters.' });
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) return res.status(409).json({ error: 'This email is already registered.' });
  const info = db.prepare('INSERT INTO users (name,email,phone,password_hash,pin_hash) VALUES (?,?,?,?,?)')
    .run(name, email, phone, await bcrypt.hash(password, 10), await bcrypt.hash('1234', 10));
  res.status(201).json({ token: sign(info.lastInsertRowid), user: pub(getUser(info.lastInsertRowid)) });
}));

app.post('/api/auth/login', authLimiter, wrap(async (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE email = ?').get(clean(req.body.email, 200).toLowerCase());
  if (!u || !(await bcrypt.compare(String(req.body.password || ''), u.password_hash)))
    return res.status(401).json({ error: 'Wrong email or password.' });
  res.json({ token: sign(u.id), user: pub(u) });
}));

// Forgot password: creates a 6-digit code valid for 10 minutes.
// Hook an email/SMS provider in sendResetCode() for real delivery.
async function sendResetCode(user, code) {
  console.log(`[reset] code for ${user.email}: ${code}`);
}
app.post('/api/auth/forgot', authLimiter, wrap(async (req, res) => {
  const email = clean(req.body.email, 200).toLowerCase();
  const u = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  let devCode;
  if (u) {
    const code = String(crypto.randomInt(100000, 1000000));
    db.prepare('INSERT OR REPLACE INTO reset_codes (email,code_hash,expires_at,attempts) VALUES (?,?,?,0)')
      .run(email, sha(code), Date.now() + 10 * 60 * 1000);
    await sendResetCode(u, code);
    if (!PROD) devCode = code;
  }
  res.json({ ok: true, devCode });
}));

app.post('/api/auth/reset', authLimiter, wrap(async (req, res) => {
  const email = clean(req.body.email, 200).toLowerCase(), code = String(req.body.code || '');
  const pw = String(req.body.newPassword || '');
  if (pw.length < 6 || pw.length > 72) return res.status(400).json({ error: 'Password must be 6-72 characters.' });
  const r = db.prepare('SELECT * FROM reset_codes WHERE email = ?').get(email);
  if (!r || r.expires_at < Date.now() || r.attempts >= 5) return res.status(400).json({ error: 'Code expired. Request a new one.' });
  if (r.code_hash !== sha(code)) {
    db.prepare('UPDATE reset_codes SET attempts = attempts + 1 WHERE email = ?').run(email);
    return res.status(400).json({ error: 'Wrong code.' });
  }
  db.prepare('UPDATE users SET password_hash = ? WHERE email = ?').run(await bcrypt.hash(pw, 10), email);
  db.prepare('DELETE FROM reset_codes WHERE email = ?').run(email);
  res.json({ ok: true });
}));


/* ---------- Google sign-in / sign-up ---------- */
app.get('/api/config', (req, res) => res.json({ googleClientId: process.env.GOOGLE_CLIENT_ID || null }));

app.post('/api/auth/google', authLimiter, wrap(async (req, res) => {
  const cid = process.env.GOOGLE_CLIENT_ID;
  if (!cid) return res.status(503).json({ error: 'Google login is not configured on the server.' });
  let info;
  try {
    const r = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(String(req.body.credential || '')));
    info = await r.json();
    if (!r.ok) throw new Error('bad token');
  } catch { return res.status(401).json({ error: 'Google sign-in failed. Try again.' }); }
  if (info.aud !== cid || String(info.email_verified) !== 'true' || !info.email) return res.status(401).json({ error: 'Google sign-in failed. Try again.' });
  const email = String(info.email).toLowerCase();
  let u = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!u) { // first time = account is created automatically
    const rnd = crypto.randomBytes(24).toString('hex');
    const i = db.prepare('INSERT INTO users (name,email,phone,password_hash,pin_hash) VALUES (?,?,?,?,?)')
      .run(clean(info.name || email.split('@')[0]), email, '', await bcrypt.hash(rnd, 10), await bcrypt.hash('1234', 10));
    u = getUser(i.lastInsertRowid);
  }
  res.json({ token: sign(u.id), user: pub(u), isNew: false });
}));

/* ---------- profile / settings ---------- */
app.get('/api/me', auth, (req, res) => res.json({ user: pub(getUser(req.uid)) }));

app.put('/api/me', auth, (req, res) => {
  const name = clean(req.body.name), phone = cleanPhone(req.body.phone);
  if (!name || !phoneRe.test(phone)) return res.status(400).json({ error: 'Enter a valid name and phone.' });
  db.prepare('UPDATE users SET name = ?, phone = ? WHERE id = ?').run(name, phone, req.uid);
  res.json({ user: pub(getUser(req.uid)) });
});

app.put('/api/me/fake', auth, (req, res) => {
  db.prepare('UPDATE users SET fake_name = ?, fake_number = ? WHERE id = ?')
    .run(clean(req.body.name, 60) || 'Unknown', clean(req.body.num, 30) || 'Unknown', req.uid);
  res.json({ user: pub(getUser(req.uid)) });
});

app.put('/api/me/settings', auth, (req, res) => {
  const u = getUser(req.uid);
  const shake = req.body.shake === undefined ? u.shake : (req.body.shake ? 1 : 0);
  const voice = req.body.voice === undefined ? u.voice : (req.body.voice ? 1 : 0);
  db.prepare('UPDATE users SET shake = ?, voice = ? WHERE id = ?').run(shake, voice, req.uid);
  res.json({ user: pub(getUser(req.uid)) });
});

app.put('/api/me/pin', auth, wrap(async (req, res) => {
  const u = getUser(req.uid);
  if (!(await bcrypt.compare(String(req.body.oldPin || ''), u.pin_hash))) return res.status(403).json({ error: 'Current PIN is wrong.' });
  if (!/^\d{4,6}$/.test(String(req.body.newPin || ''))) return res.status(400).json({ error: 'PIN must be 4-6 digits.' });
  db.prepare('UPDATE users SET pin_hash = ? WHERE id = ?').run(await bcrypt.hash(String(req.body.newPin), 10), req.uid);
  res.json({ ok: true });
}));

app.put('/api/me/password', auth, wrap(async (req, res) => {
  const u = getUser(req.uid);
  if (!(await bcrypt.compare(String(req.body.oldPassword || ''), u.password_hash))) return res.status(403).json({ error: 'Current password is wrong.' });
  const pw = String(req.body.newPassword || '');
  if (pw.length < 6 || pw.length > 72) return res.status(400).json({ error: 'Password must be 6-72 characters.' });
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await bcrypt.hash(pw, 10), req.uid);
  res.json({ ok: true });
}));

/* ---------- emergency contacts ---------- */
app.get('/api/contacts', auth, (req, res) => {
  res.json({ contacts: db.prepare('SELECT id,name,phone FROM contacts WHERE user_id = ? ORDER BY id').all(req.uid) });
});
app.post('/api/contacts', auth, (req, res) => {
  const name = clean(req.body.name, 60), phone = cleanPhone(req.body.phone);
  if (!name || !phoneRe.test(phone)) return res.status(400).json({ error: 'Enter a name and a valid phone number.' });
  if (db.prepare('SELECT COUNT(*) c FROM contacts WHERE user_id = ?').get(req.uid).c >= 10)
    return res.status(400).json({ error: 'You can add up to 10 contacts.' });
  const i = db.prepare('INSERT INTO contacts (user_id,name,phone) VALUES (?,?,?)').run(req.uid, name, phone);
  res.status(201).json({ contact: { id: i.lastInsertRowid, name, phone } });
});
app.delete('/api/contacts/:id', auth, (req, res) => {
  db.prepare('DELETE FROM contacts WHERE id = ? AND user_id = ?').run(req.params.id, req.uid);
  res.json({ ok: true });
});

/* ---------- SOS ---------- */
const toE164 = (n) => { const d = String(n).replace(/\D/g, ''); return d.length === 10 ? '+91' + d : '+' + d; };
async function sendSms(to, body) {
  const { TWILIO_SID: sid, TWILIO_TOKEN: tok, TWILIO_FROM: from } = process.env;
  if (!sid || !tok || !from) return null; // SMS provider not configured
  try {
    const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: { Authorization: 'Basic ' + Buffer.from(`${sid}:${tok}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ To: toE164(to), From: from, Body: body }),
    });
    return r.ok;
  } catch { return false; }
}

const sosLimiter = rateLimit({ windowMs: 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false });
app.post('/api/sos', auth, sosLimiter, wrap(async (req, res) => {
  const lat = Number(req.body.lat), lng = Number(req.body.lng);
  const hasLoc = Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
    && req.body.lat !== null && req.body.lng !== null;
  const time = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: process.env.TIMEZONE || 'Asia/Kolkata' }).toUpperCase();
  const url = hasLoc ? `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=18/${lat}/${lng}` : '(location unavailable)';
  const message = `🆘 SHAKTI SETU: EMERGENCY!\nI need help!\n📍 View my Live Location:\n${url}\n🕐 Time: ${time}`;
  const contacts = db.prepare('SELECT id,name,phone FROM contacts WHERE user_id = ?').all(req.uid);

  let sent = 0, failed = 0, enabled = false;
  for (const c of contacts) {
    const ok = await sendSms(c.phone, message);
    if (ok === null) break;
    enabled = true; ok ? sent++ : failed++;
  }
  const i = db.prepare('INSERT INTO sos_events (user_id,lat,lng,accuracy,message,sms_sent) VALUES (?,?,?,?,?,?)')
    .run(req.uid, hasLoc ? lat : null, hasLoc ? lng : null, Number(req.body.accuracy) || null, message, sent);
  res.status(201).json({ id: i.lastInsertRowid, message, url, contacts, sms: { enabled, sent, failed } });
}));

app.post('/api/sos/dismiss', auth, wrap(async (req, res) => {
  const u = getUser(req.uid);
  if (!(await bcrypt.compare(String(req.body.pin || ''), u.pin_hash))) return res.status(403).json({ error: 'Wrong PIN.' });
  if (req.body.id) db.prepare("UPDATE sos_events SET status='dismissed', ended_at=CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?").run(req.body.id, req.uid);
  res.json({ ok: true });
}));

app.get('/api/sos', auth, (req, res) => {
  res.json({ events: db.prepare('SELECT id,lat,lng,status,sms_sent,started_at,ended_at FROM sos_events WHERE user_id = ? ORDER BY id DESC LIMIT 50').all(req.uid) });
});

/* ---------- evidence (photos + audio files on disk, metadata in DB) ---------- */
const EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'audio/webm': '.webm', 'audio/ogg': '.ogg', 'audio/mp4': '.m4a', 'audio/mpeg': '.mp3', 'audio/wav': '.wav', 'video/webm': '.webm' };
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => { const d = path.join(UPLOAD_DIR, String(req.uid)); fs.mkdirSync(d, { recursive: true }); cb(null, d); },
    filename: (req, file, cb) => cb(null, crypto.randomUUID() + (EXT[file.mimetype.split(';')[0]] || '')),
  }),
  limits: { fileSize: 25 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => cb(null, !!EXT[file.mimetype.split(';')[0]]),
});
const evDir = (uid) => path.join(UPLOAD_DIR, String(uid));

app.post('/api/evidence', auth, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Unsupported or missing file.' });
  const type = req.body.type === 'photo' ? 'photo' : 'audio';
  const mime = req.file.mimetype.split(';')[0];
  if ((type === 'photo') !== mime.startsWith('image/')) { fs.unlink(req.file.path, () => {}); return res.status(400).json({ error: 'File type mismatch.' }); }
  const sosId = Number(req.body.sosId) || null;
  const i = db.prepare('INSERT INTO evidence (user_id,sos_id,type,filename,mime,size) VALUES (?,?,?,?,?,?)')
    .run(req.uid, sosId && db.prepare('SELECT 1 FROM sos_events WHERE id=? AND user_id=?').get(sosId, req.uid) ? sosId : null, type, req.file.filename, mime, req.file.size);
  res.status(201).json({ id: i.lastInsertRowid });
});
app.get('/api/evidence', auth, (req, res) => {
  res.json({ evidence: db.prepare('SELECT id,type,mime,size,created_at FROM evidence WHERE user_id = ? ORDER BY id DESC').all(req.uid) });
});
app.get('/api/evidence/:id/file', auth, (req, res) => {
  const e = db.prepare('SELECT * FROM evidence WHERE id = ? AND user_id = ?').get(req.params.id, req.uid);
  if (!e) return res.status(404).json({ error: 'Not found.' });
  res.type(e.mime).sendFile(path.join(evDir(req.uid), e.filename));
});
app.delete('/api/evidence', auth, (req, res) => {
  for (const e of db.prepare('SELECT filename FROM evidence WHERE user_id = ?').all(req.uid)) fs.unlink(path.join(evDir(req.uid), e.filename), () => {});
  db.prepare('DELETE FROM evidence WHERE user_id = ?').run(req.uid);
  res.json({ ok: true });
});
app.delete('/api/evidence/:id', auth, (req, res) => {
  const e = db.prepare('SELECT * FROM evidence WHERE id = ? AND user_id = ?').get(req.params.id, req.uid);
  if (e) { fs.unlink(path.join(evDir(req.uid), e.filename), () => {}); db.prepare('DELETE FROM evidence WHERE id = ?').run(e.id); }
  res.json({ ok: true });
});

/* ---------- static frontend + errors ---------- */
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'File is too large (max 25 MB).' : 'Upload failed.' });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON.' });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server.' });
});

app.listen(PORT, () => console.log(`ShaktiSetu running on http://localhost:${PORT}`));
