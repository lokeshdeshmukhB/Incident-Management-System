const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
const env = require('./config/env');
const { testConnection } = require('./config/db');
const { setupIncidentSocket } = require('./sockets/incidentSocket');
const { startAlertPolling } = require('./jobs/alertIngestionJob');
const logger = require('./services/logger');

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

  server.listen(env.app.port, () => {
    logger.info(`AIMS server running on port ${env.app.port}`);
    logger.info(`Environment: ${env.app.nodeEnv}`);
  });
}

start();
