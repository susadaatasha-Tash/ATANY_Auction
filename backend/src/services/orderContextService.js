// backend/src/services/orderContextService.js
// Provides real-time, authenticated order context for the ATANY AI Assistant.
// Fetches the customer's latest orders from the DB — never stale, never invented.
import { pool } from '../db/pool.js';

export const ORDER_KEYWORDS = [
  'order', 'my order', 'my item', 'my jewelry', 'my purchase',
  'status', 'where is', 'where are', 'when can i', 'when will', 'when is',
  'pickup', 'pick up', 'collect', 'collection', 'ready', 'arrive', 'arrival',
  'payment', 'paid', 'deadline', 'expire', 'expired', 'cancel', 'cancelled',
  'preparing', 'preparation', 'tracking', 'delivery', 'deliver',
  'receipt', 'receive', 'received', 'when get', 'how long',
  'order ko', 'item ko', 'jewelry ko', 'bili ko', 'binili ko',
  'status ng', 'asa na', 'saan na', 'kailan', 'kailan pwede', 'kailan ready',
  'pickup ko', 'kunin', 'kukunin', 'nabayaran', 'bayad', 'deadline',
  'expiry', 'expired', 'kansel', 'cancelled', 'cancel',
  'handa', 'handa na', 'preparing', 'gawa', 'ginagawa',
  'tracking', 'delivery', 'padala', 'ipadala', 'receipt', 'matanggap',
  'kailan matanggap', 'saan kukunin', 'saan ko kukunin',
  'ano status', 'ano na', 'kumusta', 'kumusta na',
  'tumatagal', 'bakit matagal', 'matagal',
];

export const FOLLOWUP_KEYWORDS = [
  'it', 'that', 'this', 'same', 'the order', 'the item', 'the jewelry',
  'where', 'when', 'how', 'pwede', 'ba', 'na ba', 'na ba siya',
  'saan', 'kailan', 'paano', 'bakit',
];

export function isOrderQuery(text) {
  if (!text) return false;
  const lower = String(text).toLowerCase();
  return ORDER_KEYWORDS.some((kw) => lower.includes(kw));
}

export function isFollowupQuery(text) {
  if (!text) return false;
  const lower = String(text).toLowerCase();
  const words = lower.trim().split(/\s+/);
  if (words.length <= 4) {
    return FOLLOWUP_KEYWORDS.some((kw) => lower.includes(kw));
  }
  return false;
}

