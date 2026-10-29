// frontend/src/roles/shop-owner/pages/SalesPayouts.jsx
// Sales & Payouts dashboard with time-range filtering + SPR export.
// Single source per range: GET /shop-owner/sales/summary?range=7d|month|year
// (seller-scoped, backend-authoritative). Page title lives in the shared
// Topbar — no duplicate in-page heading.
import { useState, useEffect, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { TrendingUp, Wallet, Clock, Hash, Printer } from 'lucide-react';
import { apiFetch } from '../../../shared/lib/apiClient';
import { buildSPRReport } from './salesSPR';
import './sales-payouts.css';

export const SALES_RANGES = [
  { key: '7d', label: '7 Days' },
  { key: 'month', label: 'This Month' },
  { key: 'year', label: 'This Year' },
];

function peso(n) { return '₱' + Number(n || 0).toLocaleString(); }

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
}

function fmtAxis(v) {
  const n = Number(v || 0);
  if (n >= 1000) return `₱${Math.round(n / 1000)}k`;
  return `₱${n}`;
}

const PAYOUT_STATUS = {
  paid: { label: 'Paid', cls: 'paid' },
  scheduled: { label: 'Scheduled', cls: 'scheduled' },
  processing: { label: 'Processing', cls: 'scheduled' },
  failed: { label: 'Failed', cls: 'failed' },
};

const PAGE_SIZE = 8;

function validRange(v) {
  return SALES_RANGES.some((r) => r.key === v) ? v : 'month';
}

