const dotenv = require('dotenv');
const path = require('path');

// Prefer backend-local `.env`, then repo-root `.env`, then `.env.example`.
// This supports both setups:
// - env stored at `server/.env`
// - env stored at repo root `.env`
let loaded = dotenv.config({ path: path.resolve(__dirname, '../.env') });
if (loaded.error) loaded = dotenv.config({ path: path.resolve(__dirname, '../../.env') });
if (loaded.error) loaded = dotenv.config({ path: path.resolve(__dirname, '../../.env.example') });

const required = [
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'GROQ_API_KEY_1',
];

const missing = required.filter((key) => !process.env[key]);
if (missing.length > 0) {
  const msg = `Missing required environment variables: ${missing.join(', ')}`;
  const hint = 'Copy .env.example to .env and fill in the values.';

  // Only hard-fail when explicitly running in production.
  if ((process.env.NODE_ENV || 'development') === 'production') {
    console.error(msg);
    console.error(hint);
    process.exit(1);
  } else {
    console.warn(msg);
    console.warn(hint);
    console.warn('Continuing in development mode with limited functionality.');
  }
}

module.exports = {
  supabase: {
    url: process.env.SUPABASE_URL,
    anonKey: process.env.SUPABASE_ANON_KEY,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY,
  },
  groq: {
    keys: [
      process.env.GROQ_API_KEY_1,
      process.env.GROQ_API_KEY_2 || process.env.GROQ_API_KEY_1,
      process.env.GROQ_API_KEY_3 || process.env.GROQ_API_KEY_1,
    ],
    model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
  },
  app: {
    port: parseInt(process.env.PORT, 10) || 5000,
    nodeEnv: process.env.NODE_ENV || 'development',
    jwtSecret: process.env.JWT_SECRET || 'aims-dev-secret',
  },
  notifications: {
    slackWebhookUrl: process.env.SLACK_WEBHOOK_URL,
    pagerdutyApiKey: process.env.PAGERDUTY_API_KEY,
  },
  polling: {
    alertPollIntervalMs: parseInt(process.env.ALERT_POLL_INTERVAL_MS, 10) || 10000,
  },
  /** When true (default in development), align decision with workflows.csv / DB rule so demo actions run and incidents can resolve. */
  pipeline: {
    devAutoApproveWorkflowActions:
      process.env.DEV_AUTO_APPROVE_WORKFLOW_ACTIONS !== 'false' &&
      (process.env.NODE_ENV || 'development') !== 'production',
  },
  /** Mock health check timing; in development keeps pipelines snappy. */
  healthCheck: {
    delayMsMin: parseInt(process.env.HEALTH_CHECK_DELAY_MS_MIN, 10),
    delayMsMax: parseInt(process.env.HEALTH_CHECK_DELAY_MS_MAX, 10),
  },
};
