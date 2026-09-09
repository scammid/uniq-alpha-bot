const db = require('./database');
const alphabot = require('./alphabot');
const { EmbedBuilder } = require('discord.js');

const BANNER_URL = 'https://raw.githubusercontent.com/scammid/uniq-alpha-bot/main/Logo_Animation-02.webp';

async function startMintReminderLoop(dmCallback) {
  console.log('[Mint] Starting mint reminder loop...');
  const check = async () => {
    try {
      const reminders = await db.getPendingReminders();
      const now = Date.now();
      for (const r of reminders) {
        const diff = r.mint_date - now;
        const hoursLeft = diff / (1000 * 60 * 60);
        if (!r.reminded_72h && hoursLeft <= 72 && hoursLeft > 24) { await dmCallback(r.discord_id, buildReminderMsg(r, '72 hours')); await db.markReminder(r.id, 'reminded_72h'); }
        if (!r.reminded_24h && hoursLeft <= 24 && hoursLeft > 1) { await dmCallback(r.discord_id, buildReminderMsg(r, '24 hours')); await db.markReminder(r.id, 'reminded_24h'); }
        if (!r.reminded_1h && hoursLeft <= 1 && hoursLeft > 0) { await dmCallback(r.discord_id, buildReminderMsg(r, '1 hour')); await db.markReminder(r.id, 'reminded_1h'); }
        if (!r.reminded_start && diff <= 0 && diff > -60 * 60 * 1000) { await dmCallback(r.discord_id, buildStartMsg(r)); await db.markReminder(r.id, 'reminded_start'); }
      }
    } catch (err) { console.error('[Mint] Error:', err.message); }
  };
  await check();
  setInterval(check, 5 * 60 * 1000);
}

function buildReminderMsg(r, timeLeft) {
  const mintDate = new Date(r.mint_date).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
  return { embeds: [new EmbedBuilder()
    .setTitle(`⏰ Mint Reminder — ${timeLeft} to go!`)
    .setDescription([
      `🎟 **Raffle:** ${r.raffle_name}`,
      `📅 **Mint Date:** ${mintDate}`,
      r.wallet_used ? `👛 **Wallet:** \`${r.wallet_used}\`` : null,
      `🔗 **Link:** https://alphabot.app/${r.raffle_slug}`,
      ``, `Get ready to mint! 🚀`,
    ].filter(Boolean).join('\n'))
    .setColor(0xff6b00)
    .setImage(BANNER_URL)
    .setTimestamp()
  ]};
}

function buildStartMsg(r) {
  return { embeds: [new EmbedBuilder()
    .setTitle('🚀 MINT IS LIVE NOW!')
    .setDescription([
      `🎟 **Raffle:** ${r.raffle_name}`,
      r.wallet_used ? `👛 **Wallet:** \`${r.wallet_used}\`` : null,
      `🔗 **Link:** https://alphabot.app/${r.raffle_slug}`,
      ``, `**Go mint NOW!** ⚡`,
    ].filter(Boolean).join('\n'))
    .setColor(0xff6b00)
    .setImage(BANNER_URL)
    .setTimestamp()
  ]};
}

async function scheduleReminder(discordId, apiKey, raffleSlug, raffleName, walletUsed) {
  try {
    const result = await alphabot.getRaffleDetails(apiKey, raffleSlug);
    if (!result.success || !result.raffle) return;
    const mintDate = result.raffle.mintDate || 0;
    if (mintDate && mintDate > Date.now()) {
      await db.addMintReminder(discordId, raffleSlug, raffleName, mintDate, walletUsed);
      console.log(`[Mint] Scheduled reminders for ${raffleName}`);
    }
  } catch (err) { console.error('[Mint] scheduleReminder error:', err.message); }
}

module.exports = { startMintReminderLoop, scheduleReminder };
