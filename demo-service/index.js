const express = require('express');

const PORT = parseInt(process.env.DEMO_SERVICE_PORT || '5055', 10) || 5055;

/** In-memory state — intentionally ephemeral for sandbox demos */
let isBroken = false;

const app = express();
app.use(express.json());

function healthBody() {
  if (isBroken) {
    return { ok: false, status: 'broken' };
  }
  return { ok: true, status: 'healthy' };
}

app.get('/health', (req, res) => {
  const body = healthBody();
  if (isBroken) {
    return res.status(500).json(body);
  }
  res.status(200).json(body);
});

app.post('/break', (req, res) => {
  isBroken = true;
  console.log('[demo-service] State -> broken');
  res.json({ ok: true, status: 'broken', message: 'Demo API marked broken' });
});

app.post('/repair', (req, res) => {
  isBroken = false;
  console.log('[demo-service] State -> healthy (repair)');
  res.json({ ok: true, status: 'healthy', message: 'Demo API repaired' });
});

app.get('/state', (req, res) => {
  res.json({ isBroken, status: isBroken ? 'broken' : 'healthy' });
});

app.listen(PORT, () => {
  console.log(`[demo-service] Listening on http://127.0.0.1:${PORT}`);
});
