const { supabase } = require('./config/db');
const { parseAlerts, parseWorkflows } = require('./services/csvParser');
const logger = require('./services/logger');

async function seed() {
  logger.info('Seeding database from CSV files...');

  try {
    const workflows = await parseWorkflows();
    if (workflows.length > 0) {
      const { error: delError } = await supabase.from('workflow_rules').delete().neq('id', '00000000-0000-0000-0000-000000000000');
      if (delError) logger.warn('Could not clear workflow_rules: ' + delError.message);

      const { data, error } = await supabase.from('workflow_rules').insert(workflows).select();
      if (error) throw error;
      logger.info(`Inserted ${data.length} workflow rules`);
    }

    const alerts = await parseAlerts();
    if (alerts.length > 0) {
      const formatted = alerts.map((a) => ({
        alert_id: a.alert_id,
        alert_type: a.alert_type,
        severity: a.severity,
        service: a.service,
        host: a.host,
        metric_value: a.metric_value,
        threshold: a.threshold,
        timestamp: a.timestamp,
        processed: false,
      }));

      const { data, error } = await supabase.from('alerts').upsert(formatted, { onConflict: 'alert_id' }).select();
      if (error) throw error;
      logger.info(`Upserted ${data.length} alerts`);
    }

    logger.info('Seeding complete.');
  } catch (err) {
    logger.error('Seed failed: ' + err.message);
    process.exit(1);
  }
}

seed();
