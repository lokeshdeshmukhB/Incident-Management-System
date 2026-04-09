const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const required = [
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'GROQ_API_KEY_1',
];

const missing = required.filter((key) => !process.env[key]);
if (missing.length > 0) {
  console.error(`Missing required environment variables: ${missing.join(', ')}`);
  console.error('Copy .env.example to .env and fill in the values.');
  process.exit(1);
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
    model: process.env.GROQ_MODEL || 'llama3-70b-8192',
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
};
