require('dotenv').config();
const { Client, GatewayIntentBits, Events, REST, Routes, EmbedBuilder, MessageFlags } = require('discord.js');
const { handleInteraction } = require('./handlers/interactionHandler');
const { buildSharedPanel, BANNER_URL } = require('./utils/panelBuilder');
const { runLoop } = require('./services/autoEnter');
const { startMintReminderLoop } = require('./services/mintReminder');
const db = require('./services/database');

const REQUIRED_ROLE_ID = process.env.REQUIRED_ROLE_ID;
const GUILD_ID = process.env.GUILD_ID;

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildMembers],
});

const commands = [
  { name: 'panel', description: 'Spawn the UNI-Q Alpha Auto-Enter control panel' },
  { name: 'setup', description: 'How to get your Alphabot API key' },
  { name: 'stats', description: 'View your raffle stats' },
  { name: 'admin', description: 'Admin dashboard (server owner only)' },
  { name: 'leaderboard', description: 'Top 10 users by entries' },
  {
    name: 'block',
    description: 'Block a project or team',
    options: [
      { name: 'type', description: 'project or team', type: 3, required: true, choices: [{ name: 'project', value: 'project' }, { name: 'team', value: 'team' }] },
      { name: 'value', description: 'Name or Team ID', type: 3, required: true },
    ]
  },
  {
    name: 'unblock',
    description: 'Remove from blocklist by ID',
    options: [{ name: 'id', description: 'Blocklist ID', type: 4, required: true }]
  },
  {
    name: 'setteams',
    description: 'Set custom team IDs',
    options: [{ name: 'ids', description: 'Comma-separated team IDs', type: 3, required: true }]
  },
];

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  try {
    console.log('[Bot] Registering slash commands...');
    const route = GUILD_ID
      ? Routes.applicationGuildCommands(process.env.CLIENT_ID, GUILD_ID)
      : Routes.applicationCommands(process.env.CLIENT_ID);
    await rest.put(route, { body: commands });
    console.log('[Bot] Slash commands registered.');
  } catch (err) { console.error('[Bot] Failed to register commands:', err.message); }
}

async function hasRole(guild, userId) {
  if (!REQUIRED_ROLE_ID) return true;
  try {
    const member = await guild.members.fetch(userId);
    return member.roles.cache.has(REQUIRED_ROLE_ID);
  } catch (_) { return false; }
}

async function dmUser(discordId, content) {
  try {
    const user = await client.users.fetch(discordId);
    await user.send(content);
  } catch (err) { console.error(`[DM] Failed to DM ${discordId}:`, err.message); }
}

// Auto-stop users who lose Premium+ role
async function checkRoles() {
  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    const runningUsers = await db.getAllRunningUsers();
    for (const user of runningUsers) {
      const stillHasRole = await hasRole(guild, user.discord_id);
      if (!stillHasRole) {
        await db.setRunning(user.discord_id, false);
        await dmUser(user.discord_id,
          `⚠️ **Auto-enter stopped**\n\nYou no longer have the **Premium+** role in UNI-Q Alpha.\nYour bot has been automatically stopped.\n\nRejoin the Premium+ tier to resume!`
        );
        console.log(`[Role] Stopped bot for ${user.discord_id} — lost Premium+ role`);
      }
    }
  } catch (err) { console.error('[Role] Check error:', err.message); }
}

