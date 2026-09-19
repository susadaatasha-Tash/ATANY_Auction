import { pool } from '../db/pool.js';
import { createPayMongoCheckout, getCheckoutSession, checkoutStatus } from '../services/paymongoService.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function addOneMonth(date) {
  const d = new Date(date);
  const day = d.getDate();
  d.setMonth(d.getMonth() + 1);
  // handle month-end: if day changed, set to last day of previous month
  if (d.getDate() !== day) d.setDate(0);
  return d;
}

async function ensureNextPeriod(sellerId) {
  const { rows: latest } = await pool.query(
    `SELECT id, status, current_period_end, due_date FROM billing_records WHERE seller_id=$1 ORDER BY created_at DESC LIMIT 1`,
    [sellerId]
  );
  if (!latest.length) return;
  const last = latest[0];
  if (last.status !== 'paid') return;
  const end = last.current_period_end ? new Date(last.current_period_end) : last.due_date ? new Date(last.due_date) : null;
  if (!end) return;
  // if period already ended or within 3 days of renewal, create next pending if not exists
  const now = new Date();
  const diffDays = (end - now) / (1000 * 60 * 60 * 24);
  if (diffDays > 3) return; // still active, not yet due for renewal
  const { rows: existingPending } = await pool.query(
    `SELECT id FROM billing_records WHERE seller_id=$1 AND status IN ('pending','overdue') LIMIT 1`,
    [sellerId]
  );
  if (existingPending.length) return;
  const nextStart = new Date(end);
  nextStart.setDate(nextStart.getDate() + 1);
  const nextEnd = addOneMonth(nextStart);
  const period = nextStart.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) + ' – ' + nextEnd.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  await pool.query(
    `INSERT INTO billing_records (seller_id, amount, billing_period, status, due_date, current_period_start, current_period_end) VALUES ($1,$2,$3,'pending',$4,$5,$6)`,
    [sellerId, 1000, period, nextEnd.toISOString().split('T')[0], nextStart.toISOString().split('T')[0], nextEnd.toISOString().split('T')[0]]
  );
}

// Seller views their own billing records
export const listMyBilling = async (req, res) => {
  try {
    // ensure next period pending exists if last paid period is ending soon
    try { await ensureNextPeriod(req.user.id); } catch {}
    const { rows } = await pool.query(
      `SELECT * FROM billing_records WHERE seller_id = $1 ORDER BY created_at DESC`,
      [req.user.id]
    );
    res.json(rows);
  } catch (e) {
    console.error('listMyBilling failed:', e.message);
    res.status(500).json({ message: 'Failed to fetch billing records' });
  }
};

// Admin views all billing records — REST-compatible via simple queries
export const listAllBilling = async (req, res) => {
  try {
    const { status, seller_id } = req.query;
    const allowedStatuses = ['pending', 'paid', 'overdue'];
    if (status && !allowedStatuses.includes(status)) return res.status(400).json({ message: `Status must be one of: ${allowedStatuses.join(', ')}` });
    if (seller_id) {
      const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!UUID_RE.test(seller_id)) return res.status(400).json({ message: 'Invalid seller ID' });
    }
    let where = [];
    let params = [];
    if (status) { params.push(status); where.push(`status = $${params.length}`); }
    if (seller_id) { params.push(seller_id); where.push(`seller_id = $${params.length}`); }
    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const { rows: billings } = await pool.query(`SELECT * FROM billing_records ${whereClause} ORDER BY created_at DESC`, params);
    if (!billings.length) return res.json([]);
    const sellerIds = [...new Set(billings.map(b => b.seller_id).filter(Boolean))];
    let userMap = {};
    let shopMap = {};
    let branchMap = {};
    if (sellerIds.length) {
      const { rows: users } = await pool.query(`SELECT id, name, email FROM users WHERE id IN (${sellerIds.map((_,i)=>`$${i+1}`).join(',')})`, sellerIds);
      userMap = Object.fromEntries(users.map(u => [u.id, u]));
      const { rows: shops } = await pool.query(`SELECT * FROM shops WHERE user_id IN (${sellerIds.map((_,i)=>`$${i+1}`).join(',')})`, sellerIds);
      shopMap = Object.fromEntries(shops.map(s => [s.user_id, s]));
      const branchIds = [...new Set(shops.map(s => s.home_branch_id).filter(Boolean))];
      if (branchIds.length) {
        const { rows: branches } = await pool.query(`SELECT * FROM branches WHERE id IN (${branchIds.map((_,i)=>`$${i+1}`).join(',')})`, branchIds);
        branchMap = Object.fromEntries(branches.map(b => [b.id, b]));
      }
    }
    const rows = billings.map(br => {
      const u = userMap[br.seller_id] || {};
      const s = shopMap[br.seller_id] || {};
      const b = branchMap[s.home_branch_id] || {};
      return {
        ...br,
        seller_name: u.name || null,
        seller_email: u.email || null,
        shop_name: s.shop_name || null,
        branch_name: b.name || null,
        branch_address: b.address || null,
      };
    });
    res.json(rows);
  } catch (e) {
    console.error('listAllBilling failed:', e.message);
    res.status(500).json({ message: 'Failed to fetch billing records' });
  }
};

