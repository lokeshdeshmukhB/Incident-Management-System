/**
 * Manual helper: mark the sandbox demo API as broken (for live demos).
 */
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '../.env') });
dotenv.config({ path: path.join(__dirname, '../../.env') });

const base = (process.env.DEMO_SERVICE_URL || 'http://127.0.0.1:5055').replace(/\/$/, '');

fetch(`${base}/break`, { method: 'POST', headers: { 'Content-Type': 'application/json' } })
  .then(async (res) => {
    const text = await res.text();
    console.log(res.status, text);
    if (!res.ok) process.exit(1);
  })
  .catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
