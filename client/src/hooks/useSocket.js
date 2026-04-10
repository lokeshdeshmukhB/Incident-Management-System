import { useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import useIncidentStore from '../store/incidentStore';

/** Injected in dev by Vite (see vite.config.js) — connects straight to the API and avoids WS proxy issues. */
// eslint-disable-next-line no-undef
const DEV_API_ORIGIN = typeof __AIMS_DEV_API_ORIGIN__ !== 'undefined' ? __AIMS_DEV_API_ORIGIN__ : '';

const SOCKET_URL =
  import.meta.env.VITE_SOCKET_URL ||
  (import.meta.env.DEV && DEV_API_ORIGIN ? DEV_API_ORIGIN : '');

export function useSocket() {
  const socketRef = useRef(null);
  const { addIncident, updateIncident, setAgentActivity, addNotification } = useIncidentStore();

  useEffect(() => {
    const socket = io(SOCKET_URL, {
      transports: ['polling', 'websocket'],
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      socket.emit('subscribe:incidents');
      socket.emit('subscribe:agents');
    });

    socket.on('incident:created', (incident) => {
      addIncident(incident);
      addNotification({
        type: 'info',
        message: `New incident: ${incident.incident_id} (${incident.alert_type})`,
      });
    });

    socket.on('incident:updated', (update) => {
      updateIncident(update);
      if (update.status === 'resolved') {
        addNotification({
          type: 'success',
          message: `Incident ${update.incident_id} resolved`,
        });
      } else if (update.status === 'escalated') {
        addNotification({
          type: 'error',
          message: `Incident ${update.incident_id} escalated`,
        });
      }
    });

    socket.on('agent:activity', (activity) => {
      setAgentActivity(activity);
    });

    socket.on('incident:report_ready', (data) => {
      addNotification({
        type: 'info',
        message: `Report ready for ${data.incident_id}`,
      });
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  return socketRef;
}
