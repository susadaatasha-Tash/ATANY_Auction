// frontend/src/shared/hooks/useLiveBadgeCounts.js
// Provides live badge counts for sidebar (Auctions live, SecurityAlerts open, etc.)
// Uses Supabase Realtime for products/auctions/security_alerts, fallback to polling
import { useEffect, useState, useCallback } from 'react';
import { apiFetch } from '../lib/apiClient';
import { supabase } from '../lib/supabaseClient';

export function useLiveBadgeCounts(role) {
  const [counts, setCounts] = useState({ auctions: 0, security: 0, pendingProducts: 0 });

  const refresh = useCallback(async () => {
    try {
      if (role === 'admin') {
        const [auctions, alerts, products] = await Promise.all([
          apiFetch('/admin/auctions').catch(() => []),
          apiFetch('/admin/security-alerts').catch(() => []),
          apiFetch('/admin/products').catch(() => []),
        ]);
        setCounts({
          auctions: (Array.isArray(auctions) ? auctions.filter(a => a.status === 'live').length : 0),
          security: (Array.isArray(alerts) ? alerts.filter(a => a.status === 'new' || a.status === 'investigating').length : 0),
          pendingProducts: (Array.isArray(products) ? products.filter(p => p.status === 'pending').length : 0),
        });
      } else if (role === 'shop_owner') {
        const [auctions, listings] = await Promise.all([
          apiFetch('/shop-owner/auctions').catch(() => []),
          apiFetch('/shop-owner/listings').catch(() => []),
        ]);
        setCounts({
          auctions: (Array.isArray(auctions) ? auctions.filter(a => a.status === 'live').length : 0),
          security: 0,
          pendingProducts: (Array.isArray(listings) ? listings.filter(l => l.status === 'pending').length : 0),
        });
      }
    } catch {}
  }, [role]);

  useEffect(() => {
    refresh();
    // Poll as fallback every 30s (if Realtime not available or for initial)
    const interval = setInterval(refresh, 30000);

    // Realtime subscriptions for live badge updates
    const channels = [];
    if (role === 'admin') {
      const prodChannel = supabase.channel('badge-products-admin')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, () => refresh())
        .subscribe();
      const auctionChannel = supabase.channel('badge-auctions-admin')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'auctions' }, () => refresh())
        .subscribe();
      const secChannel = supabase.channel('badge-security-admin')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'security_alerts' }, () => refresh())
        .subscribe();
      channels.push(prodChannel, auctionChannel, secChannel);
    } else if (role === 'shop_owner') {
      const auctionChannel = supabase.channel('badge-auctions-shop')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'auctions' }, () => refresh())
        .subscribe();
      const prodChannel = supabase.channel('badge-products-shop')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, () => refresh())
        .subscribe();
      channels.push(auctionChannel, prodChannel);
    }

    return () => {
      clearInterval(interval);
      channels.forEach(ch => supabase.removeChannel(ch));
    };
  }, [refresh, role]);

  return counts;
}
