// frontend/src/roles/customer/pages/BranchLocator.jsx
// Customer-facing GPS locator — extracted from branches.html:231-250
// Read-only: branches are single source of truth from Admin (spec 4.5). Uses Haversine client-side (spec 4.5).
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { BranchMap } from '../components/BranchMap';
import { apiFetch } from '../../../shared/lib/apiClient';

function distanceKm(a, b, c, d) {
  const R = 6371, dLat = (c - a) * Math.PI / 180, dLng = (d - b) * Math.PI / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a * Math.PI / 180) * Math.cos(c * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

export default function BranchLocator({ branches: propBranches }) {
  const navigate = useNavigate();
  const [fetched, setFetched] = useState([]);
  const branches = propBranches ?? fetched;
  const [q, setQ] = useState('');
  const [userLoc, setUserLoc] = useState(null);

  useEffect(() => {
    if (propBranches) return;
    apiFetch('/branches').then(setFetched).catch(() => setFetched([]));
  }, [propBranches]);

  const locate = () => {
    navigator.geolocation.getCurrentPosition((pos) => setUserLoc({ lat: pos.coords.latitude, lng: pos.coords.longitude }));
  };

  const list = branches
    .filter((b) => b.name.toLowerCase().includes(q.toLowerCase()) || b.address.toLowerCase().includes(q.toLowerCase()))
    .map((b) => ({ ...b, dist: userLoc ? distanceKm(userLoc.lat, userLoc.lng, b.lat, b.lng) : null }))
    .sort((a, b) => (a.dist ?? Infinity) - (b.dist ?? Infinity));

  return (
    <>
      <button onClick={() => navigate(-1)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 700, color: 'var(--navy)', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 4, padding: 0 }}>← Back</button>
      <div className="locator-toolbar">
        <div className="search-box"><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by city or branch name…" /></div>
        <button className="btn btn-primary" onClick={locate}>Use My Location</button>
      </div>
      <div className="locator-layout">
        <div className="branch-list">
          {list.map((b) => (
            <div key={b.id} className="branch-card">
              <div className="branch-card-top"><h3>{b.name}</h3>{b.dist != null && <span className="distance-chip">{b.dist < 1 ? '<1' : b.dist.toFixed(1)} km</span>}</div>
              <p>◇ {b.address}</p><p>☎ {b.phone}</p>
            </div>
          ))}
        </div>
        <div className="map-panel"><BranchMap branches={branches} userLocation={userLoc} /></div>
      </div>
    </>
  );
}
