// frontend/src/roles/customer/pages/BranchLocator.jsx
// Customer-facing GPS locator — extracted from branches.html:231-250
// Read-only: branches are single source of truth from Admin (spec 4.5).
// Uses Haversine client-side (spec 4.5).
import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Store, MapPin, Phone, ArrowRight, RefreshCw } from 'lucide-react';
import { Badge } from '../../../shared/components/Badge';
import { BranchMap } from '../components/BranchMap';
import { apiFetch } from '../../../shared/lib/apiClient';
import { useToast } from '../../../shared/components/Toast';

function distanceKm(a, b, c, d) {
  const R = 6371, dLat = (c - a) * Math.PI / 180, dLng = (d - b) * Math.PI / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a * Math.PI / 180) * Math.cos(c * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

const DAVAO_CENTER = [7.07, 125.6];

export default function BranchLocator({ branches: propBranches }) {
  const navigate = useNavigate();
  const showToast = useToast();
  const [fetched, setFetched] = useState([]);
  const [loading, setLoading] = useState(!propBranches);
  const [error, setError] = useState(null);
  const branches = propBranches ?? fetched;
  const [q, setQ] = useState('');
  const [userLoc, setUserLoc] = useState(null);
  const [selectedBranchId, setSelectedBranchId] = useState(null);
  const [mapReady, setMapReady] = useState(true);

  // ── Load branches from the public endpoint ──────────────────────────────
  // Public endpoint — must work for anonymous visitors (no session yet).
  useEffect(() => {
    if (propBranches) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    apiFetch('/branches', { public: true })
      .then((rows) => {
        if (!cancelled) {
          setFetched(Array.isArray(rows) ? rows : []);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err);
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, [propBranches]);

  const retry = useCallback(() => {
    setError(null);
    setLoading(true);
    apiFetch('/branches', { public: true })
      .then((rows) => {
        setFetched(Array.isArray(rows) ? rows : []);
        setLoading(false);
      })
      .catch((err) => {
        setError(err);
        setLoading(false);
      });
  }, []);

  const locate = useCallback(() => {
    if (!navigator.geolocation) {
      showToast('Geolocation is not supported by your browser');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => setUserLoc({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => {
        // A denied/dismissed location request must NOT clear the branch list.
        showToast(err && err.code === 1
          ? 'Location permission was denied. You can still search for a branch manually.'
          : err.message || 'Unable to retrieve your location');
      },
    );
  }, [showToast]);

  const handleBranchClick = useCallback((branchId) => {
    setSelectedBranchId(branchId);
  }, []);

  const handleMapBranchSelect = useCallback((branchId) => {
    setSelectedBranchId(branchId);
  }, []);
  const handleMapReady = useCallback(() => setMapReady(true), []);

  const isOpen = (b) => String(b.status || '').toLowerCase() === 'open';

  const filtered = branches.filter((b) => {
    const query = q.trim().toLowerCase();
    if (!query) return true;
    return (
      String(b.name || '').toLowerCase().includes(query) ||
      String(b.address || '').toLowerCase().includes(query)
    );
  });

  const list = filtered
    .map((b) => ({ ...b, dist: userLoc ? distanceKm(userLoc.lat, userLoc.lng, b.lat, b.lng) : null }))
    .sort((a, b) => (a.dist ?? Infinity) - (b.dist ?? Infinity));

  const getBranchImage = (b) => b.branch_image_url || b.image_url || null;

  // ── Empty-state resolution ─────────────────────────────────────────────
  let emptyMessage = null;
  if (loading) {
    emptyMessage = 'Loading branches…';
  } else if (error) {
    emptyMessage = 'Unable to load branches right now.';
  } else if (branches.length === 0) {
    emptyMessage = 'No ATANY branches are currently available.';
  } else if (q.trim() !== '' && list.length === 0) {
    emptyMessage = 'No branches match your search.';
  }

  return (
    <main className="locator-page">
      <div className="container">
        <div className="page-header">
          <button className="back-btn" onClick={() => navigate(-1)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
            Back
          </button>
          <h1>Branch Locator</h1>
        </div>

        <div className="locator-toolbar">
          <div className="search-box">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
            <input
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search by city or branch name…"
              disabled={loading}
            />
          </div>
          <button className="btn btn-gold" onClick={locate} disabled={loading}>
            <MapPin size={15} /> Use My Location
          </button>
        </div>

        <div className="locator-layout">
          <div className="branch-list">
            {emptyMessage ? (
              <div className="empty-state" style={{ padding: '32px 20px', textAlign: 'center', color: 'var(--muted)' }}>
                <p>{emptyMessage}</p>
                {error && !loading && (
                  <button className="btn btn-outline" onClick={retry} style={{ marginTop: 10 }}>
                    <RefreshCw size={14} /> Retry
                  </button>
                )}
              </div>
            ) : (
              list.map((b) => (
                <div
                  key={b.id}
                  className={`branch-card ${selectedBranchId === b.id ? 'active' : ''}`}
                  onClick={() => handleBranchClick(b.id)}
                >
                  <div className="branch-card-icon">
                    <Store size={22} />
                  </div>
                  <div className="branch-card-info">
                    <div className="branch-card-top">
                      <h3>{b.name}</h3>
                      {b.dist != null && (
                        <span className="distance-chip">{b.dist < 1 ? '<1' : b.dist.toFixed(1)} km</span>
                      )}
                    </div>
                    <div className="branch-card-badge">
                      <Badge status={isOpen(b) ? 'active' : 'suspended'} />
                    </div>
                    <div className="branch-card-detail">
                      <MapPin size={13} />
                      <span>{b.address}</span>
                    </div>
                    <div className="branch-card-detail">
                      <Phone size={13} />
                      <span>{b.phone}</span>
                    </div>
                  </div>
                  <ArrowRight size={16} className="branch-card-arrow" />
                  {b.lat != null && b.lng != null && Number.isFinite(Number(b.lat)) && Number.isFinite(Number(b.lng)) ? (
                    <a
                      href={`https://www.google.com/maps?q=${b.lat},${b.lng}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="branch-card-gmaps"
                      onClick={(e) => e.stopPropagation()}
                      title="View on Google Maps"
                    >
                      <MapPin size={13} />
                    </a>
                  ) : null}
                </div>
              ))
            )}
          </div>
          <div className="map-panel">
            {mapReady ? (
              <BranchMap
                branches={branches}
                userLocation={userLoc}
                selectedBranchId={selectedBranchId}
                onSelectBranch={handleMapBranchSelect}
                initialCenter={DAVAO_CENTER}
                onMapReady={handleMapReady}
                scrollWheelZoom={false}
              />
            ) : (
              <div className="map-loading">Loading map…</div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
