const store = require("./database");

function memberNames(member) {
  return {
    id: member.id,
    username: member.user.username,
    displayName: member.displayName || member.user.globalName || member.user.username
  };
}

function isAfk(channelId) {
  return Boolean(channelId && channelId === process.env.AFK_CHANNEL_ID);
}

async function handleVoiceStateUpdate(oldState, newState) {
  if (newState.guild.id !== process.env.GUILD_ID) return;
  const member = newState.member || oldState.member;
  if (!member || member.user.bot) return;

  const oldChannel = oldState.channelId;
  const newChannel = newState.channelId;
  const now = Date.now();
  const names = memberNames(member);

  if (!oldChannel && newChannel) {
    store.start({...names, now, kind: isAfk(newChannel) ? "afk" : "voice"});
    return;
  }
  if (oldChannel && !newChannel) {
    store.stop(member.id, now);
    return;
  }
  if (oldChannel && newChannel) {
    // A move between ordinary voice channels is still one continuous voice session.
    const oldKind = isAfk(oldChannel) ? "afk" : "voice";
    const newKind = isAfk(newChannel) ? "afk" : "voice";
    if (oldKind !== newKind) store.transition({...names, now, kind:newKind});
    else {
      store.statements.upsertMember.run({...names, now});
    }
  }
}

async function reconcileOnReady(guild) {
  const now = Date.now();
  await guild.members.fetch();
  const connected = new Map();
  for (const [, member] of guild.members.cache) {
    if (member.voice.channelId && !member.user.bot) connected.set(member.id, member);
  }

  for (const active of store.statements.allActive.all()) {
    const member = connected.get(active.user_id);
    if (!member) {
      // The bot was offline when this member disconnected; close at restart time.
      store.recoverStop(active.user_id, now);
      continue;
    }
    const kind = isAfk(member.voice.channelId) ? "afk" : "voice";
    if (kind !== active.kind) {
      store.transition({...memberNames(member),now,kind});
    } else {
      store.statements.upsertMember.run({...memberNames(member),now});
    }
    connected.delete(member.id);
  }

  // A member already connected when the bot starts is tracked from startup onward.
  for (const member of connected.values()) {
    store.start({...memberNames(member),now,kind:isAfk(member.voice.channelId) ? "afk" : "voice"});
  }
}

module.exports = { handleVoiceStateUpdate, reconcileOnReady };
