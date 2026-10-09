import { describe, it, expect } from 'vitest';
import {
  makeCoverage,
  assertCoverageComplete,
  parseTablePayload,
  parseRedactPayload,
  parseTextPayload,
  extractJson,
  pairCompareManifest,
  AiContractError,
  type AiResult,
} from '../shared/ai/aiContract';

describe('AI coverage contract (no silent truncation)', () => {
  it('labels a full run complete', () => {
    const c = makeCoverage(3, 3, []);
    expect(c.status).toBe('complete');
    const res: AiResult = { toolId: 'ocr', coverage: c, payload: { kind: 'text', text: 'hi' } };
    expect(() => assertCoverageComplete(res)).not.toThrow();
  });
  it('labels a middle-batch failure partial and lists the missing pages', () => {
    const missing = [{ doc: 'A', page: 2 }];
    const c = makeCoverage(3, 2, missing);
    expect(c.status).toBe('partial');
    const res: AiResult = { toolId: 'ocr', coverage: c, payload: { kind: 'text', text: 'partial' } };
    expect(() => assertCoverageComplete(res)).toThrowError(AiContractError);
  });
  it('labels zero processed as failed', () => {
    expect(makeCoverage(2, 0, [{ doc: 'A', page: 1 }, { doc: 'A', page: 2 }]).status).toBe('failed');
  });
});

describe('structured parsers reject empty/malformed', () => {
  it('table: valid rows pass, empty/malformed throw', () => {
    expect(parseTablePayload({ rows: [{ a: 1 }], document_metadata: { x: 1 } }).rows).toHaveLength(1);
    expect(parseTablePayload({ rows: [] }).rows).toHaveLength(0); // empty ledger is valid
    expect(() => parseTablePayload('not json')).toThrowError(AiContractError);
    expect(() => parseTablePayload({ nothing: true })).toThrowError(/rows\[\]/i);
  });
  it('redact: regions array required', () => {
    expect(parseRedactPayload({ regions: [{ page: 1, text: 'x', category: 'Email', x: 0, y: 0, width: 1, height: 1 }] }).regions).toHaveLength(1);
    expect(parseRedactPayload({ regions: [] }).regions).toHaveLength(0); // no PII found is valid
    expect(() => parseRedactPayload({ nope: 1 })).toThrowError(/regions\[\]/i);
  });
  it('text: empty and non-string rejected', () => {
    expect(parseTextPayload('hello').text).toBe('hello');
    expect(() => parseTextPayload('   ')).toThrowError(/empty/i);
    expect(() => parseTextPayload({ text: '   ' })).toThrowError(/empty/i);
  });
  it('extractJson handles fenced and prefixed replies', () => {
    expect(extractJson('```json\n{"rows":[1]}\n```')).toEqual({ rows: [1] });
    expect(extractJson('Here you go: {"rows":[]}')).toEqual({ rows: [] });
    expect(() => extractJson('totally plain text')).toThrowError(AiContractError);
  });
});

describe('compare pairing (BUG: batches contained only one document)', () => {
  it('pairs A_n with B_n so every request has both docs', () => {
    const A = [{ doc: 'A', page: 1 }, { doc: 'A', page: 2 }, { doc: 'A', page: 3 }];
    const B = [{ doc: 'B', page: 1 }, { doc: 'B', page: 2 }];
    const pairs = pairCompareManifest(A, B);
    expect(pairs.length).toBe(2); // page 3 has no B counterpart -> not comparable
    expect(pairs[0].map(p => p.doc)).toEqual(['A', 'B']);
    expect(pairs[1].map(p => p.page)).toEqual([2, 2]);
  });
});
