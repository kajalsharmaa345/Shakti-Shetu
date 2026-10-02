# ShaktiSetu - A Bridge to Safety (Full Stack)

| Layer | Tech |
|---|---|
| Frontend | HTML, CSS, vanilla JS (`public/`) |
| Backend | Node.js 18+, Express (`server.js`) |
| Database | SQLite via better-sqlite3 (`db.js`, file: `data/shaktisetu.db`) |
| API | REST + JSON, JWT auth (Bearer token) |
| Files | Evidence photos/audio saved in `data/uploads/<userId>/` |
| Security | bcrypt password + PIN hashes, helmet (CSP), rate limiting, per-user data isolation |
| SMS (optional) | Twilio REST API (no extra package) |

## Two modes (automatic)
- **Server mode:** when the Node server is running, everything is stored in the SQLite database.
- **Local mode:** if the server is not reachable (static hosting, Live Server, opening `public/index.html` directly), the same app still works fully and keeps data in the browser only (`public/local.js`).

## Run
```bash
npm install
cp .env.example .env      # set JWT_SECRET
npm start                 # http://localhost:3000
```
Camera, mic and location need HTTPS (localhost is fine for testing).

## Structure
```
server.js        API routes + static hosting
db.js            schema (users, contacts, sos_events, evidence, reset_codes)
public/          index.html, style.css, app.js
data/            created at runtime (DB + uploads)
```

## API
| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | /api/auth/signup | no | create account |
| POST | /api/auth/login | no | login, returns token |
| GET | /api/config | no | public config (Google client id) |
| POST | /api/auth/google | no | Google sign-in / sign-up (verifies Google ID token) |
| POST | /api/auth/forgot | no | create 6-digit reset code (printed in server log in dev) |
| POST | /api/auth/reset | no | reset password with code |
| GET/PUT | /api/me | yes | profile |
| PUT | /api/me/fake | yes | fake call identity |
| PUT | /api/me/settings | yes | shake / voice toggles |
| PUT | /api/me/pin | yes | change SOS PIN (default 1234) |
| PUT | /api/me/password | yes | change password |
| GET/POST | /api/contacts | yes | list / add emergency contact |
| DELETE | /api/contacts/:id | yes | remove contact |
| POST | /api/sos | yes | log SOS, build message, send SMS if Twilio set |
| POST | /api/sos/dismiss | yes | dismiss with PIN |
| GET | /api/sos | yes | SOS history |
| POST | /api/evidence | yes | upload photo/audio (multipart: type, file) |
| GET | /api/evidence | yes | list evidence |
| GET | /api/evidence/:id/file | yes | download file |
| DELETE | /api/evidence[/:id] | yes | delete all / one |

## Google sign-in setup (needed once)
1. console.cloud.google.com -> APIs & Services -> Credentials -> Create credentials -> OAuth client ID -> **Web application**.
2. Authorized JavaScript origins: `http://localhost:3000` (and your live https domain later).
3. Put the client id in `public/config.js` (`googleClientId`) - works in both modes - or in `.env` as `GOOGLE_CLIENT_ID=...` (server mode), then refresh.
4. The Google button now works on both Sign In and Sign Up pages (new Google users get an account automatically).
Google does not allow plain-IP origins (like http://192.168.x.x), so test Google login on localhost or an https domain.

## Deploy
Render / Railway / Fly.io / VPS: set `NODE_ENV=production`, `JWT_SECRET`, and mount a
persistent disk at `DATA_DIR` (SQLite + uploads must survive restarts). Serve over HTTPS.

## Known limits
- Password-reset codes are only logged to the server console; plug an email/SMS provider into `sendResetCode()` in `server.js` for real delivery.
- Without Twilio keys, SOS opens WhatsApp/SMS links on the phone (one tap per contact).
