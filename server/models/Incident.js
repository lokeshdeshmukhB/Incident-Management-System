const { supabase } = require('../config/db');

const TABLE = 'incidents';

const IncidentModel = {
  async create(incident) {
    const { data, error } = await supabase.from(TABLE).insert(incident).select().single();
    if (error) throw error;
    return data;
  },

  async findByIncidentId(incidentId) {
    const { data, error } = await supabase.from(TABLE).select('*').eq('incident_id', incidentId).single();
    if (error && error.code !== 'PGRST116') throw error;
    return data;
  },

  async findAll({ status, severity, service, limit = 50, offset = 0 } = {}) {
    let query = supabase.from(TABLE).select('*', { count: 'exact' });
    if (status) query = query.eq('status', status);
    if (severity) query = query.eq('severity', severity);
    if (service) query = query.eq('service', service);
    query = query.order('started_at', { ascending: false }).range(offset, offset + limit - 1);
    const { data, error, count } = await query;
    if (error) throw error;
    return { data, count };
  },

  async update(incidentId, updates) {
    const { data, error } = await supabase
      .from(TABLE)
      .update(updates)
      .eq('incident_id', incidentId)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async delete(incidentId) {
    const { error } = await supabase.from(TABLE).delete().eq('incident_id', incidentId);
    if (error) throw error;
    return true;
  },

  async getKPIs() {
    const { data: all, error } = await supabase.from(TABLE).select('*');
    if (error) throw error;

    const incidents = all || [];
    const resolved = incidents.filter((i) => i.status === 'resolved');
    const escalated = incidents.filter((i) => i.escalated);
    const today = new Date().toISOString().split('T')[0];
    const todayIncidents = incidents.filter((i) => i.started_at?.startsWith(today));

    const avgMttd = resolved.length
      ? Math.round(resolved.reduce((sum, i) => sum + (i.mttd_sec || 0), 0) / resolved.length)
      : 0;
    const avgMttr = resolved.length
      ? Math.round(resolved.reduce((sum, i) => sum + (i.mttr_sec || 0), 0) / resolved.length)
      : 0;
    const automationRate = incidents.length
      ? Math.round(((incidents.length - escalated.length) / incidents.length) * 100 * 10) / 10
      : 0;
    const escalationRate = incidents.length
      ? Math.round((escalated.length / incidents.length) * 100 * 10) / 10
      : 0;

    return {
      mttd_avg: avgMttd,
      mttr_avg: avgMttr,
      automation_rate: automationRate,
      escalation_rate: escalationRate,
      incidents_today: todayIncidents.length,
      total_incidents: incidents.length,
      resolved_count: resolved.length,
      escalated_count: escalated.length,
    };
  },

  async getTimeline(days = 7) {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabase
      .from(TABLE)
      .select('incident_id, alert_type, severity, status, started_at, resolved_at')
      .gte('started_at', since)
      .order('started_at', { ascending: true });
    if (error) throw error;
    return data || [];
  },

  async findRecentByService(service, limit = 5) {
    const { data, error } = await supabase
      .from(TABLE)
      .select('*')
      .eq('service', service)
      .order('started_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data || [];
  },
};

module.exports = IncidentModel;
