const Database = require("better-sqlite3");
const fs = require("node:fs");
const path = require("node:path");

const filename = process.env.DATABASE_PATH || "./data/voice-activity.sqlite";
fs.mkdirSync(path.dirname(path.resolve(filename)), { recursive: true });
const db = new Database(filename);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS members (
  user_id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  display_name TEXT NOT NULL,
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS voice_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  FOREIGN KEY(user_id) REFERENCES members(user_id)
);
CREATE TABLE IF NOT EXISTS voice_segments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('voice','afk')),
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  FOREIGN KEY(session_id) REFERENCES voice_sessions(id),
  FOREIGN KEY(user_id) REFERENCES members(user_id)
);
CREATE INDEX IF NOT EXISTS idx_segments_user_start ON voice_segments(user_id, started_at);
CREATE INDEX IF NOT EXISTS idx_segments_start_end ON voice_segments(started_at, ended_at);
CREATE TABLE IF NOT EXISTS active_voice (
  user_id TEXT PRIMARY KEY,
  session_id INTEGER NOT NULL,
  segment_id INTEGER NOT NULL,
  session_started_at INTEGER NOT NULL,
  segment_started_at INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('voice','afk')),
  FOREIGN KEY(user_id) REFERENCES members(user_id),
  FOREIGN KEY(session_id) REFERENCES voice_sessions(id),
  FOREIGN KEY(segment_id) REFERENCES voice_segments(id)
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`);

const statements = {
  upsertMember: db.prepare(`INSERT INTO members(user_id,username,display_name,first_seen_at,last_seen_at)
    VALUES(@id,@username,@displayName,@now,@now)
    ON CONFLICT(user_id) DO UPDATE SET username=excluded.username,display_name=excluded.display_name,last_seen_at=excluded.last_seen_at`),
  startSession: db.prepare("INSERT INTO voice_sessions(user_id,started_at) VALUES(?,?)"),
  startSegment: db.prepare("INSERT INTO voice_segments(session_id,user_id,kind,started_at) VALUES(?,?,?,?)"),
  addActive: db.prepare(`INSERT OR REPLACE INTO active_voice(user_id,session_id,segment_id,session_started_at,segment_started_at,kind)
    VALUES(?,?,?,?,?,?)`),
  getActive: db.prepare("SELECT * FROM active_voice WHERE user_id=?"),
  closeSegment: db.prepare("UPDATE voice_segments SET ended_at=? WHERE id=? AND ended_at IS NULL"),
  closeSession: db.prepare("UPDATE voice_sessions SET ended_at=? WHERE id=? AND ended_at IS NULL"),
  removeActive: db.prepare("DELETE FROM active_voice WHERE user_id=?"),
  updateMember: db.prepare("UPDATE members SET username=?,display_name=?,last_seen_at=? WHERE user_id=?"),
  allActive: db.prepare("SELECT * FROM active_voice")
};

const start = db.transaction(({id, username, displayName, now, kind}) => {
  statements.upsertMember.run({id,username,displayName,now});
  const sessionId = statements.startSession.run(id,now).lastInsertRowid;
  const segmentId = statements.startSegment.run(sessionId,id,kind,now).lastInsertRowid;
  statements.addActive.run(id,sessionId,segmentId,now,now,kind);
});
const transition = db.transaction(({id, username, displayName, now, kind}) => {
  statements.upsertMember.run({id,username,displayName,now});
  const active = statements.getActive.get(id);
  if (!active) {
    const sessionId = statements.startSession.run(id,now).lastInsertRowid;
    const segmentId = statements.startSegment.run(sessionId,id,kind,now).lastInsertRowid;
    statements.addActive.run(id,sessionId,segmentId,now,now,kind);
    return;
  }
  statements.closeSegment.run(now,active.segment_id);
  const segmentId = statements.startSegment.run(active.session_id,id,kind,now).lastInsertRowid;
  statements.addActive.run(id,active.session_id,segmentId,active.session_started_at,now,kind);
});
const stop = db.transaction((id, now) => {
  const active = statements.getActive.get(id);
  if (!active) return;
  statements.closeSegment.run(now,active.segment_id);
  statements.closeSession.run(now,active.session_id);
  statements.removeActive.run(id);
});
const recoverStop = db.transaction((id, now) => {
  const active = statements.getActive.get(id);
  if (!active) return;
  statements.closeSegment.run(now,active.segment_id);
  statements.closeSession.run(now,active.session_id);
  statements.removeActive.run(id);
});

module.exports = { db, statements, start, transition, stop, recoverStop };