// Admin creates a billing record for a seller
export const createBillingRecord = async (req, res) => {
  const { seller_id, amount, billing_period, due_date } = req.body;
  // Input validation
  if (!seller_id) return res.status(400).json({ message: 'seller_id is required' });
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!UUID_RE.test(seller_id)) return res.status(400).json({ message: 'Invalid seller ID' });
  if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) return res.status(400).json({ message: 'Valid amount is required' });
  if (!billing_period || typeof billing_period !== 'string' || !billing_period.trim()) return res.status(400).json({ message: 'billing_period is required' });
  if (billing_period.length > 50) return res.status(400).json({ message: 'billing_period must be at most 50 characters' });
  if (due_date && isNaN(Date.parse(due_date))) return res.status(400).json({ message: 'Invalid due_date format' });
  try {
    const now = new Date();
    const end = due_date ? new Date(due_date) : addOneMonth(now);
    const startStr = now.toISOString().split('T')[0];
    const endStr = end.toISOString().split('T')[0];
    const { rows } = await pool.query(
      `INSERT INTO billing_records (seller_id, amount, billing_period, due_date, current_period_start, current_period_end)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [seller_id, Number(amount), billing_period.trim(), due_date || endStr, startStr, endStr]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    console.error('createBillingRecord failed:', e.message);
    res.status(500).json({ message: 'Failed to create billing record' });
  }
};

// Seller fetches single billing with polling fallback
export const getMyBillingOne = async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT * FROM billing_records WHERE id=$1 AND seller_id=$2`, [req.params.id, req.user.id]);
    if (!rows.length) return res.status(404).json({ message: 'Billing record not found' });
    let billing = rows[0];
    if (['pending', 'processing'].includes(billing.status) && billing.paymongo_checkout_session_id) {
      try {
        const checkout = await getCheckoutSession(billing.paymongo_checkout_session_id);
        const status = checkoutStatus(checkout);
        if (status === 'paid' && billing.status !== 'paid') {
          const attrs = checkout?.data?.attributes || {};
          const payId = attrs.payments?.[0]?.id || attrs.payment_intent?.id || billing.paymongo_checkout_session_id;
          const { rows: upd } = await pool.query(
            `UPDATE billing_records SET status='paid', paid_at=now(), payment_reference=$1, updated_at=now() WHERE id=$2 RETURNING *`,
            [payId, billing.id]
          );
          billing = upd[0] || billing;
          try {
            await pool.query(
              'INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details) VALUES ($1, $2, $3, $4, $5)',
              [billing.seller_id, 'subscription_paid', 'billing', billing.id, JSON.stringify({ billing_period: billing.billing_period, amount: billing.amount })]
            );
          } catch (logErr) {
            console.warn('[audit log] failed:', logErr.message);
          }
          try {
            await pool.query(`INSERT INTO notifications (user_id, type, message) VALUES ($1,'payout',$2)`, [billing.seller_id, `Your ${billing.billing_period} maintenance payment of ₱${Number(billing.amount).toLocaleString()} has been received.`]);
            const { rows: admins } = await pool.query(`SELECT id FROM users WHERE role='admin' LIMIT 5`);
            for (const a of admins) {
              await pool.query(`INSERT INTO notifications (user_id, type, message) VALUES ($1,'payout',$2)`, [a.id, `Maintenance payment received from seller for ${billing.billing_period} — ₱${Number(billing.amount).toLocaleString()}.`]);
            }
          } catch {}
          console.log(`[billing-sync] billing ${billing.id} marked paid via polling`);
        } else if ((status === 'failed' || status === 'expired') && billing.status !== status) {
          const { rows: upd } = await pool.query(`UPDATE billing_records SET status=$1, updated_at=now() WHERE id=$2 RETURNING *`, [status, billing.id]);
          billing = upd[0] || billing;
        }
      } catch (e) {
        console.warn(`[billing-sync] Unable to verify checkout ${billing.paymongo_checkout_session_id}: ${e.message}`);
      }
    }
    res.json(billing);
  } catch (e) {
    console.error('getMyBillingOne failed:', e.message);
    res.status(500).json({ message: 'Failed to fetch billing record' });
  }
};

