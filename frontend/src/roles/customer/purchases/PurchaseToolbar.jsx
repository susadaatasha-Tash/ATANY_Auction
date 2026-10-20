// frontend/src/roles/customer/purchases/PurchaseToolbar.jsx
export function PurchaseToolbar({ query, onQueryChange, sort, onSortChange }) {
  return (
    <div className="mp-toolbar">
      <div className="mp-search">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
        <input
          type="search"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Search your purchases..."
          aria-label="Search your purchases"
        />
      </div>
      <label className="mp-sort">
        <span className="mp-sort-label">Sort</span>
        <select value={sort} onChange={(e) => onSortChange(e.target.value)} aria-label="Sort purchases">
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
          <option value="highest">Highest total</option>
          <option value="lowest">Lowest total</option>
        </select>
      </label>
    </div>
  );
}
