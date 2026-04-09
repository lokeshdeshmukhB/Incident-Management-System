const { callGroq } = require('../config/groqRouter');
const logger = require('../services/logger');

class BaseAgent {
  constructor(name, systemPrompt) {
    this.name = name;
    this.systemPrompt = systemPrompt;
    this.maxRetries = 2;
  }

  async run(input) {
    const startTime = Date.now();
    logger.info(`[${this.name}] Starting execution`);

    let lastError = null;
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const messages = [
          { role: 'system', content: this.systemPrompt },
          { role: 'user', content: JSON.stringify(input, null, 2) },
        ];

        const result = await callGroq(this.name, messages);
        const duration = Date.now() - startTime;

        logger.info(`[${this.name}] Completed in ${duration}ms`);
        return {
          ...result,
          _meta: {
            agent: this.name,
            duration_ms: duration,
            timestamp: new Date().toISOString(),
          },
        };
      } catch (err) {
        lastError = err;
        logger.error(`[${this.name}] Attempt ${attempt} failed: ${err.message}`);
        if (attempt < this.maxRetries) {
          await new Promise((r) => setTimeout(r, 1000 * attempt));
        }
      }
    }

    logger.error(`[${this.name}] All attempts failed`);
    return {
      error: true,
      message: lastError?.message || 'Unknown error',
      _meta: {
        agent: this.name,
        duration_ms: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      },
    };
  }
}

module.exports = BaseAgent;
