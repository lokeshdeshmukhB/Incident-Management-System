const { supabase } = require('../config/db');

const TABLE = 'alerts';

const AlertModel = {
  async create(alert) {
    const { data, error } = await supabase.from(TABLE).insert(alert).select().single();
    if (error) throw error;
    return data;
  },

  async findByAlertId(alertId) {
    const { data, error } = await supabase.from(TABLE).select('*').eq('alert_id', alertId).single();
    if (error && error.code !== 'PGRST116') throw error;
    return data;
  },

  async findAll({ severity, service, alertType, limit = 50, offset = 0 } = {}) {
    let query = supabase.from(TABLE).select('*', { count: 'exact' });
    if (severity) query = query.eq('severity', severity);
    if (service) query = query.eq('service', service);
    if (alertType) query = query.eq('alert_type', alertType);
    query = query.order('timestamp', { ascending: false }).range(offset, offset + limit - 1);
    const { data, error, count } = await query;
    if (error) throw error;
    return { data, count };
  },

  async findRecentByTypeAndService(alertType, service, windowSeconds = 60) {
    const cutoff = new Date(Date.now() - windowSeconds * 1000).toISOString();
    const { data, error } = await supabase
      .from(TABLE)
      .select('*')
      .eq('alert_type', alertType)
      .eq('service', service)
      .gte('timestamp', cutoff)
      .order('timestamp', { ascending: false });
    if (error) throw error;
    return data || [];
  },

  async markProcessed(alertId) {
    const { data, error } = await supabase
      .from(TABLE)
      .update({ processed: true })
      .eq('alert_id', alertId)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async findUnprocessed() {
    const { data, error } = await supabase
      .from(TABLE)
      .select('*')
      .eq('processed', false)
      .order('timestamp', { ascending: true });
    if (error) throw error;
    return data || [];
  },
};

module.exports = AlertModel;
