'use strict';
/* ShaktiSetu frontend: talks to the Express REST API under /api */
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let token = null; try { token = localStorage.getItem('st'); } catch (e) {}
const setToken = t => { token = t; try { t ? localStorage.setItem('st', t) : localStorage.removeItem('st'); } catch (e) {} };
let me = null, contacts = [];

let mode = null; // 'server' (Node backend found) or 'local' (data stays in this browser)
const modeReady = fetch('/api/health').then(r => r.ok ? r.json() : null).then(j => { mode = j && j.ok ? 'server' : 'local'; }).catch(() => { mode = 'local'; });
async function api(path, opt = {}) { await modeReady; return mode === 'server' ? serverApi(path, opt) : localApi(path, opt); }
async function serverApi(path, { method = 'GET', body } = {}) {
  const h = {}; if (token) h.Authorization = 'Bearer ' + token;
  let b; if (body instanceof FormData) b = body; else if (body !== undefined) { h['Content-Type'] = 'application/json'; b = JSON.stringify(body); }
  let r; try { r = await fetch('/api' + path, { method, headers: h, body: b }); } catch (e) { throw new Error(location.protocol === 'file:' ? 'This page cannot run by double-clicking the file. Run npm start in a terminal and open http://localhost:3000.' : 'Cannot reach the server. Make sure npm start is running.'); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { if (r.status === 401 && token && !path.startsWith('/auth')) logout(); throw new Error(j.error || 'Request failed.'); }
  return j;
}
const run = (btn, fn) => async (...a) => { if (btn.disabled) return; btn.disabled = true; try { await fn(...a); } catch (e) { toast(e.message); } finally { btn.disabled = false; } };
function toast(m) { const t = $('#toast'); t.textContent = m; t.setAttribute('role', 'status'); t.style.display = 'block'; t.style.animation = 'none'; void t.offsetWidth; t.style.animation = ''; clearTimeout(t._t); t._t = setTimeout(() => t.style.display = 'none', 3000); }
const coarse = () => !!(window.matchMedia && window.matchMedia('(pointer:coarse)').matches);
function modal(html) { $('#mob').innerHTML = html; enhance($('#mob')); $('#mo').classList.add('on'); const f = $('#mob input:not([disabled])'); if (f && !coarse()) f.focus(); }
function closeM() { $('#mo').classList.remove('on'); }
$('#mo').onclick = e => { if (e.target.id === 'mo') closeM(); };

/* ---------- screens & auth ---------- */
function show(id) { document.querySelectorAll('#shell>.screen').forEach(s => s.classList.toggle('on', s.id === id)); }
(async () => {
  if (token) { try { me = (await api('/me')).user; enter(); } catch (e) { setToken(null); } }
})();
const formLogin = () => { $('#signf').style.display = 'none'; $('#loginf').style.display = 'block'; show('auth'); };
const formSignup = () => { $('#loginf').style.display = 'none'; $('#signf').style.display = 'block'; show('auth'); };
$('#wsin').onclick = formLogin; $('#wsup').onclick = formSignup; $('#backw').onclick = () => show('splash');
$('#tosu').onclick = () => { $('#loginf').style.display = 'none'; $('#signf').style.display = 'block'; };
$('#tosi').onclick = () => { $('#signf').style.display = 'none'; $('#loginf').style.display = 'block'; };
const gmsg = () => modal(`<h2>Set up Google sign-in</h2><p style="color:var(--txt);line-height:1.6">Google needs a one-time setup that only the site owner can do (it needs your own Google Client ID):</p><ol style="color:var(--txt);line-height:1.7;padding-left:20px"><li>Open <b>console.cloud.google.com</b> &rarr; APIs &amp; Services &rarr; Credentials &rarr; Create credentials &rarr; <b>OAuth client ID</b> &rarr; Web application.</li><li>Add the address of this site (for example <b>http://localhost:3000</b>) under <b>Authorized JavaScript origins</b>.</li><li>Copy the Client ID and paste it in <b>public/config.js</b> (or <b>GOOGLE_CLIENT_ID</b> in .env). Refresh this page.</li></ol><p style="color:var(--mute)">Until then, please use email sign-in.</p><button class="btn" id="mclose">Got it</button>`) || ($('#mclose').onclick = closeM);
$('#g1').onclick = gmsg; $('#g2').onclick = gmsg;

const emailRe = /^\S+@\S+\.\S+$/, phoneRe = /^\+?\d{10,13}$/;
function authBtn(btn, errSel, label, fn) {
  btn.onclick = async () => {
    if (btn.disabled) return; $(errSel).textContent = '';
    try { btn.disabled = true; btn.textContent = 'Please wait…'; await fn(); }
    catch (e) { $(errSel).textContent = e.message; }
    finally { btn.disabled = false; btn.textContent = label; }
  };
}
authBtn($('#lgo'), '#aerr1', 'CONTINUE', async () => {
  const email = $('#le').value.trim(), password = $('#lp').value;
  if (!emailRe.test(email)) throw new Error('Enter a valid email.');
  if (!password) throw new Error('Enter your password.');
  const r = await api('/auth/login', { method: 'POST', body: { email, password } });
  setToken(r.token); me = r.user; enter();
});
authBtn($('#sgo'), '#aerr2', 'CREATE ACCOUNT', async () => {
  const name = $('#sn').value.trim(), email = $('#se').value.trim(), phone = $('#sp').value.replace(/[\s-]/g, ''), pw = $('#sw').value;
  if (!name) throw new Error('Enter your full name.');
  if (!emailRe.test(email)) throw new Error('Enter a valid email.');
  if (!phoneRe.test(phone)) throw new Error('Enter a valid phone number (10 digits).');
  if (pw.length < 6) throw new Error('Password must be at least 6 characters.');
  if (pw !== $('#sc').value) throw new Error('Password and Confirm Password do not match.');
  if (!$('#stc').checked) throw new Error('Please tick the Terms & Conditions checkbox.');
  const r = await api('/auth/signup', { method: 'POST', body: { name, email, phone, password: pw } });
  setToken(r.token); me = r.user; enter();
});
modeReady.then(() => { if (mode === 'local') $('#auth').insertAdjacentHTML('beforeend', '<p class="note">Offline mode: your account and data are saved in this browser only. Run the Node server (npm start) to keep them in a database.</p>'); });
$('#forgot').onclick = () => {
  modal(`<h2>Forgot Password</h2><br><input id="fe" type="email" placeholder="Registered email" value="${esc($('#le').value)}"><button class="btn dark" id="fgo">Send reset code</button>`);
  $('#fgo').onclick = run($('#fgo'), async () => {
    const email = $('#fe').value.trim(); const r = await api('/auth/forgot', { method: 'POST', body: { email } });
    modal(`<h2>Enter reset code</h2><p style="color:var(--mute)">${r.devCode ? 'Dev mode: your code is <b>' + r.devCode + '</b>' : 'If this email is registered, a code has been sent.'}</p><input id="rc" inputmode="numeric" placeholder="6-digit code"><input id="rn" type="password" placeholder="New password (min 6)"><button class="btn dark" id="rgo">Reset password</button>`);
    $('#rgo').onclick = run($('#rgo'), async () => { await api('/auth/reset', { method: 'POST', body: { email, code: $('#rc').value.trim(), newPassword: $('#rn').value } }); closeM(); toast('Password reset. You can sign in now.'); });
  });
};
function tc() {
  modal(`<h2>Terms &amp; Conditions</h2><p style="line-height:1.6;color:var(--txt)">ShaktiSetu is a safety-assist tool, not a replacement for emergency services. Always call 112 / 100 / 1091 directly in an emergency. Your data (profile, contacts, evidence) is stored securely on the server and only you can see it. Your location is shared only at the time of an SOS, and only with the contacts you chose.</p><button class="btn" id="mclose">Close</button>`);
  $('#mclose').onclick = closeM;
}
$('#tcl').onclick = e => { e.preventDefault(); tc(); }; $('#stc2').onclick = tc;

function enter() {
  show('app'); go('home'); $('#wel').textContent = 'Welcome back, ' + me.name.split(' ')[0];
  renderFake(); applyToggles(); refreshCon().catch(() => {});
}
function logout() { setToken(null); me = null; contacts = []; stopVoice(); if (shakeOn) { window.removeEventListener('devicemotion', onMotion); shakeOn = false; } show('splash'); }
$('#slog').onclick = logout;
function go(p) {
  document.querySelectorAll('#app>section').forEach(s => s.classList.toggle('on', s.id === 'p-' + p));
  document.querySelectorAll('.nav button').forEach(b => b.classList.toggle('on', b.dataset.p === p && !b.classList.contains('mid')));
  if (p === 'ev') renderEv(); if (p === 'con') { renderCon(); refreshCon().then(renderCon).catch(() => {}); }
}
document.querySelectorAll('.nav button').forEach(b => b.onclick = () => go(b.dataset.p));
$('#qfake').onclick = () => go('fake'); $('#bell').onclick = () => toast('No new alerts.');

/* ---------- contacts ---------- */
async function refreshCon() { contacts = (await api('/contacts')).contacts; }
function renderCon() {
  $('#clist').innerHTML = contacts.length ? contacts.map(c => `<div class="row" style="cursor:default"><span class="ic">👤</span><div><b>${esc(c.name)}</b><small>${esc(c.phone)}</small></div><button class="pill" style="margin-left:auto" data-del="${c.id}" aria-label="Delete">🗑️</button></div>`).join('') : '<div class="empty" style="padding:130px 0">🛡️<br>No contacts added yet</div>';
}
$('#clist').onclick = async e => {
  const b = e.target.closest('[data-del]'); if (!b) return;
  try { await api('/contacts/' + b.dataset.del, { method: 'DELETE' }); await refreshCon(); renderCon(); } catch (err) { toast(err.message); }
};
$('#cadd').onclick = () => {
  modal(`<h2>Add New Member</h2><br><input id="mn" placeholder="Name"><input id="mm" type="tel" placeholder="Phone (e.g. 9876543210)"><button class="btn dark" id="msv">Save contact</button>`);
  $('#msv').onclick = run($('#msv'), async () => {
    await api('/contacts', { method: 'POST', body: { name: $('#mn').value, phone: $('#mm').value } });
    closeM(); await refreshCon(); renderCon(); toast('Contact added.');
  });
};

/* ---------- evidence ---------- */
let urls = [];
async function blobUrl(id) {
  await modeReady;
  if (mode === 'local') { const u = await localBlob(id); urls.push(u); return u; }
  const r = await fetch('/api/evidence/' + id + '/file', { headers: { Authorization: 'Bearer ' + token } }); if (!r.ok) throw 0; const u = URL.createObjectURL(await r.blob()); urls.push(u); return u;
}
async function renderEv() {
  let list; try { list = (await api('/evidence')).evidence; } catch (e) { return toast(e.message); }
  urls.forEach(URL.revokeObjectURL); urls = [];
  const fmtT = t => new Date(t.replace(' ', 'T') + 'Z').toLocaleString();
  const p = list.filter(x => x.type === 'photo'), a = list.filter(x => x.type === 'audio');
  $('#photos').innerHTML = p.length ? '<div class="ph">' + p.map(x => `<div><img data-id="${x.id}" alt="photo"><small style="color:var(--mute)">${fmtT(x.created_at)}</small></div>`).join('') + '</div>' : '<div class="empty">No photos captured yet</div>';
  $('#audios').innerHTML = a.length ? a.map(x => `<div style="margin:8px 0"><small style="color:var(--mute)">${fmtT(x.created_at)}</small><audio controls data-id="${x.id}" style="width:100%"></audio></div>`).join('') : '<div class="empty">No audio recordings found</div>';
  document.querySelectorAll('#p-ev [data-id]').forEach(el => blobUrl(el.dataset.id).then(u => el.src = u).catch(() => {}));
}
$('#evdel').onclick = run($('#evdel'), async () => { if (!confirm('Delete all evidence?')) return; await api('/evidence', { method: 'DELETE' }); await renderEv(); toast('✅ Evidence deleted.'); });

/* ---------- SOS ---------- */
let sosOn = false, sosId = null, actx, osc, gain, sirenT, muted = false, rec, stream, chunks = [];
function siren() { try { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); actx.resume(); osc = actx.createOscillator(); gain = actx.createGain(); osc.type = 'sawtooth'; osc.connect(gain); gain.connect(actx.destination); gain.gain.value = muted ? 0 : .6; osc.start(); let up = true, f = 600; sirenT = setInterval(() => { f += up ? 40 : -40; if (f > 1300) up = false; if (f < 600) up = true; osc.frequency.value = f; }, 30); } catch (e) {} }
function stopSiren() { clearInterval(sirenT); try { osc && osc.stop(); } catch (e) {} osc = null; }
$('#mute').onclick = () => { muted = !muted; if (gain) gain.gain.value = muted ? 0 : .6; $('#mute').textContent = muted ? '🔇 Unmute siren' : '🔊 Mute siren'; };
const loc = () => new Promise(r => { if (!navigator.geolocation) return r(null); navigator.geolocation.getCurrentPosition(p => r(p.coords), () => r(null), { enableHighAccuracy: true, timeout: 9000, maximumAge: 0 }); });
const waNum = n => { n = n.replace(/\D/g, ''); return n.length === 10 ? '91' + n : n; };
function localMsg(c) {
  const url = c ? `https://www.openstreetmap.org/?mlat=${c.latitude}&mlon=${c.longitude}#map=18/${c.latitude}/${c.longitude}` : '(location unavailable)';
  return `🆘 SHAKTI SETU: EMERGENCY!\nI need help!\n📍 View my Live Location:\n${url}\n🕐 Time: ${new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }).toUpperCase()}`;
}
async function startSOS() {
  if (sosOn || !token) return; sosOn = true; sosId = null; muted = false; $('#mute').textContent = '🔊 Mute siren';
  $('#sosinfo').textContent = 'Getting your location… recording has started.'; $('#sendl').innerHTML = '';
  $('#sosov').classList.add('on'); startTimer(); siren(); navigator.vibrate && navigator.vibrate([400, 200, 400]);
  evidence();
  const c = await loc(); let msg, list = contacts, note = '';
  try {
    const r = await api('/sos', { method: 'POST', body: { lat: c ? c.latitude : null, lng: c ? c.longitude : null, accuracy: c ? c.accuracy : null } });
    sosId = r.id; msg = r.message; list = r.contacts;
    if (r.sms.enabled) note = `<p>✅ ${r.sms.sent} contact(s) ko SMS bheja gaya${r.sms.failed ? ', ' + r.sms.failed + ' fail' : ''}.</p>`;
  } catch (e) { msg = localMsg(c); note = '<p>Could not reach the server. Please send the message manually.</p>'; }
  $('#sosinfo').textContent = c ? 'Location found. Send the alert to your contacts below.' : 'Location unavailable (check permission). The message will go without a location.';
  $('#sendl').innerHTML = note + (list.length ? list.map(x => `<a class="sosbtn" target="_blank" rel="noopener" href="https://wa.me/${waNum(x.phone)}?text=${encodeURIComponent(msg)}">💬 WhatsApp: ${esc(x.name)}</a><a class="sosbtn" href="sms:${esc(x.phone)}?body=${encodeURIComponent(msg)}">✉️ SMS: ${esc(x.name)}</a>`).join('') : '<p>No emergency contacts yet. Add them in the Contacts tab.</p>') + '<a class="sosbtn" href="tel:112">📞 Call 112</a>';
}
function upload(type, blob) { const f = new FormData(); f.append('type', type); if (sosId) f.append('sosId', sosId); f.append('file', blob, type === 'photo' ? 'photo.jpg' : 'audio'); return api('/evidence', { method: 'POST', body: f }).catch(() => {}); }
async function evidence() {
  try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: true }); } catch (e) { try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch (e2) { return; } }
  try { chunks = []; rec = new MediaRecorder(new MediaStream(stream.getAudioTracks())); rec.ondataavailable = e => e.data.size && chunks.push(e.data); rec.onstop = () => { if (chunks.length) upload('audio', new Blob(chunks, { type: (rec.mimeType || 'audio/webm').split(';')[0] })); }; rec.start(); } catch (e) {}
  if (stream.getVideoTracks().length) {
    const v = document.createElement('video'); v.muted = true; v.playsInline = true; v.srcObject = stream; await v.play().catch(() => {});
    setTimeout(() => { try { const cv = document.createElement('canvas'); cv.width = v.videoWidth || 640; cv.height = v.videoHeight || 480; cv.getContext('2d').drawImage(v, 0, 0); cv.toBlob(b => b && upload('photo', b), 'image/jpeg', .75); stream.getVideoTracks().forEach(t => t.stop()); } catch (e) {} }, 1200);
  }
}
function endSOS() { clearInterval(sosTimer); stopSiren(); try { rec && rec.state !== 'inactive' && rec.stop(); } catch (e) {} stream && stream.getTracks().forEach(t => t.stop()); sosOn = false; $('#sosov').classList.remove('on'); navigator.vibrate && navigator.vibrate(0); toast('Emergency dismissed. Evidence is being saved.'); }
$('#sosb').onclick = startSOS;
$('#dismiss').onclick = run($('#dismiss'), async () => {
  const p = prompt('Enter your SOS PIN to dismiss the emergency'); if (p === null) return;
  await api('/sos/dismiss', { method: 'POST', body: { pin: p, id: sosId } }); endSOS();
});

