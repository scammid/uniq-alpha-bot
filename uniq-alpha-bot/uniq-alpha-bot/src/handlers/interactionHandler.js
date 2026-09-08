const { EmbedBuilder } = require('discord.js');
const db = require('../services/database');
const alphabot = require('../services/alphabot');
const { clearSessionCache } = require('../services/autoEnter');
const { buildSharedPanel, buildUserStatus, buildApiKeyModal, buildBlocklistModal, buildSettingsModal } = require('../utils/panelBuilder');

const REQUIRED_ROLE_ID = process.env.REQUIRED_ROLE_ID;

async function checkRole(interaction) {
  if (!REQUIRED_ROLE_ID) return true;
  try {
    const member = interaction.member || await interaction.guild?.members.fetch(interaction.user.id);
    if (!member) return false;
    return member.roles.cache.has(REQUIRED_ROLE_ID);
  } catch (_) { return false; }
}

async function handleInteraction(interaction, client) {
  const userId = interaction.user.id;
  const username = interaction.user.username;

  if (interaction.isButton()) {
    if (interaction.customId === 'submit_api_key') {
      const hasRole = await checkRole(interaction);
      if (!hasRole) {
        return interaction.reply({ content: '❌ This bot is exclusive to **Premium+** members only.', ephemeral: true });
      }
      return interaction.showModal(buildApiKeyModal());
    }

    if (interaction.customId === 'settings') {
      const hasRole = await checkRole(interaction);
      if (!hasRole) return interaction.reply({ content: '❌ **Premium+** members only.', ephemeral: true });
      const user = await db.getUser(userId);
      return interaction.showModal(buildSettingsModal(user));
    }

    if (interaction.customId === 'manage_blocklist_add') {
      return interaction.showModal(buildBlocklistModal());
    }

    await interaction.deferReply({ ephemeral: true });

    // Role check for all buttons
    const hasRole = await checkRole(interaction);
    if (!hasRole) {
      return interaction.editReply({ content: '❌ This bot is exclusive to **Premium+** members only.' });
    }

    await db.upsertUser(userId, username);
    const user = await db.getUser(userId);

    switch (interaction.customId) {
      case 'start': {
        if (!user?.alphabot_api_key) return interaction.editReply({ content: '⚠️ Submit your API key first by clicking **📝 Submit API Key**.' });
        await db.setRunning(userId, true);
        clearSessionCache(userId);
        const updated = await db.getUser(userId);
        return interaction.editReply({ content: '🟢 **Auto-enter started!** You\'ll get a DM when raffles are entered.', embeds: [buildUserStatus(updated)] });
      }
      case 'stop': {
        await db.setRunning(userId, false);
        const updated = await db.getUser(userId);
        return interaction.editReply({ content: '🔴 **Auto-enter stopped.**', embeds: [buildUserStatus(updated)] });
      }
      case 'mode_all': { await db.setMode(userId, 'all'); return interaction.editReply({ content: '🌐 Mode: **All Raffles**', embeds: [buildUserStatus(await db.getUser(userId))] }); }
      case 'mode_communities': { await db.setMode(userId, 'communities'); return interaction.editReply({ content: '👥 Mode: **My Communities**', embeds: [buildUserStatus(await db.getUser(userId))] }); }
      case 'mode_custom': { await db.setMode(userId, 'custom'); return interaction.editReply({ content: '📌 Mode: **Custom Teams** — use `/setteams` to add IDs.', embeds: [buildUserStatus(await db.getUser(userId))] }); }
      case 'my_status': { return interaction.editReply({ embeds: [buildUserStatus(user)] }); }

      case 'manage_blocklist': {
        const list = await db.getBlocklist(userId);
        const lines = list.length > 0 ? list.map(b => `**${b.type}:** ${b.value} — ID: \`${b.id}\``).join('\n') : '_Nothing blocked yet._';
        return interaction.editReply({ embeds: [new EmbedBuilder().setTitle('🚫 Your Blocklist').setDescription(lines + '\n\nUse `/block` to add and `/unblock <id>` to remove.').setColor(0xed4245)] });
      }

      case 'stats': {
        const { user: u, recent } = await db.getStats(userId);
        const lines = recent.length > 0 ? recent.map(r => `${r.status === 'won' ? '🏆' : '✅'} **${r.raffle_name}**`).join('\n') : '_No entries yet._';
        return interaction.editReply({ embeds: [new EmbedBuilder().setTitle('📊 Your Stats').setColor(0xff6b00)
          .addFields(
            { name: '🎟 Entered', value: String(u?.total_entered || 0), inline: true },
            { name: '🏆 Won', value: String(u?.total_won || 0), inline: true },
            { name: '📈 Win Rate', value: u?.total_entered > 0 ? `${((u.total_won / u.total_entered) * 100).toFixed(1)}%` : 'N/A', inline: true },
            { name: 'Recent', value: lines }
          ).setTimestamp()] });
      }

      case 'logs': {
        const { recent } = await db.getStats(userId);
        const lines = recent.length > 0 ? recent.map(r => `${r.status === 'won' ? '🏆' : '✅'} **${r.raffle_name}** — ${r.entered_at?.slice(0,16)} UTC`).join('\n') : '_No logs yet._';
        return interaction.editReply({ embeds: [new EmbedBuilder().setTitle('📋 Entry Logs').setDescription(lines).setColor(0xff6b00).setTimestamp()] });
      }

      case 'remove_data': {
        await db.removeUser(userId);
        clearSessionCache(userId);
        return interaction.editReply({ content: '🗑️ All your data has been wiped.' });
      }

      default: return interaction.editReply({ content: '❓ Unknown action.' });
    }
  }

  if (interaction.isModalSubmit()) {
    await interaction.deferReply({ ephemeral: true });
    await db.upsertUser(userId, username);

    switch (interaction.customId) {
      case 'modal_api_key': {
        const apiKey = interaction.fields.getTextInputValue('api_key_input').trim();
        const forwardWebhook = interaction.fields.getTextInputValue('forward_webhook').trim();
        const validation = await alphabot.validateApiKey(apiKey);
        if (!validation.valid) return interaction.editReply({ content: `❌ Invalid API key: ${validation.error}` });
        await db.setApiKey(userId, apiKey);
        if (forwardWebhook) await db.setForwardWebhook(userId, forwardWebhook);
        return interaction.editReply({ content: '✅ API key saved! Click **🟢 Start** to begin.', embeds: [buildUserStatus(await db.getUser(userId))] });
      }

      case 'modal_add_blocklist': {
        const type = interaction.fields.getTextInputValue('block_type').trim().toLowerCase();
        const value = interaction.fields.getTextInputValue('block_value').trim();
        if (!['project', 'team'].includes(type)) return interaction.editReply({ content: '⚠️ Type must be **project** or **team**.' });
        await db.addToBlocklist(userId, type, value);
        return interaction.editReply({ content: `🚫 Blocked **${type}**: ${value}` });
      }

      case 'modal_settings': {
        const delayMin = parseInt(interaction.fields.getTextInputValue('delay_min')) || 3;
        const delayMax = parseInt(interaction.fields.getTextInputValue('delay_max')) || 8;
        const instantFcfs = interaction.fields.getTextInputValue('instant_fcfs').trim().toLowerCase() === 'yes';
        const forwardWebhook = interaction.fields.getTextInputValue('forward_webhook').trim();
        await db.setDelay(userId, delayMin, delayMax);
        await db.setInstantFcfs(userId, instantFcfs);
        if (forwardWebhook) await db.setForwardWebhook(userId, forwardWebhook);
        return interaction.editReply({ content: `✅ Settings saved!`, embeds: [buildUserStatus(await db.getUser(userId))] });
      }

      default: return interaction.editReply({ content: '❓ Unknown action.' });
    }
  }
}

module.exports = { handleInteraction };
