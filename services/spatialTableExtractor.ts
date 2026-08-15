/**
 * Shared geometry-first table alignment engine. Every input uses normalized,
 * top-left page-relative coordinates so PDF text and OCR boxes share one grid.
 */

import * as pdfjs from 'pdfjs-dist';
import type { DocumentType } from './extractionPipeline';
import {
  type CoordinateConvention,
  type NormalizedRect,
  type PdfRect,
  pdfRectToNormalized,
} from './pdfCoordinateAdapter';

export interface BoundingBox extends NormalizedRect {}

export interface SpatialTextItem {
  str: string;
  bbox: BoundingBox;
  page: number;
  rectPdf?: PdfRect;
}

export interface AlignedCell {
  page: number;
  row: number;
  column: number;
  value: string;
  items: SpatialTextItem[];
}

export interface TableAlignmentPage {
  page: number;
  rectPdf: PdfRect;
  rows: string[][];
  cells: AlignedCell[];
}

export interface TableAlignmentResult {
  coordinateSource: 'text-layer' | 'ocr';
  coordinateConvention: CoordinateConvention;
  sourceItems: SpatialTextItem[];
  dividers: number[];
  pages: TableAlignmentPage[];
  rows: string[][];
  headers: string[];
  confidence: number;
  diagnostics: string[];
  templateFingerprint?: string;
}

const HEADER_KEYWORDS = [
  'date', 'description', 'details', 'narrative', 'transaction', 'amount',
  'balance', 'debit', 'credit', 'withdrawal', 'deposit', 'money in',
  'money out', 'charges', 'fees', 'reference', 'value date', 'posting date',
];
const FOOTER_KEYWORDS = [
  'closing balance', 'total', 'sum', 'page ', 'statement period',
  'end of statement', 'brought forward', 'carried forward', 'continue',
];

/** Extract text geometry through the page viewport instead of raw transforms. */
export async function extractSpatialAlignment(file: File): Promise<TableAlignmentResult> {
  const bytes = await file.arrayBuffer();
  // @ts-expect-error PDF.js accepts browser ArrayBuffer data.
  const pdf = await pdfjs.getDocument({ data: bytes }).promise;
  const items: SpatialTextItem[] = [];
  const pageRects = new Map<number, PdfRect>();
  let rotation = 0;

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1, rotation: page.rotate });
    rotation = viewport.rotation;
    const [x0, y0, x1, y1] = page.view;
    pageRects.set(pageNumber, { x: x0, y: y0, width: x1 - x0, height: y1 - y0 });
    const content = await page.getTextContent();
    for (const raw of content.items as Array<any>) {
      if (!raw.str || !raw.str.trim()) continue;
      const height = Math.abs(raw.height || raw.transform?.[3] || 10);
      const rectPdf = {
        x: raw.transform[4],
        y: raw.transform[5] - height,
        width: Math.abs(raw.width || 0),
        height,
      };
      items.push({
        str: raw.str.trim(),
        bbox: pdfRectToNormalized(viewport, rectPdf),
        rectPdf,
        page: pageNumber,
      });
    }
  }

  if (!items.length) throw new Error('No text items found in PDF');
  const result = alignSpatialItems(items, {
    coordinateSource: 'text-layer',
    pageRects,
    rotation,
  });
  result.templateFingerprint = await fingerprintTemplate(result.headers, result.dividers);
  return result;
}

export function alignSpatialItems(
  sourceItems: SpatialTextItem[],
  options: {
    coordinateSource: 'text-layer' | 'ocr';
    pageRects?: Map<number, PdfRect>;
    rotation?: number;
    dividers?: number[];
  },
): TableAlignmentResult {
  if (!sourceItems.length) throw new Error('No spatial text items available');
  const diagnostics: string[] = [];
  const rowsByPage = clusterRows(sourceItems);
  const allRows = Array.from(rowsByPage.values()).flat();
  const ledgerRows = isolateLedgerRows(allRows);
  if (!ledgerRows.length) diagnostics.push('No transaction-like ledger zone was detected.');

  const ledgerItems = ledgerRows.flat();
  const dividers = sanitizeDividers(options.dividers ?? discoverColumnBoundaries(ledgerItems, 1));
  if (dividers.length < 3) diagnostics.push('Fewer than two data columns were inferred.');

  const assignedRows = ledgerRows.map((row) => ({ row, cells: assignCells([row], dividers)[0] }));
  const pages = new Map<number, TableAlignmentPage>();
  const matrix: string[][] = [];
  assignedRows.forEach(({ row, cells }, rowIndex) => {
    const page = row[0].page;
    const pageResult = pages.get(page) ?? {
      page,
      rectPdf: options.pageRects?.get(page) ?? { x: 0, y: 0, width: 1, height: 1 },
      rows: [],
      cells: [],
    };
    pageResult.rows.push(cells);
    row.forEach((item) => {
      const column = columnForItem(item, dividers);
      const existing = pageResult.cells.find((cell) => cell.row === rowIndex && cell.column === column);
      if (existing) {
        existing.items.push(item);
        existing.value = `${existing.value} ${item.str}`.trim();
      } else {
        pageResult.cells.push({ page, row: rowIndex, column, value: item.str, items: [item] });
      }
    });
    pages.set(page, pageResult);
    matrix.push(cells);
  });

  const merged = mergeMultiLineRows(matrix);
  const { headers, dataMatrix } = isolateLedgerData(merged);
  const confidence = computeSpatialConfidence(dataMatrix, headers, dividers);
  if (confidence < 0.75) diagnostics.push(`Geometry confidence is ${(confidence * 100).toFixed(0)}%, below the review threshold.`);
  if (!headers.length || getHeaderScore(headers) < 2) diagnostics.push('Column headers were inferred weakly.');

  return {
    coordinateSource: options.coordinateSource,
    coordinateConvention: { version: 1, space: 'page-relative-top-left', rotation: options.rotation ?? 0 },
    sourceItems,
    dividers,
    pages: Array.from(pages.values()).sort((a, b) => a.page - b.page),
    rows: dataMatrix,
    headers,
    confidence,
    diagnostics,
  };
}