/* ---------- fake call ---------- */
let delay = 5, ringT, callT, secs = 0;
function renderFake() {
  $('#fn').textContent = me.fake.name; $('#fnum').textContent = me.fake.num;
  $('#delays').innerHTML = [['Instant', 0], ['5s', 5], ['15s', 15], ['30s', 30], ['1m', 60]].map(([l, v]) => `<button class="pill ${v === delay ? 'on' : ''}" data-d="${v}">${l}</button>`).join('');
  document.querySelectorAll('#delays .pill').forEach(b => b.onclick = () => { delay = +b.dataset.d; renderFake(); });
}
$('#fedit').onclick = () => {
  modal(`<h2>Edit Identity</h2><br><input id="fnn" value="${esc(me.fake.name)}" placeholder="Caller name"><input id="fnu" value="${esc(me.fake.num)}" placeholder="Caller number"><button class="btn dark" id="fsv">Save</button>`);
  $('#fsv').onclick = run($('#fsv'), async () => { me = (await api('/me/fake', { method: 'PUT', body: { name: $('#fnn').value, num: $('#fnu').value } })).user; closeM(); renderFake(); });
};
$('#fsched').onclick = () => { toast(delay ? `Fake call will ring in ${delay >= 60 ? '1 min' : delay + 's'}. Keep the screen on.` : 'Fake call incoming…'); setTimeout(incoming, delay * 1000); };
function incoming() {
  $('#cn').textContent = me.fake.name; $('#cs').textContent = 'Incoming call… ' + me.fake.num; $('#cacc').style.display = ''; $('#callov').classList.add('on');
  let n = 0; const ring = () => { try { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); actx.resume(); const o = actx.createOscillator(), g = actx.createGain(); o.frequency.value = n % 2 ? 480 : 440; o.connect(g); g.connect(actx.destination); g.gain.setValueAtTime(.25, actx.currentTime); g.gain.setValueAtTime(0, actx.currentTime + .9); o.start(); o.stop(actx.currentTime + 1); n++; } catch (e) {} navigator.vibrate && navigator.vibrate([700, 300]); };
  ring(); ringT = setInterval(ring, 2000);
}
function endCall() { clearInterval(ringT); clearInterval(callT); $('#callov').classList.remove('on'); navigator.vibrate && navigator.vibrate(0); }
$('#cdec').onclick = endCall;
$('#cacc').onclick = () => { clearInterval(ringT); $('#cacc').style.display = 'none'; secs = 0; $('#cs').textContent = '00:00'; callT = setInterval(() => { secs++; $('#cs').textContent = String(Math.floor(secs / 60)).padStart(2, '0') + ':' + String(secs % 60).padStart(2, '0'); }, 1000); };

