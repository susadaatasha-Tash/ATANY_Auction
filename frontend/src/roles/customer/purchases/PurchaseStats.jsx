// frontend/src/roles/customer/purchases/PurchaseStats.jsx
import { peso } from '../lib/currency';

function StatCard({ icon, value, label, helper }) {
  return (
    <div className="mp-stat">
      <div className="mp-stat-top">
        <span className="mp-stat-icon" aria-hidden="true">{icon}</span>
        <span className="mp-stat-helper">{helper}</span>
      </div>
      <div className="mp-stat-value">{value}</div>
      <div className="mp-stat-label">{label}</div>
    </div>
  );
}

const IconTrophy = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4Z"/><path d="M7 6H4a2 2 0 0 0 2 4h1M17 6h3a2 2 0 0 1-2 4h-1"/></svg>
);
const IconWallet = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M20 7H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2Z"/><path d="M16 7V5a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v2"/><circle cx="16" cy="14" r="1.2" fill="currentColor"/></svg>
);
const IconBox = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M21 8 12 3 3 8v8l9 5 9-5V8Z"/><path d="M3 8l9 5 9-5M12 13v8"/></svg>
);
const IconArchive = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="4" width="18" height="5" rx="1"/><path d="M5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9M10 13h4"/></svg>
);

export function PurchaseStats({ stats }) {
  return (
    <section className="mp-stats" aria-label="Purchase summary">
      <StatCard icon={<IconTrophy />} value={stats.lotsWon} label="Lots won" helper="All-time" />
      <StatCard icon={<IconWallet />} value={peso(stats.totalSpent)} label="Total spent" helper="Incl. premium & tax" />
      <StatCard icon={<IconBox />} value={stats.awaitingPickup} label="Awaiting pickup" helper="Ready at branch" />
      <StatCard icon={<IconArchive />} value={stats.collected} label="Collected" helper="Completed" />
    </section>
  );
}
