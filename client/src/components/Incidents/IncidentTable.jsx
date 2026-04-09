import { useNavigate } from 'react-router-dom';
import { FileText } from 'lucide-react';
import SeverityBadge from '../common/SeverityBadge';
import StatusIndicator from '../common/StatusIndicator';

function timeAgo(ts) {
  if (!ts) return '-';
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function IncidentTable({ incidents = [] }) {
  const navigate = useNavigate();

  if (incidents.length === 0) {
    return (
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-12 text-center">
        <p className="text-slate-500">No incidents found</p>
      </div>
    );
  }

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-800 text-left">
            <th className="px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">ID</th>
            <th className="px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">Service</th>
            <th className="px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">Type</th>
            <th className="px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">Severity</th>
            <th className="px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">Status</th>
            <th className="px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">Action</th>
            <th className="px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">MTTR</th>
            <th className="px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">Time</th>
            <th className="px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800/50">
          {incidents.map((inc) => (
            <tr
              key={inc.incident_id}
              onClick={() => navigate(`/incidents/${inc.incident_id}`)}
              className="hover:bg-slate-800/50 cursor-pointer transition-colors"
            >
              <td className="px-4 py-3 font-mono text-blue-400 text-xs">{inc.incident_id}</td>
              <td className="px-4 py-3 text-slate-300">{inc.service}</td>
              <td className="px-4 py-3 text-slate-400 font-mono text-xs">{inc.alert_type}</td>
              <td className="px-4 py-3"><SeverityBadge severity={inc.severity} /></td>
              <td className="px-4 py-3"><StatusIndicator status={inc.status} /></td>
              <td className="px-4 py-3 text-slate-400 font-mono text-xs">{inc.action_taken || '-'}</td>
              <td className="px-4 py-3 text-slate-300">{inc.mttr_sec ? `${inc.mttr_sec}s` : '-'}</td>
              <td className="px-4 py-3 text-slate-500 text-xs">{timeAgo(inc.started_at)}</td>
              <td className="px-4 py-3">
                {inc.report_url && (
                  <FileText className="w-4 h-4 text-slate-500 hover:text-blue-400" />
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
