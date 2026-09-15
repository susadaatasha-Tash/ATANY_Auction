// frontend/src/shared/components/Badge.jsx
// Premium status badges — consistent colors, dot indicator, polished typography
export function Badge({ status }) {
  const labelMap = {
    readypickup: 'Ready for Pickup',
    pendingreview: 'Pending Review',
    instock: 'In Stock',
    lowstock: 'Low Stock',
    soldout: 'Sold Out',
    investigating: 'Investigating',
  };
  const display = labelMap[status] || status.charAt(0).toUpperCase() + status.slice(1);
  return <span className={`badge ${status}`}>{display}</span>;
}
