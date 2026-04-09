const { createClient } = require('@supabase/supabase-js');
const env = require('./env');

const supabase = createClient(env.supabase.url, env.supabase.serviceRoleKey);

async function testConnection() {
  try {
    const { data, error } = await supabase.from('alerts').select('count', { count: 'exact', head: true });
    if (error && error.code === '42P01') {
      console.warn('Tables not yet created. Run the migration SQL in your Supabase dashboard.');
      return false;
    }
    if (error) throw error;
    console.log('Supabase connection established.');
    return true;
  } catch (err) {
    console.error('Supabase connection failed:', err.message);
    return false;
  }
}

module.exports = { supabase, testConnection };
