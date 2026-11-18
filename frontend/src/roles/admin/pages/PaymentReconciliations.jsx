import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../../../shared/lib/apiClient';

export default function PaymentReconciliations() {
  const [rows,setRows]=useState([]), [error,setError]=useState(null), [loading,setLoading]=useState(true);
  const load=useCallback(async()=>{
    setLoading(true);
    try { setRows(await apiFetch('/admin/payment-reconciliations')); setError(null); }
    catch(e) { setError(e.message); }
    finally { setLoading(false); }
  },[]);
  useEffect(()=>{load();},[load]);
  return <section className="panel" aria-label="Payment reconciliation">
    <div className="panel-head"><div><h2>Payment reconciliation</h2><p>Payment evidence awaiting review. Orders retain their current fulfillment status.</p></div><button className="btn btn-outline" onClick={load} disabled={loading}>Refresh payments</button></div>
    {loading ? <p role="status">Loading payment evidence…</p> : error ? <p role="alert">{error}</p> : !rows.length ? <p>No payment reconciliation cases.</p> :
      <div style={{overflowX:'auto'}}><table className="table"><thead><tr><th>Order</th><th>Provider payment</th><th>Amount received</th><th>Reason</th><th>State</th></tr></thead>
        <tbody>{rows.map(r=><tr key={r.id}><td>{r.transaction_code || r.order_id || 'Unmatched'}<br/>{r.order_status}</td><td>{r.provider_payment_id || 'No payment identifier recorded'}<br/>{r.checkout_session_id}<br/>{r.livemode === false ? 'Test mode' : r.livemode === true ? 'Live mode' : ''}<details><summary>View evidence</summary><dl><dt>Provider Event</dt><dd>{r.provider_event_id || 'Not recorded'}</dd><dt>Payment Intent</dt><dd>{r.payment_intent_id || 'Not recorded'}</dd><dt>Operation</dt><dd>{r.operation_id || 'Not recorded'}</dd><dt>Cancelled By</dt><dd>{r.cancelled_by || '—'}</dd><dt>Cancellation Reason</dt><dd>{r.cancellation_reason || '—'}</dd></dl></details></td><td>{r.amount_centavos == null ? '—' : `${r.currency} ${(Number(r.amount_centavos)/100).toLocaleString(undefined,{minimumFractionDigits:2})}`}</td><td>{r.reason.replaceAll('_',' ')}</td><td>{r.state}</td></tr>)}</tbody></table></div>}
  </section>;
}