export async function getCustomerOrderContext(userId, highlightOrderId = null) {
  if (!userId) return [];
  try {
    // Fetch recent orders (up to 5) for general context
    const { rows: recentOrders } = await pool.query(
      `SELECT id, transaction_code, auction_id, amount, status, branch_id,
              payment_method, created_at, winner_confirmed_at, payment_deadline,
              winner_rank, cancellation_reason, cancelled_at, cancelled_by
       FROM orders WHERE buyer_id=$1 ORDER BY created_at DESC LIMIT 5`,
      [userId]
    );

    // If a specific order is highlighted (from notification), fetch it directly
    // by ID with ownership verification, even if it's older than the recent 5.
    let highlightedOrder = null;
    if (highlightOrderId) {
      const { rows: highlighted } = await pool.query(
        `SELECT id, transaction_code, auction_id, amount, status, branch_id,
                payment_method, created_at, winner_confirmed_at, payment_deadline,
                winner_rank, cancellation_reason, cancelled_at, cancelled_by
         FROM orders WHERE id=$1 AND buyer_id=$2`,
        [highlightOrderId, userId]
      );
      if (highlighted.length) {
        highlightedOrder = highlighted[0];
      }
    }

    // Merge: highlighted order first, then recent orders (deduplicated)
    const orderMap = new Map();
    if (highlightedOrder) {
      orderMap.set(highlightedOrder.id, highlightedOrder);
    }
    for (const o of recentOrders) {
      if (!orderMap.has(o.id)) {
        orderMap.set(o.id, o);
      }
    }
    const orders = Array.from(orderMap.values());
    if (!orders.length) return [];
    const auctionIds = [...new Set(orders.map((o) => o.auction_id).filter(Boolean))];
    const branchIds = [...new Set(orders.map((o) => o.branch_id).filter(Boolean))];
    const orderIds = orders.map((o) => o.id);
    let auctionMap = {};
    if (auctionIds.length) {
      const { rows: auctions } = await pool.query(
        `SELECT id, product_id, auction_code, end_time FROM auctions WHERE id IN (${auctionIds.map((_, i) => `$${i + 1}`).join(',')})`,
        auctionIds
      );
      auctionMap = Object.fromEntries(auctions.map((a) => [a.id, a]));
    }
    const productIds = [...new Set(Object.values(auctionMap).map((a) => a.product_id).filter(Boolean))];
    let productMap = {};
    if (productIds.length) {
      const { rows: products } = await pool.query(
        `SELECT id, name, category, karat_weight, image_url FROM products WHERE id IN (${productIds.map((_, i) => `$${i + 1}`).join(',')})`,
        productIds
      );
      productMap = Object.fromEntries(products.map((p) => [p.id, p]));
    }
    let branchMap = {};
    if (branchIds.length) {
      const { rows: branches } = await pool.query(
        `SELECT id, name, address, hours, phone FROM branches WHERE id IN (${branchIds.map((_, i) => `$${i + 1}`).join(',')})`,
        branchIds
      );
      branchMap = Object.fromEntries(branches.map((b) => [b.id, b]));
    }
    let paymentMap = {};
    if (orderIds.length) {
      try {
        const { rows: payments } = await pool.query(
          `SELECT order_id, status, payment_method, paid_at, created_at FROM payments WHERE order_id IN (${orderIds.map((_, i) => `$${i + 1}`).join(',')}) ORDER BY created_at DESC`,
          orderIds
        );
        for (const pay of payments) {
          if (!paymentMap[pay.order_id]) paymentMap[pay.order_id] = pay;
        }
        for (const pay of payments) {
          if (paymentMap[pay.order_id]?.status !== 'paid' && pay.status === 'paid') {
            paymentMap[pay.order_id] = pay;
          }
        }
      } catch {}
    }
    return orders.map((o) => {
      const a = auctionMap[o.auction_id] || {};
      const p = productMap[a.product_id] || {};
      const b = branchMap[o.branch_id] || {};
      const payment = paymentMap[o.id] || null;
      const winnerConfirmedAt = o.winner_confirmed_at || o.created_at;
      const paymentDeadline = o.payment_deadline || (winnerConfirmedAt
        ? new Date(new Date(winnerConfirmedAt).getTime() + 7 * 24 * 60 * 60 * 1000).toISOString()
        : null);
      return {
        orderId: o.id,
        transactionCode: o.transaction_code,
        item: p.name || 'Jewelry Item',
        category: p.category || null,
        karatWeight: o.karat_weight || p.karat_weight || null,
        amount: o.amount,
        orderStatus: o.status,
        paymentStatus: payment?.status || null,
        paymentMethod: o.payment_method || payment?.payment_method || null,
        paidAt: payment?.paid_at || null,
        paymentDeadline: paymentDeadline,
        winnerConfirmedAt: winnerConfirmedAt,
        winnerRank: o.winner_rank ?? 1,
        pickupBranch: b.name || null,
        pickupAddress: b.address || null,
        pickupHours: b.hours || null,
        pickupPhone: b.phone || null,
        cancellationReason: o.cancellation_reason || null,
        cancelledAt: o.cancelled_at || null,
        cancelledBy: o.cancelled_by || null,
        createdAt: o.created_at,
        auctionCode: a.auction_code || null,
        auctionEnd: a.end_time || null,
      };
    });
  } catch (e) {
    console.error('[orderContext] failed to fetch order context:', e.message);
    return [];
  }
}

