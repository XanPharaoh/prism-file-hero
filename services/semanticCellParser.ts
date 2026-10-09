/**
 * SEMANTIC CELL PARSER
 * Uses LLM to clean and map the raw 2D matrix into structured JSON objects.
 * Processes in chunks to prevent token-limit truncation and hallucinations.
 */

import type { DocumentType } from './extractionPipeline';
import { getAuthToken } from './authService';
import { isInternalDesktopDistribution } from '../src/config/distribution';
import { getInternalAiHeaders } from './internalDeviceAuth';
import { WORKER_BASE_URL } from './apiConfig';
const CHUNK_SIZE = 40; // Process 40 rows at a time

async function getAiHeaders(): Promise<Record<string, string>> {
  if (isInternalDesktopDistribution) {
    return getInternalAiHeaders();
  }

  const token = await getAuthToken();
  if (!token) {
    throw new Error('Sign in required for premium AI extraction.');
  }

  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

export async function parseMatrixWithLLM(
  matrix: string[][], 
  headers: string[],
  docType: DocumentType
): Promise<Record<string, any>[]> {
  if (matrix.length === 0) return [];

  const allParsedRows: Record<string, any>[] = [];
  const schema = getTargetSchema(docType);

  // Chunk the matrix to guarantee we never hit LLM output token limits
  for (let i = 0; i < matrix.length; i += CHUNK_SIZE) {
    const chunk = matrix.slice(i, i + CHUNK_SIZE);
    
    // Format as CSV for maximum token efficiency
    const csvData = [
      headers.join(','),
      ...chunk.map(row => row.map(cell => `"${(cell || '').replace(/"/g, '""')}"`).join(','))
    ].join('\n');

    const prompt = `
      You are an enterprise data normalization engine. 
      I have extracted a raw CSV table from a ${docType}.
      Your job is NOT to invent data, but to map these raw columns to a strict JSON schema.
      
      RAW CSV DATA:
      ${csvData}
      
      TARGET JSON SCHEMA:
      ${schema}
      
      INSTRUCTIONS:
      1. Map the CSV columns to the JSON schema based on semantic meaning.
      2. Clean dates to YYYY-MM-DD. Clean currency to raw numbers (no symbols).
      3. If a required field is missing in the CSV, use null.
      4. Return ONLY a valid JSON array of objects. No markdown, no explanations.
    `;
    
    try {
      const response = await fetch(`${WORKER_BASE_URL}/api/ai`, {
        method: 'POST',
        headers: await getAiHeaders(),
        body: JSON.stringify({
          toolId: 'pdf-to-excel',
          messages: [{ role: 'user', content: prompt }],
          options: { docType, temperature: 0.1 } // Low temperature for strict formatting
        }),
      });
      
      // Network/non-OK response: fall back to offline mapping instead of dumping raw rows
      if (!response.ok) {
        throw new Error(`LLM worker returned ${response.status}`);
      }

      const data = await response.json();
      const text = data.choices?.[0]?.message?.content || '';
      
      if (!text || !text.trim()) {
        throw new Error('LLM returned empty content');
      }

      // Strip markdown code blocks if the LLM adds them anyway
      const cleanJson = text.replace(/```json\n?|\n?```/g, '').trim();
      const parsedChunk = JSON.parse(cleanJson);
      
      if (Array.isArray(parsedChunk)) {
        allParsedRows.push(...parsedChunk);
      } else {
        throw new Error('LLM did not return a JSON array');
      }
    } catch (error) {
      console.warn(`LLM parse failed for chunk ${i / CHUNK_SIZE}, using offline mapping:`, error);
      // Robust offline fallback: map columns by semantic type detection and
      // clean values locally. Produces structured output without an LLM.
      const offlineRows = mapMatrixOffline(chunk, headers, docType);
      allParsedRows.push(...offlineRows);
    }
  }
  
  return allParsedRows;
}

/**
 * Offline schema mapping — used when the LLM worker is unavailable.
 * Detects column types by inspecting cell contents (date / money / text) and
 * maps each row to the target schema for the document type, with local
 * value cleaning (Cr/Dr suffixes, R prefix, date normalization).
 */
function mapMatrixOffline(
  matrix: string[][],
  headers: string[],
  docType: DocumentType
): Record<string, any>[] {
  if (matrix.length === 0) return [];

  // 1. Determine the semantic type of each column by sampling cell contents.
  const colCount = headers.length;
  const columnTypes: ('date' | 'money' | 'description' | 'unknown')[] = [];

  // First pass: try to classify columns from header names
  for (let c = 0; c < colCount; c++) {
    const headerName = (headers[c] || '').toLowerCase();
    if (/date|day|datum/.test(headerName)) { columnTypes[c] = 'date'; continue; }
    if (/debit|withdrawal|out/.test(headerName)) { columnTypes[c] = 'money'; continue; }
    if (/credit|deposit|in/.test(headerName)) { columnTypes[c] = 'money'; continue; }
    if (/amount|bedrag/.test(headerName)) { columnTypes[c] = 'money'; continue; }
    if (/balance|saldo/.test(headerName)) { columnTypes[c] = 'money'; continue; }
    if (/charge|fee/.test(headerName)) { columnTypes[c] = 'money'; continue; }
    if (/description|narrative|detail|particulars|desc/.test(headerName)) { columnTypes[c] = 'description'; continue; }
    columnTypes[c] = 'unknown';
  }

  // Second pass: classify remaining "unknown" columns by sampling data cells
  for (let c = 0; c < colCount; c++) {
    if (columnTypes[c] !== 'unknown') continue;
    let moneyHits = 0, dateHits = 0, textHits = 0, total = 0;
    for (const row of matrix) {
      const cell = (row[c] || '').trim();
      if (!cell) continue;
      total++;
      if (isMoneyCell(cell)) moneyHits++;
      else if (isDateCell(cell)) dateHits++;
      else textHits++;
    }
    if (total === 0) { columnTypes[c] = 'description'; continue; }
    if (moneyHits / total > 0.5) columnTypes[c] = 'money';
    else if (dateHits / total > 0.5) columnTypes[c] = 'date';
    else columnTypes[c] = 'description';
  }

  // 2. Build the target schema and map each row
  const schemaFields = getSchemaFields(docType);
  const result: Record<string, any>[] = [];

  for (const row of matrix) {
    const obj: Record<string, any> = {};
    // Initialize all schema fields to null
    for (const f of schemaFields) obj[f] = null;

    // Collect money values in column order (for Amount/Balance/Debit/Credit/Charges)
    const moneyValues: { value: number; raw: string; col: number }[] = [];
    let descriptionParts: string[] = [];
    let dateValue: string | null = null;

    for (let c = 0; c < colCount; c++) {
      const cell = (row[c] || '').trim();
      if (!cell) continue;

      if (columnTypes[c] === 'date') {
        if (!dateValue) dateValue = normalizeDate(cell);
      } else if (columnTypes[c] === 'money') {
        const parsed = parseMoneyOffline(cell);
        if (parsed.value !== null) moneyValues.push({ ...parsed, col: c });
      } else {
        // description / unknown
        descriptionParts.push(cell);
      }
    }

    // Assign to schema based on doc type
    if (docType === 'bank-statement') {
      obj['Date'] = dateValue;
      obj['Description'] = descriptionParts.join(' ').trim() || null;
      // Money column ordering: typically Amount first, then Balance
      // If a Cr suffix is present, treat as Credit; Dr suffix as Debit
      assignBankMoney(obj, moneyValues, row, columnTypes, headers);
    } else if (docType === 'invoice' || docType === 'receipt') {
      obj['Description'] = descriptionParts.join(' ').trim() || null;
      if (moneyValues.length >= 1) obj['Total'] = moneyValues[moneyValues.length - 1].value;
      if (moneyValues.length >= 2) obj['UnitPrice'] = moneyValues[0].value;
    } else {
      // Generic: keep original column values
      headers.forEach((h, idx) => { obj[h || `Field${idx + 1}`] = row[idx] || ''; });
    }

    // Skip rows that are entirely empty after mapping
    const hasAnyValue = Object.values(obj).some(v => v !== null && v !== '' && !(typeof v === 'number' && Number.isNaN(v)));
    if (hasAnyValue) result.push(obj);
  }

  return result;
}

function getSchemaFields(docType: DocumentType): string[] {
  switch (docType) {
    case 'bank-statement': return ['Date', 'Description', 'Debit', 'Credit', 'Amount', 'Balance'];
    case 'invoice': return ['Description', 'Quantity', 'UnitPrice', 'Total'];
    case 'receipt': return ['Item', 'Qty', 'Price', 'Total'];
    default: return ['Field1', 'Field2', 'Field3'];
  }
}

function isMoneyCell(cell: string): boolean {
  const clean = cell.replace(/[R$€£¥\s\*]/g, '');
  return /^-?[\d,]+(\.\d{1,2})?(Cr|Dr|CR|DR)?$/i.test(clean) && /\d/.test(cell);
}

function isDateCell(cell: string): boolean {
  return /^\d{1,2}[-\/.]\d{1,2}([-\/.]\d{2,4})?$/.test(cell) ||
         /^\d{4}[-\/.]\d{1,2}[-\/.]\d{1,2}$/.test(cell) ||
         /^\d{1,2}\s+[A-Za-z]{3,}/.test(cell) ||
         /^[A-Za-z]{3,}\s+\d{1,2}/.test(cell);
}

function parseMoneyOffline(raw: string): { value: number | null; raw: string } {
  if (!raw) return { value: null, raw };
  let clean = String(raw).trim().replace(/\*/g, '').replace(/^R\s*/i, '');
  if (!clean) return { value: null, raw };

  let isNegative = false;
  if (clean.startsWith('(') && clean.endsWith(')')) {
    isNegative = true;
    clean = clean.substring(1, clean.length - 1);
  }
  const lower = clean.toLowerCase();
  if (lower.endsWith('dr')) { isNegative = true; clean = clean.slice(0, -2).trim(); }
  else if (lower.endsWith('cr')) { isNegative = false; clean = clean.slice(0, -2).trim(); }

  // Locale-aware number normalization.
  // Strategy: if the rightmost separator is a comma, it's the decimal separator
  // (European: 1.234,56). Otherwise the dot is decimal (US/SA: 1,234.56).
  const lastComma = clean.lastIndexOf(',');
  const lastDot = clean.lastIndexOf('.');
  let normalized: string;
  if (lastComma > lastDot) {
    // Comma is decimal (European): remove dots, replace comma with dot
    normalized = clean.replace(/\./g, '').replace(',', '.');
  } else if (lastDot > lastComma) {
    // Dot is decimal (US/SA): remove commas
    normalized = clean.replace(/,/g, '');
  } else if (lastComma > -1) {
    // Only comma: if 2 digits after → decimal, else → thousands
    const afterComma = clean.substring(lastComma + 1);
    normalized = afterComma.length === 2 ? clean.replace(/,/g, '.') : clean.replace(/,/g, '');
  } else {
    normalized = clean;
  }

  const num = parseFloat(normalized);
  if (isNaN(num)) return { value: null, raw };
  return { value: isNegative ? -Math.abs(num) : Math.abs(num), raw };
}

function normalizeDate(raw: string): string {
  const s = raw.trim();
  // "DD MMM" or "DD MMM YYYY" (e.g. "15 Jan", "15 Jan 2026")
  const dmy = s.match(/^(\d{1,2})\s+([A-Za-z]{3,})\s*(\d{4})?$/);
  if (dmy) {
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const mIdx = months.findIndex(m => m.toLowerCase() === dmy[2].toLowerCase().substring(0, 3));
    const year = dmy[3] || new Date().getFullYear();
    if (mIdx >= 0) {
      return `${year}-${String(mIdx + 1).padStart(2, '0')}-${String(dmy[1]).padStart(2, '0')}`;
    }
  }
  // "DD/MM/YYYY" or "DD-MM-YYYY"
  const slash = s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2,4})$/);
  if (slash) {
    let year = slash[3];
    if (year.length === 2) year = '20' + year;
    return `${year}-${slash[2].padStart(2, '0')}-${slash[1].padStart(2, '0')}`;
  }
  // Already ISO or unparseable — return as-is
  return s;
}

