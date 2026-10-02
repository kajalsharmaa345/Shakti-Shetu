'use strict';
/* Local mode: used automatically when the Node server is not reachable
   (static hosting, Live Server, double-clicking index.html...).
   It implements the same API shapes as server.js, but data stays in THIS browser. */
const LS = {
  mem: {},
  get(k, d) { try { const v = localStorage.getItem('sl_' + k); return v ? JSON.parse(v) : d; } catch (e) { return k in LS.mem ? LS.mem[k] : d; } },
  set(k, v) { LS.mem[k] = v; try { localStorage.setItem('sl_' + k, JSON.stringify(v)); } catch (e) {} },
};
const lhash = async s => {
  try { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('shaktisetu:' + s)); return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join(''); }
  catch (e) { return 'b64:' + btoa(unescape(encodeURIComponent('shaktisetu:' + s))); }
};
const lpub = u => ({ id: u.email, name: u.name, email: u.email, phone: u.phone, fake: u.fake, settings: u.settings });
const lsaveUser = u => { const all = LS.get('users', {}); all[u.email] = u; LS.set('users', all); };
const lnow = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
const lcheck = (name, email, phone, pw) => {
  if (!name) throw new Error('Name is required.');
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error('Enter a valid email.');
  if (!/^\+?\d{10,13}$/.test(phone)) throw new Error('Enter a valid phone number.');
  if (pw.length < 6 || pw.length > 72) throw new Error('Password must be 6-72 characters.');
};
function lme() {
  const u = LS.get('users', {})[String(token || '').replace(/^local:/, '')];
  if (!u) { logout(); throw new Error('Please log in again.'); }
  return u;
}
let _ldb;
const ldb = () => _ldb || (_ldb = new Promise((res, rej) => { const q = indexedDB.open('shakti_local', 1); q.onupgradeneeded = () => q.result.createObjectStore('ev', { keyPath: 'id', autoIncrement: true }); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }));
const ltx = async (mode, fn) => { const d = await ldb(); return new Promise((res, rej) => { const t = d.transaction('ev', mode); const r = fn(t.objectStore('ev')); t.oncomplete = () => res(r && r.result); t.onerror = () => rej(t.error); }); };
async function localBlob(id) { const rec = await ltx('readonly', s => s.get(+id)); if (!rec) throw 0; return URL.createObjectURL(rec.blob); }

