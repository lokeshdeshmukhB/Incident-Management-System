import { useState } from 'react';
import { FileText } from 'lucide-react';
import { useReports, useReport, regenerateReport } from '../hooks/useIncidents';
import ReportViewer from '../components/Reports/ReportViewer';

export default function ReportsPage() {
  const { data: reportsData } = useReports();
  const reports = reportsData?.data || [];
  const [selectedId, setSelectedId] = useState(null);
  const { data: selectedReport } = useReport(selectedId);
  const [regenerating, setRegenerating] = useState(false);

  const handleRegenerate = async (incidentId) => {
    setRegenerating(true);
    try {
      await regenerateReport(incidentId);
    } catch (err) {
      console.error('Regenerate failed:', err);
    } finally {
      setRegenerating(false);
    }
  };

  return (
    <div className="p-6 space-y-6">
      <h1 className="font-headline text-2xl font-bold text-white">Incident Reports</h1>

      <div className="grid grid-cols-3 gap-6">
        <div className="space-y-2">
          <h3 className="text-sm font-medium text-slate-400 mb-3">All Reports ({reports.length})</h3>
          {reports.length === 0 && (
            <div className="bg-slate-900 border border-slate-800 rounded-lg p-8 text-center">
              <FileText className="w-8 h-8 text-slate-600 mx-auto mb-2" />
              <p className="text-sm text-slate-500">No reports yet</p>
              <p className="text-xs text-slate-600 mt-1">Reports are generated after incidents are processed</p>
            </div>
          )}
          {reports.map((r) => (
            <button
              key={r.id}
              onClick={() => setSelectedId(r.incident_id)}
              className={`w-full text-left p-4 rounded-lg border transition-colors ${
                selectedId === r.incident_id
                  ? 'bg-blue-600/10 border-blue-500/30'
                  : 'bg-slate-900 border-slate-800 hover:border-slate-700'
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="font-mono text-sm text-blue-400">{r.incident_id}</span>
                <span className="text-xs text-slate-500">
                  {new Date(r.generated_at).toLocaleDateString()}
                </span>
              </div>
              <p className="text-sm text-slate-300 truncate">{r.title}</p>
              <p className="text-xs text-slate-500 mt-1 truncate">{r.summary?.slice(0, 80)}...</p>
            </button>
          ))}
        </div>

        <div className="col-span-2">
          <ReportViewer report={selectedReport} onRegenerate={handleRegenerate} />
        </div>
      </div>
    </div>
  );
}