function assignBankMoney(
  obj: Record<string, any>,
  moneyValues: { value: number; raw: string; col: number }[],
  row: string[],
  columnTypes: ('date' | 'money' | 'description' | 'unknown')[],
  headers: string[]
): void {
  if (moneyValues.length === 0) return;

  // If any money cell had an explicit Cr/Dr suffix, use it to set Debit/Credit
  const withSuffix = moneyValues.filter(mv => /cr|dr/i.test(mv.raw));
  const lastIdx = moneyValues.length - 1;

  if (withSuffix.length > 0) {
    // Use the suffix-bearing cell as the Amount
    const amountCell = withSuffix[0];
    const absVal = Math.abs(amountCell.value);
    if (amountCell.value < 0) {
      obj['Debit'] = absVal;
      obj['Amount'] = -absVal;
    } else {
      obj['Credit'] = absVal;
      obj['Amount'] = absVal;
    }
    // Balance is typically the last money value that isn't the amount cell
    const balanceCell = moneyValues.find((mv, i) => i !== moneyValues.indexOf(amountCell));
    if (balanceCell) obj['Balance'] = Math.abs(balanceCell.value);
  } else {
    // No explicit suffix: first money value = Amount, last = Balance
    obj['Amount'] = moneyValues[0].value;
    if (moneyValues.length >= 2) {
      obj['Balance'] = Math.abs(moneyValues[lastIdx].value);
    }
    // Infer direction from header name if available
    const amountColIdx = moneyValues[0].col;
    const headerName = (headers[amountColIdx] || '').toLowerCase();
    if (/debit|withdrawal/.test(headerName)) { obj['Debit'] = Math.abs(moneyValues[0].value); }
    else if (/credit|deposit/.test(headerName)) { obj['Credit'] = Math.abs(moneyValues[0].value); }
  }
}

function getTargetSchema(docType: DocumentType): string {
  switch(docType) {
    case 'bank-statement': 
      return `[ { "Date": "YYYY-MM-DD", "Description": "string", "Debit": "number|null", "Credit": "number|null", "Balance": "number|null" } ]`;
    case 'invoice': 
      return `[ { "Description": "string", "Quantity": "number", "UnitPrice": "number", "Total": "number" } ]`;
    case 'receipt': 
      return `[ { "Item": "string", "Qty": "number", "Price": "number", "Total": "number" } ]`;
    default: 
      return `[ { "Field1": "string", "Field2": "string", "Field3": "string" } ]`;
  }
}
