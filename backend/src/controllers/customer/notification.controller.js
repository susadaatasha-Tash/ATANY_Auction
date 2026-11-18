import { pool } from '../../db/pool.js';
export const listNotifications = async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM notifications WHERE user_id=$1 ORDER BY created_at DESC', [req.user.id]);
  res.json(rows);
};
export const markAllRead = async (req, res) => {
  await pool.query('UPDATE notifications SET read=true WHERE user_id=$1', [req.user.id]);
  res.json({ ok: true });
};
export const markOneRead = async (req, res) => {
  await pool.query('UPDATE notifications SET read=true WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
  res.json({ ok: true });
};
export const deleteNotification = async (req, res) => {
  const { rowCount } = await pool.query('DELETE FROM notifications WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
  if (!rowCount) return res.status(404).json({ message: 'Notification not found' });
  res.status(204).end();
};

export const resolveNotificationOrder = async (req, res) => {
  try {
    const notifId = req.params.id;
    const userId = req.user.id;

    // 1. Verify notification belongs to authenticated customer
    const { rows: notifRows } = await pool.query(
      'SELECT * FROM notifications WHERE id=$1 AND user_id=$2',
      [notifId, userId]
    );
    if (!notifRows.length) {
      return res.status(404).json({ message: 'Notification not found', code: 'NOTIFICATION_NOT_FOUND' });
    }
    const notif = notifRows[0];

    // 2. Determine if this is a winning notification
    const msg = String(notif.message || '');
    const title = String(notif.title || notif.subject || '');
    const combined = `${title} ${msg}`.toLowerCase();
    const isWinning = combined.includes('you won') || combined.includes('eligible winner') || combined.includes('winner');
    const isAuction = notif.type === 'auction' || notif.type === 'Auction';

    if (!isWinning && !isAuction) {
      return res.status(400).json({ message: 'This notification is not a winning notification', code: 'NOT_WINNING_NOTIFICATION' });
    }

    // 3. Try to resolve order through auction_id
    let orderId = null;
    if (notif.auction_id) {
      const { rows: orderRows } = await pool.query(
        'SELECT id FROM orders WHERE auction_id=$1 AND buyer_id=$2',
        [notif.auction_id, userId]
      );
      if (orderRows.length) {
        orderId = orderRows[0].id;
      }
    }

    // 4. Try to resolve through transaction code in message
    if (!orderId) {
      const txMatch = msg.match(/Transaction ([A-Za-z0-9-]+)/);
      if (txMatch) {
        const code = txMatch[1];
        const { rows: orderRows } = await pool.query(
          'SELECT id FROM orders WHERE transaction_code=$1 AND buyer_id=$2',
          [code, userId]
        );
        if (orderRows.length) {
          orderId = orderRows[0].id;
        }
      }
    }

    // 5. If still not resolved, return unresolved
    if (!orderId) {
      return res.status(200).json({
        resolved: false,
        notificationId: notifId,
        message: 'Unable to resolve this notification to a specific order. You can view your orders in My Purchases.',
        code: 'ORDER_UNRESOLVED',
      });
    }

    // 6. Verify the customer owns the order
    const { rows: verifyRows } = await pool.query(
      'SELECT id FROM orders WHERE id=$1 AND buyer_id=$2',
      [orderId, userId]
    );
    if (!verifyRows.length) {
      return res.status(403).json({ message: 'You are not authorized to access this order', code: 'ORDER_NOT_AUTHORIZED' });
    }

    return res.status(200).json({
      resolved: true,
      orderId: orderId,
      notificationId: notifId,
    });
  } catch (e) {
    console.error('[notification:resolve-order]', e.message);
    res.status(500).json({ message: 'Failed to resolve notification order', code: 'RESOLVE_FAILED' });
  }
};
