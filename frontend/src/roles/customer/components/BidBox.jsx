// frontend/src/roles/customer/components/BidBox.jsx
// Reusable bid input — used inside AuctionCard and DetailModal
export function BidBox({ minBid, onBid }) {
  const handle = () => {
    const val = Number(document.getElementById('detailBidInput')?.value);
    onBid(val);
  };
  return (
    <div className="detail-bidbox">
      <input type="number" id="detailBidInput" placeholder={`₱${minBid.toLocaleString()}+`} />
      <button className="btn btn-primary" onClick={handle}>Place Bid</button>
    </div>
  );
}
