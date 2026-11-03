require("dotenv").config();
const {
  Client, GatewayIntentBits, Events, REST, Routes,
  SlashCommandBuilder, PermissionFlagsBits,
  EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle
} = require("discord.js");
const store = require("./database");
const tracker = require("./tracker");
const reports = require("./reports");

const required=["DISCORD_TOKEN","CLIENT_ID","GUILD_ID","AFK_CHANNEL_ID","ADMIN_CHANNEL_ID"];
const missing=required.filter(k=>!process.env[k]);
if(missing.length){console.error("Missing environment variables:",missing.join(", "));process.exit(1);}

const client=new Client({intents:[
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildMembers,
  GatewayIntentBits.GuildVoiceStates
]});
const PERIODS=[
  {label:"Today",value:"today"},
  {label:"This Week",value:"weekly"},
  {label:"This Month",value:"monthly"},
  {label:"Lifetime",value:"lifetime"}
];
const getSetting=k=>store.db.prepare("SELECT value FROM settings WHERE key=?").get(k)?.value;
const setSetting=(k,v)=>store.db.prepare("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(k,String(v));
const admin=i=>Boolean(i.memberPermissions?.has(PermissionFlagsBits.Administrator));
const fmt=reports.duration;

function dashboardComponents(period="weekly",page=0){
  const periodRow=new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder().setCustomId("dash:period").setPlaceholder("Reporting period").addOptions(
      PERIODS.map(p=>({label:p.label,value:p.value,default:p.value===period}))
    )
  );
  const members=reports.activeMembers(period);
  const pageSize=25, maxPage=Math.max(0,Math.ceil(members.length/pageSize)-1);
  page=Math.min(Math.max(0,page),maxPage);
  const slice=members.slice(page*pageSize,(page+1)*pageSize);
  const memberSelect=new StringSelectMenuBuilder().setCustomId("dash:member").setPlaceholder(
    members.length ? `Select a member (${members.length} active)` : "No members active in this period"
  );
  if(slice.length){
    memberSelect.addOptions(slice.map(m=>({
      label:(m.display_name||m.username||m.user_id).slice(0,100),
      description:`Voice ${fmt(m.voice_ms)} • AFK ${fmt(m.afk_ms)}`.slice(0,100),
      value:m.user_id
    })));
  }else{
    memberSelect.setDisabled(true).addOptions([{label:"No activity in this period",value:"none"}]);
  }
  const memberRow=new ActionRowBuilder().addComponents(memberSelect);
  const rows=[periodRow,memberRow];
  if(maxPage>0){
    rows.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`dash:page:${period}:${Math.max(0,page-1)}`).setLabel("Previous").setStyle(ButtonStyle.Secondary).setDisabled(page===0),
      new ButtonBuilder().setCustomId(`dash:page:${period}:${Math.min(maxPage,page+1)}`).setLabel(`Page ${page+1}/${maxPage+1}`).setStyle(ButtonStyle.Secondary).setDisabled(true),
      new ButtonBuilder().setCustomId(`dash:page:${period}:${Math.min(maxPage,page+1)}`).setLabel("Next").setStyle(ButtonStyle.Secondary).setDisabled(page===maxPage)
    ));
  }
  return rows;
}

function dashboardEmbed(period="weekly"){
  const t=reports.serverTotals();
  const e=new EmbedBuilder().setColor(0x5865F2).setTitle("📣 VOICE ACTIVITY TRACKER")
    .setDescription("Server-wide voice statistics\n🔊 Voice Time  •  💤 AFK Time")
    .addFields(
      {name:"TODAY",value:`🔊 **${fmt(t.today.voice)}**\n💤 **${fmt(t.today.afk)}**`,inline:true},
      {name:"THIS WEEK",value:`🔊 **${fmt(t.weekly.voice)}**\n💤 **${fmt(t.weekly.afk)}**`,inline:true},
      {name:"THIS MONTH",value:`🔊 **${fmt(t.monthly.voice)}**\n💤 **${fmt(t.monthly.afk)}**`,inline:true},
      {name:"LIFETIME",value:`🔊 **${fmt(t.lifetime.voice)}**\n💤 **${fmt(t.lifetime.afk)}**`,inline:true}
    )
    .setFooter({text:`Member list: ${PERIODS.find(p=>p.value===period)?.label||"This Week"} • Times use ${process.env.TIMEZONE||"America/New_York"}`})
    .setTimestamp();
  return e;
}