export function recomputeTableAlignment(result: TableAlignmentResult, dividers: number[]): TableAlignmentResult {
  const pageRects = new Map(result.pages.map((page) => [page.page, page.rectPdf]));
  const recomputed = alignSpatialItems(result.sourceItems, {
    coordinateSource: result.coordinateSource,
    pageRects,
    rotation: result.coordinateConvention.rotation,
    dividers,
  });
  recomputed.templateFingerprint = result.templateFingerprint;
  return recomputed;
}

export function alignmentToRows(result: TableAlignmentResult): Record<string, string>[] {
  const headers = result.headers.map((header, index) => header.trim() || `Column ${index + 1}`);
  return result.rows.map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ''])));
}

/** Compatibility wrapper retained for the universal pipeline. */
export async function extractSpatialMatrix(
  file: File,
  _docType: DocumentType,
): Promise<{ matrix: string[][]; headers: string[]; confidence: number }> {
  const result = await extractSpatialAlignment(file);
  return { matrix: result.rows, headers: result.headers, confidence: result.confidence };
}

function clusterRows(items: SpatialTextItem[]): Map<number, SpatialTextItem[][]> {
  const byPage = new Map<number, SpatialTextItem[]>();
  for (const item of items) byPage.set(item.page, [...(byPage.get(item.page) ?? []), item]);
  const rowsByPage = new Map<number, SpatialTextItem[][]>();
  for (const [page, pageItems] of byPage) {
    const sorted = [...pageItems].sort((a, b) => a.bbox.y - b.bbox.y || a.bbox.x - b.bbox.x);
    const rows: SpatialTextItem[][] = [];
    let current: SpatialTextItem[] = [];
    let baseline = 0;
    for (const item of sorted) {
      const tolerance = Math.max(0.006, median([...current.map((entry) => entry.bbox.height), item.bbox.height]) * 0.7);
      if (!current.length || Math.abs(item.bbox.y - baseline) <= tolerance) {
        current.push(item);
        baseline = current.reduce((sum, entry) => sum + entry.bbox.y, 0) / current.length;
      } else {
        rows.push(current.sort((a, b) => a.bbox.x - b.bbox.x));
        current = [item];
        baseline = item.bbox.y;
      }
    }
    if (current.length) rows.push(current.sort((a, b) => a.bbox.x - b.bbox.x));
    rowsByPage.set(page, rows);
  }
  return rowsByPage;
}

function isolateLedgerRows(rows: SpatialTextItem[][]): SpatialTextItem[][] {
  if (!rows.length) return [];
  const candidates = rows.filter((row) => {
    const text = row.map((item) => item.str).join(' ').toLowerCase();
    return !FOOTER_KEYWORDS.some((keyword) => text.includes(keyword) && !hasDate(text));
  });
  const scored = candidates.map((row) => {
    const text = row.map((item) => item.str).join(' ').toLowerCase();
    return { row, score: (hasDate(text) ? 3 : 0) + (hasMoney(text) ? 2 : 0) + getHeaderScore([text]) };
  });
  const transactionRows = scored.filter((entry) => entry.score >= 2).map((entry) => entry.row);
  return transactionRows.length ? transactionRows : candidates;
}

function isolateLedgerData(matrix: string[][]): { headers: string[]; dataMatrix: string[][] } {
  if (!matrix.length) return { headers: [], dataMatrix: [] };
  const firstRows = matrix.slice(0, 15);
  const headerOffset = firstRows.reduce((best, row, index) => getHeaderScore(row) > getHeaderScore(firstRows[best] ?? []) ? index : best, 0);
  const headers = matrix[headerOffset] ?? matrix[0];
  const dataMatrix = matrix.slice(headerOffset + 1).filter((row) => {
    const text = row.join(' ').toLowerCase();
    return row.some(Boolean) && !(getHeaderScore(row) >= 3 && !hasMoney(text)) && !(FOOTER_KEYWORDS.some((keyword) => text.includes(keyword)) && !hasDate(text));
  });
  return { headers, dataMatrix };
}

