import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, FileText, RefreshCw, AlertTriangle, CheckCircle } from 'lucide-react';
import { useIncident, useReport } from '../hooks/useIncidents';
import SeverityBadge from '../components/common/SeverityBadge';
import StatusIndicator from '../components/common/StatusIndicator';
import { useState } from 'react';

const PIPELINE_STAGES = ['detection', 'decision', 'action', 'resolution', 'escalation', 'reporting'];

export default function IncidentDetailPage() {
  const { id } = useParams();
  const { data: incident, isLoading } = useIncident(id);
  const { data: report } = useReport(id);
  const [expandedAgent, setExpandedAgent] = useState(null);

  if (isLoading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-slate-800 rounded w-64" />
          <div className="h-64 bg-slate-800 rounded" />
        </div>
      </div>
    );
  }

  if (!incident) {
    return (
      <div className="p-6 text-center">
        <p className="text-slate-500">Incident not found</p>
        <Link to="/incidents" className="text-blue-400 text-sm mt-2 inline-block">Back to incidents</Link>
      </div>
    );
  }

  const agentOutputs = incident.agent_outputs || {};

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-4">
        <Link to="/incidents" className="p-2 hover:bg-slate-800 rounded-lg transition-colors">
          <ArrowLeft className="w-4 h-4 text-slate-400" />
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="font-headline text-xl font-bold text-white font-mono">{incident.incident_id}</h1>
            <SeverityBadge severity={incident.severity} />
            <StatusIndicator status={incident.status} />
          </div>
          <p className="text-sm text-slate-400 mt-1">
            {incident.service} &middot; {incident.alert_type} &middot; {incident.host || 'unknown host'}
          </p>
        </div>
        <div className="flex gap-2">
          {report && (
            <Link
              to="/reports"
              className="flex items-center gap-2 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm rounded-lg transition-colors"
            >
              <FileText className="w-4 h-4" />
              View Report
            </Link>
          )}
        </div>
      </div>

      <div className="grid grid-cols-4 gap-3">
        <MetricCard label="MTTD" value={incident.mttd_sec ? `${incident.mttd_sec}s` : '-'} />
        <MetricCard label="MTTR" value={incident.mttr_sec ? `${incident.mttr_sec}s` : '-'} />
        <MetricCard label="Retries" value={incident.retry_count ?? 0} />
        <MetricCard
          label="Automated"
          value={!incident.escalated ? (
            <span className="flex items-center gap-1 text-emerald-400"><CheckCircle className="w-4 h-4" /> Yes</span>
          ) : (
            <span className="flex items-center gap-1 text-red-400"><AlertTriangle className="w-4 h-4" /> Escalated</span>
          )}
        />
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-lg p-5">
        <h3 className="text-sm font-medium text-slate-300 mb-4">Pipeline Timeline</h3>
        <div className="space-y-0">
          {PIPELINE_STAGES.map((stage) => {
            const output = agentOutputs[stage];
            if (!output) return null;
            const ts = output._meta?.timestamp || output.enriched_at || output.resolved_at || '';
            const time = ts ? new Date(ts).toLocaleTimeString() : '';

            return (
              <div key={stage} className="flex gap-4 relative">
                <div className="flex flex-col items-center">
                  <div className={`w-3 h-3 rounded-full border-2 ${output.error ? 'border-red-500 bg-red-500/20' : 'border-blue-500 bg-blue-500/20'}`} />
                  <div className="w-px h-full bg-slate-700 min-h-[2rem]" />
                </div>
                <div className="pb-4 flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-medium text-slate-200 capitalize">{stage} Agent</span>
                    {time && <span className="text-xs text-slate-500">{time}</span>}
                    {output._meta?.duration_ms && (
                      <span className="text-xs text-slate-600">({output._meta.duration_ms}ms)</span>
                    )}
                  </div>
                  <p className="text-sm text-slate-400">
                    {getStageSummary(stage, output)}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-lg p-5">
        <h3 className="text-sm font-medium text-slate-300 mb-4">Agent Outputs</h3>
        <div className="space-y-2">
          {PIPELINE_STAGES.map((stage) => {
            const output = agentOutputs[stage];
            if (!output) return null;

            return (
              <div key={stage} className="border border-slate-800 rounded-lg overflow-hidden">
                <button
                  onClick={() => setExpandedAgent(expandedAgent === stage ? null : stage)}
                  className="w-full px-4 py-3 flex items-center justify-between text-sm text-slate-300 hover:bg-slate-800/50 transition-colors"
                >
                  <span className="capitalize font-medium">{stage} Agent</span>
                  <span className="text-xs text-slate-500">{expandedAgent === stage ? 'Collapse' : 'Expand'}</span>
                </button>
                {expandedAgent === stage && (
                  <pre className="px-4 pb-4 text-xs text-slate-400 overflow-auto max-h-64 font-mono">
                    {JSON.stringify(output, null, 2)}
                  </pre>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function MetricCard({ label, value }) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 text-center">
      <p className="text-xs text-slate-500 mb-1">{label}</p>
      <div className="text-lg font-headline font-bold text-slate-200 flex items-center justify-center">{value}</div>
    </div>
  );
}

function getStageSummary(stage, output) {
  switch (stage) {
    case 'detection':
      return output.description || `${output.alert_type} on ${output.service} (confidence: ${output.confidence})`;
    case 'decision':
      return `Action: ${output.action}, Safe: ${output.safe_to_execute ? 'Yes' : 'No'}, Priority: ${output.priority}`;
    case 'action':
      return output.execution_command || `${output.action} (risk: ${output.risk_level})`;
    case 'resolution':
      return output.resolution_summary || `Status: ${output.status}`;
    case 'escalation':
      return output.message_title || 'Escalation triggered';
    case 'reporting':
      return 'Full incident report generated';
    default:
      return '';
  }
}
