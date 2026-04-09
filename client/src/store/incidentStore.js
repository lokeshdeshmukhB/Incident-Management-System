import { create } from 'zustand';

const useIncidentStore = create((set, get) => ({
  incidents: [],
  agentActivity: {},
  notifications: [],

  setIncidents: (incidents) => set({ incidents }),

  addIncident: (incident) =>
    set((state) => ({
      incidents: [incident, ...state.incidents.filter((i) => i.incident_id !== incident.incident_id)],
    })),

  updateIncident: (update) =>
    set((state) => ({
      incidents: state.incidents.map((i) =>
        i.incident_id === update.incident_id ? { ...i, ...update } : i
      ),
    })),

  setAgentActivity: (activity) =>
    set((state) => ({
      agentActivity: {
        ...state.agentActivity,
        [activity.agent]: activity,
      },
    })),

  addNotification: (notification) =>
    set((state) => ({
      notifications: [
        { id: Date.now(), timestamp: new Date().toISOString(), ...notification },
        ...state.notifications.slice(0, 49),
      ],
    })),

  clearNotification: (id) =>
    set((state) => ({
      notifications: state.notifications.filter((n) => n.id !== id),
    })),
}));

export default useIncidentStore;
