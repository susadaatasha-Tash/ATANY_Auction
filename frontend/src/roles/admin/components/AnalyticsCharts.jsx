// frontend/src/roles/admin/components/AnalyticsCharts.jsx
// Pixel-close to legacy _legacy_html_backup/admin.html:1432-1478 (inline SVG builders)
// Uses Recharts but mirrors legacy visual: navy #14301f, cream fill, rounded-square KPI icon, pill deltas
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Area, ComposedChart, LabelList } from 'recharts';

export function RevenueTrendChart({ data }) {
  // data: [{ month, value }] — legacy: Sep–Feb, dark green line #14301f, cream fill rgba(199,166,106,.16), dots r3.5 white fill navy stroke
  if (!data || !data.length) return null;
  return (
    <ResponsiveContainer width="100%" height={200}>
      <ComposedChart data={data} margin={{ top: 14, right: 12, bottom: 6, left: 36 }}>
        <CartesianGrid stroke="#e5e2da" strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#707782', fontFamily: 'Plus Jakarta Sans' }} axisLine={false} tickLine={false} interval={0} />
        <YAxis tick={{ fontSize: 10, fill: '#707782', fontFamily: 'Plus Jakarta Sans' }} axisLine={false} tickLine={false} tickFormatter={(v) => `₱${Math.round(v/1000)}k`} width={36} />
        <Tooltip formatter={(v) => `₱${Number(v).toLocaleString()}`} contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid #e5e2da' }} />
        <Area type="monotone" dataKey="value" fill="rgba(199,166,106,0.16)" stroke="none" />
        <Line type="monotone" dataKey="value" stroke="#14301f" strokeWidth={2.5} dot={{ r: 3.5, fill: '#fffefa', stroke: '#14301f', strokeWidth: 2.5 }} activeDot={{ r: 4.5, fill: '#c7a66a', stroke: '#14301f', strokeWidth: 2 }} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export function CategoryBarChart({ data }) {
  // data: [{ cat, count }] — legacy: 5 bars Rings/Necklaces/Bracelets/Earrings/Watches, dark green #14301f, value on top, no y-grid/numbers
  if (!data || !data.length) return null;
  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={data} margin={{ top: 20, right: 10, bottom: 6, left: 10 }} barCategoryGap="14%">
        <XAxis dataKey="cat" tick={{ fontSize: 10, fill: '#707782', fontFamily: 'Plus Jakarta Sans' }} axisLine={false} tickLine={false} interval={0} />
        <YAxis hide />
        <Tooltip cursor={{ fill: 'rgba(243,241,236,0.5)' }} formatter={(v) => v} contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid #e5e2da' }} />
        <Bar dataKey="count" fill="#14301f" radius={[4, 4, 0, 0]} maxBarSize={48}>
          <LabelList dataKey="count" position="top" style={{ fontSize: 10, fill: '#14301f', fontWeight: 700, fontFamily: 'Plus Jakarta Sans' }} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function BranchRevenueChart({ data }) {
  // data: [{ branch, value }] — legacy: 5 bars Davao/Cebu/Manila/Iloilo/Baguio, value as ₱612k above bar
  if (!data || !data.length) return null;
  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={data} margin={{ top: 20, right: 10, bottom: 6, left: 10 }} barCategoryGap="14%">
        <XAxis dataKey="branch" tick={{ fontSize: 10, fill: '#707782', fontFamily: 'Plus Jakarta Sans' }} axisLine={false} tickLine={false} interval={0} width={60} />
        <YAxis hide />
        <Tooltip cursor={{ fill: 'rgba(243,241,236,0.5)' }} formatter={(v) => `₱${Number(v).toLocaleString()}`} contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid #e5e2da' }} />
        <Bar dataKey="value" fill="#14301f" radius={[4, 4, 0, 0]} maxBarSize={48}>
          <LabelList dataKey="value" position="top" formatter={(v) => `₱${Math.round(v/1000)}k`} style={{ fontSize: 10, fill: '#14301f', fontWeight: 700, fontFamily: 'Plus Jakarta Sans' }} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// New Users uses same bar style as Category — value on top, no y-axis
export function NewUsersBarChart({ data }) {
  // data: [{ month, value }]
  if (!data || !data.length) return null;
  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={data} margin={{ top: 20, right: 10, bottom: 6, left: 10 }} barCategoryGap="14%">
        <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#707782', fontFamily: 'Plus Jakarta Sans' }} axisLine={false} tickLine={false} interval={0} />
        <YAxis hide />
        <Tooltip cursor={{ fill: 'rgba(243,241,236,0.5)' }} contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid #e5e2da' }} />
        <Bar dataKey="value" fill="#14301f" radius={[4, 4, 0, 0]} maxBarSize={48}>
          <LabelList dataKey="value" position="top" style={{ fontSize: 10, fill: '#14301f', fontWeight: 700, fontFamily: 'Plus Jakarta Sans' }} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