/* ---------- settings ---------- */
let shakeOn = false, voiceOn = false, rc, shakes = [];
function applyToggles() { $('#swshake').classList.toggle('on', me.settings.shake); $('#swvoice').classList.toggle('on', me.settings.voice); if (me.settings.shake) startShake(); if (me.settings.voice) startVoice(); }
const setOpt = (k, v) => api('/me/settings', { method: 'PUT', body: { [k]: v } }).then(r => me = r.user).catch(() => {});
function onMotion(e) { const a = e.accelerationIncludingGravity; if (!a) return; const m = Math.hypot(a.x || 0, a.y || 0, a.z || 0); if (m > 28) { const n = Date.now(); shakes = shakes.filter(t => n - t < 1500); if (!shakes.length || n - shakes[shakes.length - 1] > 150) shakes.push(n); if (shakes.length >= 3) { shakes = []; startSOS(); } } }
async function startShake() { if (shakeOn) return true; try { if (window.DeviceMotionEvent && DeviceMotionEvent.requestPermission && await DeviceMotionEvent.requestPermission() !== 'granted') return false; } catch (e) { return false; } window.addEventListener('devicemotion', onMotion); shakeOn = true; return true; }
$('#swshake').onclick = async () => {
  if ($('#swshake').classList.contains('on')) { window.removeEventListener('devicemotion', onMotion); shakeOn = false; setOpt('shake', false); $('#swshake').classList.remove('on'); }
  else { if (!('DeviceMotionEvent' in window)) return toast('Shake sensor is not available on this device.'); if (await startShake()) { setOpt('shake', true); $('#swshake').classList.add('on'); toast('Shake your phone 3 times hard to trigger SOS.'); } else toast('Motion permission was denied.'); }
};
function startVoice() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition; if (!SR) { toast('Voice command is not supported in this browser (use Chrome).'); return false; }
  if (voiceOn) return true; voiceOn = true; rc = new SR(); rc.continuous = true; rc.lang = 'en-IN'; rc.interimResults = true;
  rc.onresult = e => { const t = [...e.results].slice(e.resultIndex).map(r => r[0].transcript.toLowerCase()).join(' '); if (/\bhelp\b|bachao|बचाओ|हेल्प/.test(t)) startSOS(); };
  rc.onend = () => { if (voiceOn) try { rc.start(); } catch (e) {} };
  rc.onerror = e => { if (e.error === 'not-allowed') { voiceOn = false; setOpt('voice', false); $('#swvoice').classList.remove('on'); } };
  try { rc.start(); } catch (e) {} return true;
}
function stopVoice() { voiceOn = false; try { rc && rc.stop(); } catch (e) {} }
$('#swvoice').onclick = () => {
  if ($('#swvoice').classList.contains('on')) { stopVoice(); setOpt('voice', false); $('#swvoice').classList.remove('on'); }
  else if (startVoice()) { setOpt('voice', true); $('#swvoice').classList.add('on'); toast('Say "Help" to trigger SOS.'); }
};
$('#sprof').onclick = () => {
  modal(`<h2>My Profile</h2><br><input id="pn" value="${esc(me.name)}" placeholder="Full name"><input value="${esc(me.email)}" disabled><input id="pp" value="${esc(me.phone)}" placeholder="Phone"><button class="btn dark" id="psv">Save profile</button>`);
  $('#psv').onclick = run($('#psv'), async () => { me = (await api('/me', { method: 'PUT', body: { name: $('#pn').value, phone: $('#pp').value } })).user; $('#wel').textContent = 'Welcome back, ' + me.name.split(' ')[0]; closeM(); toast('Profile updated.'); });
};
$('#spin').onclick = () => {
  modal(`<h2>Change SOS PIN</h2><p style="color:var(--mute)">This PIN is required to dismiss an emergency (default 1234).</p><input id="op" type="password" inputmode="numeric" placeholder="Current PIN"><input id="np" type="password" inputmode="numeric" maxlength="6" placeholder="New PIN (4-6 digits)"><button class="btn dark" id="pvs">Update PIN</button>`);
  $('#pvs').onclick = run($('#pvs'), async () => { await api('/me/pin', { method: 'PUT', body: { oldPin: $('#op').value, newPin: $('#np').value } }); closeM(); toast('SOS PIN changed.'); });
};
$('#spw').onclick = () => {
  modal(`<h2>Reset Password</h2><br><input id="rp0" type="password" placeholder="Current password"><input id="rp1" type="password" placeholder="New password (min 6)"><input id="rp2" type="password" placeholder="Confirm new password"><button class="btn dark" id="rsv">Update password</button>`);
  $('#rsv').onclick = run($('#rsv'), async () => { if ($('#rp1').value !== $('#rp2').value) return toast('Passwords do not match.'); await api('/me/password', { method: 'PUT', body: { oldPassword: $('#rp0').value, newPassword: $('#rp1').value } }); closeM(); toast('Password updated.'); });
};

