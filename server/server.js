const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
const env = require('./config/env');
const { testConnection } = require('./config/db');
const { setupIncidentSocket } = require('./sockets/incidentSocket');
const { startAlertPolling } = require('./jobs/alertIngestionJob');
const logger = require('./services/logger');
const { writeListeningPort, registerExitCleanup } = require('./utils/devPortFile');

const alertRoutes = require('./routes/alerts');
const incidentRoutes = require('./routes/incidents');
const reportRoutes = require('./routes/reports');
const dashboardRoutes = require('./routes/dashboard');
const workflowRoutes = require('./routes/workflows');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST', 'PATCH', 'DELETE'] },
});

app.use(cors());
app.use(express.json());

app.set('io', io);

app.use('/api/alerts', alertRoutes);
app.use('/api/incidents', incidentRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/workflows', workflowRoutes);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

setupIncidentSocket(io);

async function start() {
  const dbOk = await testConnection();
  if (!dbOk) {
    logger.warn('Starting without confirmed DB connection. Ensure Supabase tables are created.');
  }

  startAlertPolling(io);

  const isProd = env.app.nodeEnv === 'production';
  if (!isProd) registerExitCleanup();
  let port = env.app.port;
  let attempts = 0;
  let listening = false;

  const listen = () => {
    attempts += 1;
    server.listen(port);
  };

  const configuredPort = env.app.port;

  server.once('listening', () => {
    listening = true;
    logger.info(`AIMS server running on port ${port}`);
    logger.info(`Environment: ${env.app.nodeEnv}`);
    if (!isProd) {
      writeListeningPort(port);
      if (port !== configuredPort) {
        logger.info(
          `Wrote ${port} to repo .aims-backend-port — restart Vite (or use npm run dev from repo root) so the client proxy and Socket.io match this port.`
        );
      }
    }
  });

  server.on('error', (err) => {
    if (!isProd && !listening && err && err.code === 'EADDRINUSE' && attempts < 20) {
      logger.warn(`Port ${port} is in use; trying ${port + 1}...`);
      port += 1;
      setTimeout(listen, 200);
      return;
    }

    logger.error(`Server failed to start: ${err?.message || err}`);
    process.exit(1);
  });

  listen();
}

start();
