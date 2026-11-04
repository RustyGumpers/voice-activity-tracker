const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const reports = require("./reports");

const PAGE_SIZE = 20;
const PERIOD_LABELS = {
  today: "Today",
  weekly: "This Week",
  monthly: "This Month"
};

function roleName(member, gumpRoleId, recruitRoleId) {
  const roles = [];
  if (member.roles.cache.has(gumpRoleId)) roles.push("Gump");
  if (member.roles.cache.has(recruitRoleId)) roles.push("Recruit");
  return roles.join(" / ");
}

async function buildReport(guild, period, requestedPage = 0) {
  if (!PERIOD_LABELS[period]) throw new Error("Unsupported zero-activity reporting period.");

  const gumpRoleId = process.env.GUMP_ROLE_ID;
  const recruitRoleId = process.env.RECRUIT_ROLE_ID;
  if (!gumpRoleId || !recruitRoleId) {
    throw new Error("GUMP_ROLE_ID and RECRUIT_ROLE_ID must be configured.");
  }

  // Fetch the full member roster so members who have never joined voice are included.
  const fetchedMembers = await guild.members.fetch();
  const eligible = [...fetchedMembers.values()].filter(member =>
    !member.user.bot &&
    (member.roles.cache.has(gumpRoleId) || member.roles.cache.has(recruitRoleId))
  );

  // AFK time is included: any voice or AFK time means the member is not at zero.
  const inactive = eligible.filter(member => {
    const totals = reports.memberPeriods(member.id)[period];
    return totals.voice + totals.afk === 0;
  }).map(member => ({
    displayName: member.displayName || member.user.globalName || member.user.username,
    username: member.user.username,
    role: roleName(member, gumpRoleId, recruitRoleId)
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
        .setCustomId(`zero:${period}:${page + 1}`)
        .setLabel(`Page ${page + 1}/${pageCount}`)
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true),
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