function memberEmbed(userId){
  const m=reports.memberById(userId);
  if(!m)return new EmbedBuilder().setColor(0xED4245).setDescription("No historical record was found for that member.");
  const p=reports.memberPeriods(userId), days=reports.weeklyDays(userId), recent=reports.sessions(userId,3,0);
  const e=new EmbedBuilder().setColor(0x5865F2).setTitle(`👤 ${m.display_name}`)
    .setDescription(`@${m.username}\nVoice Activity Report`)
    .addFields(
      {name:"TODAY",value:`🔊 Voice: **${fmt(p.today.voice)}**\n💤 AFK: **${fmt(p.today.afk)}**`,inline:true},
      {name:"THIS WEEK",value:`🔊 Voice: **${fmt(p.weekly.voice)}**\n💤 AFK: **${fmt(p.weekly.afk)}**`,inline:true},
      {name:"THIS MONTH",value:`🔊 Voice: **${fmt(p.monthly.voice)}**\n💤 AFK: **${fmt(p.monthly.afk)}**`,inline:true},
      {name:"LIFETIME",value:`🔊 Voice: **${fmt(p.lifetime.voice)}**\n💤 AFK: **${fmt(p.lifetime.afk)}**`,inline:true},
      {name:"WEEKLY BREAKDOWN",value:days.map(d=>`**${d.day}** — Voice ${fmt(d.voice)} | AFK ${fmt(d.afk)}`).join("\n"),inline:false},
      {name:"RECENT SESSIONS",value:recent.length?recent.map(s=>{
        const start=new Date(s.started_at).toLocaleString("en-US",{timeZone:process.env.TIMEZONE||"America/New_York",month:"short",day:"numeric",hour:"numeric",minute:"2-digit"});
        const end=s.ended_at?new Date(s.ended_at).toLocaleString("en-US",{timeZone:process.env.TIMEZONE||"America/New_York",hour:"numeric",minute:"2-digit"}):"Currently connected";
        return `**${start} → ${end}**\nVoice ${fmt(s.voice_ms)} | AFK ${fmt(s.afk_ms)}`;
      }).join("\n\n"):"No sessions recorded.",inline:false}
    ).setFooter({text:"Voice and AFK time are tracked separately."}).setTimestamp();
  return e;
}

function memberButtons(userId){
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`history:${userId}:0`).setLabel("Session History").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("back:dashboard").setLabel("Back to Dashboard").setStyle(ButtonStyle.Secondary)
  )];
}

async function showDashboard(channel,existingMessage=null,period="weekly",page=0){
  const payload={embeds:[dashboardEmbed(period)],components:dashboardComponents(period,page)};
  const message=existingMessage?await existingMessage.edit(payload):await channel.send(payload);
  setSetting("dashboard_message_id",message.id);
  return message;
}

async function registerCommands(){
  const commands=[
    new SlashCommandBuilder().setName("voice-dashboard").setDescription("Open or refresh the voice activity dashboard"),
    new SlashCommandBuilder().setName("voice-health").setDescription("Show voice tracker status")
  ].map(x=>x.toJSON());
  const rest=new REST({version:"10"}).setToken(process.env.DISCORD_TOKEN);
  await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID,process.env.GUILD_ID),{body:commands});
}

client.on(Events.VoiceStateUpdate,(oldState,newState)=>tracker.handleVoiceStateUpdate(oldState,newState).catch(console.error));

client.once(Events.ClientReady,async readyClient=>{
  console.log(`Logged in as ${readyClient.user.tag}`);
  try{
    await registerCommands();
    const guild=await readyClient.guilds.fetch(process.env.GUILD_ID);
    await tracker.reconcileOnReady(guild);
    const channel=await guild.channels.fetch(process.env.ADMIN_CHANNEL_ID);
    if(!channel?.isTextBased())throw new Error("ADMIN_CHANNEL_ID must be a text channel.");
    const oldId=getSetting("dashboard_message_id");
    let oldMessage=null;
    if(oldId){try{oldMessage=await channel.messages.fetch(oldId);}catch{}}
    await showDashboard(channel,oldMessage);
    console.log("Voice tracker initialized; dashboard is ready.");
  }catch(error){console.error("Startup initialization failed:",error);}
});