function getHeaderScore(row: string[]): number {
  const text = row.join(' ').toLowerCase();
  return HEADER_KEYWORDS.filter((keyword) => text.includes(keyword)).length;
}

function hasDate(text: string): boolean {
  return /\d{1,2}[-/]\d{1,2}(?:[-/]\d{2,4})?|\d{4}[-/]\d{2}[-/]\d{2}|\d{1,2}\s+[a-z]{3}\b/i.test(text);
}

function hasMoney(text: string): boolean {
  return /(?:[R$£€]\s*)?\d{1,3}(?:[ ,.]\d{3})*[.,]\d{2}/.test(text);
}

function computeSpatialConfidence(dataMatrix: string[][], headers: string[], dividers: number[]): number {
  if (!dataMatrix.length) return 0;
  const columnCount = Math.max(1, dividers.length - 1);
  const populated = new Set<number>();
  let complete = 0;
  let moneyRows = 0;
  for (const row of dataMatrix) {
    row.forEach((cell, index) => { if (cell.trim()) populated.add(index); });
    if (row.filter((cell) => cell.trim()).length >= Math.min(3, columnCount)) complete++;
    if (hasMoney(row.join(' '))) moneyRows++;
  }
  const score =
    Math.min(1, populated.size / Math.max(2, columnCount)) * 0.3 +
    (getHeaderScore(headers) >= 2 ? 1 : 0) * 0.2 +
    (complete / dataMatrix.length) * 0.25 +
    (moneyRows / dataMatrix.length) * 0.25;
  return Math.min(0.95, Math.round(score * 100) / 100);
}

export function discoverColumnBoundaries(items: SpatialTextItem[], pageWidth: number): number[] {
  if (!items.length || pageWidth <= 0) return [0, pageWidth || 1];
  const resolution = pageWidth <= 1 ? 0.01 : 5;
  const bins = Math.max(1, Math.ceil(pageWidth / resolution));
  const profile = new Array<number>(bins).fill(0);
  for (const item of items) {
    const start = Math.max(0, Math.floor(item.bbox.x / resolution));
    const end = Math.min(bins - 1, Math.floor((item.bbox.x + item.bbox.width) / resolution));
    for (let index = start; index <= end; index++) profile[index]++;
  }
  const medianDensity = median(profile) || 1;
  const threshold = Math.max(1, medianDensity * 0.3);
  const boundaries = [0];
  let gapStart: number | null = null;
  for (let index = 0; index <= bins; index++) {
    const empty = index < bins && profile[index] <= threshold;
    if (empty && gapStart === null) gapStart = index;
    if (!empty && gapStart !== null) {
      if ((index - gapStart) * resolution >= (pageWidth <= 1 ? 0.025 : 15)) boundaries.push((gapStart + index) * resolution / 2);
      gapStart = null;
    }
  }
  boundaries.push(pageWidth);
  return sanitizeDividers(boundaries);
}

export function assignCells(rows: SpatialTextItem[][], dividers: number[]): string[][] {
  return rows.map((row) => {
    const cells = new Array(Math.max(0, dividers.length - 1)).fill('');
    for (const item of row) {
      const column = columnForItem(item, dividers);
      cells[column] = `${cells[column]} ${item.str}`.trim();
    }
    return cells;
  });
}

function columnForItem(item: SpatialTextItem, dividers: number[]): number {
  const center = item.bbox.x + item.bbox.width / 2;
  for (let index = 0; index < dividers.length - 1; index++) {
    if (center >= dividers[index] && center < dividers[index + 1]) return index;
  }
  return center < dividers[0] ? 0 : Math.max(0, dividers.length - 2);
}

export function mergeMultiLineRows(matrix: string[][]): string[][] {
  if (!matrix.length) return [];
  const merged: string[][] = [matrix[0]];
  for (const row of matrix.slice(1)) {
    const current = merged[merged.length - 1];
    const populated = row.map((cell, index) => cell.trim() ? index : -1).filter((index) => index >= 0);
    const isDatedTransaction = row.some((cell) => hasDate(cell));
    if (populated.length && !isDatedTransaction && !row[0]?.trim() && populated.every((index) => index > 0 && index < row.length - 1)) {
      populated.forEach((index) => { current[index] = `${current[index]} ${row[index]}`.trim(); });
    } else {
      merged.push(row);
    }
  }
  return merged;
}

function sanitizeDividers(dividers: number[]): number[] {
  return Array.from(new Set(dividers.map((value) => Math.max(0, Math.min(1, value))).sort((a, b) => a - b)))
    .filter((value, index, values) => index === 0 || value - values[index - 1] >= 0.02);
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

async function fingerprintTemplate(headers: string[], dividers: number[]): Promise<string> {
  const source = `${headers.map((header) => header.toLowerCase().replace(/\s+/g, ' ').trim()).join('|')}|${dividers.map((divider) => divider.toFixed(3)).join('|')}`;
  const bytes = new TextEncoder().encode(source);
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest)).map((value) => value.toString(16).padStart(2, '0')).join('');
  }
  return Array.from(bytes).reduce((hash, value) => ((hash << 5) - hash + value) | 0, 0).toString(16);
}