/* ---------- Google sign-in / sign-up (Google Identity Services) ---------- */
async function onGoogle(resp) {
  try { const r = await api('/auth/google', { method: 'POST', body: { credential: resp.credential } }); setToken(r.token); me = r.user; enter(); }
  catch (e) { $($('#loginf').style.display === 'none' ? '#aerr2' : '#aerr1').textContent = e.message; }
}
(async function initGoogle() {
  await modeReady; let cid = window.SHAKTI_CONFIG && window.SHAKTI_CONFIG.googleClientId;
  if (!cid && mode === 'server') { try { cid = (await (await fetch('/api/config')).json()).googleClientId; } catch (e) {} }
  if (!cid) return; // keep the fallback button (it explains the one-time setup)
  await new Promise(res => { const s = document.createElement('script'); s.src = 'https://accounts.google.com/gsi/client'; s.async = true; s.onload = res; s.onerror = res; document.head.appendChild(s); });
  if (!window.google || !google.accounts) return;
  google.accounts.id.initialize({ client_id: cid, callback: onGoogle });
  const w = Math.max(200, Math.min(380, window.innerWidth - 40));
  [['gbtn1', 'continue_with'], ['gbtn2', 'signup_with']].forEach(([id, text]) => google.accounts.id.renderButton($('#' + id), { theme: 'outline', size: 'large', text, shape: 'pill', width: w, logo_alignment: 'center' }));
  $('#g1').style.display = $('#g2').style.display = 'none';
})();

