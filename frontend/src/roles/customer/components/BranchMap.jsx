// frontend/src/roles/customer/components/BranchMap.jsx
// Reusable Leaflet map — extracts branches.html:311-332 initMap().
// Admin is source of truth (spec 4.5); this component is read-only for customers.
import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

export function BranchMap({ branches, userLocation, onSelectBranch }) {
  const mapRef = useRef(null);
  const leafletRef = useRef(null);

  useEffect(() => {
    if (!mapRef.current || leafletRef.current) return;
    const map = L.map(mapRef.current).setView([12.5, 122.0], 5.4);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors', maxZoom: 18,
    }).addTo(map);
    const icon = L.divIcon({
      className: 'atany-pin',
      html: '<div style="width:26px;height:26px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:#14301f;border:2px solid #c7a66a;"></div>',
      iconSize: [26, 26], iconAnchor: [13, 26],
    });
    branches.forEach((b) => {
      const m = L.marker([b.lat, b.lng], { icon }).addTo(map);
      m.bindPopup(`<b>${b.name}</b><br>${b.address}`);
      m.on('click', () => onSelectBranch?.(b.id));
    });
    leafletRef.current = map;
    return () => map.remove();
  }, [branches, onSelectBranch]);

  return <div ref={mapRef} style={{ width: '100%', height: 620 }} />;
}
