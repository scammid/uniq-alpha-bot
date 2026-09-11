const axios = require('axios');
const { getAgentForUser } = require('../utils/proxyAgent');

const BASE_URL = 'https://api.alphabot.app/v1';

// Network-level errors worth retrying once (as opposed to a definitive
// 4xx/response from Alphabot itself). Proxy hops add a few more ways a
// request can fail transiently, so this list is a bit broader than just
// timeouts.
const RETRYABLE_CODES = new Set(['ECONNABORTED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN']);

function createClient(apiKey, discordId) {
  const agent = getAgentForUser(discordId);
  return axios.create({
    baseURL: BASE_URL,
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    timeout: 30000,
    // When a proxy agent is set, also disable axios's own env-based proxy
    // handling so it doesn't try to layer another proxy on top of it.
    ...(agent ? { httpsAgent: agent, proxy: false } : {}),
  });
}

async function validateApiKey(apiKey, discordId) {
  try {
    const client = createClient(apiKey, discordId);
    const res = await client.get('/raffles', { params: { status: 'active', pageSize: 1 } });
    if (res.data?.success) return { valid: true };
    return { valid: false, error: 'Invalid response' };
  } catch (err) {
    const status = err.response?.status;
    const message = err.response?.data?.errors?.[0]?.message || err.message;
    if (status === 401) return { valid: false, error: 'Invalid API key' };
    return { valid: false, error: message };
  }
}

async function getOpenRaffles(apiKey, teamIds = [], discordId) {
  try {
    const client = createClient(apiKey, discordId);
    let allRaffles = [];
    if (teamIds.length > 0) {
      for (const alpha of teamIds) {
        const res = await client.get('/raffles', { params: { status: 'active', pageSize: 50, alpha } });
        allRaffles = [...allRaffles, ...(res.data?.data?.raffles || [])];
      }
    } else {
      const res = await client.get('/raffles', { params: { status: 'active', pageSize: 50 } });
      allRaffles = res.data?.data?.raffles || [];
    }
    console.log(`[Alphabot] [ALL] Found ${allRaffles.length} raffle(s)`);
    return { success: true, raffles: allRaffles };
  } catch (err) {
    const status = err.response?.status;
    const message = err.response?.data?.errors?.[0]?.message || err.message;
    if (status === 401) return { success: false, error: message, invalidKey: true };
    if (status === 429) return { success: false, error: message, rateLimited: true };
    return { success: false, error: message };
  }
}

async function getMyCommunityRaffles(apiKey, discordId) {
  try {
    const client = createClient(apiKey, discordId);
    const res = await client.get('/raffles', { params: { status: 'active', pageSize: 50, scope: 'community' } });
    const raffles = res.data?.data?.raffles || [];
    console.log(`[Alphabot] [COMMUNITY] Found ${raffles.length} raffle(s)`);
    return { success: true, raffles };
  } catch (err) {
    const status = err.response?.status;
    const message = err.response?.data?.errors?.[0]?.message || err.message;
    if (status === 401) return { success: false, error: message, invalidKey: true };
    if (status === 429) return { success: false, error: message, rateLimited: true };
    return { success: false, error: message };
  }
}

async function enterRaffle(apiKey, slug, discordId, retries = 2) {
  try {
    const client = createClient(apiKey, discordId);
    const res = await client.post('/register', { slug });
    const validation = res.data?.data?.validation;
    const reason = validation?.reason;
    const resultMd = res.data?.data?.resultMd || '';

    if (validation?.success === false && reason) {
      if (reason.toLowerCase().includes('already')) return { success: false, alreadyEntered: true, error: reason };
      if (validation?.twitterValid === false || resultMd.toLowerCase().includes('twitter')) {
        return { success: false, ineligible: true, twitterIssue: true, error: reason };
      }
      return { success: false, ineligible: true, error: reason };
    }
    return { success: true, data: res.data };
  } catch (err) {
    const status = err.response?.status;
    const message = err.response?.data?.errors?.[0]?.message || err.message;
    if (RETRYABLE_CODES.has(err.code) && retries > 0) {
      await new Promise(r => setTimeout(r, 3000));
      return enterRaffle(apiKey, slug, discordId, retries - 1);
    }
    if (status === 401) return { success: false, invalidKey: true, error: message };
    if (status === 429) return { success: false, rateLimited: true, error: message };
    if (message?.toLowerCase().includes('already')) return { success: false, alreadyEntered: true, error: message };
    if (status === 400) return { success: false, ineligible: true, error: message };
    return { success: false, error: message };
  }
}

async function checkWins(apiKey, discordId) {
  try {
    const client = createClient(apiKey, discordId);
    const res = await client.get('/raffles', { params: { filter: 'winners', pageSize: 50 } });
    const wins = res.data?.data?.raffles || [];
    console.log(`[Win] Found ${wins.length} win(s)`);
    return { success: true, wins };
  } catch (_) { return { success: false, wins: [] }; }
}

async function getRaffleDetails(apiKey, slug, discordId) {
  try {
    const client = createClient(apiKey, discordId);
    const res = await client.get(`/raffles/${slug}`);
    return { success: true, raffle: res.data?.data?.raffle };
  } catch (err) { return { success: false, error: err.message }; }
}

module.exports = { validateApiKey, getOpenRaffles, getMyCommunityRaffles, enterRaffle, checkWins, getRaffleDetails };
