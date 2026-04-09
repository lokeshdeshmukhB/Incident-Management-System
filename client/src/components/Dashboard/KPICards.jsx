import { Clock, Timer, Bot, AlertTriangle } from 'lucide-react';
import { useKPIs } from '../../hooks/useIncidents';

const cards = [
  { key: 'mttd_avg', label: 'Avg MTTD', icon: Clock, unit: 's', color: 'text-blue-400', bg: 'bg-blue-500/10' },
  { key: 'mttr_avg', label: 'Avg MTTR', icon: Timer, unit: 's', color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
  { key: 'automation_rate', label: 'Automation Rate', icon: Bot, unit: '%', color: 'text-violet-400', bg: 'bg-violet-500/10' },
  { key: 'escalated_count', label: 'Escalations', icon: AlertTriangle, unit: '', color: 'text-red-400', bg: 'bg-red-500/10' },
];

export default function KPICards() {
  const { data: kpis, isLoading } = useKPIs();

  if (isLoading) {
    return (
      <div className="grid grid-cols-4 gap-4">
        {cards.map((c) => (
          <div key={c.key} className="bg-slate-900 border border-slate-800 rounded-lg p-5 animate-pulse h-28" />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-4 gap-4">
      {cards.map(({ key, label, icon: Icon, unit, color, bg }) => {
        const value = kpis?.[key] ?? 0;
        const display = key === 'mttr_avg' && value > 60 ? `${(value / 60).toFixed(1)} min` : `${value}${unit}`;
        return (
          <div key={key} className="bg-slate-900 border border-slate-800 rounded-lg p-5 hover:border-slate-700 transition-colors">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">{label}</span>
              <div className={`p-2 rounded-lg ${bg}`}>
                <Icon className={`w-4 h-4 ${color}`} />
              </div>
            </div>
            <p className={`text-2xl font-headline font-bold ${color}`}>{display}</p>
            <p className="text-xs text-slate-500 mt-1">{kpis?.total_incidents ?? 0} total incidents</p>
          </div>
        );
      })}
    </div>
  );
}
