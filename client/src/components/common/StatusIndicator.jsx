import { CheckCircle, XCircle, Clock, Loader2 } from 'lucide-react';

const STATUS_CONFIG = {
  resolved: { icon: CheckCircle, color: 'text-emerald-400', label: 'Resolved' },
  escalated: { icon: XCircle, color: 'text-red-400', label: 'Escalated' },
  in_progress: { icon: Loader2, color: 'text-amber-400', label: 'In Progress', animate: true },
  pending: { icon: Clock, color: 'text-slate-400', label: 'Pending' },
};

export default function StatusIndicator({ status }) {
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.pending;
  const Icon = config.icon;
  return (
    <span className={`inline-flex items-center gap-1.5 text-sm ${config.color}`}>
      <Icon className={`w-4 h-4 ${config.animate ? 'animate-spin' : ''}`} />
      {config.label}
    </span>
  );
}
