import { useState } from 'react';
import { Plus, Search } from 'lucide-react';
import IncidentTable from '../components/Incidents/IncidentTable';
import { useIncidents, ingestAlert } from '../hooks/useIncidents';

const STATUSES = ['', 'pending', 'in_progress', 'resolved', 'escalated'];
const SEVERITIES = ['', 'critical', 'high', 'medium', 'low'];
const SERVICES = ['', 'checkout', 'payments', 'auth', 'orders'];

export default function IncidentsPage() {
  const [filters, setFilters] = useState({ status: '', severity: '', service: '' });
  const [showIngest, setShowIngest] = useState(false);
  const [alertForm, setAlertForm] = useState({
    alert_type: 'high_cpu',
    severity: 'critical',
    service: 'checkout',
    host: 'host-01',
    metric_value: 95,
    threshold: 90,
  });
  const [ingesting, setIngesting] = useState(false);

  const { data, refetch } = useIncidents(filters);
  const incidents = data?.data || [];

  const handleIngest = async () => {
    setIngesting(true);
    try {
      await ingestAlert({
        ...alertForm,
        timestamp: new Date().toISOString(),
      });
      setShowIngest(false);
      setTimeout(refetch, 2000);
    } catch (err) {
      console.error('Ingest failed:', err);
    } finally {
      setIngesting(false);
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="font-headline text-2xl font-bold text-white">Incidents</h1>
        <button
          onClick={() => setShowIngest(!showIngest)}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
        >
          <Plus className="w-4 h-4" />
          Ingest Alert
        </button>
      </div>

      {showIngest && (
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-5">
          <h3 className="text-sm font-medium text-slate-300 mb-4">Simulate New Alert</h3>
          <div className="grid grid-cols-3 gap-4 mb-4">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Alert Type</label>
              <select
                value={alertForm.alert_type}
                onChange={(e) => setAlertForm({ ...alertForm, alert_type: e.target.value })}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200"
              >
                <option value="high_cpu">high_cpu</option>
                <option value="disk_full">disk_full</option>
                <option value="api_failure">api_failure</option>
                <option value="service_down">service_down</option>
                <option value="memory_leak">memory_leak</option>
                <option value="network_timeout">network_timeout</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Severity</label>
              <select
                value={alertForm.severity}
                onChange={(e) => setAlertForm({ ...alertForm, severity: e.target.value })}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200"
              >
                <option value="critical">critical</option>
                <option value="high">high</option>
                <option value="medium">medium</option>
                <option value="low">low</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Service</label>
              <select
                value={alertForm.service}
                onChange={(e) => setAlertForm({ ...alertForm, service: e.target.value })}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200"
              >
                <option value="checkout">checkout</option>
                <option value="payments">payments</option>
                <option value="auth">auth</option>
                <option value="orders">orders</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Host</label>
              <input
                value={alertForm.host}
                onChange={(e) => setAlertForm({ ...alertForm, host: e.target.value })}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Metric Value</label>
              <input
                type="number"
                value={alertForm.metric_value}
                onChange={(e) => setAlertForm({ ...alertForm, metric_value: parseFloat(e.target.value) })}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Threshold</label>
              <input
                type="number"
                value={alertForm.threshold}
                onChange={(e) => setAlertForm({ ...alertForm, threshold: parseFloat(e.target.value) })}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200"
              />
            </div>
          </div>
          <button
            onClick={handleIngest}
            disabled={ingesting}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-700 text-white text-sm font-medium rounded-lg transition-colors"
          >
            {ingesting ? 'Processing...' : 'Send Alert to Pipeline'}
          </button>
        </div>
      )}

      <div className="flex items-center gap-3">
        {[
          { key: 'status', options: STATUSES, labels: ['All Status', 'Pending', 'In Progress', 'Resolved', 'Escalated'] },
          { key: 'severity', options: SEVERITIES, labels: ['All Severity', 'Critical', 'High', 'Medium', 'Low'] },
          { key: 'service', options: SERVICES, labels: ['All Services', 'checkout', 'payments', 'auth', 'orders'] },
        ].map(({ key, options, labels }) => (
          <select
            key={key}
            value={filters[key]}
            onChange={(e) => setFilters({ ...filters, [key]: e.target.value })}
            className="bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-300"
          >
            {options.map((opt, i) => (
              <option key={opt} value={opt}>{labels[i]}</option>
            ))}
          </select>
        ))}
        <div className="flex-1" />
        <span className="text-xs text-slate-500">{data?.count ?? 0} incidents</span>
      </div>

      <IncidentTable incidents={incidents} />
    </div>
  );
}
