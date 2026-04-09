const { supabase } = require('../config/db');

const TABLE = 'workflow_rules';

const WorkflowRuleModel = {
  async create(rule) {
    const { data, error } = await supabase.from(TABLE).insert(rule).select().single();
    if (error) throw error;
    return data;
  },

  async findAll() {
    const { data, error } = await supabase.from(TABLE).select('*').order('priority', { ascending: true });
    if (error) throw error;
    return data || [];
  },

  async findByAlertType(alertType) {
    const { data, error } = await supabase
      .from(TABLE)
      .select('*')
      .eq('alert_type', alertType)
      .order('priority', { ascending: true })
      .limit(1)
      .single();
    if (error && error.code !== 'PGRST116') throw error;
    return data;
  },

  async update(id, updates) {
    const { data, error } = await supabase.from(TABLE).update(updates).eq('id', id).select().single();
    if (error) throw error;
    return data;
  },

  async delete(id) {
    const { error } = await supabase.from(TABLE).delete().eq('id', id);
    if (error) throw error;
    return true;
  },

  async bulkInsert(rules) {
    const { data, error } = await supabase.from(TABLE).insert(rules).select();
    if (error) throw error;
    return data;
  },
};

module.exports = WorkflowRuleModel;
