const db = require('./database');
const alphabot = require('./alphabot');
const { scheduleReminder } = require('./mintReminder');
const { normalizeTimestamp } = require('../utils/time');

const enteredThisSession = new Map();
const knownWins = new Map();
const rateLimitUntil = new Map();
const twitterWarned = new Map();

function randomDelay(min, max) { return Math.floor(Math.random() * (max - min + 1) + min) * 1000; }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function getEntered(id) { if (!enteredThisSession.has(id)) enteredThisSession.set(id, new Set()); return enteredThisSession.get(id); }
function getKnownWins(id) { if (!knownWins.has(id)) knownWins.set(id, new Set()); return knownWins.get(id); }

async function processUser(user, alertCallback) {
  const { discord_id, alphabot_api_key, mode, custom_team_ids, delay_min, delay_max, instant_fcfs, max_winners } = user;
  const entered = getEntered(discord_id);
  const wins = getKnownWins(discord_id);

  const cooldown = rateLimitUntil.get(discord_id);
  if (cooldown && Date.now() < cooldown) {
    return { entered: 0, failed: 0, skipped: 0, rateLimited: true };
  }

  let result;
  if (mode === 'communities') result = await alphabot.getMyCommunityRaffles(alphabot_api_key, discord_id);
  else if (mode === 'custom') {
    const ids = custom_team_ids ? custom_team_ids.split(',').map(s => s.trim()).filter(Boolean) : [];
    result = await alphabot.getOpenRaffles(alphabot_api_key, ids, discord_id);
  } else result = await alphabot.getOpenRaffles(alphabot_api_key, [], discord_id);

  if (!result.success) {
    if (result.invalidKey) { await db.setRunning(discord_id, false); if (alertCallback) alertCallback(discord_id, 'invalid_key', null); return { entered: 0, failed: 0, skipped: 0 }; }
    if (result.rateLimited) { rateLimitUntil.set(discord_id, Date.now() + 10 * 60 * 1000); if (alertCallback) alertCallback(discord_id, 'rate_limited', null); return { entered: 0, failed: 0, skipped: 0, rateLimited: true }; }
    return { entered: 0, failed: 0, skipped: 0 };
  }

  // Check wins
  const winCheck = await alphabot.checkWins(alphabot_api_key, discord_id);
  if (winCheck.success && winCheck.wins.length > 0) {
    for (const raffle of winCheck.wins) {
      if (!wins.has(raffle.slug)) {
        wins.add(raffle.slug);
        // Skip wins older than 24 hours — only alert on genuinely new wins.
        // normalizeTimestamp handles ms epoch, seconds epoch, or ISO string
        // so this doesn't silently break if the API's date format changes.
        const endDate = normalizeTimestamp(raffle.endDate);
        const isRecent = endDate && (Date.now() - endDate) < 24 * 60 * 60 * 1000;
        if (!isRecent) continue;
        await db.logEntry(discord_id, raffle.slug, raffle.name || raffle.slug, raffle.teamId || '', 'won', null);
        if (alertCallback) alertCallback(discord_id, 'win', raffle);
        await scheduleReminder(discord_id, alphabot_api_key, raffle.slug, raffle.name || raffle.slug, null);
      }
    }
  }

  let raffles = result.raffles;
  if (max_winners > 0) raffles = raffles.filter(r => !r.winnerCount || r.winnerCount <= max_winners);

  const fcfsRaffles = raffles.filter(r => r.type === 'fcfs');
  const normalRaffles = raffles.filter(r => r.type !== 'fcfs');
  const allRaffles = instant_fcfs ? [...fcfsRaffles, ...normalRaffles] : [...normalRaffles, ...fcfsRaffles];

  let enteredCount = 0, failedCount = 0, skippedCount = 0, twitterIssueFound = false;
  const enteredRaffles = [];

  for (const raffle of allRaffles) {
    const slug = raffle.slug;
    const name = raffle.name || 'Unknown';
    const teamId = raffle.teamId || '';
    const isFcfs = raffle.type === 'fcfs';

    if (entered.has(slug)) { skippedCount++; continue; }
    if (await db.isBlocked(discord_id, name, teamId)) { entered.add(slug); skippedCount++; continue; }

    const res = await alphabot.enterRaffle(alphabot_api_key, slug, discord_id);
    entered.add(slug);

    if (res.rateLimited) { rateLimitUntil.set(discord_id, Date.now() + 10 * 60 * 1000); if (alertCallback) alertCallback(discord_id, 'rate_limited', null); break; }
    if (res.invalidKey) { await db.setRunning(discord_id, false); if (alertCallback) alertCallback(discord_id, 'invalid_key', null); break; }
    if (res.alreadyEntered) { skippedCount++; }
    else if (res.success) { enteredCount++; await db.logEntry(discord_id, slug, name, teamId, 'entered', null); enteredRaffles.push({ name, isFcfs }); console.log(`[${discord_id}] ✅ ${isFcfs ? '[FCFS] ' : ''}Entered: ${name}`); }
    else if (res.twitterIssue) { skippedCount++; twitterIssueFound = true; }
    else if (res.ineligible) { skippedCount++; }
    else { failedCount++; }

    if (!isFcfs || !instant_fcfs) await sleep(randomDelay(60, 120)); // Fixed 60-120s delay = ~1-2hr per tick
  }

  if (twitterIssueFound && !twitterWarned.get(discord_id)) { twitterWarned.set(discord_id, true); if (alertCallback) alertCallback(discord_id, 'twitter_issue', null); }

  return { entered: enteredCount, failed: failedCount, skipped: skippedCount, enteredRaffles };
}

let loopRunning = false;
let loopTimer = null;

async function runLoop(notifyCallback, alertCallback) {
  if (loopRunning) return;
  loopRunning = true;
  console.log('[Engine] Starting auto-enter loop...');

  const tick = async () => {
    const users = await db.getAllRunningUsers();
    console.log(`[Engine] Tick: ${users.length} active user(s)`);
    for (const user of users) {
      const fresh = await db.getUser(user.discord_id);
      if (!fresh?.is_running) continue;
      try {
        const stats = await processUser(fresh, alertCallback);
        if (notifyCallback && (stats.entered > 0 || stats.failed > 0)) notifyCallback(user.discord_id, stats, fresh);
      } catch (err) { console.error(`[Engine] Error for ${user.discord_id}:`, err.message); }
    }
  };

  await tick();
  loopTimer = setInterval(tick, 2 * 60 * 60 * 1000); // Run every 2 hours
}

function clearSessionCache(id) { enteredThisSession.delete(id); twitterWarned.delete(id); rateLimitUntil.delete(id); }

module.exports = { runLoop, clearSessionCache };
