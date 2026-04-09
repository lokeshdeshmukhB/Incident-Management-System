const logger = require('./logger');

const ACTION_SIMULATORS = {
  async restart_service(service, command) {
    logger.info(`[ActionExecutor] Simulating restart of ${service}: ${command}`);
    await simulateDelay(2000, 5000);
    return {
      executed: true,
      success: true,
      output_log: `Service ${service} restarted successfully. New PID assigned.`,
      duration_ms: randomBetween(1500, 4000),
    };
  },

  async cleanup_logs(service, command) {
    logger.info(`[ActionExecutor] Simulating log cleanup for ${service}: ${command}`);
    await simulateDelay(3000, 8000);
    const filesDeleted = randomBetween(15, 200);
    const gbReclaimed = (Math.random() * 5 + 0.5).toFixed(1);
    return {
      executed: true,
      success: true,
      output_log: `Cleaned ${filesDeleted} log files, reclaimed ${gbReclaimed}GB on ${service}.`,
      duration_ms: randomBetween(3000, 7000),
    };
  },

  async switch_to_fallback(service, command) {
    logger.info(`[ActionExecutor] Simulating fallback switch for ${service}: ${command}`);
    await simulateDelay(1000, 3000);
    return {
      executed: true,
      success: true,
      output_log: `Traffic for ${service} rerouted to fallback endpoint.`,
      duration_ms: randomBetween(800, 2500),
    };
  },

  async retry_connections(service, command) {
    logger.info(`[ActionExecutor] Simulating connection retry for ${service}: ${command}`);
    await simulateDelay(1000, 4000);
    return {
      executed: true,
      success: true,
      output_log: `Network connections for ${service} re-established. 3/3 endpoints healthy.`,
      duration_ms: randomBetween(1000, 3500),
    };
  },

  async escalate_to_human(service) {
    logger.info(`[ActionExecutor] Escalation triggered for ${service}`);
    return {
      executed: true,
      success: true,
      output_log: `Escalation notification sent for ${service}. Awaiting human response.`,
      duration_ms: 100,
    };
  },
};

async function executeAction(actionName, service, command) {
  const executor = ACTION_SIMULATORS[actionName];
  if (!executor) {
    logger.warn(`[ActionExecutor] No simulator for action: ${actionName}, using generic`);
    await simulateDelay(1000, 3000);
    return {
      executed: true,
      success: true,
      output_log: `Action ${actionName} executed on ${service}`,
      duration_ms: randomBetween(1000, 3000),
    };
  }

  try {
    return await executor(service, command);
  } catch (err) {
    logger.error(`[ActionExecutor] Failed: ${err.message}`);
    return {
      executed: true,
      success: false,
      output_log: `Action ${actionName} failed on ${service}`,
      duration_ms: 0,
      error: err.message,
    };
  }
}

function simulateDelay(min, max) {
  const delay = randomBetween(min, max);
  return new Promise((resolve) => setTimeout(resolve, delay));
}

function randomBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

module.exports = { executeAction };
