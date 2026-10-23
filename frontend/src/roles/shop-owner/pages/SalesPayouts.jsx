// frontend/src/roles/shop-owner/pages/SalesPayouts.jsx
// Sales & Payouts dashboard — KPIs, revenue trend, top categories, earnings history.
// The history table shows recognized seller EARNINGS (ATANY does not record seller
// disbursements yet), so it is never presented as a payout.
// GET /shop-owner/sales/summary returns seller-scoped analytics.
// All money figures derived from real orders belonging to the caller's shop.
// Commission = 10%, seller earnings = 90% (canonical backend rule).
import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../../../shared/lib/apiClient';
import { useToast } from '../../../shared/components/Toast';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceDot
} from 'recharts';
import { Gavel, Tag, Clock, Wallet, Download, ChevronRight } from 'lucide-react';
import '../sales-payouts.css';

function peso(n) {
  return '₱' + Number(n || 0).toLocaleString();
}
function formatDate(d) {
  if (!d) return '—';
  const date = new Date(d);
  if (isNaN(date)) return String(d);
  return date.toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
}
function monthLabel(d) {
  return d.toLocaleDateString('en-PH', { month: 'short' });
}
function statusTone(status) {
  switch (status) {
    case 'Earned': return 'paid';
    case 'Failed': return 'failed';
    default: return 'pending';
  }
}
// ---- Custom tooltip for the trend chart ----
function TrendTooltip({ active, payload, label }) {
  if (!active || !payload || payload.length === 0) return null;

  const grossEntry = payload.find((entry) => entry.dataKey === 'gross');
  const netEntry = payload.find((entry) => entry.dataKey === 'net');

  const gross = grossEntry ? grossEntry.value : 0;
  const net = netEntry ? netEntry.value : 0;

  return (
    <div className="chart-tooltip">
      <div style={{ fontSize: 10, color: '#848b96', marginBottom: 8, textTransform: 'uppercase' }}>{label}</div>
      <div style={{ display: 'flex', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 8, height: 8, borderRadius: 4, background: '#c4a265', display: 'inline-block' }} />
          <span style={{ fontSize: 13, color: '#1e2a3a', fontWeight: 700 }}>Gross Sales</span>
          <span style={{ fontSize: 13, color: '#8a6a1f', fontWeight: 800, marginLeft: 8 }}>{peso(gross)}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 8, height: 8, borderRadius: 4, background: '#1a2744', display: 'inline-block' }} />
          <span style={{ fontSize: 13, color: '#1e2a3a', fontWeight: 700 }}>Net Earnings</span>
          <span style={{ fontSize: 13, color: '#1a2744', fontWeight: 800, marginLeft: 8 }}>{peso(net)}</span>
        </div>
      </div>
    </div>
  );
}

const EMPTY_SUMMARY = {
  summary: { gross_sales_ytd: 0, net_earnings_ytd: 0, pending_earnings: 0, sales_this_month: 0, lots_sold_this_month: 0, commission_rate: 0.10 },
  revenue_trend: [],
  top_categories: [],
  earnings_history: []
};

