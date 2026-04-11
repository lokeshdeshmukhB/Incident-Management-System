const fs = require('fs');
const path = require('path');
const { supabase } = require('./config/db');
const { parseAlerts, parseWorkflows } = require('./services/csvParser');
const logger = require('./services/logger');

async function seed() {
  logger.info('Seeding database from CSV files...');

  try {
    const dataDir = path.resolve(__dirname, '../data');
    for (const name of ['workflows.csv', 'alerts.csv']) {
      const fp = path.join(dataDir, name);
      if (!fs.existsSync(fp)) {
        logger.warn(`Seed: CSV not found at ${fp} (rows for ${name} will be skipped). Deploy must include the data/ folder.`);
      }
    }

    const workflows = await parseWorkflows();
    if (workflows.length > 0) {
      const { error: delError } = await supabase.from('workflow_rules').delete().neq('id', '00000000-0000-0000-0000-000000000000');
      if (delError) logger.warn('Could not clear workflow_rules: ' + delError.message);

      const { data, error } = await supabase.from('workflow_rules').insert(workflows).select();
      if (error) throw error;
      logger.info(`Inserted ${data.length} workflow rules`);
    }

    const rawAlerts = await parseAlerts();
    const alerts = rawAlerts.filter(
      (a) => a.alert_id != null && String(a.alert_id).trim() !== ''
    );
    if (rawAlerts.length > alerts.length) {
      logger.warn(`Skipped ${rawAlerts.length - alerts.length} alert row(s) missing alert_id`);
    }
    if (alerts.length > 0) {
      const alertIds = alerts.map((a) => a.alert_id);
      let processedById = new Map();
      if (alertIds.length > 0) {
        const { data: existingAlerts, error: selErr } = await supabase
          .from('alerts')
          .select('alert_id, processed')
          .in('alert_id', alertIds);
        if (selErr) logger.warn('Could not read existing alerts for merge: ' + selErr.message);
        else processedById = new Map((existingAlerts || []).map((r) => [r.alert_id, Boolean(r.processed)]));
      }

      const formatted = alerts.map((a) => ({
        alert_id: a.alert_id,
        alert_type: a.alert_type,
        severity: a.severity,
        service: a.service,
        host: a.host,
        metric_value: a.metric_value,
        threshold: a.threshold,
        timestamp: a.timestamp,
        // Do not wipe processed=true on re-seed — otherwise CSV polling re-runs every row forever.
        processed: processedById.get(a.alert_id) === true,
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
