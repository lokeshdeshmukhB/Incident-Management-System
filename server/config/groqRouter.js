const Groq = require('groq-sdk');
const env = require('./env');
const logger = require('../services/logger');

const GROQ_KEYS = env.groq.keys;

const AGENT_KEY_MAP = {
  detection: 0,
  resolution: 0,
  decision: 1,
  reporting: 1,
  action: 2,
  escalation: 2,
};

const keyHealth = GROQ_KEYS.map(() => ({ available: true, cooldownUntil: 0 }));

function getNextAvailableKey(startIndex) {
  const now = Date.now();
  for (let i = 0; i < GROQ_KEYS.length; i++) {
    const idx = (startIndex + i) % GROQ_KEYS.length;
    if (keyHealth[idx].available || now > keyHealth[idx].cooldownUntil) {
      keyHealth[idx].available = true;
      return idx;
    }
  }
  return startIndex;
}

function markKeyThrottled(keyIndex) {
  keyHealth[keyIndex].available = false;
  keyHealth[keyIndex].cooldownUntil = Date.now() + 60000;
  logger.warn(`Groq key ${keyIndex + 1} rate-limited, cooling down for 60s`);
}

async function callGroq(agentName, messages, options = {}) {
  const primaryKeyIndex = AGENT_KEY_MAP[agentName] ?? 0;
  let keyIndex = getNextAvailableKey(primaryKeyIndex);
  let lastError = null;

  for (let attempt = 0; attempt < GROQ_KEYS.length; attempt++) {
    try {
      const client = new Groq({ apiKey: GROQ_KEYS[keyIndex] });
      const completion = await client.chat.completions.create({
        model: options.model || env.groq.model,
        messages,
        temperature: options.temperature ?? 0.1,
        max_tokens: options.maxTokens || 2048,
        response_format: { type: 'json_object' },
      });

      const content = completion.choices[0]?.message?.content;
      if (!content) throw new Error('Empty response from Groq');

      logger.debug(`[${agentName}] Groq call succeeded (key ${keyIndex + 1})`);
      return JSON.parse(content);
    } catch (err) {
      lastError = err;
      if (err.status === 429 || err.message?.includes('rate_limit')) {
        markKeyThrottled(keyIndex);
        keyIndex = getNextAvailableKey((keyIndex + 1) % GROQ_KEYS.length);
        logger.warn(`[${agentName}] Rate limited, rotating to key ${keyIndex + 1}`);
        continue;
      }
      throw err;
    }
  }

  throw new Error(`All Groq keys exhausted for ${agentName}: ${lastError?.message}`);
}

module.exports = { callGroq, AGENT_KEY_MAP };
