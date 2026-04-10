const logger = require('./logger');

// In development, use much shorter simulated delays so the pipeline runs quickly.
const isDev = (process.env.NODE_ENV || 'development') === 'development';

const DELAY_SCALE = isDev ? 0.05 : 1; // 5% of original delays in dev

const ACTION_SIMULATORS = {
  async restart_service(service, command) {
    logger.info(`[ActionExecutor] Simulating restart of ${service}: ${command}`);
    await simulateDelay(2000 * DELAY_SCALE, 5000 * DELAY_SCALE);
    return {
      executed: true,
      success: true,
      output_log: `Service ${service} restarted successfully. New PID assigned.`,
      duration_ms: randomBetween(150, 400),
    };
  },

  async restart_api_service(service, command) {
    logger.info(`[ActionExecutor] Simulating API service restart of ${service}: ${command}`);
    await simulateDelay(1500 * DELAY_SCALE, 4000 * DELAY_SCALE);
    return {
      executed: true,
      success: true,
      output_log: `API service ${service} restarted. Error rate normalized. All health probes passing.`,
      duration_ms: randomBetween(150, 350),
    };
  },

  async cleanup_disk_space(service, command) {
    logger.info(`[ActionExecutor] Simulating disk cleanup for ${service}: ${command}`);
    await simulateDelay(2000 * DELAY_SCALE, 5000 * DELAY_SCALE);
    const gbReclaimed = (Math.random() * 30 + 5).toFixed(1);
    return {
      executed: true,
      success: true,
      output_log: `Disk cleanup completed on ${service}. Reclaimed ${gbReclaimed}GB. Disk usage now below threshold.`,
      duration_ms: randomBetween(200, 500),
    };
  },

  async cleanup_logs(service, command) {
    logger.info(`[ActionExecutor] Simulating log cleanup for ${service}: ${command}`);
    await simulateDelay(3000 * DELAY_SCALE, 8000 * DELAY_SCALE);
    const filesDeleted = randomBetween(15, 200);
    const gbReclaimed = (Math.random() * 5 + 0.5).toFixed(1);
    return {
      executed: true,
      success: true,
      output_log: `Cleaned ${filesDeleted} log files, reclaimed ${gbReclaimed}GB on ${service}.`,
      duration_ms: randomBetween(150, 400),
    };
  },

  async switch_to_fallback(service, command) {
    logger.info(`[ActionExecutor] Simulating fallback switch for ${service}: ${command}`);
    await simulateDelay(1000 * DELAY_SCALE, 3000 * DELAY_SCALE);
    return {
      executed: true,
      success: true,
      output_log: `Traffic for ${service} rerouted to fallback endpoint.`,
      duration_ms: randomBetween(80, 250),
    };
  },

  async retry_connections(service, command) {
    logger.info(`[ActionExecutor] Simulating connection retry for ${service}: ${command}`);
    await simulateDelay(1000 * DELAY_SCALE, 4000 * DELAY_SCALE);
    return {
      executed: true,
      success: true,
      output_log: `Network connections for ${service} re-established. 3/3 endpoints healthy.`,
      duration_ms: randomBetween(80, 250),
    };
  },

  async scale_up_instances(service, command) {
    logger.info(`[ActionExecutor] Simulating scale-up for ${service}: ${command}`);
    await simulateDelay(1000 * DELAY_SCALE, 3000 * DELAY_SCALE);
    return {
      executed: true,
      success: true,
      output_log: `Scaled ${service} from 2 to 4 instances. Load distributed.`,
      duration_ms: randomBetween(100, 300),
    };
  },

  async escalate_to_human(service) {
    logger.info(`[ActionExecutor] Escalation triggered for ${service}`);
    return {
      executed: true,
      success: true,
      output_log: `Escalation notification sent for ${service}. Awaiting human response.`,
      duration_ms: 50,
    };
  },

  async notify_admin(service, command) {
    logger.info(`[ActionExecutor] Notify admin for ${service}: ${command || 'certificate / policy follow-up'}`);
    await simulateDelay(200 * DELAY_SCALE, 800 * DELAY_SCALE);
    return {
      executed: true,
      success: true,
      output_log: `Ops notification queued for ${service}.`,
      duration_ms: randomBetween(80, 200),
    };
  },
};

async function executeAction(actionName, service, command) {
  const executor = ACTION_SIMULATORS[actionName];
  if (!executor) {
    logger.warn(`[ActionExecutor] No simulator for action: ${actionName}, using generic`);
    await simulateDelay(500 * DELAY_SCALE, 1500 * DELAY_SCALE);
    return {
      executed: true,
      success: true,
      output_log: `Action ${actionName} executed on ${service}`,
      duration_ms: randomBetween(100, 300),
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
