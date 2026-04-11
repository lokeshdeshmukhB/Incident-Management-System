const dotenv = require('dotenv');
const path = require('path');

// Prefer backend-local `.env`, then repo-root `.env`, then `.env.example`.
// This supports both setups:
// - env stored at `server/.env`
// - env stored at repo root `.env`
let loaded = dotenv.config({ path: path.resolve(__dirname, '../.env') });
if (loaded.error) loaded = dotenv.config({ path: path.resolve(__dirname, '../../.env') });
if (loaded.error) loaded = dotenv.config({ path: path.resolve(__dirname, '../.env.example') });
if (loaded.error) loaded = dotenv.config({ path: path.resolve(__dirname, '../../.env.example') });

/** `seed.js` only talks to Supabase; Groq keys are not loaded on many hosts that run a one-off seed job. */
function isRunningSeedScript() {
  const main = process.argv[1];
  if (!main) return false;
  const norm = main.replace(/\\/g, '/');
  return norm.endsWith('/seed.js') || norm === 'seed.js';
}

const required = isRunningSeedScript()
  ? ['SUPABASE_URL', 'SUPABASE_ANON_KEY']
  : ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'GROQ_API_KEY_1'];

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

function parseServiceEscalationEmails(raw) {
  if (!raw || typeof raw !== 'string' || !raw.trim()) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed;
    }
    console.warn('[env] SERVICE_ESCALATION_EMAILS_JSON must be a JSON object, using {}');
    return {};
  } catch (e) {
    console.warn(`[env] Failed to parse SERVICE_ESCALATION_EMAILS_JSON: ${e.message}`);
    return {};
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
  email: {
    host: process.env.SMTP_HOST || '',
    port: (() => {
      const p = parseInt(process.env.SMTP_PORT || '587', 10);
      return Number.isNaN(p) ? 587 : p;
    })(),
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER || '',
    // Gmail app passwords are often copied with spaces between groups; SMTP expects 16 chars without spaces.
    pass: (process.env.SMTP_PASS || '').replace(/\s+/g, ''),
    escalationEmails: (process.env.ESCALATION_EMAILS || '')
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean),
    serviceEscalationEmails: parseServiceEscalationEmails(process.env.SERVICE_ESCALATION_EMAILS_JSON),
  },
  polling: {
    alertPollIntervalMs: parseInt(process.env.ALERT_POLL_INTERVAL_MS, 10) || 10000,
    /** When false, `data/alerts.csv` polling is disabled (webhook-only demos). Default: enabled. */
    enableCsvPolling: process.env.ENABLE_CSV_POLLING !== 'false',
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
  /** Sandbox demo: local demo API + webhook monitor + optional real POST /repair. */
  demoSandbox: {
    serviceUrl: (process.env.DEMO_SERVICE_URL || 'http://127.0.0.1:5055').replace(/\/$/, ''),
    enableRealFixes: process.env.ENABLE_REAL_SANDBOX_FIXES === 'true',
    webhookSharedSecret: process.env.WEBHOOK_SHARED_SECRET || '',
  },
};