export function formatOrderContext(orders, highlightOrderId = null) {
  if (!orders || !orders.length) {
    return `CUSTOMER ORDER DATA: No orders found for this customer.`;
  }
  // If a specific order is highlighted (from notification), move it to front
  let ordered = [...orders];
  let highlightFound = false;
  if (highlightOrderId) {
    const idx = ordered.findIndex((o) => o.orderId === highlightOrderId || o.transactionCode === highlightOrderId);
    if (idx >= 0) {
      highlightFound = true;
      if (idx > 0) {
        const [highlighted] = ordered.splice(idx, 1);
        ordered.unshift(highlighted);
      }
    }
  }

  const lines = ordered.map((o, i) => {
    const parts = [];
    const isHighlighted = highlightOrderId && (o.orderId === highlightOrderId || o.transactionCode === highlightOrderId);
    parts.push(`Order ${i + 1}${isHighlighted ? ' (THE ORDER FROM YOUR NOTIFICATION)' : ''}:`);
    parts.push(`  Transaction Code: ${o.transactionCode || 'N/A'}`);
    parts.push(`  Item: ${o.item}${o.category ? ` (${o.category})` : ''}${o.karatWeight ? `, ${o.karatWeight}` : ''}`);
    parts.push(`  Amount: ₱${Number(o.amount).toLocaleString()}`);
    parts.push(`  Order Status: ${o.orderStatus}`);
    parts.push(`  Payment Status: ${o.paymentStatus || 'No payment recorded'}`);
    if (o.paymentMethod) parts.push(`  Payment Method: ${o.paymentMethod}`);
    if (o.paidAt) parts.push(`  Paid At: ${o.paidAt}`);
    if (o.paymentDeadline) parts.push(`  Payment Deadline: ${o.paymentDeadline}`);
    parts.push(`  Fulfillment: Branch pickup (ATANY is pickup-only, no delivery)`);
    if (o.pickupBranch) {
      parts.push(`  Pickup Branch: ${o.pickupBranch}`);
      if (o.pickupAddress) parts.push(`  Pickup Address: ${o.pickupAddress}`);
      if (o.pickupHours) parts.push(`  Branch Hours: ${o.pickupHours}`);
      if (o.pickupPhone) parts.push(`  Branch Phone: ${o.pickupPhone}`);
    }
    if (o.orderStatus === 'cancelled') {
      if (o.cancellationReason) parts.push(`  Cancellation Reason: ${o.cancellationReason}`);
      if (o.cancelledAt) parts.push(`  Cancelled At: ${o.cancelledAt}`);
    }
    parts.push(`  Order Created: ${o.createdAt}`);
    if (o.winnerRank && o.winnerRank > 1) parts.push(`  Winner Rank: ${o.winnerRank}`);
    return parts.join('\n');
  });
  // Add unauthorized access note if highlightOrderId was provided but not found
  let unauthorizedNote = '';
  if (highlightOrderId && !highlightFound) {
    unauthorizedNote = `\n\nSECURITY NOTE: The requested order (${highlightOrderId}) was NOT found among this customer's orders. The customer may be attempting to access an order they do not own. Do NOT provide information about this order. Only discuss the orders listed above.`;
  }

  return `CUSTOMER ORDER DATA (from database — use ONLY this data, never invent information):\n${lines.join('\n\n')}${unauthorizedNote}\n\nIMPORTANT ORDER RULES:\n- ATANY is a PICKUP-ONLY platform. There is NO delivery. Never mention delivery, shipping, or tracking numbers.\n- Payment status and fulfillment status are SEPARATE. "Paid" means payment confirmed, NOT that preparation has started.\n- Only claim preparation has started if order status is "preparing" or "ready_pickup".\n- Only claim pickup is available if order status is "ready_pickup".\n- If no pickup branch is listed, say the branch information is not available.\n- If no payment deadline exists, do not invent one.\n- If the order is cancelled, explain the recorded cancellation reason if available.\n- If the order is expired, explain that the payment deadline has passed.\n- Never invent tracking numbers, delivery dates, or payment confirmations.\n- For follow-up questions like "when can I get it?" or "where?", refer to the most recent order above.`;
}
