import { AlertTriangle, Clock, User, X } from 'lucide-react';
import SeverityBadge from '../common/SeverityBadge';

const PRIORITY_BORDER = {
  critical: 'border-l-red-500',
  high: 'border-l-orange-500',
  medium: 'border-l-yellow-500',
  low: 'border-l-green-500',
};

function timeAgo(ts) {
  if (!ts) return '-';
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ago`;
}

export default function EscalationQueue({ incidents = [], onAcknowledge }) {
  const escalated = incidents.filter((i) => i.status === 'escalated');

  if (escalated.length === 0) {
    return (
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-12 text-center">
        <AlertTriangle className="w-8 h-8 text-slate-600 mx-auto mb-3" />
        <p className="text-slate-500">No pending escalations</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {escalated.map((inc) => (
        <div
          key={inc.incident_id}
          className={`bg-slate-900 border border-slate-800 border-l-4 ${PRIORITY_BORDER[inc.severity] || 'border-l-slate-500'} rounded-lg p-5`}
        >
          <div className="flex items-start justify-between mb-3">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="font-mono text-sm text-blue-400">{inc.incident_id}</span>
                <SeverityBadge severity={inc.severity} />
              </div>
              <p className="text-sm text-slate-300">
                {inc.service} &middot; {inc.alert_type}
              </p>
            </div>
            <div className="flex items-center gap-1 text-xs text-slate-500">
              <Clock className="w-3 h-3" />
              {timeAgo(inc.started_at)}
            </div>
          </div>

          <p className="text-sm text-slate-400 mb-2">
            Automated remediation failed after {inc.retry_count || 0} retries
          </p>

          {inc.action_taken && (
            <p className="text-xs text-slate-500 mb-4 font-mono">
              Failed action: {inc.action_taken} (x{(inc.retry_count || 0) + 1})
            </p>
          )}

          <div className="flex gap-2">
            <button
              onClick={() => onAcknowledge?.(inc.incident_id)}
              className="px-3 py-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
            >
              Acknowledge
            </button>
            <button className="px-3 py-1.5 text-xs font-medium border border-blue-500/30 text-blue-400 hover:bg-blue-500/10 rounded-lg transition-colors">
              <User className="w-3 h-3 inline mr-1" />
              Assign to me
            </button>
            <button className="px-3 py-1.5 text-xs font-medium text-slate-400 hover:text-slate-300 rounded-lg transition-colors">
              <X className="w-3 h-3 inline mr-1" />
              Dismiss
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
