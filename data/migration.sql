-- AIMS Database Schema for Supabase (PostgreSQL)
-- Run this in your Supabase SQL Editor

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Enum types
CREATE TYPE alert_severity AS ENUM ('critical', 'high', 'medium', 'low');
CREATE TYPE incident_status AS ENUM ('pending', 'in_progress', 'resolved', 'escalated');
CREATE TYPE alert_type_enum AS ENUM (
  'high_cpu', 'disk_full', 'api_failure', 'service_down',
  'memory_leak', 'network_timeout', 'repeated_failure'
);

-- Alerts table
CREATE TABLE IF NOT EXISTS alerts (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  alert_id TEXT UNIQUE NOT NULL,
  alert_type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'medium',
  service TEXT NOT NULL,
  host TEXT NOT NULL,
  metric_value REAL,
  threshold REAL,
  timestamp TIMESTAMPTZ NOT NULL,
  processed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Incidents table
CREATE TABLE IF NOT EXISTS incidents (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  incident_id TEXT UNIQUE NOT NULL,
  alert_id TEXT REFERENCES alerts(alert_id),
  alert_type TEXT NOT NULL,
  service TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'medium',
  action_taken TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  started_at TIMESTAMPTZ NOT NULL,
  resolved_at TIMESTAMPTZ,
  mttd_sec INTEGER,
  mttr_sec INTEGER,
  retry_count INTEGER DEFAULT 0,
  escalated BOOLEAN DEFAULT FALSE,
  report_url TEXT,
  agent_outputs JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Workflow rules table
CREATE TABLE IF NOT EXISTS workflow_rules (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  alert_type TEXT NOT NULL,
  action TEXT NOT NULL,
  priority INTEGER DEFAULT 1,
  max_retries INTEGER DEFAULT 2,
  escalation_after INTEGER DEFAULT 3,
  dry_run BOOLEAN DEFAULT FALSE,
  notify_channel TEXT DEFAULT '#ops-alerts',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Reports table
CREATE TABLE IF NOT EXISTS reports (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  incident_id TEXT REFERENCES incidents(incident_id),
  title TEXT NOT NULL,
  summary TEXT,
  timeline JSONB DEFAULT '[]'::jsonb,
  root_cause TEXT,
  action_taken TEXT,
  resolution TEXT,
  metrics JSONB DEFAULT '{}'::jsonb,
  recommendations JSONB DEFAULT '[]'::jsonb,
  generated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX idx_alerts_alert_type ON alerts(alert_type);
CREATE INDEX idx_alerts_severity ON alerts(severity);
CREATE INDEX idx_alerts_service ON alerts(service);
CREATE INDEX idx_alerts_processed ON alerts(processed);
CREATE INDEX idx_alerts_timestamp ON alerts(timestamp DESC);

CREATE INDEX idx_incidents_status ON incidents(status);
CREATE INDEX idx_incidents_severity ON incidents(severity);
CREATE INDEX idx_incidents_service ON incidents(service);
CREATE INDEX idx_incidents_started_at ON incidents(started_at DESC);

CREATE INDEX idx_workflow_rules_alert_type ON workflow_rules(alert_type);

CREATE INDEX idx_reports_incident_id ON reports(incident_id);

-- Enable Realtime for live dashboard updates
ALTER PUBLICATION supabase_realtime ADD TABLE incidents;
ALTER PUBLICATION supabase_realtime ADD TABLE alerts;

-- Row Level Security (allow all for service role)
ALTER TABLE alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all for service role" ON alerts FOR ALL USING (true);
CREATE POLICY "Allow all for service role" ON incidents FOR ALL USING (true);
CREATE POLICY "Allow all for service role" ON workflow_rules FOR ALL USING (true);
CREATE POLICY "Allow all for service role" ON reports FOR ALL USING (true);
