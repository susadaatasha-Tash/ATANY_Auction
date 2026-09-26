// Shared notification destination resolver (Problem 4C).
// Maps a notification row to an existing in-app route. Never invents destinations:
// every return value is a route confirmed in the role routes files, and order
// lookups resolve transaction_code -> actual order.id via the existing order API.
import { apiFetch } from './apiClient';

// Extracts a transaction/order reference from existing backend message formats:
//   "Transaction {code} ..." (winner notices)
//   "Order {ref} ..." / "Payment for order {code} ..." (reminders, failures, counter)
export function extractTransactionCode(message) {
  if (!message) return null;
  const text = String(message);
  let m = text.match(/Transaction ([A-Za-z0-9-]+)/);
  if (m) return m[1];
  m = text.match(/[Oo]rder ([A-Za-z0-9-]+)/);
  if (m) return m[1];
  return null;
}

function isOrderLike(n) {
  const text = `${n?.type || ''} ${n?.message || ''}`.toLowerCase();
  return text.includes('payout') || text.includes('order') || text.includes('payment');
}

// Customer: payout rows always resolve through the order path (transaction_code ->
// /customer/orders/:id, fallback /customer/purchases) even when auction_id is set.
// Auction-type rows with auction_id -> /customer/live (no customer detail route).
// Anything else -> role list fallback. Existing 4C outcomes are preserved.
async function resolveCustomerOrder(code) {
  try {
    const orders = await apiFetch('/customer/orders');
    const list = Array.isArray(orders) ? orders : [];
    const match = list.find((o) => o.transaction_code === code || String(o.id) === code);
    if (match) return `/customer/orders/${match.id}`;
  } catch {}
  return '/customer/purchases';
}

export async function resolveCustomerDestination(n) {
  const type = n?.type || '';
  if (type === 'payout' || (!n?.auction_id && isOrderLike(n))) {
    const code = extractTransactionCode(n?.message);
    if (code) return resolveCustomerOrder(code);
    return '/customer/purchases';
  }
  if (n?.auction_id) return '/customer/live';
  const code = extractTransactionCode(n?.message);
  if (code) return resolveCustomerOrder(code);
  return '/customer/live';
}

// Seller: payout rows -> /shop/sales even when auction_id is set (order list;
// no per-order seller route). Auction rows with auction_id -> /shop/auctions.
// seller_application and unknown rows keep existing expand behavior (handled by caller).
export function resolveShopDestination(n) {
  const type = n?.type || '';
  if (type === 'payout' || (!n?.auction_id && isOrderLike(n))) return '/shop/sales';
  if (n?.auction_id) return '/shop/auctions';
  if (extractTransactionCode(n?.message)) return '/shop/sales';
  if (isOrderLike(n)) return '/shop/sales';
  if (type === 'auction') return '/shop/auctions';
  return null;
}

// Admin: payout rows -> /admin/transactions even when auction_id is set.
// Auction rows with auction_id -> /admin/auctions/:id (real detail route).
// seller_application -> /admin/seller-applications.
// Unknown rows return null so the caller keeps existing expand behavior.
export function resolveAdminDestination(n) {
  const type = n?.type || '';
  if (type === 'seller_application') return '/admin/seller-applications';
  if (type === 'payout' || (!n?.auction_id && isOrderLike(n))) return '/admin/transactions';
  if (n?.auction_id) return `/admin/auctions/${n.auction_id}`;
  if (extractTransactionCode(n?.message)) return '/admin/transactions';
  if (isOrderLike(n)) return '/admin/transactions';
  if (type === 'auction') return '/admin/auctions';
  return null;
}
