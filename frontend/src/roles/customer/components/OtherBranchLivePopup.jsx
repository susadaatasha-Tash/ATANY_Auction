// frontend/src/roles/customer/components/OtherBranchLivePopup.jsx
// Other-branch live auction popup — compact toast with 10s cooldown
import { useEffect, useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../../shared/hooks/useAuth';
import { apiFetch } from '../../../shared/lib/apiClient';

const POLL_INTERVAL = 30000;
const MAX_VISIBLE = 1;
const COOLDOWN_MS = 10000;
const STORAGE_PREFIX = 'atany_otherBranchSeen_';
const DISMISS_PREFIX = 'atany_otherBranchDismissed_';

function isDismissed(id) {
  try { return localStorage.getItem(DISMISS_PREFIX + id) === '1'; } catch { return false; }
}
function markDismissed(id) {
  try { localStorage.setItem(DISMISS_PREFIX + id, '1'); } catch {}
}
function isSeen(id) {
  try { return localStorage.getItem(STORAGE_PREFIX + id) === '1'; } catch { return false; }
}
function markSeen(id) {
  try { localStorage.setItem(STORAGE_PREFIX + id, '1'); } catch {}
}

export default function OtherBranchLivePopup() {
  const { user, role, preferredBranchId } = useAuth();
  const navigate = useNavigate();
  const [popups, setPopups] = useState([]);
  const [exiting, setExiting] = useState({});
  const seenRef = useRef(new Set());
  const queueRef = useRef([]);
  const cooldownRef = useRef(false);
  const cooldownTimerRef = useRef(null);
  const isCustomer = role === 'customer' && !!user;

  const showNextFromQueue = useCallback(() => {
    if (cooldownRef.current) return;
    if (queueRef.current.length === 0) return;
    const next = queueRef.current.shift();
    if (!next) return;
    setPopups((prev) => {
      if (prev.some((p) => p.id === next.id)) return prev;
      return [...prev].slice(-(MAX_VISIBLE - 1)).concat([next]);
    });
    cooldownRef.current = true;
    if (cooldownTimerRef.current) clearTimeout(cooldownTimerRef.current);
    cooldownTimerRef.current = setTimeout(() => {
      cooldownRef.current = false;
      // After cooldown, show next queued if any and no popups currently visible
      // If a popup is still visible, wait for dismiss; otherwise show next
      setPopups((curr) => {
        if (curr.length === 0 && queueRef.current.length > 0) {
          const n = queueRef.current.shift();
          if (n) {
            cooldownRef.current = true;
            if (cooldownTimerRef.current) clearTimeout(cooldownTimerRef.current);
            cooldownTimerRef.current = setTimeout(() => {
              cooldownRef.current = false;
              if (queueRef.current.length > 0) showNextFromQueue();
            }, COOLDOWN_MS);
            return [n];
          }
        } else if (curr.length === 0 && queueRef.current.length > 0) {
          // no visible, but queue has items — show one
        }
        // If still visible popups, cooldown will be restarted on dismiss
        if (queueRef.current.length > 0 && curr.length === 0) {
          // handled above
        } else if (queueRef.current.length > 0) {
          // keep cooldown active until current dismissed
          // reset cooldown for next after dismiss
        } else {
          cooldownRef.current = false;
        }
        return curr;
      });
      // If queue still has items and no popup visible, trigger again
      if (queueRef.current.length > 0) {
        // Use timeout to avoid state batch issues
        setTimeout(() => showNextFromQueue(), 0);
      }
    }, COOLDOWN_MS);
  }, []);

  const addPopup = useCallback((auction) => {
    const id = auction.id;
    if (seenRef.current.has(id) || isSeen(id) || isDismissed(id)) return;
    seenRef.current.add(id);
    markSeen(id);
    const item = {
      id,
      auctionId: auction.id,
      branchName: auction.branch_name || auction.branch || 'Branch',
      branchId: auction.branch_id,
      productName: auction.name || auction.product || auction.item || 'Jewelry',
      startingPrice: auction.startPrice ?? auction.start_price ?? auction.currentBid ?? 0,
      image: auction.img || auction.image_url || null,
    };
    // If no popup visible and not in cooldown, show immediately
    // Otherwise queue
    setPopups((prev) => {
      // Already visible?
      if (prev.some((p) => p.id === id)) return prev;
      // If currently in cooldown or already showing, queue
      if (cooldownRef.current || prev.length >= MAX_VISIBLE) {
        if (!queueRef.current.some((p) => p.id === id)) queueRef.current.push(item);
        return prev;
      }
      // Show immediately and start cooldown
      cooldownRef.current = true;
      if (cooldownTimerRef.current) clearTimeout(cooldownTimerRef.current);
      cooldownTimerRef.current = setTimeout(() => {
        cooldownRef.current = false;
        showNextFromQueue();
      }, COOLDOWN_MS);
      return [...prev, item].slice(-MAX_VISIBLE);
    });
    // If queue was empty and we queued, ensure cooldown handling doesn't leave queue stuck when popups dismissed quickly
    // The dismiss handler will also trigger showNextFromQueue after cooldown
  }, [showNextFromQueue]);

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
      // After dismiss, if cooldown finished, show next; otherwise queue will be shown after cooldown
      if (!cooldownRef.current) {
        showNextFromQueue();
      }
    }, 260);
  }, [showNextFromQueue]);

  const handleView = useCallback((p) => {
    dismiss(p.id);
    navigate('/customer/auctions');
  }, [navigate, dismiss]);

  useEffect(() => {
    if (!isCustomer || !preferredBranchId) return;
    let cancelled = false;
    let timer = null;

    const poll = async () => {
      try {
        const rows = await apiFetch('/api/auctions?status=live', { public: true });
        if (cancelled || !Array.isArray(rows)) return;
        for (const a of rows) {
          if (a.status !== 'live') continue;
          const branchId = a.branch_id || a.branchId;
          if (!branchId) continue;
          if (String(branchId) === String(preferredBranchId)) continue;
          addPopup(a);
        }
      } catch {}
    };

    const initial = setTimeout(poll, 4000);
    timer = setInterval(poll, POLL_INTERVAL);

    return () => {
      cancelled = true;
      clearTimeout(initial);
      if (timer) clearInterval(timer);
      if (cooldownTimerRef.current) clearTimeout(cooldownTimerRef.current);
    };
  }, [isCustomer, preferredBranchId, addPopup]);

  if (!isCustomer || popups.length === 0) return null;

  return (
    <>
      <style>{`
        @keyframes otherBranchIn {
          from { opacity: 0; transform: translateY(-8px) translateX(12px); }
          to { opacity: 1; transform: translateY(0) translateX(0); }
        }
        @keyframes otherBranchOut {
          from { opacity: 1; transform: translateY(0) translateX(0); }
          to { opacity: 0; transform: translateY(-6px) translateX(12px); }
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
          gap: 10,
          pointerEvents: 'none',
          maxWidth: 'calc(100vw - 24px)',
        }}
      >
        {popups.slice(-MAX_VISIBLE).map((p) => {
          const isExiting = !!exiting[p.id];
          return (
            <div
              key={p.id}
              role="alert"
              style={{
                pointerEvents: 'auto',
                width: 340,
                maxWidth: 'calc(100vw - 24px)',
                background: '#FFFFFF',
                border: '1px solid #E6E2DA',
                borderRadius: 10,
                boxShadow: '0 8px 24px rgba(20,42,74,0.12), 0 2px 8px rgba(20,42,74,0.06)',
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column',
                animation: isExiting ? 'otherBranchOut 260ms ease-in forwards' : 'otherBranchIn 360ms ease-out forwards',
              }}
            >
              <div style={{ padding: '8px 10px 6px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, borderBottom: '1px solid #F3F1EC', background: '#FAF9F6' }}>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <span style={{ width: 20, height: 20, borderRadius: '50%', background: '#142A4A', display: 'grid', placeItems: 'center', fontSize: 11, flexShrink: 0 }}>🔔</span>
                  <div style={{ fontSize: 11, fontWeight: 800, color: '#142A4A', letterSpacing: '.03em' }}>Live Auction</div>
                </div>
                <button
                  aria-label="Close"
                  onClick={() => dismiss(p.id)}
                  style={{ background: 'none', border: 'none', fontSize: 16, lineHeight: 1, color: '#7B8493', cursor: 'pointer', padding: '0 2px' }}
                >
                  ×
                </button>
              </div>

              <div style={{ padding: '8px 10px 10px', display: 'flex', gap: 10, alignItems: 'center' }}>
                <div style={{ width: 48, height: 48, borderRadius: 8, overflow: 'hidden', background: '#FAF9F6', border: '1px solid #EFEDE8', flexShrink: 0, display: 'grid', placeItems: 'center' }}>
                  {p.image ? (
                    <img src={p.image} alt={p.productName} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    <span style={{ fontSize: 18 }}>💍</span>
                  )}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#142A4A', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: 1.3 }}>{p.productName}</div>
                  <div style={{ fontSize: 11, color: '#7B8493', marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.branchName}</div>
                  <div style={{ fontSize: 11, color: '#142A4A', marginTop: 2, fontWeight: 600 }}>₱{Number(p.startingPrice).toLocaleString()}</div>
                </div>
                <button
                  onClick={() => handleView(p)}
                  style={{ height: 30, padding: '0 10px', borderRadius: 8, border: 'none', background: '#142A4A', color: '#FFFFFF', fontSize: 11, fontWeight: 700, cursor: 'pointer', flexShrink: 0 }}
                >
                  View
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
