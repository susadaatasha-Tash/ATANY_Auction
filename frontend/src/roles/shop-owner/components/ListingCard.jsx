// frontend/src/roles/shop-owner/components/ListingCard.jsx
// Extracted row logic from shop-owner-dashboard.html:620 renderListings()
export function ListingRow({ listing, onResubmit }) {
  return (
    <tr>
      <td className="cell-main">{listing.name}<div className="cell-sub">{listing.id}</div></td>
      <td>{listing.category}</td>
      <td>{listing.karat}</td>
      <td>₱{Number(listing.price).toLocaleString()}</td>
      <td><span className={`badge ${listing.status}`}>{listing.status}</span></td>
      <td>{listing.status === 'rejected' && <button className="btn-ghost" onClick={() => onResubmit(listing.id)}>Edit & Resubmit</button>}</td>
    </tr>
  );
}
