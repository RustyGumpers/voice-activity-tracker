const { DateTime } = require("luxon");
const { db } = require("./database");

const zone = () => process.env.TIMEZONE || "America/New_York";
const nowLocal = () => DateTime.now().setZone(zone());
const ranges = () => {
  const n = nowLocal();
  return {
    today: {label:"Today",start:n.startOf("day").toMillis(),end:n.toMillis()},
    weekly: {label:"This Week",start:n.startOf("week").toMillis(),end:n.toMillis()},
    monthly: {label:"This Month",start:n.startOf("month").toMillis(),end:n.toMillis()},
    lifetime: {label:"Lifetime",start:0,end:n.toMillis()}
  };
};
function duration(ms) {
  const minutes = Math.max(0,Math.floor(ms/60000));
  const days = Math.floor(minutes/1440);
  const hours = Math.floor((minutes%1440)/60);
  const mins = minutes%60;
  return days ? `${days}d ${hours}h ${mins}m` : hours ? `${hours}h ${mins}m` : `${mins}m`;
}
function totalsFor(userId, start, end) {
  const rows = db.prepare(`SELECT kind,
    SUM(MAX(0, MIN(COALESCE(ended_at,?),?) - MAX(started_at,?))) AS ms
    FROM voice_segments
    WHERE (? IS NULL OR user_id=?)
      AND started_at < ?
      AND COALESCE(ended_at,?) > ?
    GROUP BY kind`).all(end,end,start,userId,userId,end,end,start);
  const result = {voice:0,afk:0};
  for (const row of rows) result[row.kind] = Number(row.ms || 0);
  return result;
}
function serverTotals() {
  const r = ranges();
  return Object.fromEntries(Object.entries(r).map(([key,v]) => [key,{...v,...totalsFor(null,v.start,v.end)}]));
}
function activeMembers(period) {
  const r = ranges()[period] || ranges().weekly;
  return db.prepare(`SELECT m.user_id,m.username,m.display_name,
    SUM(CASE WHEN s.kind='voice' THEN MAX(0,MIN(COALESCE(s.ended_at,?),?)-MAX(s.started_at,?)) ELSE 0 END) AS voice_ms,
    SUM(CASE WHEN s.kind='afk' THEN MAX(0,MIN(COALESCE(s.ended_at,?),?)-MAX(s.started_at,?)) ELSE 0 END) AS afk_ms
    FROM members m JOIN voice_segments s ON s.user_id=m.user_id
    WHERE s.started_at < ? AND COALESCE(s.ended_at,?) > ?
    GROUP BY m.user_id HAVING voice_ms > 0 OR afk_ms > 0
    ORDER BY voice_ms DESC, afk_ms DESC`).all(r.end,r.end,r.start,r.end,r.end,r.start,r.end,r.end,r.start)
    .map(x=>({...x,voice_ms:Number(x.voice_ms||0),afk_ms:Number(x.afk_ms||0)}));
}
function memberPeriods(userId) {
  const r = ranges();
  return Object.fromEntries(Object.entries(r).map(([key,v])=>[key,{...v,...totalsFor(userId,v.start,v.end)}]));
}
function weeklyDays(userId) {
  const n=nowLocal();
  return Array.from({length:7},(_,i)=>{
    const day=n.startOf("week").plus({days:i});
    const t=totalsFor(userId,day.toMillis(),Math.min(day.endOf("day").toMillis(),Date.now()));
    return {day:day.toFormat("ccc"),voice:t.voice,afk:t.afk};
  });
}
function sessions(userId, limit=10, offset=0) {
  const rows=db.prepare(`SELECT vs.id,vs.started_at,vs.ended_at,
    SUM(CASE WHEN sg.kind='voice' THEN MAX(0,MIN(COALESCE(sg.ended_at,?),?)-sg.started_at) ELSE 0 END) AS voice_ms,
    SUM(CASE WHEN sg.kind='afk' THEN MAX(0,MIN(COALESCE(sg.ended_at,?),?)-sg.started_at) ELSE 0 END) AS afk_ms
    FROM voice_sessions vs JOIN voice_segments sg ON sg.session_id=vs.id
    WHERE vs.user_id=? GROUP BY vs.id ORDER BY vs.started_at DESC LIMIT ? OFFSET ?`)
    .all(Date.now(),Date.now(),Date.now(),Date.now(),userId,limit,offset);
  return rows.map(x=>({...x,voice_ms:Number(x.voice_ms||0),afk_ms:Number(x.afk_ms||0)}));
}
function sessionCount(userId) {
  return db.prepare("SELECT COUNT(*) AS n FROM voice_sessions WHERE user_id=?").get(userId).n;
}
function memberById(userId) { return db.prepare("SELECT * FROM members WHERE user_id=?").get(userId); }

module.exports = { ranges, duration, serverTotals, activeMembers, memberPeriods, weeklyDays, sessions, sessionCount, memberById };