client.once(Events.ClientReady, async () => {
  console.log(`[Bot] Logged in as ${client.user.tag}`);
  await db.getAllRunningUsers();
  console.log('[Bot] Database ready.');
  await registerCommands();

  // Check roles every 30 minutes
  setInterval(checkRoles, 30 * 60 * 1000);

  // ── Notify callback ───────────────────────────────────────────
  const notifyCallback = async (discordId, stats, user) => {
    const mode = user?.mode || 'all';
    const modeLabel = mode === 'communities' ? 'Community' : mode === 'custom' ? 'Custom Teams' : 'All Raffles';
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
    const fcfsCount = stats.enteredRaffles?.filter(r => r.isFcfs).length || 0;
    const raffleLines = stats.enteredRaffles?.map(r => `  ${r.isFcfs ? '⚡' : '✅'} ${r.name}`).join('\n') || '';

    const msg = [
      `📋 **Raffle Entry Update**`, ``,
      `✅ **${stats.entered}** entered${fcfsCount > 0 ? ` (⚡ ${fcfsCount} FCFS)` : ''}`,
      raffleLines || null,
      `⏭ **${stats.skipped}** skipped`,
      stats.failed > 0 ? `❌ **${stats.failed}** failed` : null,
      ``, `🎯 **Scope:** ${modeLabel}`,
      `🕐 **Time:** ${now}`,
    ].filter(l => l !== null).join('\n');

    const embed = new EmbedBuilder().setDescription(msg).setColor(0xff6b00).setImage(BANNER_URL).setTimestamp();
    await dmUser(discordId, { embeds: [embed] });

    if (user?.forward_webhook) {
      try {
        const axios = require('axios');
        await axios.post(user.forward_webhook, { embeds: [embed.toJSON()] }, { timeout: 5000 });
      } catch (_) {}
    }
  };

  // ── Alert callback ────────────────────────────────────────────
  const alertCallback = async (discordId, type, data) => {
    if (type === 'invalid_key') {
      const embed = new EmbedBuilder()
        .setDescription(`⚠️ **API Key Expired**\n\nYour key is invalid. Bot has been stopped.\n\n1. Go to https://alphabot.app → Settings → Developer settings\n2. Generate a new key\n3. Click **📝 Submit API Key** in the panel\n4. Click **🟢 Start**`)
        .setColor(0xed4245).setImage(BANNER_URL).setTimestamp();
      await dmUser(discordId, { embeds: [embed] });
    }

    if (type === 'rate_limited') {
      const embed = new EmbedBuilder()
        .setDescription(`⏳ **Rate Limited**\n\nAlphabot rate limited your account. Auto-resuming in 10 minutes!`)
        .setColor(0xfee75c).setImage(BANNER_URL).setTimestamp();
      await dmUser(discordId, { embeds: [embed] });
    }

    if (type === 'win' && data) {
      const embed = new EmbedBuilder()
        .setTitle('🏆 YOU WON A RAFFLE!')
        .setDescription(`**${data.name || data.slug}**\n\n🔗 [View on Alphabot](https://alphabot.app/${data.slug})\n\nCheck your Alphabot account for next steps! 🎉`)
        .setColor(0xff6b00)
        .setThumbnail(data.bannerImageUrl || null)
        .setImage(BANNER_URL)
        .setTimestamp();
      if (data.twitterUrl) embed.addFields({ name: 'Project Twitter', value: data.twitterUrl });
      await dmUser(discordId, { embeds: [embed] });
    }

    if (type === 'twitter_issue') {
      const embed = new EmbedBuilder()
        .setDescription(`⚠️ **X (Twitter) Account Issue**\n\nCouldn't complete X requirements.\n\n• X account suspended or restricted\n• X disconnected from Alphabot\n\n**Fix:** Go to alphabot.app → Settings → reconnect X account.`)
        .setColor(0xf0b132).setImage(BANNER_URL).setTimestamp();
      await dmUser(discordId, { embeds: [embed] });
    }
  };

  runLoop(notifyCallback, alertCallback);
  startMintReminderLoop(async (discordId, message) => await dmUser(discordId, message));
});

// ── New member joins → check role ─────────────────────────────
client.on(Events.GuildMemberAdd, async member => {
  if (member.guild.id !== GUILD_ID) return;
  console.log(`[Bot] New member: ${member.user.username}`);
});

// ── Member role update → auto-stop if role removed ────────────
client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
  if (newMember.guild.id !== GUILD_ID) return;
  if (!REQUIRED_ROLE_ID) return;
  const hadRole = oldMember.roles.cache.has(REQUIRED_ROLE_ID);
  const hasRoleNow = newMember.roles.cache.has(REQUIRED_ROLE_ID);
  if (hadRole && !hasRoleNow) {
    const user = await db.getUser(newMember.user.id);
    if (user?.is_running) {
      await db.setRunning(newMember.user.id, false);
      await dmUser(newMember.user.id,
        `⚠️ **Auto-enter stopped**\n\nYou no longer have the **Premium+** role.\nYour bot has been automatically stopped.\n\nRejoin the Premium+ tier to resume!`
      );
    }
  }
});

