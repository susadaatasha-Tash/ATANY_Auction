// frontend/src/roles/admin/components/CsvImport.jsx
// Extension d) — bulk product import (beyond spec, requested in d). Frontend parses CSV, POSTs to /admin/products/bulk.
import { useState } from 'react';
import { apiFetch } from '../../../shared/lib/apiClient';

function parseCsv(text) {
  const [headerLine, ...rows] = text.trim().split('\n');
  const headers = headerLine.split(',').map((h) => h.trim().toLowerCase());
  return rows.map((line) => {
    const cells = line.split(',').map((c) => c.trim());
    const obj = {};
    headers.forEach((h, i) => (obj[h] = cells[i]));
    return obj;
  });
}

export function CsvImport({ onDone }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  const onFile = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setBusy(true);
    try {
      const text = await file.text();
      const rows = parseCsv(text);
      // Validate required columns (name, category, price)
      const invalid = rows.filter((r) => !r.name || !r.category || !r.price);
      if (invalid.length) throw new Error(`${invalid.length} rows missing name/category/price`);
      const res = await apiFetch('/admin/products/bulk', { method: 'POST', body: JSON.stringify({ rows }) });
      setResult(`Imported ${res.inserted} products`);
      onDone?.();
    } catch (err) {
      setResult(`Error: ${err.message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
      <label className="btn btn-outline" style={{ cursor: 'pointer' }}>
        {busy ? 'Importing…' : 'Import CSV'}
        <input type="file" accept=".csv" onChange={onFile} style={{ display: 'none' }} disabled={busy} />
      </label>
      {result && <span style={{ fontSize: 11, color: 'var(--muted)' }}>{result}</span>}
      <a href="data:text/csv,name%2Ccategory%2Ckarat_weight%2Cprice%2Cstock%0ASolitaire%20Ring%2CRings%2C18K%20%C2%B7%203.1g%2C68000%2C4" download="atany-template.csv" style={{ fontSize: 11, color: 'var(--navy)', fontWeight: 700 }}>Download template</a>
    </div>
  );
}