async function localApi(path, { method = 'GET', body } = {}) {
  const k = method + ' ' + path, b = body || {};
  const clean = (s, n = 100) => String(s ?? '').trim().slice(0, n);
  const phone = s => String(s ?? '').replace(/[\s-]/g, '');

  if (k === 'POST /auth/signup') {
    const name = clean(b.name), email = clean(b.email, 200).toLowerCase(), ph = phone(b.phone), pw = String(b.password || '');
    lcheck(name, email, ph, pw);
    if (LS.get('users', {})[email]) throw new Error('This email is already registered.');
    const u = { name, email, phone: ph, pw: await lhash(pw), pin: await lhash('1234'), fake: { name: 'Harsh', num: '+91 82950 00000' }, settings: { shake: false, voice: false } };
    lsaveUser(u); return { token: 'local:' + email, user: lpub(u) };
  }
  if (k === 'POST /auth/login') {
    const u = LS.get('users', {})[clean(b.email, 200).toLowerCase()];
    if (!u || u.pw !== await lhash(String(b.password || ''))) throw new Error('Wrong email or password.');
    return { token: 'local:' + u.email, user: lpub(u) };
  }
  if (k === 'POST /auth/forgot') {
    const email = clean(b.email, 200).toLowerCase(); if (!LS.get('users', {})[email]) return { ok: true };
    const code = String(Math.floor(100000 + Math.random() * 900000)); LS.set('reset:' + email, { code, exp: Date.now() + 600000 });
    return { ok: true, devCode: code }; // no email service in local mode
  }
  if (k === 'POST /auth/reset') {
    const email = clean(b.email, 200).toLowerCase(), r = LS.get('reset:' + email, null), pw = String(b.newPassword || '');
    if (pw.length < 6 || pw.length > 72) throw new Error('Password must be 6-72 characters.');
    if (!r || r.exp < Date.now()) throw new Error('Code expired. Request a new one.');
    if (r.code !== String(b.code || '')) throw new Error('Wrong code.');
    const u = LS.get('users', {})[email]; u.pw = await lhash(pw); lsaveUser(u); LS.set('reset:' + email, null); return { ok: true };
  }
  if (k === 'POST /auth/google') { // decodes the Google ID token in the browser (not server-verified)
    let p; try { p = JSON.parse(decodeURIComponent(escape(atob(String(b.credential).split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))))); } catch (e) { throw new Error('Google sign-in failed. Try again.'); }
    const cid = window.SHAKTI_CONFIG && window.SHAKTI_CONFIG.googleClientId;
    if (!cid || p.aud !== cid || !p.email) throw new Error('Google sign-in failed. Try again.');
    const email = String(p.email).toLowerCase(); let u = LS.get('users', {})[email];
    if (!u) { u = { name: clean(p.name || email.split('@')[0]), email, phone: '', pw: await lhash(crypto.getRandomValues(new Uint32Array(4)).join('-')), pin: await lhash('1234'), fake: { name: 'Harsh', num: '+91 82950 00000' }, settings: { shake: false, voice: false } }; lsaveUser(u); }
    return { token: 'local:' + email, user: lpub(u) };
  }

  const u = lme(); // everything below needs a logged-in user
  if (k === 'GET /me') return { user: lpub(u) };
  if (k === 'PUT /me') { const n = clean(b.name), ph = phone(b.phone); if (!n || !/^\+?\d{10,13}$/.test(ph)) throw new Error('Enter a valid name and phone.'); u.name = n; u.phone = ph; lsaveUser(u); return { user: lpub(u) }; }
  if (k === 'PUT /me/fake') { u.fake = { name: clean(b.name, 60) || 'Unknown', num: clean(b.num, 30) || 'Unknown' }; lsaveUser(u); return { user: lpub(u) }; }
  if (k === 'PUT /me/settings') { if (b.shake !== undefined) u.settings.shake = !!b.shake; if (b.voice !== undefined) u.settings.voice = !!b.voice; lsaveUser(u); return { user: lpub(u) }; }
  if (k === 'PUT /me/pin') {
    if (u.pin !== await lhash(String(b.oldPin || ''))) throw new Error('Current PIN is wrong.');
    if (!/^\d{4,6}$/.test(String(b.newPin || ''))) throw new Error('PIN must be 4-6 digits.');
    u.pin = await lhash(String(b.newPin)); lsaveUser(u); return { ok: true };
  }
  if (k === 'PUT /me/password') {
    if (u.pw !== await lhash(String(b.oldPassword || ''))) throw new Error('Current password is wrong.');
    const pw = String(b.newPassword || ''); if (pw.length < 6 || pw.length > 72) throw new Error('Password must be 6-72 characters.');
    u.pw = await lhash(pw); lsaveUser(u); return { ok: true };
  }

  const ck = 'contacts:' + u.email;
  if (k === 'GET /contacts') return { contacts: LS.get(ck, []) };
  if (k === 'POST /contacts') {
    const name = clean(b.name, 60), ph = phone(b.phone), l = LS.get(ck, []);
    if (!name || !/^\+?\d{10,13}$/.test(ph)) throw new Error('Enter a name and a valid phone number.');
    if (l.length >= 10) throw new Error('You can add up to 10 contacts.');
    const c = { id: Date.now(), name, phone: ph }; l.push(c); LS.set(ck, l); return { contact: c };
  }
  if (method === 'DELETE' && path.startsWith('/contacts/')) { LS.set(ck, LS.get(ck, []).filter(c => String(c.id) !== path.split('/')[2])); return { ok: true }; }

  if (k === 'POST /sos') {
    const has = typeof b.lat === 'number' && typeof b.lng === 'number';
    const message = localMsg(has ? { latitude: b.lat, longitude: b.lng } : null);
    const ev = LS.get('sos:' + u.email, []); const id = Date.now(); ev.unshift({ id, lat: b.lat, lng: b.lng, status: 'active', started_at: lnow() }); LS.set('sos:' + u.email, ev.slice(0, 50));
    return { id, message, contacts: LS.get(ck, []), sms: { enabled: false, sent: 0, failed: 0 } };
  }
  if (k === 'POST /sos/dismiss') {
    if (u.pin !== await lhash(String(b.pin || ''))) throw new Error('Wrong PIN.');
    LS.set('sos:' + u.email, LS.get('sos:' + u.email, []).map(e => e.id === b.id ? { ...e, status: 'dismissed' } : e)); return { ok: true };
  }

  if (k === 'GET /evidence') { const all = await ltx('readonly', s => s.getAll()); return { evidence: all.filter(x => x.user === u.email).map(({ id, type, mime, size, created_at }) => ({ id, type, mime, size, created_at })).reverse() }; }
  if (k === 'POST /evidence') {
    const f = body.get('file'); if (!f) throw new Error('Missing file.');
    const id = await ltx('readwrite', s => s.add({ user: u.email, type: body.get('type') === 'photo' ? 'photo' : 'audio', blob: f, mime: (f.type || '').split(';')[0], size: f.size, created_at: lnow() }));
    return { id };
  }
  if (k === 'DELETE /evidence') { await ltx('readwrite', s => { s.openCursor().onsuccess = e => { const c = e.target.result; if (c) { if (c.value.user === u.email) c.delete(); c.continue(); } }; }); return { ok: true }; }
  throw new Error('Not available in local mode.');
}
