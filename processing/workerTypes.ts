// Local mirror of the Worker's conversion contract so the Node jobs service (processing/)
// does not import from the Worker runtime bundle (worker/src, which can't spawn processes).
// Kept structurally in sync with worker/src/processing/converterProvider.ts.
export type ConversionJob =
  | 'office-to-pdf' | 'pdf-to-office-advanced' | 'pdf-to-pdfa' | 'pdf-forms' | 'pdf-sign' | 'pdf-edit';
export interface ConversionRequest {
  job: ConversionJob;
  inputBytes: ArrayBuffer;
  inputMime: string;
  options?: Record<string, unknown>;
  leaseId?: string;
}
export interface ConversionResult { bytes: Uint8Array; mime: string; engine: string; engineVersion: string; }
export interface ConversionProvider {
  name: string;
  supports(job: ConversionJob): boolean;
  convert(req: ConversionRequest): Promise<ConversionResult>;
}
