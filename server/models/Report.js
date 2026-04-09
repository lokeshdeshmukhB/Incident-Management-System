const { supabase } = require('../config/db');

const TABLE = 'reports';

const ReportModel = {
  async create(report) {
    const { data, error } = await supabase.from(TABLE).insert(report).select().single();
    if (error) throw error;
    return data;
  },

  async findByIncidentId(incidentId) {
    const { data, error } = await supabase.from(TABLE).select('*').eq('incident_id', incidentId).single();
    if (error && error.code !== 'PGRST116') throw error;
    return data;
  },

  async findAll({ limit = 50, offset = 0 } = {}) {
    const { data, error, count } = await supabase
      .from(TABLE)
      .select('*', { count: 'exact' })
      .order('generated_at', { ascending: false })
      .range(offset, offset + limit - 1);
    if (error) throw error;
    return { data, count };
  },

  async upsertByIncidentId(incidentId, report) {
    const existing = await this.findByIncidentId(incidentId);
    if (existing) {
      const { data, error } = await supabase
        .from(TABLE)
        .update({ ...report, generated_at: new Date().toISOString() })
        .eq('incident_id', incidentId)
        .select()
        .single();
      if (error) throw error;
      return data;
    }
    return this.create({ ...report, incident_id: incidentId });
  },
};

module.exports = ReportModel;
