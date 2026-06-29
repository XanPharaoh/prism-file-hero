import { Workbook } from 'exceljs';

function detectNumberFormatSample(tokens: string[]): { decimal: string, grouping: string } {
  let commaDecimal = 0;
  let dotDecimal = 0;

  for (const t of tokens) {
    const s = t.trim();
    // 1.234,56
    if (/^\d{1,3}(\.\d{3})*,\d{2}$/.test(s)) commaDecimal++;
    // 1,234.56
    if (/^\d{1,3}(,\d{3})*\.\d{2}$/.test(s)) dotDecimal++;
  }

  if (commaDecimal > dotDecimal) return { decimal: ',', grouping: '.' };
  return { decimal: '.', grouping: ',' };
}

function tryParseNumberLocale(raw: string, format: { decimal: string, grouping: string }): number | null {
  let s = raw.trim().replace(/\s*\*\s*$/, '');

  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1).trim(); }
  if (s.endsWith('-')) { neg = true; s = s.slice(0, -1).trim(); }
  if (s.startsWith('-')) { neg = true; s = s.slice(1).trim(); }

  // Remove currency and spaces
  s = s.replace(/[R$£€\s]/g, '');

  // Remove grouping separator
  if (format.grouping) {
    const reGroup = new RegExp('\\' + format.grouping, 'g');
    s = s.replace(reGroup, '');
  }

  // Normalize decimal to dot
  if (format.decimal && format.decimal !== '.') {
    s = s.replace(new RegExp('\\' + format.decimal, 'g'), '.');
  }

  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return neg ? -n : n;
}

export async function getExcelBlob(rows: any[], metadata?: any): Promise<Blob> {
  const wb = new Workbook();

  if (!rows || rows.length === 0) {
    const ws = wb.addWorksheet('Empty');
    ws.columns = [{ header: 'Message', key: 'Message', width: 50 }];
    ws.addRow({ Message: 'No data found. Ensure the PDF contains a table.' });
    return await toBlob(wb);
  }

  const headers = Object.keys(rows[0]);

  // Detect number format from a sample of data
  const sampleTokens: string[] = [];
  rows.slice(0, 100).forEach(row => {
    headers.forEach(h => {
      const val = row[h];
      if (typeof val === 'string' && /[\d]{1,}/.test(val)) {
        sampleTokens.push(val);
      }
    });
  });
  const format = detectNumberFormatSample(sampleTokens);

  // Clean rows: attempt to parse numbers for Excel
  const cleanRows = rows.map(row => {
    const clean: Record<string, any> = {};
    for (const key of headers) {
      const val = row[key];
      if (val === null || val === undefined || val === '') {
        clean[key] = '';
        continue;
      }

      const str = String(val).trim();

      // If it looks like a date or description, don't parse as number
      if (key.toLowerCase().includes('date') ||
        /description|narrative|particular|details/i.test(key) ||
        /^\d{2}[\s-\/]\d{2}[\s-\/]\d{4}/.test(str)) {
        clean[key] = str;
        continue;
      }

      // Safe locale-aware numeric parsing
      const parsed = tryParseNumberLocale(str, format);
      if (parsed !== null) {
        clean[key] = parsed;
      } else {
        clean[key] = str;
      }
    }
    return clean;
  });

  const ws = wb.addWorksheet('Transactions');
  ws.columns = headers.map(h => ({ header: h, key: h, width: Math.max(h.length, 15) }));
  cleanRows.forEach(r => ws.addRow(r));

  // FIX F: RawLines sheet
  if (metadata?.rawLines && Array.isArray(metadata.rawLines)) {
    const rawWs = wb.addWorksheet('RawLines');
    rawWs.columns = [
      { header: 'Page', key: 'Page', width: 8 },
      { header: 'Type', key: 'Type', width: 16 },
      { header: 'Text', key: 'Text', width: 80 },
    ];
    metadata.rawLines.forEach((l: any) => rawWs.addRow({ Page: l.page, Type: l.kind, Text: l.text }));
  }

  // Summary sheet with extraction metadata
  if (metadata) {
    const summary: Record<string, any> = {};
    const conf = metadata.confidence ?? 0;
    summary['Extraction Quality'] = conf > 0.8 ? 'High' : conf > 0.5 ? 'Medium' : 'Low';
    summary['Rows Extracted'] = metadata.rowCount ?? rows.length;
    summary['Pages Processed'] = metadata.pageCount ?? '';
    summary['Columns Found'] = metadata.columnCount ?? headers.length;
    summary['Column Names'] = (metadata.columns || headers).join(', ');
    summary['Extraction Source'] = metadata.source ?? 'text-layer';
    summary['Confidence Score'] = `${Math.round(conf * 100)}%`;

    if (metadata.anomalies && Array.isArray(metadata.anomalies) && metadata.anomalies.length > 0) {
      summary['Anomalies Detected'] = metadata.anomalies.join('; ');
    }

    // Reconciliation metrics (from ExtractionReview export)
    if (metadata.reconciliation) {
      const r = metadata.reconciliation;
      summary['Balance Checks'] = `${r.passed ?? 0} / ${r.checked ?? 0} passed`;
      summary['Balance Mismatches'] = r.mismatches ?? 0;
      summary['Reconciliation Rate'] = r.rate ?? 'N/A';
    }

    const summaryWs = wb.addWorksheet('Summary');
    const keys = Object.keys(summary);
    summaryWs.columns = keys.map(k => ({ header: k, key: k, width: Math.max(k.length, String(summary[k]).length) + 5 }));
    summaryWs.addRow(summary);
  }

  return await toBlob(wb);
}

async function toBlob(wb: Workbook): Promise<Blob> {
  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

/**
 * Download extracted transactions as Excel file
 */
export async function downloadAsExcel(data: any[], filename: string = 'transactions.xlsx', metadata?: any): Promise<void> {
  if (!data || data.length === 0) {
    console.error('No data to export.');
    return;
  }

  const blob = await getExcelBlob(data, metadata);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
