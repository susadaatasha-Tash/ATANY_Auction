// frontend/src/roles/customer/components/BranchMap.jsx
// Reusable Leaflet map — extracts branches.html:311-332 initMap().
// Admin is source of truth (spec 4.5); this component is read-only for customers.
import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Fix Leaflet default icon issues
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

export function BranchMap({
  branches,
  userLocation,
  selectedBranchId,
  onSelectBranch,
  initialCenter = [7.07, 125.6],
  onMapReady,
}) {
  const mapRef = useRef(null);
  const leafletRef = useRef(null);
  const markersRef = useRef({});
  const [mapInitialized, setMapInitialized] = useState(false);

  // Initialize map (once)
  useEffect(() => {
    if (!mapRef.current || leafletRef.current) return;

    const map = L.map(mapRef.current).setView(initialCenter, 12);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 18,
    }).addTo(map);

    leafletRef.current = map;
    setMapInitialized(true);
    onMapReady?.();

    return () => {
      map.remove();
      leafletRef.current = null;
    };
  }, [initialCenter, onMapReady]);

  // Unified marker sync — handles branches loaded async + selected branch changes
  useEffect(() => {
    if (!leafletRef.current || !mapInitialized) return;
    if (!Array.isArray(branches)) return;
    const map = leafletRef.current;

    const icon = L.divIcon({
      className: 'atany-pin',
      html: '<div style="width:28px;height:28px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:#14301f;border:2px solid #c7a66a;"></div>',
      iconSize: [28, 28],
      iconAnchor: [14, 28],
    });
    const selectedIcon = L.divIcon({
      className: 'atany-pin-selected',
      html: '<div style="width:32px;height:32px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:#c7a66a;border:2px solid #14301f;"></div>',
      iconSize: [32, 32],
      iconAnchor: [16, 32],
    });

    // Remove markers whose branch no longer exists
    Object.keys(markersRef.current).forEach((id) => {
      if (!branches.some((b) => String(b.id) === String(id))) {
        map.removeLayer(markersRef.current[id]);
        delete markersRef.current[id];
      }
    });

    // Create missing markers and update icons
    branches.forEach((b) => {
      if (!b.id) return;
      const lat = Number(b.lat);
      const lng = Number(b.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
      const isSelected = String(b.id) === String(selectedBranchId);
      const existing = markersRef.current[b.id];
      if (existing) {
        existing.setIcon(isSelected ? selectedIcon : icon);
        if (isSelected) {
          existing.openPopup();
          map.setView(existing.getLatLng(), map.getZoom(), { animate: true, duration: 0.5 });
        }
        return;
      }
      const m = L.marker([lat, lng], { icon: isSelected ? selectedIcon : icon }).addTo(map);
      m.bindPopup(`<b style="color:#14301f;font-family:'Plus Jakarta Sans',sans-serif">${b.name}</b><br>${b.address}<br>☎ ${b.phone}`);
      m.on('click', () => onSelectBranch?.(b.id));
      markersRef.current[b.id] = m;
      if (isSelected) {
        m.openPopup();
        map.setView(m.getLatLng(), map.getZoom(), { animate: true, duration: 0.5 });
      }
    });
  }, [branches, selectedBranchId, mapInitialized, onSelectBranch]);

  // Update user location marker when userLocation changes
  useEffect(() => {
    if (!leafletRef.current || !mapInitialized) return;
    // User location handling could be expanded here if needed
  }, [userLocation, mapInitialized]);

  return <div ref={mapRef} style={{ width: '100%', height: '100%', minHeight: 620 }} />;
}