// Seller creates PayMongo checkout for own billing
export const createMaintenanceCheckout = async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT * FROM billing_records WHERE id=$1 AND seller_id=$2`, [req.params.id, req.user.id]);
    if (!rows.length) return res.status(404).json({ message: 'Billing record not found' });
    const billing = rows[0];
    if (billing.status === 'paid') return res.status(400).json({ message: 'Billing already paid' });
    if (!['pending', 'overdue'].includes(billing.status)) return res.status(400).json({ message: 'Billing not payable' });

    // reuse existing pending checkout if recent
    if (billing.paymongo_checkout_session_id && ['pending', 'processing'].includes(billing.status)) {
      const { rows: existing } = await pool.query(`SELECT paymongo_checkout_session_id FROM billing_records WHERE id=$1 AND paymongo_checkout_session_id IS NOT NULL AND updated_at > NOW() - INTERVAL '30 minutes'`, [billing.id]);
      // try to return existing checkout_url if stored (check via PayMongo)
      try {
        const checkout = await getCheckoutSession(billing.paymongo_checkout_session_id);
        const url = checkout?.data?.attributes?.checkout_url;
        if (url) return res.json({ checkout_url: url, billing });
      } catch {}
    }

    const amount = Number(billing.amount);
    if (!amount || amount <= 0) return res.status(400).json({ message: 'Invalid billing amount' });

    // create PayMongo checkout — reuse service helper with billing as order-like
    const fakeOrder = { id: billing.id, amount: billing.amount, transaction_code: billing.billing_period, item: `ATANY Maintenance Fee - ${billing.billing_period}` };
    const fakePayment = { id: billing.id };
    // For billing, create directly via PayMongo API with billing reference
    const frontendUrl = (process.env.FRONTEND_URL || 'http://localhost:5178').replace(/\/$/, '');
    const successUrl = `${frontendUrl}/shop/billing/success?billing_id=${billing.id}`;
    const cancelUrl = `${frontendUrl}/shop/billing`;
    const paymongoRes = await fetch('https://api.paymongo.com/v1/checkout_sessions', {
      method: 'POST',
      headers: { Authorization: `Basic ${Buffer.from(process.env.PAYMONGO_SECRET_KEY + ':').toString('base64')}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        data: {
          attributes: {
            line_items: [{ currency: 'PHP', amount: Math.round(amount * 100), name: `ATANY Maintenance Fee - ${billing.billing_period}`, quantity: 1 }],
            payment_method_types: ['gcash', 'card', 'paymaya', 'grab_pay', 'qrph', 'billease'],
            send_email_receipt: false,
            show_description: true,
            show_line_items: true,
            description: `ATANY Maintenance Fee - ${billing.billing_period}`,
            success_url: successUrl,
            cancel_url: cancelUrl,
            reference_number: billing.id,
          },
        },
      }),
    });
    const body = await paymongoRes.json().catch(() => ({}));
    if (!paymongoRes.ok) throw new Error(body?.errors?.[0]?.detail || `PayMongo failed: ${paymongoRes.status}`);
    const checkoutId = body.data.id;
    const checkoutUrl = body.data.attributes.checkout_url;
    await pool.query(`UPDATE billing_records SET paymongo_checkout_session_id=$1, updated_at=now() WHERE id=$2`, [checkoutId, billing.id]);
    const { rows: upd } = await pool.query(`SELECT * FROM billing_records WHERE id=$1`, [billing.id]);
    res.json({ checkout_url: checkoutUrl, billing: upd[0] });
  } catch (e) {
    console.error('[billing checkout]', e.message);
    res.status(500).json({ message: e.message || 'Failed to create checkout' });
  }
};