client.on(Events.InteractionCreate,async interaction=>{
  try{
    if(!admin(interaction)){
      const payload={content:"⛔ This voice activity report is restricted to server administrators.",ephemeral:true};
      if(interaction.isRepliable()) await interaction.reply(payload).catch(()=>{});
      return;
    }
    if(interaction.isChatInputCommand()){
      if(interaction.commandName==="voice-dashboard"){
        const channel=await interaction.guild.channels.fetch(process.env.ADMIN_CHANNEL_ID);
        if(!channel?.isTextBased())return interaction.reply({content:"Configured admin dashboard channel is unavailable.",ephemeral:true});
        const oldId=getSetting("dashboard_message_id");
        let old=null;if(oldId){try{old=await channel.messages.fetch(oldId);}catch{}}
        const message=await showDashboard(channel,old);
        return interaction.reply({content:`Dashboard ${old?"refreshed":"created"} in <#${channel.id}>: ${message.url}`,ephemeral:true});
      }
      if(interaction.commandName==="voice-health"){
        const active=store.statements.allActive.all().length;
        return interaction.reply({content:`✅ Tracker online. Active tracked connections: **${active}**. Database: ${process.env.DATABASE_PATH||"./data/voice-activity.sqlite"}. Reporting timezone: **${process.env.TIMEZONE||"America/New_York"}**.`,ephemeral:true});
      }
    }
    if(interaction.isStringSelectMenu()){
      if(interaction.customId==="dash:period"){
        const period=interaction.values[0];
        return interaction.update({embeds:[dashboardEmbed(period)],components:dashboardComponents(period,0)});
      }
      if(interaction.customId==="dash:member"){
        const userId=interaction.values[0];
        if(userId==="none")return interaction.reply({content:"No members have activity in that period.",ephemeral:true});
        return interaction.reply({embeds:[memberEmbed(userId)],components:memberButtons(userId),ephemeral:true});
      }
    }
    if(interaction.isButton()){
      if(interaction.customId.startsWith("dash:page:")){
        const [, ,period,page]=interaction.customId.split(":");
        return interaction.update({embeds:[dashboardEmbed(period)],components:dashboardComponents(period,Number(page))});
      }
      if(interaction.customId.startsWith("history:")){
        const [,userId,offsetText]=interaction.customId.split(":");
        const offset=Number(offsetText)||0, pageSize=10;
        const rows=reports.sessions(userId,pageSize,offset), total=reports.sessionCount(userId);
        const m=reports.memberById(userId);
        const embed=new EmbedBuilder().setColor(0x5865F2).setTitle(`Session History — ${m?.display_name||"Member"}`)
          .setDescription(rows.length?rows.map(s=>{
            const start=new Date(s.started_at).toLocaleString("en-US",{timeZone:process.env.TIMEZONE||"America/New_York"});
            const end=s.ended_at?new Date(s.ended_at).toLocaleString("en-US",{timeZone:process.env.TIMEZONE||"America/New_York"}):"Currently connected";
            return `**${start} → ${end}**\nVoice: ${fmt(s.voice_ms)} | AFK: ${fmt(s.afk_ms)}`;
          }).join("\n\n"):"No sessions recorded.")
          .setFooter({text:`Showing ${total?offset+1:0}–${Math.min(offset+pageSize,total)} of ${total}`});
        const buttons=new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`history:${userId}:${Math.max(0,offset-pageSize)}`).setLabel("Previous").setStyle(ButtonStyle.Secondary).setDisabled(offset===0),
          new ButtonBuilder().setCustomId(`history:${userId}:${offset+pageSize}`).setLabel("Next").setStyle(ButtonStyle.Secondary).setDisabled(offset+pageSize>=total),
          new ButtonBuilder().setCustomId("back:dashboard").setLabel("Back to Dashboard").setStyle(ButtonStyle.Primary)
        );
        return interaction.update({embeds:[embed],components:[buttons]});
      }
      if(interaction.customId==="back:dashboard"){
        return interaction.update({embeds:[dashboardEmbed()],components:dashboardComponents()});
      }
    }
  }catch(error){
    console.error("Interaction failed:",error);
    const message="Something went wrong while loading that report.";
    if(interaction.deferred||interaction.replied)await interaction.followUp({content:message,ephemeral:true}).catch(()=>{});
    else if(interaction.isRepliable())await interaction.reply({content:message,ephemeral:true}).catch(()=>{});
  }
});

process.on("unhandledRejection",error=>console.error("Unhandled rejection:",error));
client.login(process.env.DISCORD_TOKEN);
