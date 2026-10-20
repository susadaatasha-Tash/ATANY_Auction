// frontend/src/roles/shop-owner/pages/SalesPayouts.jsx
// Sales & Payouts dashboard — KPIs, revenue trend, top categories, payout history.
// GET /shop-owner/sales/summary returns seller-scoped analytics.
// All money figures derived from real orders belonging to the caller's shop.
// Commission = 10%, seller payout = 90% (canonical backend rule).
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
    case 'Paid': return 'paid';
    case 'Scheduled': return 'scheduled';
    case 'Failed': return 'failed';
    default: return 'pending';
  }
}
function formatPaymentMethod(method) {
  if (!method) return '—';
  const m = method.trim();
  const lower = m.toLowerCase();
  const label = lower === 'gcash' ? 'GCash'
    : lower === 'maya' ? 'Maya'
    : lower === 'bpi' ? 'BPI'
    : lower === 'bank' ? 'Bank Transfer'
    : m.charAt(0).toUpperCase() + m.slice(1);
  return label;
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
          <span style={{ fontSize: 13, color: '#1e2a3a', fontWeight: 700 }}>Net Payout</span>
          <span style={{ fontSize: 13, color: '#1a2744', fontWeight: 800, marginLeft: 8 }}>{peso(net)}</span>
        </div>
      </div>
    </div>
  );
}

const EMPTY_SUMMARY = {
  summary: { gross_sales_ytd: 0, net_payout_ytd: 0, pending_payout: 0, sales_this_month: 0, lots_sold_this_month: 0, commission_rate: 0.10 },
  revenue_trend: [],
  top_categories: [],
  payout_history: []
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
      setError(e.message || 'Unable to load sales and payout data.');
      setData(EMPTY_SUMMARY);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const { summary, revenue_trend: trend, top_categories: categories, payout_history: payouts } = data || EMPTY_SUMMARY;

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
      label: 'Net Payout',
      sub: 'After fees',
      value: peso(summary.net_payout_ytd),
      helper: summary.gross_sales_ytd > 0 ? `ATANY keeps ${Math.round(summary.commission_rate * 100)}% commission` : 'No payouts yet',
      tone: 'gold',
      icon: <Wallet size={16} />
    },
    {
      label: 'Pending Payout',
      sub: summary.pending_payout > 0 ? 'Awaiting release' : 'None',
      value: peso(summary.pending_payout),
      helper: summary.pending_payout > 0 ? 'Ready for release to your account' : 'All caught up',
      tone: summary.pending_payout > 0 ? 'gold' : 'muted',
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

  // ---- CSV export ----
  const handleExportCsv = () => {
    if (!payouts || !payouts.length) {
      showToast('No payout data to export');
      return;
    }
    const headers = ['Payout ID', 'Date', 'Amount', 'Method', 'Status'];
    const rows = payouts.map((p) => [
      p.id || '—',
      formatDate(p.date),
      peso(p.amount),
      p.method || '—',
      p.status || '—'
    ]);
    const csv = [headers, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `atany-payout-history-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('Payout history exported');
  };

  if (loading) {
    return (
      <div className="sp-page">
        <div className="sp-header">
          <p className="sp-eyebrow">EARNINGS</p>
          <h1 className="sp-title">Sales & Payouts</h1>
        </div>
        <div className="sp-loading" style={{ padding: 40, textAlign: 'center', color: '#848b96' }}>
          Loading sales and payout data…
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="sp-page">
        <div className="sp-header">
          <p className="sp-eyebrow">EARNINGS</p>
          <h1 className="sp-title">Sales & Payouts</h1>
        </div>
        <div className="sp-error">
          <p>{error}</p>
          <button className="sp-btn-retry" onClick={refresh}>Retry</button>
        </div>
      </div>
    );
  }

  const hasData = summary.gross_sales_ytd > 0 || payouts.length > 0 || categories.length > 0;

  return (
    <div className="sp-page">
      {/* Header */}
      <div className="sp-header">
        <div className="sp-header-main">
          <p className="sp-eyebrow">EARNINGS</p>
          <h1 className="sp-title">Sales & Payouts</h1>
          <p className="sp-subtitle">Track your sales performance and payout history</p>
        </div>
        <div className="sp-header-actions">
          <span className="sp-active-pill" title="Active listings">
            <span className="sp-dot" aria-hidden="true" />
            <span className="sp-count">35</span>
            active listings
          </span>
        </div>
      </div>

      {/* KPI Cards */}
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
            <p className="sp-card-sub">Gross sales vs net payout over 12 months</p>
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
                  <Line type="monotone" dataKey="gross" stroke="#c4a265" strokeWidth={2.5} dot={false} activeDot={{ r: 6, fill: '#c4a265' }} fill="url(#colorGross)" name="Gross sales" />
                  <Line type="monotone" dataKey="net" stroke="#1a2744" strokeWidth={2.5} dot={false} activeDot={{ r: 6, fill: '#1a2744' }} fill="url(#colorNet)" name="Net payout" />
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

      {/* Payout History (full width) */}
      <div className="sp-card sp-payout-card">
        <div className="sp-card-head sp-payout-head">
          <div className="sp-payout-head-left">
            <h2 className="sp-card-title">Payout History</h2>
            <p className="sp-card-sub">Recent releases to your preferred accounts</p>
          </div>
          <button className="sp-btn-export" onClick={handleExportCsv} disabled={!payouts.length}>
            <Download size={14} /> Export CSV
          </button>
        </div>
        <div className="sp-table-wrap">
          <table className="sp-payout-table">
            <thead>
              <tr>
                <th>Payout ID</th>
                <th>Date</th>
                <th>Amount</th>
                <th>Method</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {hasData && payouts.length ? (
                payouts.map((p) => (
                  <tr key={p.id || p.date}>
                    <td className="sp-pid">{p.id || '—'}</td>
                    <td>{formatDate(p.date)}</td>
                    <td className="sp-amt">{peso(p.amount)}</td>
                    <td className="sp-method">{formatPaymentMethod(p.method)}</td>
                    <td>
                      <span className={`sp-badge sp-badge-${statusTone(p.status)}`}>
                        <span className="sp-badge-dot" />
                        {p.status}
                      </span>
                    </td>
                  </tr>
                ))
              ) : (
                <tr><td colSpan={5}><div className="sp-empty-inline"><span style={{ color: '#848b96', fontSize: 13 }}>No payout history yet.</span></div></td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
