import { useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import useIncidentStore from '../store/incidentStore';

const SOCKET_URL = import.meta.env.VITE_API_URL || '';

export function useSocket() {
  const socketRef = useRef(null);
  const { addIncident, updateIncident, setAgentActivity, addNotification } = useIncidentStore();

  useEffect(() => {
    const socket = io(SOCKET_URL, { transports: ['websocket', 'polling'] });
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
