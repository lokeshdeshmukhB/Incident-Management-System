import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  AlertTriangle,
  FileText,
  ShieldAlert,
  Settings,
  Activity,
} from 'lucide-react';
import DashboardPage from './pages/DashboardPage';
import IncidentsPage from './pages/IncidentsPage';
import IncidentDetailPage from './pages/IncidentDetailPage';
import ReportsPage from './pages/ReportsPage';
import EscalationPage from './pages/EscalationPage';
import { useSocket } from './hooks/useSocket';

const navItems = [
  { path: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { path: '/incidents', icon: AlertTriangle, label: 'Incidents' },
  { path: '/reports', icon: FileText, label: 'Reports' },
  { path: '/escalations', icon: ShieldAlert, label: 'Escalations' },
];

export default function App() {
  useSocket();

  return (
    <BrowserRouter>
      <div className="flex h-screen overflow-hidden">
        <aside className="w-64 bg-slate-900 border-r border-slate-800 flex flex-col">
          <div className="p-6 border-b border-slate-800">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 bg-blue-600 rounded-lg flex items-center justify-center">
                <Activity className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className="font-headline text-lg font-bold text-white">AIMS</h1>
                <p className="text-xs text-slate-400">Incident Management</p>
              </div>
            </div>
          </div>
          <nav className="flex-1 p-4 space-y-1">
            {navItems.map(({ path, icon: Icon, label }) => (
              <NavLink
                key={path}
                to={path}
                end={path === '/'}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-blue-600/10 text-blue-400 border border-blue-500/20'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                  }`
                }
              >
                <Icon className="w-4 h-4" />
                {label}
              </NavLink>
            ))}
          </nav>
          <div className="p-4 border-t border-slate-800">
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <Settings className="w-3 h-3" />
              <span>v1.0.0 &middot; Groq AI</span>
            </div>
          </div>
        </aside>

        <main className="flex-1 overflow-auto bg-slate-950">
          <Routes>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/incidents" element={<IncidentsPage />} />
            <Route path="/incidents/:id" element={<IncidentDetailPage />} />
            <Route path="/reports" element={<ReportsPage />} />
            <Route path="/escalations" element={<EscalationPage />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
