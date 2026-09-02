// WealthCore — minimal, safe CSV parser / stringifier.
//
// No dependency. Handles quoted fields, escaped quotes, commas and newlines.
// Does not evaluate formulas or execute anything (safe against CSV injection
// on import).

export function parseCsv(text) {
  if (typeof text !== 'string') throw new Error('CSV input must be a string');
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let start = 0;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n') {
      row.push(field); field = '';
      if (row.some((f) => f !== '')) rows.push(row);
      row = [];
    } else if (c === '\r') {
      // ignore carriage returns (handle CRLF)
    } else {
      field += c;
    }
  }
  // flush last field
  if (field !== '' || row.length) { row.push(field); if (row.some((f) => f !== '')) rows.push(row); }

  if (!rows.length) return { headers: [], rows: [] };
  const headers = rows[0].map((h) => h.trim());
  const body = rows.slice(1).map((r) => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = (r[i] !== undefined ? r[i] : '').trim(); });
    return obj;
  });
  return { headers, rows: body };
}

export function toCsv(headers, rows) {
  const esc = (v) => {
    const s = String(v == null ? '' : v);
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [headers.map(esc).join(',')];
  for (const r of rows) lines.push(headers.map((h) => esc(r[h])).join(','));
  return lines.join('\n');
}

export default { parseCsv, toCsv };
