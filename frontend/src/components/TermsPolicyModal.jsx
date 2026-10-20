// frontend/src/components/TermsPolicyModal.jsx
// Reusable ATANY Terms & Policy modal — used by Login and Signup
// Content covers: Auction Participation, Winner, 7-Day Payment, Failure to Pay, Next Bidder, Payment Completion, Notifications, Agreement
export default function TermsPolicyModal({ open, onClose, agreed, setAgreed, onAgree }) {
  if (!open) return null;

  const handleAgree = () => {
    if (!agreed) return;
    onAgree?.();
  };

  const handleOverlayClick = (e) => {
    if (e.target === e.currentTarget && onClose) {
      onClose();
    }
  };

  return (
    <div
      onClick={handleOverlayClick}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        background: 'rgba(20,42,74,0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
    >
      <div
        style={{
          width: 'min(560px, 100%)',
          maxHeight: '85vh',
          background: '#fff',
          borderRadius: 12,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
        }}
      >
        <div style={{ padding: '20px 24px 0', borderBottom: '1px solid #EDE9E1', background: '#FFFEFB' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 style={{ fontSize: 18, fontWeight: 800, color: '#142A4A', margin: 0 }}>Terms & Policy</h2>
            {onClose && (
              <button
                onClick={onClose}
                aria-label="Close"
                style={{ background: 'transparent', border: 'none', fontSize: 20, cursor: 'pointer', color: '#8A94A8', lineHeight: 1 }}
              >
                ×
              </button>
            )}
          </div>
          <p style={{ fontSize: 12, color: '#8A94A8', margin: '4px 0 12px' }}>Please review and agree to continue.</p>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 24px', fontSize: 12.5, lineHeight: 1.6, color: '#2D3748' }}>
          <h3 style={{ fontSize: 13, fontWeight: 800, color: '#142A4A', margin: '12px 0 6px' }}>1. Auction Participation</h3>
          <p>Users who participate in ATANY auctions agree to follow the auction rules and payment requirements. By placing a bid, you commit to completing the purchase if you become the eligible winner.</p>
          <h3 style={{ fontSize: 13, fontWeight: 800, color: '#142A4A', margin: '12px 0 6px' }}>2. Auction Winner</h3>
          <p>When an auction ends, the highest valid bidder becomes the first eligible winner, subject to the existing auction rules and verification. The winner is determined by the highest bid amount, with the earliest bid breaking ties.</p>
          <h3 style={{ fontSize: 13, fontWeight: 800, color: '#142A4A', margin: '12px 0 6px' }}>3. Seven-Day Payment Period</h3>
          <p>
            The first eligible winner has <strong>7 days</strong> from the time their winning eligibility is confirmed to complete payment for the item. The system records the confirmation time (
            <em>winner_confirmed_at</em>) and calculates the payment deadline as <em>winner_confirmed_at + 7 days</em>. For example, if eligibility is confirmed on September 23, 2026 at 3:05 PM, the
            deadline is September 30, 2026 at 3:05 PM.
          </p>
          <h3 style={{ fontSize: 13, fontWeight: 800, color: '#142A4A', margin: '12px 0 6px' }}>4. Failure to Pay</h3>
          <p>
            If the first eligible winner does not complete payment within the 7-day period, their eligibility expires. They can no longer claim the item through that winning position, and the item may be offered to
            the next eligible bidder. The expiration is determined by the backend/database, not by browser timers.
          </p>
          <h3 style={{ fontSize: 13, fontWeight: 800, color: '#142A4A', margin: '12px 0 6px' }}>5. Next Eligible Bidder</h3>
          <p>
            The next valid bidder in the auction ranking may become the new eligible buyer. That bidder receives a <strong>new 7-day payment period</strong> starting from the time their eligibility is confirmed. If they
            also fail to pay, the process continues to the next eligible bidder in ranking order.
          </p>
          <h3 style={{ fontSize: 13, fontWeight: 800, color: '#142A4A', margin: '12px 0 6px' }}>6. Payment Completion</h3>
          <p>
            If an eligible bidder successfully completes payment before their deadline, they become the successful buyer. The item is no longer reassigned, and the order/payment status is updated using the existing
            ATANY system (PayMongo, order status, etc.).
          </p>
          <h3 style={{ fontSize: 13, fontWeight: 800, color: '#142A4A', margin: '12px 0 6px' }}>7. Notifications</h3>
          <p>Eligible bidders may receive notifications when their eligibility changes (e.g., when they become the new eligible winner or when their eligibility expires). The system maintains status information to support these notifications.</p>
          <h3 style={{ fontSize: 13, fontWeight: 800, color: '#142A4A', margin: '12px 0 6px' }}>8. Agreement</h3>
          <p>By checking the box below and clicking Agree & Continue, you confirm that you have read and agree to these Terms & Policy, including the 7-day payment rule and reassignment to the next bidder if you fail to pay.</p>
        </div>
        <div style={{ padding: '16px 24px', borderTop: '1px solid #EDE9E1', background: '#FFFEFB', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: '#142A4A', cursor: 'pointer' }}>
            <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} style={{ width: 16, height: 16, accentColor: '#C89B3C' }} />
            I have read and agree to the Terms and Policy
          </label>
          <button
            onClick={handleAgree}
            disabled={!agreed}
            style={{
              width: '100%',
              height: 44,
              background: agreed ? '#142A4A' : '#CBD5E1',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              fontWeight: 700,
              cursor: agreed ? 'pointer' : 'not-allowed',
              opacity: agreed ? 1 : 0.7,
            }}
          >
            Agree & Continue
          </button>
        </div>
      </div>
    </div>
  );
}