/* ---------- UX helpers ---------- */
let sosTimer;
function startTimer() { const t0 = Date.now(), el = $('#sostimer'); clearInterval(sosTimer); el.textContent = '00:00'; sosTimer = setInterval(() => { const s = Math.floor((Date.now() - t0) / 1000); el.textContent = String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); }, 1000); }
const EYE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_OFF = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17.94 17.94A10.1 10.1 0 0 1 12 20c-7 0-11-8-11-8a18.5 18.5 0 0 1 5.06-5.94M9.9 4.24A9.1 9.1 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19M14.12 14.12a3 3 0 1 1-4.24-4.24"/><path d="M1 1l22 22"/></svg>';
function enhance(root = document) {
  root.querySelectorAll('input[type=password]').forEach(i => {
    if (i.dataset.pw) return; i.dataset.pw = 1;
    const w = document.createElement('div'); w.className = 'pw'; i.parentNode.insertBefore(w, i); w.appendChild(i);
    const b = document.createElement('button'); b.type = 'button'; b.className = 'eye'; b.innerHTML = EYE; b.setAttribute('aria-label', 'Show password'); b.setAttribute('aria-pressed', 'false');
    b.onclick = () => { const show = i.type === 'password'; i.type = show ? 'text' : 'password'; b.innerHTML = show ? EYE_OFF : EYE; b.setAttribute('aria-label', show ? 'Hide password' : 'Show password'); b.setAttribute('aria-pressed', String(show)); i.focus(); };
    w.appendChild(b);
  });
  root.querySelectorAll('input[placeholder]:not([aria-label])').forEach(i => i.setAttribute('aria-label', i.placeholder));
}
enhance();
$('#sw').addEventListener('input', e => {
  const v = e.target.value, h = $('#pwhint'); let s = 0; if (v.length >= 6) s++; if (v.length >= 10) s++; if (/[A-Z]/.test(v) && /[a-z]/.test(v)) s++; if (/\d/.test(v)) s++; if (/[^A-Za-z0-9]/.test(v)) s++;
  if (!v) { h.className = 'hint'; h.textContent = 'Use at least 6 characters.'; }
  else if (v.length < 6) { h.className = 'hint weak'; h.textContent = 'Too short - use at least 6 characters.'; }
  else if (s <= 2) { h.className = 'hint ok'; h.textContent = 'OK - add numbers, capitals or symbols to make it stronger.'; }
  else { h.className = 'hint strong'; h.textContent = 'Strong password.'; }
});
// Enter key submits forms and dialogs
$('#loginf').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); $('#lgo').click(); } });
$('#signf').addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.type !== 'checkbox') { e.preventDefault(); $('#sgo').click(); } });
$('#mob').addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') { const b = $('#mob .btn'); if (b) { e.preventDefault(); b.click(); } } });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && $('#mo').classList.contains('on')) closeM(); });
// tap a photo to view it larger
$('#photos').addEventListener('click', e => { if (e.target.tagName === 'IMG' && e.target.src) { modal(`<img src="${e.target.src}" alt="Captured photo" style="width:100%;border-radius:16px;margin-bottom:14px"><button class="btn dark" id="mclose">Close</button>`); $('#mclose').onclick = closeM; } });
// focus the first field when a form opens
['#wsin', '#wsup'].forEach(s => $(s).addEventListener('click', () => { if (!coarse()) setTimeout(() => { const f = $('#loginf').style.display === 'none' ? $('#sn') : $('#le'); f && f.focus(); }, 60); }));
$('#tosu').addEventListener('click', () => $('#sn').focus()); $('#tosi').addEventListener('click', () => $('#le').focus());
