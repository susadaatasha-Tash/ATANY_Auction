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
  // Pass `null` to hand map sizing to CSS (used by the public locator, whose
  // height is responsive). Omitting it keeps the historical 620px inline floor,
  // so the landing-page map is unchanged.
  minHeight = 620,
  // Leaflet captures the mouse wheel while the pointer is over the map, which
  // makes a public page feel trapped: the user scrolls and only the map zooms.
  // Wheel zoom is therefore off; the +/− controls, dragging, double-click and
  // touch pinch all still work. Markers, popups and selection are untouched.
  scrollWheelZoom = false,
}) {
  const mapRef = useRef(null);
  const leafletRef = useRef(null);
  const markersRef = useRef({});
  const [mapInitialized, setMapInitialized] = useState(false);

  // Initialize map (once) — ensure container has dimensions before adding markers
  useEffect(() => {
    if (!mapRef.current || leafletRef.current) return;

    const map = L.map(mapRef.current, { scrollWheelZoom }).setView(initialCenter, 12);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 18,
    }).addTo(map);

    leafletRef.current = map;
    // Fix: container may have 0 size at init (grid layout), force resize after layout
    const t1 = setTimeout(() => map.invalidateSize(), 100);
    const t2 = setTimeout(() => map.invalidateSize(), 500);
    setMapInitialized(true);
    onMapReady?.();

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      map.remove();
      leafletRef.current = null;
    };
  }, []); // stable — do not re-init on prop changes

  // Unified marker sync — handles branches loaded async + selected branch changes
  useEffect(() => {
    if (!leafletRef.current || !mapInitialized) return;
    if (!Array.isArray(branches) || branches.length === 0) return;
    const map = leafletRef.current;
    // Ensure map knows its container size (fixes hidden markers when container had 0 height at init)
    map.invalidateSize();

    const icon = L.divIcon({
      className: 'atany-pin',
      html: '<div style="width:28px;height:28px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:#14301f;border:2px solid #c7a66a;box-shadow:0 2px 6px rgba(0,0,0,0.3);"></div>',
      iconSize: [28, 28],
      iconAnchor: [14, 28],
    });
    const selectedIcon = L.divIcon({
      className: 'atany-pin-selected',
      html: '<div style="width:32px;height:32px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:#c7a66a;border:2px solid #14301f;box-shadow:0 2px 8px rgba(0,0,0,0.4);"></div>',
      iconSize: [32, 32],
      iconAnchor: [16, 32],
    });

    // Known ATANY coordinates fallback (if DB lat/lng missing or invalid)
    const fallbackCoords = {
      'Gmall Branch': [7.07782, 125.61413],
      'Abreeza Branch': [7.09144, 125.61094],
      'SM Lanang Branch': [7.0989, 125.631],
    };

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
      let lat = Number(b.lat);
      let lng = Number(b.lng);
      // Fallback to known coordinates if DB values invalid
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        const fb = fallbackCoords[b.name];
        if (fb) { lat = fb[0]; lng = fb[1]; } else return;
      }
      const isSelected = String(b.id) === String(selectedBranchId);
      const existing = markersRef.current[b.id];
      if (existing) {
        existing.setIcon(isSelected ? selectedIcon : icon);
        if (isSelected) {
          existing.openPopup();
          map.setView(existing.getLatLng(), Math.max(map.getZoom(), 13), { animate: true, duration: 0.5 });
        }
        return;
      }
      const m = L.marker([lat, lng], { icon: isSelected ? selectedIcon : icon }).addTo(map);
      m.bindPopup(`<b style="color:#14301f;font-family:'Plus Jakarta Sans',sans-serif">${b.name}</b><br>${b.address}<br>☎ ${b.phone}`);
      m.on('click', () => onSelectBranch?.(b.id));
      markersRef.current[b.id] = m;
      if (isSelected) {
        m.openPopup();
        map.setView(m.getLatLng(), Math.max(map.getZoom(), 13), { animate: true, duration: 0.5 });
      }
    });

    // Fit all markers in view if no selection and markers exist
    const allMarkers = Object.values(markersRef.current);
    if (!selectedBranchId && allMarkers.length) {
      const group = L.featureGroup(allMarkers);
      map.fitBounds(group.getBounds().pad(0.2));
      // Ensure zoom not too far out
      if (map.getZoom() > 14) map.setZoom(14);
      if (map.getZoom() < 11) map.setZoom(12);
    }
  }, [branches, selectedBranchId, mapInitialized, onSelectBranch]);

  // Update user location marker when userLocation changes
  useEffect(() => {
    if (!leafletRef.current || !mapInitialized) return;
    // User location handling could be expanded here if needed
  }, [userLocation, mapInitialized]);

  return (
    <div
      ref={mapRef}
      className="branch-map__canvas"
      style={minHeight === null ? { width: '100%', height: '100%' } : { width: '100%', height: '100%', minHeight }}
    />
  );
}