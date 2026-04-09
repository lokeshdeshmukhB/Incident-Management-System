const logger = require('../services/logger');
const { getSnapshot } = require('../services/agentActivityStore');

function setupIncidentSocket(io) {
  io.on('connection', (socket) => {
    logger.info(`[Socket] Client connected: ${socket.id}`);

    socket.on('subscribe:incidents', () => {
      socket.join('incidents');
      logger.debug(`[Socket] ${socket.id} subscribed to incidents`);
    });

    socket.on('subscribe:agents', () => {
      socket.join('agents');
      logger.debug(`[Socket] ${socket.id} subscribed to agent activity`);

      // Send last-known activity so late subscribers don't appear permanently "idle".
      for (const activity of getSnapshot()) {
        socket.emit('agent:activity', activity);
      }
    });

    socket.on('disconnect', () => {
      logger.info(`[Socket] Client disconnected: ${socket.id}`);
    });
  });

  logger.info('[Socket] Incident socket handlers initialized');
}

module.exports = { setupIncidentSocket };
