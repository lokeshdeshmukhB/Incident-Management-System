import { useQuery } from '@tanstack/react-query';
import axios from 'axios';

const api = axios.create({ baseURL: '/api' });

export function useKPIs() {
  return useQuery({
    queryKey: ['kpis'],
    queryFn: () => api.get('/dashboard/kpis').then((r) => r.data),
    refetchInterval: 15000,
  });
}

export function useTimeline(days = 7) {
  return useQuery({
    queryKey: ['timeline', days],
    queryFn: () => api.get(`/dashboard/timeline?days=${days}`).then((r) => r.data),
    refetchInterval: 30000,
  });
}

export function useAgentStats() {
  return useQuery({
    queryKey: ['agentStats'],
    queryFn: () => api.get('/dashboard/agents').then((r) => r.data),
    refetchInterval: 15000,
  });
}

export function useIncidents(filters = {}) {
  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  if (filters.severity) params.set('severity', filters.severity);
  if (filters.service) params.set('service', filters.service);
  params.set('limit', filters.limit || 50);

  return useQuery({
    queryKey: ['incidents', filters],
    queryFn: () => api.get(`/incidents?${params}`).then((r) => r.data),
    refetchInterval: 10000,
  });
}

export function useIncident(id) {
  return useQuery({
    queryKey: ['incident', id],
    queryFn: () => api.get(`/incidents/${id}`).then((r) => r.data),
    enabled: !!id,
  });
}

export function useReports() {
  return useQuery({
    queryKey: ['reports'],
    queryFn: () => api.get('/reports').then((r) => r.data),
    refetchInterval: 30000,
  });
}

export function useReport(incidentId) {
  return useQuery({
    queryKey: ['report', incidentId],
    queryFn: () => api.get(`/reports/${incidentId}`).then((r) => r.data),
    enabled: !!incidentId,
  });
}

export async function ingestAlert(alertData) {
  return api.post('/alerts', alertData).then((r) => r.data);
}

export async function updateIncidentStatus(incidentId, updates) {
  return api.patch(`/incidents/${incidentId}`, updates).then((r) => r.data);
}

export async function regenerateReport(incidentId) {
  return api.post(`/reports/${incidentId}/regenerate`).then((r) => r.data);
}
