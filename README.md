# Voice Activity Tracker

A standalone Discord bot that records member voice-channel time separately from AFK time and provides administrator-only reports.

## Features

- Tracks every member's voice connection and disconnection events.
- Counts the configured AFK channel separately from regular voice time.
- Channel-to-channel moves do not create false disconnects or reset a session.
- Stores timestamped session segments in SQLite and splits totals at local calendar-day boundaries.
- Daily, weekly, monthly, lifetime, and custom date-range reporting.
- Server overview plus member reports and paginated session history.
- Administrator-only Zero Voice Activity report for Gump and Recruit members, including members who have never joined voice; AFK time counts as activity.
- Persistent dashboard message in a designated private admin channel; detail views are ephemeral.
- Every command and component interaction independently checks administrator permission.
- Recovers open voice segments after restart and reconciles current voice state on startup.
- Retains historical member records after members leave.

## Requirements

- Node.js 20+
- Discord bot with Guilds, Guild Members, and Guild Voice States gateway intents enabled.
- View Channels, Send Messages, Embed Links, Read Message History, and Use Application Commands permissions.

## Setup

1. Copy .env.example to .env and fill in the values.
2. Set the server ID, AFK voice channel ID, private admin dashboard channel ID, Gump role ID, Recruit role ID, and reporting timezone.
3. Run npm install, then npm start.

The bot registers guild slash commands on startup. Keep the dashboard channel private to administrators; the bot also denies non-administrator command and component interactions.

## Configuration

See .env.example. TIMEZONE must be a valid IANA timezone, for example America/New_York.

## Reports

The dashboard shows server-wide Voice Time and AFK Time for today, this week, this month, and lifetime. Its Zero Voice Activity button privately lists Gump and Recruit members with no voice or AFK time in the selected day, week, or month; members with both roles appear once, and the list is paginated. A reporting-period selector filters the member selector to members active in that period. The member report shows all four periods together, a weekly day-by-day breakdown, and recent sessions. Session History opens a paginated ephemeral history view.

## Notes

- Voice Time means time connected to any non-AFK voice channel. AFK Time means time connected to the configured AFK channel.
- The bot does not track Discord online presence, mute/deafen state, speaking, streaming, or individual regular-channel usage.
- SQLite data is stored at DATABASE_PATH (default ./data/voice-activity.sqlite). Persist this directory on your host (for example, a Railway volume) to retain history across deployments.
- This first version is configured for one guild/database.