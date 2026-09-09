const {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle,
} = require('discord.js');

const BANNER_URL = 'https://raw.githubusercontent.com/scammid/uniq-alpha-bot/main/Logo_Animation-02.webp';

function buildSharedPanel() {
  const embed = new EmbedBuilder()
    .setTitle('⚡ UNI-Q Alpha — Auto-Enter Bot')
    .setDescription(
      `Welcome to **UNI-Q Alpha Auto-Enter**!\n\n` +
      `Automatically enter Alphabot raffles 24/7.\n\n` +
      `**Get started:**\n` +
      `1️⃣ Click **📝 Submit API Key** below\n` +
      `2️⃣ Paste your key from alphabot.app → Settings → Developer settings\n` +
      `3️⃣ Click **🟢 Start** — done!\n\n` +
      `> 🔒 All your responses are **private** — only you can see them.\n` +
      `> ⚡ Exclusive to **Premium+** members only.`
    )
    .setColor(0xff6b00)
    .setImage(BANNER_URL)
    .setFooter({ text: 'UNI-Q Alpha Auto-Enter • Premium+ Exclusive • 24/7' })
    .setTimestamp();

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('submit_api_key').setLabel('Submit API Key').setEmoji('📝').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('start').setLabel('Start').setEmoji('🟢').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('stop').setLabel('Stop').setEmoji('🔴').setStyle(ButtonStyle.Danger),
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('mode_all').setLabel('All Raffles').setEmoji('🌐').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('mode_communities').setLabel('My Communities').setEmoji('👥').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('mode_custom').setLabel('Custom Teams').setEmoji('📌').setStyle(ButtonStyle.Secondary),
  );

  const row3 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('manage_blocklist').setLabel('Blocklist').setEmoji('🚫').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('settings').setLabel('Settings').setEmoji('⚙️').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('stats').setLabel('Stats').setEmoji('📊').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('logs').setLabel('Logs').setEmoji('📋').setStyle(ButtonStyle.Secondary),
  );

  const row4 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('my_status').setLabel('My Status').setEmoji('👤').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('remove_data').setLabel('Remove My Data').setEmoji('🗑️').setStyle(ButtonStyle.Danger),
  );

  return { embeds: [embed], components: [row1, row2, row3, row4] };
}

function buildUserStatus(user) {
  const hasKey = !!user?.alphabot_api_key;
  const isRunning = !!user?.is_running;
  const mode = user?.mode || 'all';
  const modeLabel = { all: '🌐 All Raffles', communities: '👥 My Communities', custom: '📌 Custom Teams' }[mode];

  return new EmbedBuilder()
    .setTitle('👤 Your Status')
    .setDescription(hasKey ? [
      `📡 **Status:** ${isRunning ? '🟢 Running' : '🔴 Stopped'}`,
      `🎯 **Mode:** ${modeLabel}`,
      `⚡ **FCFS:** ${user?.instant_fcfs !== 0 ? 'Instant' : 'Normal'}`,`🔄 **Tick:** Every ~1-2 hours`,
      `🎟 **Total Entered:** ${user?.total_entered || 0}`,
      `🏆 **Total Won:** ${user?.total_won || 0}`,
    ].join('\n') : '⚠️ No API key set. Click **📝 Submit API Key** to get started.')
    .setColor(isRunning ? 0x57f287 : hasKey ? 0xed4245 : 0xfee75c)
    .setTimestamp();
}

function buildApiKeyModal() {
  return new ModalBuilder()
    .setCustomId('modal_api_key')
    .setTitle('Connect Alphabot Account')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('api_key_input').setLabel('Alphabot API Key')
          .setStyle(TextInputStyle.Short).setPlaceholder('From alphabot.app → Settings → Developer settings').setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('forward_webhook').setLabel('Forward Webhook (optional)')
          .setStyle(TextInputStyle.Short).setPlaceholder('Discord webhook URL for notifications').setRequired(false)
      )
    );
}

function buildBlocklistModal() {
  return new ModalBuilder()
    .setCustomId('modal_add_blocklist')
    .setTitle('Add to Blocklist')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('block_type').setLabel('Type: project or team')
          .setStyle(TextInputStyle.Short).setPlaceholder('project').setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('block_value').setLabel('Name or Team ID to block')
          .setStyle(TextInputStyle.Short).setPlaceholder('e.g. BoredApe or team123').setRequired(true)
      )
    );
}

function buildSettingsModal(user) {
  return new ModalBuilder()
    .setCustomId('modal_settings')
    .setTitle('Your Settings')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('instant_fcfs').setLabel('Instant FCFS? (yes/no)')
          .setStyle(TextInputStyle.Short).setPlaceholder('yes').setValue(user?.instant_fcfs !== 0 ? 'yes' : 'no').setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('forward_webhook').setLabel('Forward Webhook URL (optional)')
          .setStyle(TextInputStyle.Short).setPlaceholder('Discord webhook for notifications').setValue(user?.forward_webhook || '').setRequired(false)
      )
    );
}

module.exports = { buildSharedPanel, buildUserStatus, buildApiKeyModal, buildBlocklistModal, buildSettingsModal, BANNER_URL };
