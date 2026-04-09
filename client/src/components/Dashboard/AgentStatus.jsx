import useIncidentStore from '../../store/incidentStore';
import { useAgentStats } from '../../hooks/useIncidents';

const AGENTS = [
  { name: 'detection', label: 'Detection Agent' },
  { name: 'decision', label: 'Decision Agent' },
  { name: 'action', label: 'Action Agent' },
  { name: 'resolution', label: 'Resolution Agent' },
  { name: 'reporting', label: 'Reporting Agent' },
  { name: 'escalation', label: 'Escalation Agent' },
];

const STATUS_COLORS = {
  completed: 'bg-emerald-500',
  running: 'bg-amber-500 animate-pulse',
  idle: 'bg-slate-500',
  error: 'bg-red-500',
};

export default function AgentStatus() {
  const agentActivity = useIncidentStore((s) => s.agentActivity);
  const { data: stats } = useAgentStats();

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-lg p-5">
      <h3 className="text-sm font-medium text-slate-300 mb-4">Agent Activity</h3>
      <div className="space-y-3">
        {AGENTS.map(({ name, label }) => {
          const activity = agentActivity[name];
          const stat = stats?.[name];
          const status = activity?.status || 'idle';
          const dotColor = STATUS_COLORS[status] || STATUS_COLORS.idle;

          return (
            <div key={name} className="flex items-center justify-between py-1">
              <div className="flex items-center gap-3">
                <span className={`w-2 h-2 rounded-full ${dotColor}`} />
                <span className="text-sm text-slate-300">{label}</span>
              </div>
              <div className="flex items-center gap-3">
                {stat?.avg_duration_ms > 0 && (
                  <span className="text-xs text-slate-500">{stat.avg_duration_ms}ms avg</span>
                )}
                <span className="text-xs text-slate-400 capitalize">{status}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