// ── Slash commands ────────────────────────────────────────────
client.on(Events.InteractionCreate, async interaction => {
  if (interaction.isChatInputCommand()) {

    if (interaction.commandName === 'panel') {
  if (!(await hasRole(interaction.guild, interaction.user.id))) {
    return interaction.reply({ content: '❌ This bot is exclusive to **Premium+** members only.', flags: MessageFlags.Ephemeral });
  }
  await interaction.reply({ content: '✅ Panel posted!', flags: MessageFlags.Ephemeral });
  await interaction.channel.send(buildSharedPanel());
  return;
}
    }

    if (interaction.commandName === 'setup') {
      return interaction.reply({
        ephemeral: true,
        content: [
          '## 🔑 How to get your Alphabot API Key',
          '1. Go to **https://alphabot.app** and log in',
          '2. Click your profile → **Settings**',
          '3. Scroll to **Developer settings** → copy your API key',
          '4. Click **📝 Submit API Key** on the panel and paste it',
          '',
          '> ⚠️ Keep your API key private!',
        ].join('\n'),
      });
    }

    if (interaction.commandName === 'stats') {
      const guild = interaction.guild;
      if (!(await hasRole(guild, interaction.user.id))) {
        return interaction.reply({ content: '❌ **Premium+** members only.', ephemeral: true });
      }
      await db.upsertUser(interaction.user.id, interaction.user.username);
      const { user: u, recent } = await db.getStats(interaction.user.id);
      const lines = recent.length > 0 ? recent.map(r => `${r.status === 'won' ? '🏆' : '✅'} **${r.raffle_name}**`).join('\n') : '_No entries yet._';
      const embed = new EmbedBuilder().setTitle('📊 Your Stats').setColor(0xff6b00)
        .addFields(
          { name: '🎟 Entered', value: String(u?.total_entered || 0), inline: true },
          { name: '🏆 Won', value: String(u?.total_won || 0), inline: true },
          { name: '📈 Win Rate', value: u?.total_entered > 0 ? `${((u.total_won / u.total_entered) * 100).toFixed(1)}%` : 'N/A', inline: true },
          { name: 'Recent', value: lines }
        ).setTimestamp();
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    if (interaction.commandName === 'admin') {
      if (interaction.user.id !== interaction.guild.ownerId) {
        return interaction.reply({ content: '❌ Server owner only.', ephemeral: true });
      }
      const stats = await db.getAdminStats();
      const topList = stats.topUsers.map((u, i) => `**${i+1}.** ${u.discord_username} — ${u.total_entered} entered, ${u.total_won} won`).join('\n') || '_No users yet._';
      const embed = new EmbedBuilder()
        .setTitle('🛡️ Admin Dashboard — UNI-Q Alpha')
        .setColor(0xff6b00)
        .addFields(
          { name: '👥 Total Users', value: String(stats.totalUsers?.count || 0), inline: true },
          { name: '🟢 Active Now', value: String(stats.activeUsers?.count || 0), inline: true },
          { name: '🎟 Total Entries', value: String(stats.totalEntries?.total || 0), inline: true },
          { name: '🏆 Total Wins', value: String(stats.totalWins?.total || 0), inline: true },
          { name: '🏅 Top Users', value: topList },
        ).setTimestamp();
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    if (interaction.commandName === 'leaderboard') {
      const stats = await db.getAdminStats();
      const topList = stats.topUsers.map((u, i) => `**${i+1}.** ${u.discord_username} — ${u.total_entered} entered, ${u.total_won} won`).join('\n') || '_No entries yet._';
      const embed = new EmbedBuilder()
        .setTitle('🏅 UNI-Q Alpha — Entry Leaderboard')
        .setDescription(topList)
        .setColor(0xff6b00)
        .setImage(BANNER_URL)
        .setTimestamp();
      return interaction.reply({ embeds: [embed] });
    }

    if (interaction.commandName === 'block') {
      if (!(await hasRole(interaction.guild, interaction.user.id))) return interaction.reply({ content: '❌ **Premium+** only.', ephemeral: true });
      await db.upsertUser(interaction.user.id, interaction.user.username);
      const type = interaction.options.getString('type');
      const value = interaction.options.getString('value');
      await db.addToBlocklist(interaction.user.id, type, value);
      return interaction.reply({ content: `🚫 Blocked **${type}**: ${value}`, ephemeral: true });
    }

    if (interaction.commandName === 'unblock') {
      const id = interaction.options.getInteger('id');
      await db.removeFromBlocklist(interaction.user.id, id);
      return interaction.reply({ content: `✅ Removed from blocklist.`, ephemeral: true });
    }

    if (interaction.commandName === 'setteams') {
      if (!(await hasRole(interaction.guild, interaction.user.id))) return interaction.reply({ content: '❌ **Premium+** only.', ephemeral: true });
      await db.upsertUser(interaction.user.id, interaction.user.username);
      const ids = interaction.options.getString('ids');
      await db.setCustomTeamIds(interaction.user.id, ids);
      return interaction.reply({ content: `✅ Custom team IDs saved!`, ephemeral: true });
    }
  }

  await handleInteraction(interaction, client);
});

client.on(Events.Error, err => console.error('[Bot] Error:', err));
process.on('unhandledRejection', err => console.error('[Bot] Unhandled rejection:', err));

client.login(process.env.DISCORD_TOKEN);
