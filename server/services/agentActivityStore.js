const agentActivity = {
  detection: { agent: 'detection', status: 'idle' },
  decision: { agent: 'decision', status: 'idle' },
  action: { agent: 'action', status: 'idle' },
  resolution: { agent: 'resolution', status: 'idle' },
  reporting: { agent: 'reporting', status: 'idle' },
  escalation: { agent: 'escalation', status: 'idle' },
};

function setActivity(update) {
  if (!update?.agent) return;
  agentActivity[update.agent] = {
    ...(agentActivity[update.agent] || { agent: update.agent }),
    ...update,
    timestamp: update.timestamp || new Date().toISOString(),
  };
}

function getSnapshot() {
  return Object.values(agentActivity);
}

module.exports = { setActivity, getSnapshot };

