const { HttpsProxyAgent } = require('https-proxy-agent');

// Optional egress-proxy pool for outbound calls to the Alphabot API.
//
// Why: every user's raffle entries go out from Railway's single shared IP.
// With enough users hitting api.alphabot.app from one IP in a tight window,
// that traffic pattern reads as automation to Alphabot's own abuse/rate-limit
// detection, which is a real risk to entry success — separate from anything
// happening on X/Twitter's side, which is validated by Alphabot's own
// backend and is not something this bot's egress IP can influence.
//
// Config: ALPHABOT_PROXY_LIST — comma-separated proxy URLs, e.g.
//   ALPHABOT_PROXY_LIST=http://user:pass@host1:port,http://user:pass@host2:port
// Leave unset and behavior is unchanged (direct connection, no proxy).
const PROXY_LIST = (process.env.ALPHABOT_PROXY_LIST || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

const agentCache = new Map();
let roundRobinIndex = 0;

function hashString(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function agentFor(proxyUrl) {
  if (!agentCache.has(proxyUrl)) agentCache.set(proxyUrl, new HttpsProxyAgent(proxyUrl));
  return agentCache.get(proxyUrl);
}

// Sticky-per-user assignment: the same discordId always maps to the same
// proxy in the pool. This spreads load across the pool while giving each
// user a stable "identity" from Alphabot's point of view (rather than
// hopping IPs request-to-request, which can look worse, not better).
// Falls back to round-robin when no discordId is available yet (e.g. key
// validation before a user record exists).
function getAgentForUser(discordId) {
  if (PROXY_LIST.length === 0) return undefined;
  const idx = discordId ? hashString(discordId) % PROXY_LIST.length : roundRobinIndex++ % PROXY_LIST.length;
  return agentFor(PROXY_LIST[idx]);
}

function proxyEnabled() {
  return PROXY_LIST.length > 0;
}

module.exports = { getAgentForUser, proxyEnabled, poolSize: PROXY_LIST.length };
