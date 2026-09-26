import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../../../shared/lib/apiClient';
import { supabase } from '../../../shared/lib/supabaseClient';
import { useAuth } from '../../../shared/hooks/useAuth';

export function useNotifications(apiPath) {
  const path = apiPath || '/customer/notifications';
  const [notifications, setNotifications] = useState([]);
  const [error, setError] = useState(null);
  let authUserId = null;
  try { authUserId = useAuth()?.user?.id || null; } catch { authUserId = null; }
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
  // Realtime INSERT → merge by notification.id (never refresh(), never append blindly).
  // Unique channel name per hook instance: supabase.channel() returns the SAME cached
  // object for an identical topic, and realtime-js throws when .on() is called on an
  // already-subscribed channel. The bell + page mount two instances for the same user,
  // so a deterministic `notifications-${userId}` name collides. Suffix matches the
  // existing useRealtimeProducts / AuctionStartPopup convention.
  useEffect(() => {
    if (!authUserId) return;
    const channel = supabase.channel(`notifications-${authUserId}-${Math.random().toString(36).slice(2, 6)}`);
    channel.on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'notifications',
      filter: `user_id=eq.${authUserId}`,
    }, (payload) => {
      const incoming = payload.new;
      if (!incoming || !incoming.id) return;
      if (String(incoming.user_id) !== String(authUserId)) return;
      setNotifications((prev) => {
        const index = prev.findIndex((item) => String(item.id) === String(incoming.id));
        if (index !== -1) {
          const next = [...prev];
          next[index] = incoming;
          return next;
        }
        return [incoming, ...prev];
      });
    }).subscribe();
    return () => { try { supabase.removeChannel(channel); } catch {} };
  }, [authUserId]);
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
