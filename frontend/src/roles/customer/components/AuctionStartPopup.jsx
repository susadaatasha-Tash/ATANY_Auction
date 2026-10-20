// frontend/src/roles/customer/components/AuctionStartPopup.jsx
// Real-time auction start notifier for Notify Me — shows popup WITHOUT refresh when scheduled → live
// Reuses existing architecture: auction_reminders persistence, auctionStarter cron as source of truth, Supabase Realtime
import { useEffect, useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../../shared/lib/supabaseClient';
import { useAuth } from '../../../shared/hooks/useAuth';
import { useReminders } from '../hooks/useReminders';
import { apiFetch } from '../../../shared/lib/apiClient';

const STORAGE_SEEN = 'atany_auctionStartSeen_';
const STORAGE_DISMISSED = 'atany_auctionStartDismissed_';

function isSeen(id) {
  try { return localStorage.getItem(STORAGE_SEEN + id) === '1'; } catch { return false; }
}
function markSeen(id) {
  try { localStorage.setItem(STORAGE_SEEN + id, '1'); } catch {}
}
function isDismissed(id) {
  try { return localStorage.getItem(STORAGE_DISMISSED + id) === '1'; } catch { return false; }
}
function markDismissed(id) {
  try { localStorage.setItem(STORAGE_DISMISSED + id, '1'); } catch {}
}

export default function AuctionStartPopup() {
  const { user, role } = useAuth();
  const navigate = useNavigate();
  const { items: reminders } = useReminders();
  const remindersRef = useRef(reminders);
  remindersRef.current = reminders;

  const [popups, setPopups] = useState([]);
  const [exiting, setExiting] = useState({});
  const seenRef = useRef(new Set());
  const timersRef = useRef(new Map());
  const [remindersTick, setRemindersTick] = useState(0);
  const isCustomer = role === 'customer' && !!user;

  // Listen for reminders updates from other useReminders instances (e.g., LiveAuctions Notify Me)
  useEffect(() => {
    const handler = () => {
      console.log('[AUCTION POPUP] reminders updated event received');
      setRemindersTick((t) => t + 1);
    };
    window.addEventListener('atany-reminders-updated', handler);
    const storageHandler = (e) => {
      if (e.key === 'atany-reminders-updated') {
        console.log('[AUCTION POPUP] storage reminders updated');
        handler();
      }
    };
    window.addEventListener('storage', storageHandler);
    return () => {
      window.removeEventListener('atany-reminders-updated', handler);
      window.removeEventListener('storage', storageHandler);
    };
  }, []);

  const dismiss = useCallback((id) => {
    markDismissed(id);
    setExiting((prev) => ({ ...prev, [id]: true }));
    setTimeout(() => {
      setPopups((prev) => prev.filter((p) => p.id !== id));
      setExiting((prev) => {
        const n = { ...prev };
        delete n[id];
        return n;
      });
    }, 260);
  }, []);

  const handleView = useCallback((p) => {
    dismiss(p.id);
    navigate('/customer/auctions');
  }, [navigate, dismiss]);

  const addPopup = useCallback(async (auctionId, productIdHint) => {
    const id = auctionId;
    console.log('[AUCTION POPUP] addPopup called for', id, 'productHint', productIdHint);
    if (seenRef.current.has(id) || isSeen(id) || isDismissed(id)) {
      console.log('[AUCTION POPUP] Duplicate prevented for', id, 'seenRef', seenRef.current.has(id), 'isSeen', isSeen(id), 'isDismissed', isDismissed(id));
      return;
    }
    // Only notify if user had Notify Me for this auction — fetch fresh from DB (source of truth)
    // Fixes stale ref when Notify Me clicked AFTER mount (separate useReminders instance)
    let hasReminder = remindersRef.current.some((r) => String(r.auction_id) === String(id));
    console.log('[AUCTION POPUP] Reminder check (cached) for', id, 'hasReminder', hasReminder, 'cached', remindersRef.current);
    try {
      const fresh = await apiFetch('/customer/reminders');
      console.log('[AUCTION POPUP] Fresh reminders fetched', fresh);
      if (Array.isArray(fresh)) {
        hasReminder = fresh.some((r) => String(r.auction_id) === String(id));
        console.log('[AUCTION POPUP] Reminder check (fresh) for', id, 'hasReminder', hasReminder);
        // keep ref in sync for next check without extra fetch
        remindersRef.current = fresh;
      }
    } catch (e) {
      console.log('[AUCTION POPUP] Fresh fetch failed, fallback to cached', e.message);
      // fallback to cached ref on network error
    }
    if (!hasReminder) {
      console.log('[AUCTION POPUP] No reminder for', id, 'user', user?.id, '— not showing popup');
      return;
    }
    console.log('[AUCTION POPUP] Reminder found: true for', id, '— showing AUCTION STARTING SOON popup');
    // Dedup before product fetch
    seenRef.current.add(id);
    markSeen(id);
    let productName = 'Jewelry';
    let startingPrice = 0;
    let image = null;
    try {
      const full = await apiFetch(`/customer/auctions/${id}`);
      if (full) {
        productName = full.name || full.product || full.product_name || productName;
        startingPrice = full.startPrice ?? full.start_price ?? full.currentBid ?? 0;
        image = full.img || full.image_url || null;
      }
    } catch {
      // fallback: try product_id hint
      if (productIdHint) {
        try {
          const prod = await apiFetch(`/customer/auctions/${id}`).catch(() => null);
          if (prod?.name) productName = prod.name;
        } catch {}
      }
    }
    const item = {
      id,
      auctionId: id,
      productName,
      startingPrice,
      image,
    };
    setPopups((prev) => {
      if (prev.some((p) => p.id === id)) return prev;
      return [...prev, item];
    });
  }, []);

  // Client-side scheduling: trigger popup 1 min before start_time (backup to realtime)
  useEffect(() => {
    if (!isCustomer || !user?.id) return;
    // Clear old timers before creating new ones
    timersRef.current.forEach((tid) => clearTimeout(tid));
    timersRef.current.clear();
    console.log('[AUCTION POPUP] reminders updated:', reminders, 'tick', remindersTick);
    let cancelled = false;
    console.log('[AUCTION POPUP] fetching auctions for scheduling');
    (async () => {
      try {
        // Always fetch fresh reminders (source of truth) to handle Notify Me from other component instance
        let freshReminders = reminders;
        try {
          const fr = await apiFetch('/customer/reminders');
          if (Array.isArray(fr) && !cancelled) {
            freshReminders = fr;
            remindersRef.current = fr;
            console.log('[AUCTION POPUP] fresh reminders for scheduling', freshReminders);
          }
        } catch (e) {
          console.log('[AUCTION POPUP] fresh reminders fetch failed, using cached', e.message);
        }
        if (!freshReminders.length) {
          console.log('[AUCTION SCHEDULE] No reminders, no timers');
          return;
        }
        console.log('[AUCTION SCHEDULE] Scheduling for', freshReminders.length, 'reminders');
        const auctions = await apiFetch('/customer/auctions');
        if (cancelled) return;
        console.log('[AUCTION SCHEDULE] Fetched', auctions.length, 'auctions for scheduling');
        for (const r of freshReminders) {
          const reminderAuctionId = String(r.auction_id);
          const auctionId = reminderAuctionId;
          const auction = auctions.find((a) => String(a.id) === auctionId);
          console.log('[AUCTION POPUP] auction matched:', { reminderAuctionId, auctionId: auction?.id, startTime: auction?.startTime ?? auction?.start_time });
          if (seenRef.current.has(auctionId) || isSeen(auctionId) || isDismissed(auctionId)) {
            console.log('[AUCTION SCHEDULE] Skip already handled', auctionId);
            continue;
          }
          if (!auction) {
            console.log('[AUCTION SCHEDULE] Auction not in list for reminder', auctionId);
            continue;
          }
          const startRaw = auction.startTime ?? auction.start_time;
          if (!startRaw) {
            console.log('[AUCTION SCHEDULE] No start_time for', auctionId);
            continue;
          }
          const startMs = new Date(startRaw).getTime();
          if (isNaN(startMs)) {
            console.log('[AUCTION SCHEDULE] Invalid start_time for', auctionId, startRaw);
            continue;
          }
          const notifyTime = startMs - 60 * 1000;
          const delay = notifyTime - Date.now();
          console.log('[AUCTION POPUP] timing:', { startMs, notifyTime, now: Date.now(), delay, startIso: new Date(startMs).toISOString(), notifyIso: new Date(notifyTime).toISOString() });
          console.log('[AUCTION SCHEDULE] Auction', auctionId, 'start', new Date(startMs).toISOString(), 'notify', new Date(notifyTime).toISOString(), 'delay', delay);
          const nowMs = Date.now();
          if (nowMs >= startMs) {
            console.log('[AUCTION SCHEDULE] Already started for', auctionId, 'skip 1-min-before, rely on realtime');
            continue;
          }
          if (delay <= 0) {
            console.log('[AUCTION POPUP] scheduling popup: immediate', { auctionId, delay, startMs, notifyTime });
            console.log('[AUCTION SCHEDULE] Less than 1 min to start for', auctionId, 'triggering immediate AUCTION STARTING SOON');
            addPopup(auctionId, auction.productId ?? auction.product_id);
          } else {
            console.log('[AUCTION POPUP] scheduling popup:', { auctionId, delay, startMs, notifyTime });
            console.log('[AUCTION SCHEDULE] Scheduling AUCTION STARTING SOON for', auctionId, 'in', delay, 'ms at', new Date(notifyTime).toISOString());
            const tid = setTimeout(() => {
              console.log('[AUCTION SCHEDULE] Timer fired for', auctionId);
              addPopup(auctionId, auction.productId ?? auction.product_id);
            }, delay);
            timersRef.current.set(auctionId, tid);
          }
        }
      } catch (e) {
        console.log('[AUCTION SCHEDULE] Fetch failed', e.message);
      }
    })();
    return () => {
      cancelled = true;
      console.log('[AUCTION SCHEDULE] Cleanup timers, clearing', timersRef.current.size);
      timersRef.current.forEach((tid) => clearTimeout(tid));
      timersRef.current.clear();
    };
  }, [isCustomer, user?.id, reminders, remindersTick, addPopup]);

  useEffect(() => {
    if (!isCustomer || !user?.id) return;

    // Cleanup seen set when user changes
    seenRef.current = new Set();

    // Debug: trace subscription lifecycle
    const channelName = `auction-start-${user.id}-${Math.random().toString(36).slice(2, 6)}`;
    console.log('[AUCTION REALTIME] Creating subscription...', channelName, 'userId', user.id);
    const channel = supabase.channel(channelName);
    console.log('[AUCTION REALTIME] Channel created', channelName);

    channel.on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'auctions' },
      (payload) => {
        console.log('[AUCTION REALTIME] UPDATE received:', JSON.stringify({ eventType: payload.eventType, new: payload.new, old: payload.old }));
        console.log('[AUCTION POPUP] Received auction update:', payload.new?.id, 'old status', payload.old?.status, 'new status', payload.new?.status);
        const oldStatus = payload.old?.status;
        const newStatus = payload.new?.status;
        const newId = payload.new?.id;
        if (!newId || !newStatus) {
          console.log('[AUCTION POPUP] Missing id or status, ignoring', payload);
          return;
        }
        // Detect only the start event: scheduled -> live
        // Handle cases where old is null (REPLICA IDENTITY) or oldStatus missing: treat newStatus live as potential
        const isStartEvent = (oldStatus === 'scheduled' && newStatus === 'live') || (!oldStatus && newStatus === 'live');
        if (!isStartEvent) {
          console.log('[AUCTION POPUP] Not a start event, ignoring isStartEvent false', { oldStatus, newStatus });
          return;
        }
        // Extra safety: if oldStatus is defined and not scheduled, ignore
        if (oldStatus && oldStatus !== 'scheduled') {
          console.log('[AUCTION POPUP] oldStatus not scheduled, ignoring', oldStatus);
          return;
        }
        console.log('[AUCTION POPUP] Checking reminder for customer:', user.id, 'auction', newId);
        addPopup(String(newId), payload.new?.product_id);
      }
    );

    channel.subscribe((status, err) => {
      console.log('[AUCTION REALTIME] Subscription status:', status, 'channel', channelName, err || '');
      if (status === 'SUBSCRIBED') console.log('[AUCTION REALTIME] SUBSCRIBED', channelName, 'userId', user.id);
      if (status === 'CHANNEL_ERROR') console.warn('[AUCTION REALTIME] CHANNEL_ERROR', channelName, err);
      if (status === 'TIMED_OUT') console.warn('[AUCTION REALTIME] TIMED_OUT', channelName);
      if (status === 'CLOSED') console.log('[AUCTION REALTIME] CLOSED', channelName);
    });

    return () => {
      console.log('[AUCTION REALTIME] Cleaning up', channelName);
      try { supabase.removeChannel(channel); } catch {}
    };
  }, [isCustomer, user?.id, addPopup]);

  if (!isCustomer || popups.length === 0) return null;

  return (
    <>
      <style>{`
        @keyframes auctionStartIn {
          from { opacity: 0; transform: translateY(-10px) scale(0.97); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes auctionStartOut {
          from { opacity: 1; transform: translateY(0) scale(1); }
          to { opacity: 0; transform: translateY(-8px) scale(0.97); }
        }
        @keyframes auctionBellRing {
          0%, 100% { transform: rotate(0); }
          15% { transform: rotate(14deg); }
          30% { transform: rotate(-12deg); }
          45% { transform: rotate(8deg); }
          60% { transform: rotate(-4deg); }
        }
      `}</style>
      <div
        aria-live="polite"
        style={{
          position: 'fixed',
          top: 74,
          right: 16,
          zIndex: 1100,
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          pointerEvents: 'none',
          maxWidth: 'calc(100vw - 24px)',
        }}
      >
        {popups.map((p) => {
          const isExiting = !!exiting[p.id];
          return (
            <div
              key={p.id}
              role="alert"
              style={{
                pointerEvents: 'auto',
                width: 380,
                maxWidth: 'calc(100vw - 24px)',
                background: '#FFFFFF',
                border: '1px solid rgba(200,155,60,0.35)',
                borderRadius: 14,
                boxShadow: '0 12px 40px rgba(20,42,74,0.18), 0 4px 12px rgba(200,155,60,0.10), inset 0 1px 0 rgba(255,255,255,0.6)',
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column',
                animation: isExiting ? 'auctionStartOut 260ms ease-in forwards' : 'auctionStartIn 400ms cubic-bezier(0.16,1,0.3,1) forwards',
              }}
            >
              {/* Gold accent line */}
              <div style={{ height: 3, background: 'linear-gradient(90deg, #C89B3C, #E8C86A, #C89B3C)', flexShrink: 0 }} />

              {/* Navy header */}
              <div style={{ padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, background: 'linear-gradient(135deg, #142A4A 0%, #1B3A5C 100%)' }}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <span style={{ width: 30, height: 30, borderRadius: 8, background: 'rgba(200,155,60,0.2)', border: '1px solid rgba(200,155,60,0.3)', display: 'grid', placeItems: 'center', fontSize: 15, flexShrink: 0, animation: 'auctionBellRing 1.2s ease-in-out infinite' }}>🔔</span>
                  <div style={{ fontSize: 12, fontWeight: 800, color: '#FFFFFF', letterSpacing: '.06em', textTransform: 'uppercase' }}>AUCTION STARTING SOON</div>
                </div>
                <button
                  aria-label="Close"
                  onClick={() => dismiss(p.id)}
                  style={{ background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 6, width: 26, height: 26, display: 'grid', placeItems: 'center', fontSize: 14, lineHeight: 1, color: 'rgba(255,255,255,0.8)', cursor: 'pointer', transition: 'all .15s ease', flexShrink: 0 }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.22)'; e.currentTarget.style.color = '#fff'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.12)'; e.currentTarget.style.color = 'rgba(255,255,255,0.8)'; }}
                >
                  ✕
                </button>
              </div>

              {/* Content */}
              <div style={{ padding: '16px 18px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
                  <div style={{ width: 64, height: 64, borderRadius: 10, overflow: 'hidden', background: '#F8F6F1', border: '1px solid rgba(200,155,60,0.18)', flexShrink: 0, display: 'grid', placeItems: 'center', boxShadow: '0 2px 8px rgba(200,155,60,0.08)' }}>
                    {p.image ? (
                      <img src={p.image} alt={p.productName} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    ) : (
                      <span style={{ fontSize: 24 }}>💍</span>
                    )}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: '#142A4A', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: 1.3 }}>{p.productName}</div>
                    <div style={{ fontSize: 12, color: '#7B8493', marginTop: 4, lineHeight: 1.4 }}>This auction starts in <b style={{ color: '#142A4A' }}>1 minute</b>. Get ready to place your bid.</div>
                  </div>
                </div>
                <button
                  onClick={() => handleView(p)}
                  style={{ height: 38, padding: '0 16px', borderRadius: 10, border: 'none', background: 'linear-gradient(135deg, #142A4A 0%, #1B3A5C 100%)', color: '#FFFFFF', fontSize: 12, fontWeight: 700, cursor: 'pointer', alignSelf: 'stretch', letterSpacing: '.02em', boxShadow: '0 2px 8px rgba(20,42,74,0.18)', transition: 'all .15s ease' }}
                  onMouseEnter={(e) => { e.currentTarget.style.boxShadow = '0 4px 14px rgba(20,42,74,0.26)'; e.currentTarget.style.transform = 'translateY(-1px)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.boxShadow = '0 2px 8px rgba(20,42,74,0.18)'; e.currentTarget.style.transform = 'translateY(0)'; }}
                >
                  VIEW AUCTION
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
