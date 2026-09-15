// frontend/src/shared/components/DataTable.jsx
// Generic table wrapper — replaces repeated .table-wrap + .panel-head patterns
export function DataTable({ columns, rows, emptyText = 'No records.' }) {
  if (!rows.length) return <div className="empty-state"><p>{emptyText}</p></div>;
  return (
    <div className="table-wrap">
      <table>
        <thead><tr>{columns.map((c) => <th key={c.key}>{c.header}</th>)}</tr></thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={row.id || i}>{columns.map((c) => <td key={c.key}>{c.cell ? c.cell(row) : row[c.key]}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SearchFilterBar({ searchValue, onSearchChange, searchPlaceholder, filters, action }) {
  return (
    <div className="toolbar">
      <div className="search-box">
        <input type="text" value={searchValue} onChange={(e) => onSearchChange(e.target.value)} placeholder={searchPlaceholder} />
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {filters}
        {action}
      </div>
    </div>
  );
}
