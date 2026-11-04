const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const reports = require("./reports");
const { db } = require("./database");

const PAGE_SIZE = 20;
const PERIOD_LABELS = {
  today: "Today",
  weekly: "This Week",
  monthly: "This Month",
  lifetime: "Lifetime"
};

async function fetchSteamLinkRoster() {
  const endpoint = process.env.STEAM_LINK_ROSTER_URL ||
    "https://steam-link-production.up.railway.app/internal/roster";
  const token = process.env.STEAM_LINK_ROSTER_TOKEN || "";

  if (!/^https:\/\//i.test(endpoint)) {
    throw new Error("STEAM_LINK_ROSTER_URL must be an HTTPS URL.");
  }
  if (!/^[a-f0-9]{64}$/i.test(token)) {
    throw new Error("STEAM_LINK_ROSTER_TOKEN must be configured as a 64-character hexadecimal token.");
  }

  const response = await fetch(endpoint, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    signal: AbortSignal.timeout(10000)
  });

  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error(`Steam-link roster endpoint returned invalid JSON (HTTP ${response.status}).`);
  }

  if (!response.ok || data?.ok !== true || data?.complete !== true || !Array.isArray(data.members)) {
    throw new Error(data?.error || `Steam-link roster is unavailable (HTTP ${response.status}).`);
  }

  return data.members.filter(member =>
    member && /^[0-9]{17,20}$/.test(String(member.id || "")) &&
    typeof member.displayName === "string" &&
    typeof member.username === "string" &&
    typeof member.role === "string" &&
    member.role.length > 0
  );
}

async function buildReport(guild, period, requestedPage = 0) {
  if (!PERIOD_LABELS[period]) throw new Error("Unsupported zero-activity reporting period.");

  // Reuse Steam-link's existing complete Gump/Recruit roster. This endpoint
  // serves the bot's cached roster and does not trigger another Discord fetch.
  const eligible = await fetchSteamLinkRoster();

  // One aggregate query checks both regular voice and AFK segments for the selected period.
  const range = reports.ranges()[period];
  const activeRows = db.prepare(`SELECT user_id,
    SUM(MAX(0, MIN(COALESCE(ended_at, ?), ?) - MAX(started_at, ?))) AS total_ms
    FROM voice_segments
    WHERE started_at < ? AND COALESCE(ended_at, ?) > ?
    GROUP BY user_id HAVING total_ms > 0`)
    .all(range.end, range.end, range.start, range.end, range.end, range.start);
  const activeIds = new Set(activeRows.map(row => row.user_id));
  // AFK time is included: any voice or AFK time means the member is not at zero.
  const inactive = eligible.filter(member => !activeIds.has(member.id)).map(member => ({
    displayName: member.displayName,
    username: member.username,
    role: member.role
  })).sort((a, b) => a.displayName.localeCompare(b.displayName));

  const pageCount = Math.max(1, Math.ceil(inactive.length / PAGE_SIZE));
  const page = Math.min(Math.max(0, Number(requestedPage) || 0), pageCount - 1);
  const pageMembers = inactive.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const description = pageMembers.length
    ? pageMembers.map(member =>
      `**${member.displayName}** (@${member.username}) — ${member.role} — \`0:00:00\``
    ).join("\n")
    : "Everyone with the Gump or Recruit role has recorded voice or AFK time during this period.";

  const embed = new EmbedBuilder()
    .setColor(0xED4245)
    .setTitle(`ZERO VOICE ACTIVITY — ${PERIOD_LABELS[period].toUpperCase()}`)
    .setDescription(description)
    .setFooter({ text: `${inactive.length} member(s) with zero voice activity • Page ${page + 1}/${pageCount}` })
    .setTimestamp();

  const components = [];
  if (pageCount > 1) {
    components.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`zero:${period}:${Math.max(0, page - 1)}`)
        .setLabel("Previous")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page === 0),
      new ButtonBuilder()
        .setCustomId(`zero:${period}:${Math.min(pageCount - 1, page + 1)}`)
        .setLabel("Next")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page >= pageCount - 1)
    ));
  }
  return { embeds: [embed], components };
}

module.exports = { buildReport };
