// Database layer: SQLite via better-sqlite3 (file based, zero setup).
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'shaktisetu.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  phone         TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  pin_hash      TEXT NOT NULL,
  fake_name     TEXT NOT NULL DEFAULT 'Harsh',
  fake_number   TEXT NOT NULL DEFAULT '+91 82950 00000',
  shake         INTEGER NOT NULL DEFAULT 0,
  voice         INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS contacts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  phone      TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_contacts_user ON contacts(user_id);

CREATE TABLE IF NOT EXISTS sos_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lat        REAL,
  lng        REAL,
  accuracy   REAL,
  message    TEXT NOT NULL,
  sms_sent   INTEGER NOT NULL DEFAULT 0,
  status     TEXT NOT NULL DEFAULT 'active',
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ended_at   TEXT
);
CREATE INDEX IF NOT EXISTS idx_sos_user ON sos_events(user_id);

CREATE TABLE IF NOT EXISTS evidence (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sos_id     INTEGER REFERENCES sos_events(id) ON DELETE SET NULL,
  type       TEXT NOT NULL CHECK (type IN ('photo','audio')),
  filename   TEXT NOT NULL,
  mime       TEXT NOT NULL,
  size       INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_evidence_user ON evidence(user_id);

CREATE TABLE IF NOT EXISTS reset_codes (
  email      TEXT PRIMARY KEY,
  code_hash  TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts   INTEGER NOT NULL DEFAULT 0
);
`);

module.exports = { db, DATA_DIR };
