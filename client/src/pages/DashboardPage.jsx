import KPICards from '../components/Dashboard/KPICards';
import IncidentChart from '../components/Dashboard/IncidentChart';
import AgentStatus from '../components/Dashboard/AgentStatus';
import IncidentTable from '../components/Incidents/IncidentTable';
import { useIncidents } from '../hooks/useIncidents';

export default function DashboardPage() {
  const { data } = useIncidents({ limit: 5 });
  const incidents = data?.data || [];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-headline text-2xl font-bold text-white">Operations Dashboard</h1>
          <p className="text-sm text-slate-400 mt-1">Real-time incident monitoring and AI agent activity</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-xs text-slate-400">Live</span>
        </div>
      </div>

      <KPICards />

      <div className="grid grid-cols-3 gap-4">
        <div className="col-span-2">
          <IncidentChart />
        </div>
        <AgentStatus />
      </div>

      <div>
        <h3 className="text-sm font-medium text-slate-300 mb-3">Recent Incidents</h3>
        <IncidentTable incidents={incidents} />
      </div>
    </div>
  );
}
