// frontend/src/roles/shop-owner/pages/salesSPR.js
// Pure A4 Seller Financial Report builder for Export SPR. Takes the CURRENT
// range-scoped dashboard payload (never refetches, never fabricates) and
// returns a self-contained printable HTML document.
function esc(v) {
  return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function peso(n) { return '₱' + Number(n || 0).toLocaleString(); }

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

function fmtDateTime(d) {
  return d.toLocaleString('en-US', { month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function buildSPRReport({ shopName, rangeTitle, rangePeriod, generatedAt, summary, trend, categories, payouts }) {
  const gen = generatedAt instanceof Date ? generatedAt : new Date(generatedAt || Date.now());
  const trendRows = (trend || []).map((t) => `
      <tr><td>${esc(t.label || t.month)}</td><td class="num">${peso(t.gross_sales)}</td><td class="num">${peso(t.net_payout)}</td></tr>`).join('');
  const catRows = (categories || []).map((c) => `
      <tr><td>${esc(c.name)}</td><td class="num">${peso(c.revenue)}</td><td class="num">${esc(c.percent)}%</td></tr>`).join('');
  const payoutRows = (payouts || []).map((r) => `
      <tr><td>${esc(String(r.id).slice(0, 12).toUpperCase())}</td><td>${esc(fmtDate(r.date))}</td><td class="num">${peso(r.amount)}</td><td>${esc(r.method)}</td><td>${esc(r.status)}</td></tr>`).join('');
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>ATANY Seller Financial Report</title>
<style>
  @page { size: A4; margin: 16mm; }
  body { font-family: Georgia, 'Times New Roman', serif; color: #142a4a; margin: 0; }
  .brand { font-size: 22px; font-weight: 800; letter-spacing: .14em; }
  h1 { font-size: 20px; margin: 4px 0 2px; }
  .meta { font-size: 12px; color: #5c6674; margin: 2px 0; }
  .kpis { display: table; width: 100%; margin: 14px 0; border-collapse: collapse; }
  .kpis td { border: 1px solid #ddd; padding: 8px 10px; font-size: 13px; }
  .kpis .v { font-size: 16px; font-weight: 800; }
  h2 { font-size: 14px; margin: 16px 0 6px; border-bottom: 2px solid #c4a265; padding-bottom: 4px; }
  table.grid { width: 100%; border-collapse: collapse; font-size: 12px; }
  table.grid th { text-align: left; border-bottom: 1px solid #999; padding: 5px 6px; font-size: 11px; text-transform: uppercase; }
  table.grid td { border-bottom: 1px solid #eee; padding: 5px 6px; }
  .num { text-align: right; }
  .foot { margin-top: 18px; font-size: 11px; color: #5c6674; }
</style></head><body>
  <div class="brand">ATANY</div>
  <h1>SELLER FINANCIAL REPORT — Sales &amp; Payout Summary</h1>
  <p class="meta">Shop: ${esc(shopName || '—')}</p>
  <p class="meta">Reporting Period: ${esc(rangeTitle)} — ${esc(rangePeriod)}</p>
  <p class="meta">Generated: ${esc(fmtDateTime(gen))}</p>
  <table class="kpis"><tr>
    <td>Gross Sales<br><span class="v">${peso(summary?.gross_sales)}</span></td>
    <td>Net Payout<br><span class="v">${peso(summary?.net_payout)}</span></td>
    <td>Pending Payout<br><span class="v">${peso(summary?.pending_payout)}</span></td>
    <td>Lots Sold<br><span class="v">${esc(summary?.lots_sold ?? 0)}</span></td>
  </tr></table>
  <h2>Revenue Trend</h2>
  <table class="grid"><tr><th>Period</th><th class="num">Gross Sales</th><th class="num">Net Payout</th></tr>${trendRows}</table>
  <h2>Top Categories</h2>
  <table class="grid"><tr><th>Category</th><th class="num">Revenue</th><th class="num">Share</th></tr>${catRows}</table>
  <h2>Payout History</h2>
  <table class="grid"><tr><th>Payout ID</th><th>Date</th><th class="num">Amount</th><th>Method</th><th>Status</th></tr>${payoutRows}</table>
  <p class="foot">Figures are derived from settled seller records for the reporting period. Pending payout reflects the current pending balance.</p>
</body></html>`;
}
