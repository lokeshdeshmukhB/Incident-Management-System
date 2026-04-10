const axios = require('axios');
const nodemailer = require('nodemailer');
const env = require('../config/env');
const logger = require('./logger');

let emailTransporter = null;

function smtpConfigPresent() {
  const { host, user, pass } = env.email;
  return Boolean(host && user && pass);
}

function getEmailTransporter() {
  if (!smtpConfigPresent()) {
    return null;
  }
  if (!emailTransporter) {
    const { host, port, secure, user, pass } = env.email;
    emailTransporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: { user, pass },
    });
  }
  return emailTransporter;
}

function normalizeRecipientList(value) {
  if (value == null) {
    return [];
  }
  if (Array.isArray(value)) {
    return value.map((v) => String(v).trim()).filter(Boolean);
  }
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean);
  }
  return [];
}

function resolveEscalationRecipients(incident) {
  const service = incident && incident.service;
  const map = env.email.serviceEscalationEmails || {};
  if (service != null) {
    const key = String(service).trim();
    const candidates = [key, key.toLowerCase()];
    for (const k of candidates) {
      if (k && Object.prototype.hasOwnProperty.call(map, k)) {
        const svcList = normalizeRecipientList(map[k]);
        if (svcList.length > 0) {
          return svcList;
        }
      }
    }
  }
  return env.email.escalationEmails ? [...env.email.escalationEmails] : [];
}

function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function buildEscalationEmailContent(escalation, incident) {
  const stepsBlock =
    Array.isArray(escalation.recommended_manual_steps) && escalation.recommended_manual_steps.length > 0
      ? escalation.recommended_manual_steps.map((step, i) => `${i + 1}. ${step}`).join('\n')
      : '1. Review the affected service\n2. Check recent logs and metrics\n3. Apply manual remediation';

  const reason =
    incident.escalation_reason || incident.failure_reason || 'Automated remediation failed';

  const text = `Hello Team,

The automated AI incident remediation workflow has failed and requires manual attention.

Incident Details
------------------------
Incident ID: ${incident.incident_id}
Service: ${incident.service}
Alert Type: ${incident.alert_type}
Severity: ${incident.severity}
Retry Count: ${incident.retry_count ?? 0}
Current Status: ${incident.status || 'escalated'}

Escalation Summary
------------------------
Title: ${escalation.message_title || 'Escalation triggered'}
Priority: ${escalation.escalation_priority || 'P2'}
Reason: ${reason}

AI Context
------------------------
${escalation.message_body || escalation.message || 'The AI workflow could not safely resolve the incident.'}

Recommended Manual Steps
------------------------
${stepsBlock}

Please investigate immediately.

Regards,
AIMS Automated Incident Management System`;

  const html = `<p>Hello Team,</p>
<p>The automated AI incident remediation workflow has failed and requires manual attention.</p>
<h3>Incident Details</h3>
<hr/>
<pre style="font-family:sans-serif;white-space:pre-wrap;">Incident ID: ${escapeHtml(incident.incident_id)}
Service: ${escapeHtml(incident.service)}
Alert Type: ${escapeHtml(incident.alert_type)}
Severity: ${escapeHtml(incident.severity)}
Retry Count: ${escapeHtml(incident.retry_count ?? 0)}
Current Status: ${escapeHtml(incident.status || 'escalated')}</pre>
<h3>Escalation Summary</h3>
<hr/>
<pre style="font-family:sans-serif;white-space:pre-wrap;">Title: ${escapeHtml(escalation.message_title || 'Escalation triggered')}
Priority: ${escapeHtml(escalation.escalation_priority || 'P2')}
Reason: ${escapeHtml(reason)}</pre>
<h3>AI Context</h3>
<hr/>
<pre style="font-family:sans-serif;white-space:pre-wrap;">${escapeHtml(
    escalation.message_body || escalation.message || 'The AI workflow could not safely resolve the incident.'
  )}</pre>
<h3>Recommended Manual Steps</h3>
<hr/>
<pre style="font-family:sans-serif;white-space:pre-wrap;">${escapeHtml(stepsBlock)}</pre>
<p>Please investigate immediately.</p>
<p>Regards,<br/>AIMS Automated Incident Management System</p>`;

  return { text, html };
}

async function sendEmailNotification({ to, subject, text, html }) {
  if (!smtpConfigPresent()) {
    logger.warn('[Notifier] Email skipped: SMTP host, user, or password not configured');
    return false;
  }

  const recipients = normalizeRecipientList(to);
  if (recipients.length === 0) {
    logger.warn('[Notifier] Email skipped: no recipients');
    return false;
  }

  const transport = getEmailTransporter();
  if (!transport) {
    logger.warn('[Notifier] Email skipped: transporter unavailable');
    return false;
  }

  try {
    await transport.sendMail({
      from: env.email.user,
      to: recipients.join(', '),
      subject,
      text,
      html,
    });
    logger.info('[Notifier] Email sent');
    return true;
  } catch (err) {
    logger.error(`[Notifier] Email failed: ${err.message}`);
    return false;
  }
}

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

function normalizeEscalationChannels(raw) {
  if (raw == null || raw === '') {
    return ['slack', 'pagerduty', 'email'];
  }
  if (typeof raw === 'string') {
    const parts = raw.split(/[,\s]+/).map((c) => c.trim().toLowerCase()).filter(Boolean);
    return parts.length > 0 ? parts : ['slack', 'pagerduty', 'email'];
  }
  if (Array.isArray(raw)) {
    const parts = raw.map((c) => String(c).trim().toLowerCase()).filter(Boolean);
    return parts.length > 0 ? parts : ['slack', 'pagerduty', 'email'];
  }
  return ['slack', 'pagerduty', 'email'];
}

async function notifyEscalation(escalation, incident) {
  const results = [];

  let channels = normalizeEscalationChannels(escalation.notification_channels);
  const recipients = resolveEscalationRecipients(incident);
  if (smtpConfigPresent() && recipients.length > 0 && !channels.includes('email')) {
    logger.info('[Notifier] Adding email channel (SMTP configured and recipients set; model omitted email)');
    channels = [...channels, 'email'];
  }

  if (channels.includes('slack')) {
    const slackMsg = {
      text: `🚨 *${escalation.message_title}*\n${escalation.message_body}`,
    };
    results.push(await sendSlackNotification(slackMsg));
  }

  if (channels.includes('pagerduty')) {
    results.push(await sendPagerDutyAlert(incident));
  }

  if (channels.includes('email')) {
    const subject = `🚨 AIMS Escalation — ${incident.incident_id}`;
    const { text, html } = buildEscalationEmailContent(escalation, incident);
    const to = recipients;
    results.push(await sendEmailNotification({ to, subject, text, html }));
  }

  return results.some(Boolean);
}

module.exports = {
  sendSlackNotification,
  sendPagerDutyAlert,
  notifyEscalation,
  sendEmailNotification,
  resolveEscalationRecipients,
};
