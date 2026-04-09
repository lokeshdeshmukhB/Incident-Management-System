const axios = require('axios');
const env = require('../config/env');
const logger = require('./logger');

async function sendSlackNotification(message) {
  if (!env.notifications.slackWebhookUrl) {
    logger.debug('[Notifier] Slack webhook not configured, skipping');
    return false;
  }

  try {
    await axios.post(env.notifications.slackWebhookUrl, {
      text: typeof message === 'string' ? message : message.text,
      blocks: message.blocks,
    });
    logger.info('[Notifier] Slack notification sent');
    return true;
  } catch (err) {
    logger.error(`[Notifier] Slack failed: ${err.message}`);
    return false;
  }
}

async function sendPagerDutyAlert(incident) {
  if (!env.notifications.pagerdutyApiKey) {
    logger.debug('[Notifier] PagerDuty not configured, skipping');
    return false;
  }

  try {
    await axios.post('https://events.pagerduty.com/v2/enqueue', {
      routing_key: env.notifications.pagerdutyApiKey,
      event_action: 'trigger',
      payload: {
        summary: `AIMS Alert: ${incident.alert_type} on ${incident.service}`,
        severity: incident.severity === 'critical' ? 'critical' : 'warning',
        source: 'AIMS',
        component: incident.service,
      },
    });
    logger.info('[Notifier] PagerDuty alert triggered');
    return true;
  } catch (err) {
    logger.error(`[Notifier] PagerDuty failed: ${err.message}`);
    return false;
  }
}

async function notifyEscalation(escalation, incident) {
  const results = [];

  const channels = escalation.notification_channels || ['slack'];

  if (channels.includes('slack')) {
    const slackMsg = {
      text: `🚨 *${escalation.message_title}*\n${escalation.message_body}`,
    };
    results.push(await sendSlackNotification(slackMsg));
  }

  if (channels.includes('pagerduty')) {
    results.push(await sendPagerDutyAlert(incident));
  }

  return results.some(Boolean);
}

module.exports = { sendSlackNotification, sendPagerDutyAlert, notifyEscalation };
