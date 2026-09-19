import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../../../shared/lib/apiClient';

export function useNotifications(apiPath) {
  const path = apiPath || '/customer/notifications';
  const [notifications, setNotifications] = useState([]);
  const [error, setError] = useState(null);
  const refresh = useCallback(async () => {
    try {
      setError(null);
      const rows = await apiFetch(path);
      setNotifications(Array.isArray(rows) ? rows : []);
    } catch (e) {
      setError(e.message || 'Failed to load notifications');
      setNotifications([]);
    }
  }, [path]);
  useEffect(() => { refresh(); }, [refresh]);
  const unread = notifications.filter(n => !n.read).length;
  const markAllRead = async () => {
    try {
      const readPath = path.endsWith('/history') ? path.replace('/history', '/read') : `${path}/read`;
      await apiFetch(readPath, { method: 'PUT' });
    } catch {}
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
  };
  const markOneRead = async (id) => {
    try { await apiFetch(`${path}/${id}/read`, { method: 'PUT' }); } catch {}
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
  };
  const remove = async (id) => {
    await apiFetch(`${path}/${id}`, { method: 'DELETE' });
    setNotifications(prev => prev.filter(n => n.id !== id));
  };
  return { notifications, unread, refresh, markAllRead, markOneRead, remove, error };
}
