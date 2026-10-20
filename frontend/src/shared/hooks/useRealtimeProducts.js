// frontend/src/shared/hooks/useRealtimeProducts.js
// Subscribes to Supabase Realtime postgres_changes on products table
// Used by admin Products (all) and shop My Listings (own shop only) for live sync without manual refresh
// Models after socketClient.js (bid:update) but uses Supabase Realtime for postgres_changes
import { useEffect, useRef } from 'react';
import { supabase } from '../lib/supabaseClient';

export function useRealtimeProducts({ onInsert, onUpdate, onDelete, filter, enabled = true }) {
  const cbRef = useRef({ onInsert, onUpdate, onDelete });
  cbRef.current = { onInsert, onUpdate, onDelete };

  useEffect(() => {
    if (!enabled) return;
    // Use a unique channel name per filter to avoid collisions
    const channelName = `products-${filter || 'all'}-${Math.random().toString(36).slice(2,6)}`;
    const channel = supabase.channel(channelName);

    const config = {
      event: '*',
      schema: 'public',
      table: 'products',
    };
    if (filter) config.filter = filter;

    channel.on('postgres_changes', config, (payload) => {
      if (payload.eventType === 'INSERT' && cbRef.current.onInsert) cbRef.current.onInsert(payload.new);
      if (payload.eventType === 'UPDATE' && cbRef.current.onUpdate) cbRef.current.onUpdate(payload.new, payload.old);
      if (payload.eventType === 'DELETE' && cbRef.current.onDelete) cbRef.current.onDelete(payload.old);
    });

    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') console.log('[realtime] subscribed to products', filter || 'all');
      if (status === 'CHANNEL_ERROR') console.warn('[realtime] channel error for products', filter);
    });

    return () => { supabase.removeChannel(channel); };
  }, [filter, enabled]);
}
