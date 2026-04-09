import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { useTimeline } from '../../hooks/useIncidents';

export default function IncidentChart() {
  const { data: timeline, isLoading } = useTimeline(7);

  if (isLoading) {
    return (
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-5 h-72 animate-pulse" />
    );
  }

  const chartData = (timeline || []).map((d) => ({
    ...d,
    manual: d.escalated,
  }));

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-lg p-5">
      <h3 className="text-sm font-medium text-slate-300 mb-4">Automated vs Escalated (7 days)</h3>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={chartData} barGap={4}>
          <XAxis dataKey="date" tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} />
          <Tooltip
            contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: 8, fontSize: 12 }}
            labelStyle={{ color: '#94a3b8' }}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Bar dataKey="resolved" fill="#3B82F6" radius={[4, 4, 0, 0]} name="Automated" />
          <Bar dataKey="escalated" fill="#EF4444" radius={[4, 4, 0, 0]} name="Escalated" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