export default function SalesPayouts() {
  const showToast = useToast();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const d = await apiFetch('/shop-owner/sales/summary');
      setData(d || EMPTY_SUMMARY);
    } catch (e) {
      setError(e.message || 'Failed to load sales and earnings data.');
      setData(EMPTY_SUMMARY);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const { summary, revenue_trend: trend, top_categories: categories, earnings_history: earnings } = data || EMPTY_SUMMARY;

  const kpis = [
    {
      label: 'Gross Sales',
      sub: 'YTD',
      value: peso(summary.gross_sales_ytd),
      helper: summary.gross_sales_ytd > 0 ? 'Year-to-date recognized sales' : 'No recognized sales yet',
      tone: 'navy',
      icon: <Gavel size={16} />
    },
    {
      label: 'Net Earnings',
      sub: 'After fees',
      value: peso(summary.net_earnings_ytd),
      helper: summary.gross_sales_ytd > 0 ? `ATANY keeps ${Math.round(summary.commission_rate * 100)}% commission` : 'No earnings yet',
      tone: 'gold',
      icon: <Wallet size={16} />
    },
    {
      label: 'Pending Earnings',
      sub: summary.pending_earnings > 0 ? 'Awaiting fulfilment' : 'None',
      value: peso(summary.pending_earnings),
      helper: summary.pending_earnings > 0 ? 'Earned, order not yet completed' : 'All caught up',
      tone: summary.pending_earnings > 0 ? 'gold' : 'muted',
      icon: <Clock size={16} />
    },
    {
      label: 'This Month',
      sub: summary.lots_sold_this_month > 0 ? `${summary.lots_sold_this_month} lots sold` : 'No lots sold',
      value: peso(summary.sales_this_month),
      helper: 'Current calendar month sales',
      tone: 'navy',
      icon: <Tag size={16} />
    }
  ];

  // ---- CSV export (earnings history — no payout destination column) ----
  const handleExportCsv = () => {
    if (!earnings || !earnings.length) {
      showToast('No earnings data to export');
      return;
    }
    const headers = ['Transaction ID', 'Date', 'Item', 'Buyer', 'Gross Sale', 'ATANY Commission', 'Net Earnings', 'Status'];
    const rows = earnings.map((e) => [
      e.id || '—',
      formatDate(e.date),
      e.item || '—',
      e.buyer || '—',
      peso(e.gross),
      peso(e.commission),
      peso(e.net),
      e.status || '—'
    ]);
    const csv = [headers, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `atany-earnings-history-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('Earnings history exported');
  };

  if (loading) {
    return (
      <div className="sp-page">
        <div className="sp-loading" style={{ padding: 40, textAlign: 'center', color: '#848b96' }}>
          Loading sales and earnings data…
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="sp-page">
        <div className="sp-error">
          <p>{error}</p>
          <button className="sp-btn-retry" onClick={refresh}>Retry</button>
        </div>
      </div>
    );
  }

  const hasData = summary.gross_sales_ytd > 0 || earnings.length > 0 || categories.length > 0;

  return (
    <div className="sp-page">
      {/* KPI Cards — the page identity comes from the portal topbar, so the
          content starts directly with the KPIs (no duplicate heading and no
          duplicated active-listing counter). */}
      <div className="sp-kpi">
        {kpis.map((k) => (
          <div key={k.label} className={`sp-card sp-kpi-card sp-kpi-${k.tone}`}>
            <div className="sp-kpi-head">
              <div className="sp-kpi-icon" style={{ background: k.tone === 'gold' ? 'rgba(196,162,101,.14)' : 'rgba(26,39,68,.08)', color: k.tone === 'gold' ? '#8a6a1f' : '#1a2744' }}>
                {k.icon}
              </div>
              <span className="sp-kpi-sub">{k.sub}</span>
            </div>
            <div className="sp-kpi-label">{k.label}</div>
            <div className="sp-kpi-value">{k.value}</div>
            <div className="sp-kpi-helper">{k.helper}</div>
          </div>
        ))}
      </div>

      {/* Middle row: Revenue Trend + Top Categories */}
      <div className="sp-middle">
        {/* Revenue Trend (left, ~70%) */}
        <div className="sp-card sp-chart-card">
          <div className="sp-card-head">
            <h2 className="sp-card-title">Revenue Trend</h2>
            <p className="sp-card-sub">Gross sales vs net earnings over 12 months</p>
          </div>
          <div className="sp-chart-wrap">
            {hasData && trend.length ? (
              <ResponsiveContainer width="100%" height={210}>
                <LineChart
                  data={trend}
                  margin={{ top: 8, right: 24, bottom: 24, left: 10 }}
                >
                  <defs>
                    <linearGradient id="colorGross" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0" stopColor="#c4a265" stopOpacity={0.35} />
                      <stop offset="100" stopColor="#c4a265" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="colorNet" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0" stopColor="#1a2744" stopOpacity={0.25} />
                      <stop offset="100" stopColor="#1a2744" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#ebe6dc" vertical={false} />
                  <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#848b96' }} axisLine={false} tickMargin={6} />
                  <YAxis tick={{ fontSize: 10, fill: '#848b96', formatter: (v) => `₱${Number(v / 1000).toFixed(0)}k` }} axisLine={false} tickMargin={4} width={40} />
                  <Tooltip content={<TrendTooltip />} cursor={{ stroke: '#c4a265', strokeWidth: 1, strokeDasharray: '3 3' }} />
                  <Legend verticalAlign="top" align="right" height={24} fill="#848b96" formatter={(value) => value} />
                  <Line type="monotone" dataKey="gross" stroke="#c4a265" strokeWidth={2.5} dot={false} activeDot={{ r: 6, fill: '#c4a265' }} fill="url(#colorGross)" name="Gross Sales" />
                  <Line type="monotone" dataKey="net" stroke="#1a2744" strokeWidth={2.5} dot={false} activeDot={{ r: 6, fill: '#1a2744' }} fill="url(#colorNet)" name="Net Earnings" />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="sp-empty-inline">
                <span style={{ color: '#848b96', fontSize: 13 }}>No sales data yet.</span>
              </div>
            )}
          </div>
        </div>

        {/* Top Categories (right, ~30%) */}
        <div className="sp-card sp-categories-card">
          <div className="sp-card-head">
            <h2 className="sp-card-title">Top Categories</h2>
            <p className="sp-card-sub">Share of revenue by category</p>
          </div>
          <div className="sp-cat-list">
            {hasData && categories.length ? (
              categories.map((cat, i) => (
                <div key={cat.category} className="sp-cat-row">
                  <div className="sp-cat-info">
                    <span className="sp-cat-name">{cat.category}</span>
                    <span className="sp-cat-pct">{cat.percentage}% of total</span>
                  </div>
                  <span className="sp-cat-amt">{peso(cat.revenue)}</span>
                  <div className="sp-cat-bar">
                    <div className="sp-cat-bar-fill" style={{ width: `${cat.percentage}%`, background: i % 2 === 0 ? '#c4a265' : '#d4b36a' }} />
                  </div>
                </div>
              ))
            ) : (
              <div className="sp-empty-inline">
                <span style={{ color: '#848b96', fontSize: 13 }}>No category revenue yet.</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Earnings History (full width) — recognized seller earnings.
          ATANY does not record seller disbursements, so this is never shown
          as a payout: no destination column, and the status is the EARNINGS
          state ("Earned"), with the fulfilment state shown separately. */}
      <div className="sp-card sp-payout-card">
        <div className="sp-card-head sp-payout-head">
          <div className="sp-payout-head-left">
            <h2 className="sp-card-title">Earnings History</h2>
            <p className="sp-card-sub">Your recognized seller earnings from paid auction orders</p>
          </div>
          <button className="sp-btn-export" onClick={handleExportCsv} disabled={!earnings.length}>
            <Download size={14} /> Export CSV
          </button>
        </div>
        <div className="sp-table-wrap">
          <table className="sp-payout-table">
            <thead>
              <tr>
                <th>Transaction</th>
                <th>Date</th>
                <th>Item</th>
                <th>Buyer</th>
                <th>Gross Sale</th>
                <th>ATANY Commission</th>
                <th>Net Earnings</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {hasData && earnings.length ? (
                earnings.map((e) => (
                  <tr key={e.id || e.date}>
                    <td className="sp-pid">{e.id || '—'}</td>
                    <td>{formatDate(e.date)}</td>
                    <td>{e.item || '—'}</td>
                    <td>{e.buyer || '—'}</td>
                    <td className="sp-amt">{peso(e.gross)}</td>
                    <td className="sp-amt">{peso(e.commission)}</td>
                    <td className="sp-amt">{peso(e.net)}</td>
                    <td>
                      <span className={`sp-badge sp-badge-${statusTone(e.status)}`}>
                        <span className="sp-badge-dot" />
                        {e.status || '—'}
                      </span>
                      {e.order_status ? (
                        <span className="sp-order-status">{e.order_status}</span>
                      ) : null}
                    </td>
                  </tr>
                ))
              ) : (
                <tr><td colSpan={8}><div className="sp-empty-inline"><span style={{ color: '#848b96', fontSize: 13 }}>No earnings history yet.</span></div></td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
