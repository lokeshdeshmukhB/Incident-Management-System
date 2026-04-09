import { useIncidents, updateIncidentStatus } from '../hooks/useIncidents';
import EscalationQueue from '../components/Incidents/EscalationQueue';
import { ShieldAlert } from 'lucide-react';

export default function EscalationPage() {
  const { data, refetch } = useIncidents({ status: 'escalated' });
  const incidents = data?.data || [];

  const handleAcknowledge = async (incidentId) => {
    try {
      await updateIncidentStatus(incidentId, { status: 'resolved', resolved_at: new Date().toISOString() });
      setTimeout(refetch, 500);
    } catch (err) {
      console.error('Acknowledge failed:', err);
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="font-headline text-2xl font-bold text-white">Escalation Queue</h1>
          {incidents.length > 0 && (
            <span className="px-2.5 py-0.5 bg-red-500/10 text-red-400 border border-red-500/20 rounded-full text-xs font-medium">
              {incidents.length} pending
            </span>
          )}
        </div>
      </div>

      {incidents.length === 0 ? (
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-16 text-center">
          <ShieldAlert className="w-12 h-12 text-slate-700 mx-auto mb-4" />
          <p className="text-slate-400 font-medium">All clear</p>
          <p className="text-sm text-slate-600 mt-1">No pending escalations. AI agents are handling incidents automatically.</p>
        </div>
      ) : (
        <EscalationQueue incidents={incidents} onAcknowledge={handleAcknowledge} />
      )}
    </div>
  );
}
