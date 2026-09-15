// frontend/src/roles/customer/components/LiveBranchesWidget.jsx
// Consult form request: "pag gawas sa dashboard naay makita na murag branch na nakalive for auction"
// Shows which branches currently have a live auction, linking straight to LiveAuctions filtered by branch.
import { useNavigate } from 'react-router-dom';
import { formatCountdown } from '../../../shared/hooks/useAuctionCountdown';

export default function LiveBranchesWidget({ liveAuctions = [] }) {
  const navigate = useNavigate();

  // Group live auctions by branch so each branch shows once with its item count.
  const branches = Object.values(
    liveAuctions.reduce((acc, a) => {
      const key = a.branch_id || a.branch_name;
      if (!key) return acc;
      if (!acc[key]) {
        acc[key] = { branch_id: a.branch_id, branch_name: a.branch_name, count: 0, soonestEndsInSec: a.endsInSec };
      }
      acc[key].count += 1;
      if (typeof a.endsInSec === 'number' && a.endsInSec < acc[key].soonestEndsInSec) {
        acc[key].soonestEndsInSec = a.endsInSec;
      }
      return acc;
    }, {})
  );

  if (!branches.length) return null;

  return (
    <div className="panel" style={{ marginBottom: 20 }}>
      <div className="panel-head">
        <div>
          <h2>🔴 Live Now by Branch</h2>
          <p>Branches with an ongoing auction — tap to jump in.</p>
        </div>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
        {branches.map((b) => (
          <button
            key={b.branch_id || b.branch_name}
            onClick={() => navigate(`/customer/live?branch_id=${b.branch_id || ''}`)}
            className="btn btn-outline"
            style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 4, padding: '12px 16px', minWidth: 180 }}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--danger, #d33)', display: 'inline-block' }} />
              {b.branch_name}
            </span>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>
              {b.count} live auction{b.count > 1 ? 's' : ''} · ends in {formatCountdown(b.soonestEndsInSec)}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}