export default function SalesPayouts() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedRange, setSelectedRange] = useState(() => validRange(searchParams.get('range')));
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [page, setPage] = useState(0);
  const [shopName, setShopName] = useState('');
  const seqRef = useRef(0);

  const refresh = async (range) => {
    const seq = ++seqRef.current;
    const first = !data;
    if (first) setLoading(true);
    else setRefreshing(true);
    try {
      setLoadError(null);
      const res = await apiFetch(`/shop-owner/sales/summary?range=${range}`);
      if (seqRef.current !== seq) return; // stale response: a newer range won
      setData(res);
      setPage(0);
    } catch (e) {
      if (seqRef.current !== seq) return;
      if (first) setLoadError('Unable to load sales and payout data.');
    } finally {
      if (seqRef.current === seq) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  };

  useEffect(() => {
    apiFetch('/shop-owner/shop').then((s) => setShopName(s?.shop_name || '')).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    refresh(selectedRange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRange]);

  const pickRange = (key) => {
    const valid = validRange(key);
    setSelectedRange(valid);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('range', valid);
      return next;
    }, { replace: true });
  };

  const summary = data?.summary || {};
  const trend = data?.revenue_trend || [];
  const categories = data?.top_categories || [];
  const history = data?.payout_history || [];
  const rangeTitle = data?.range_label?.title
    || SALES_RANGES.find((r) => r.key === selectedRange)?.label
    || 'This Month';
  const rangePeriod = data?.range_label?.period || '';
  const pageCount = Math.max(1, Math.ceil(history.length / PAGE_SIZE));
  const pageRows = history.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  const chartData = useMemo(() => trend.map((t) => ({
    label: t.label || t.month, gross: t.gross_sales, net: t.net_payout,
  })), [trend]);

  const exportSPR = () => {
    if (!data) return;
    const html = buildSPRReport({
      shopName,
      rangeTitle,
      rangePeriod,
      generatedAt: new Date(),
      summary,
      trend: chartData,
      categories,
      payouts: history,
    });
    const w = window.open('', '_blank', 'width=900,height=700');
    if (!w) return;
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => { try { w.print(); } catch {} }, 300);
  };

  if (loading) {
    return (
      <div className="sp-page" aria-label="Loading sales and payouts">
        <div className="sp-rangerow">
          <div className="sp-range" aria-hidden="true" />
        </div>
        <div className="sp-kpis">
          {[0, 1, 2, 3].map((i) => <div key={i} className="sp-card sp-skel" style={{ height: 118 }} />)}
        </div>
        <div className="sp-mid">
          <div className="sp-card sp-skel" style={{ height: 300 }} />
          <div className="sp-card sp-skel" style={{ height: 300 }} />
        </div>
        <div className="sp-card sp-skel" style={{ height: 220 }} />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="sp-page">
        <RangeRow selectedRange={selectedRange} onPick={pickRange} onExport={exportSPR} canExport={false} />
        <div className="sp-state">
          <p className="sp-state__title">{loadError}</p>
          <button type="button" className="sp-btn sp-btn--outline" onClick={() => refresh(selectedRange)}>Retry</button>
        </div>
      </div>
    );
  }

  return (
    <div className="sp-page" aria-busy={refreshing || undefined} style={refreshing ? { opacity: 0.75 } : undefined}>
      <RangeRow selectedRange={selectedRange} onPick={pickRange} onExport={exportSPR} canExport={history.length > 0} />
      {refreshing && <div className="sp-updating" role="status">Updating…</div>}

      <div className="sp-kpis">
        <div className="sp-card sp-kpi">
          <div className="sp-kpi__top"><span className="sp-kpi__icon"><TrendingUp size={16} /></span><span className="sp-kpi__tag">YTD</span></div>
          <div className="sp-kpi__label">Gross Sales</div>
          <div className="sp-kpi__value">{peso(summary.gross_sales)}</div>
          <div className="sp-kpi__sub">{rangeTitle}</div>
        </div>
        <div className="sp-card sp-kpi">
          <div className="sp-kpi__top"><span className="sp-kpi__icon"><Wallet size={16} /></span><span className="sp-kpi__tag sp-kpi__tag--gold">After fees</span></div>
          <div className="sp-kpi__label">Net Payout</div>
          <div className="sp-kpi__value">{peso(summary.net_payout)}</div>
          <div className="sp-kpi__sub">{rangeTitle}</div>
        </div>
        <div className="sp-card sp-kpi">
          <div className="sp-kpi__top"><span className="sp-kpi__icon"><Clock size={16} /></span></div>
          <div className="sp-kpi__label">Pending Payout</div>
          <div className="sp-kpi__value">{peso(summary.pending_payout)}</div>
          <div className="sp-kpi__sub">Current pending balance</div>
        </div>
        <div className="sp-card sp-kpi">
          <div className="sp-kpi__top"><span className="sp-kpi__icon"><Hash size={16} /></span></div>
          <div className="sp-kpi__label">Lots Sold</div>
          <div className="sp-kpi__value">{summary.lots_sold || 0}</div>
          <div className="sp-kpi__sub">{rangeTitle} · {peso(summary.gross_sales)} sales</div>
        </div>
      </div>

      <div className="sp-mid">
        <div className="sp-card">
          <div className="sp-card__head">
            <div>
              <div className="sp-card__title">Revenue Trend</div>
              <div className="sp-card__sub">Gross sales vs net payout · {rangeTitle}</div>
            </div>
            <div className="sp-legend">
              <span><i className="sp-dot sp-dot--gold" />Gross sales</span>
              <span><i className="sp-dot sp-dot--navy" />Net payout</span>
            </div>
          </div>
          {chartData.every((t) => !t.gross && !t.net) ? (
            <div className="sp-chartempty">No sales data yet.</div>
          ) : (
            <div role="img" aria-label={`Revenue trend for ${rangeTitle}, gross ${peso(summary.gross_sales)}, net ${peso(summary.net_payout)}`}>
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="4 4" stroke="#ece5d8" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#8a919c' }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                  <YAxis tickFormatter={fmtAxis} tick={{ fontSize: 11, fill: '#8a919c' }} axisLine={false} tickLine={false} width={52} />
                  <Tooltip
                    formatter={(value, name) => [peso(value), name === 'gross' ? 'Gross Sales' : 'Net Payout']}
                    labelStyle={{ fontWeight: 700, color: '#142a4a' }}
                  />
                  <Line type="monotone" dataKey="gross" stroke="#c4a265" strokeWidth={2.5} dot={false} />
                  <Line type="monotone" dataKey="net" stroke="#142a4a" strokeWidth={2.5} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
        <div className="sp-card">
          <div className="sp-card__title">Top Categories</div>
          <div className="sp-card__sub">Share of revenue by category · {rangeTitle}</div>
          {categories.length === 0 ? (
            <div className="sp-chartempty">No category revenue yet.</div>
          ) : (
            <ul className="sp-cats">
              {categories.map((c) => (
                <li key={c.name}>
                  <div className="sp-cats__row"><span>{c.name}</span><b>{peso(c.revenue)}</b></div>
                  <div className="sp-cats__bar"><i style={{ width: `${Math.min(100, Math.max(0, c.percent))}%` }} /></div>
                  <div className="sp-cats__pct">{c.percent}% of total</div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="sp-card">
        <div className="sp-card__head">
          <div>
            <div className="sp-card__title">Payout History</div>
            <div className="sp-card__sub">Recent releases to your preferred accounts · {rangeTitle}</div>
          </div>
        </div>
        {history.length === 0 ? (
          <div className="sp-chartempty">No payout history yet.</div>
        ) : (
          <>
            <div className="sp-tablewrap">
              <table className="sp-table">
                <thead><tr><th>Payout ID</th><th>Date</th><th>Amount</th><th>Method</th><th>Status</th></tr></thead>
                <tbody>
                  {pageRows.map((r) => {
                    const st = PAYOUT_STATUS[r.status] || { label: r.status, cls: 'scheduled' };
                    return (
                      <tr key={r.order_id || r.id}>
                        <td className="sp-mono">{String(r.id).slice(0, 12).toUpperCase()}</td>
                        <td>{fmtDate(r.date)}</td>
                        <td><b>{peso(r.amount)}</b></td>
                        <td>{r.method}</td>
                        <td><span className={`sp-pill sp-pill--${st.cls}`}>● {st.label}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {pageCount > 1 && (
              <div className="sp-pager">
                <button type="button" className="sp-btn sp-btn--outline" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>‹ Prev</button>
                <span>Page {page + 1} of {pageCount}</span>
                <button type="button" className="sp-btn sp-btn--outline" disabled={page >= pageCount - 1} onClick={() => setPage((p) => p + 1)}>Next ›</button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function RangeRow({ selectedRange, onPick, onExport, canExport }) {
  return (
    <div className="sp-rangerow">
      <div className="sp-range" role="group" aria-label="Time range">
        {SALES_RANGES.map((r) => (
          <button
            key={r.key}
            type="button"
            className={`sp-range__btn ${selectedRange === r.key ? 'is-active' : ''}`}
            aria-pressed={selectedRange === r.key}
            onClick={() => onPick(r.key)}
          >
            {r.label}
          </button>
        ))}
      </div>
      <button type="button" className="sp-btn sp-btn--gold" onClick={onExport} disabled={!canExport}>
        <Printer size={14} /> Export SPR
      </button>
    </div>
  );
}
