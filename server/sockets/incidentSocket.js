const logger = require('../services/logger');

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
    });

    socket.on('disconnect', () => {
      logger.info(`[Socket] Client disconnected: ${socket.id}`);
    });
  });

  logger.info('[Socket] Incident socket handlers initialized');
}

module.exports = { setupIncidentSocket };
