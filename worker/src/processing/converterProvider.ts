/**
 * Batch 09 — Cloud conversion provider abstraction (local scaffold).
 *
 * Office→PDF, advanced PDF→Office, PDF/A, and form/edit/sign converters need a real
 * conversion engine (LibreOffice headless, the Docling service, or a commercial API). None
 * is bundled, and "legally usable + pinned" engine selection is a deployment/cost decision.
 * This module defines the CONTRACT and the job catalog so the integration is explicit and
 * testable at the seam; it does NOT pretend a provider exists.
 *
 * Everything that requires an actual engine is gated behind a configured provider and
 * throws a typed, actionable error otherwise — so a missing provider fails loudly rather
 * than returning a corrupt file. See docs/audit/baseline.md for the unavailable checks.
 */

export type ConversionJob =
  | 'office-to-pdf'
  | 'pdf-to-office-advanced'   // preserves headings/columns beyond the in-browser basic path
  | 'pdf-to-pdfa'              // archival PDF/A-1b/2b
  | 'pdf-forms'               // AcroForm create/fill
  | 'pdf-sign'                // digital sign
  | 'pdf-edit';               // content edit

export interface ConversionRequest {
  job: ConversionJob;
  inputBytes: ArrayBuffer;
  inputMime: string;
  options?: Record<string, unknown>;
  /** private-upload lease id; the object must be scheduled for deletion after the job. */
  leaseId?: string;
}

export interface ConversionResult {
  bytes: Uint8Array;
  mime: string;
  engine: string;
  engineVersion: string;
}

export interface ConversionProvider {
  name: string;
  supports(job: ConversionJob): boolean;
  convert(req: ConversionRequest): Promise<ConversionResult>;
}

/** The set of jobs and which provider category is expected to serve each. */
export const CONVERSION_JOBS: Record<ConversionJob, { needs: string; inBrowser: boolean }> = {
  'office-to-pdf':          { needs: 'libreoffice|commercial', inBrowser: false },
  'pdf-to-office-advanced': { needs: 'libreoffice|docling',    inBrowser: false },
  'pdf-to-pdfa':            { needs: 'ghostscript|verapdf',    inBrowser: false },
  'pdf-forms':              { needs: 'pdf-lib(basic)|commercial', inBrowser: true },
  'pdf-sign':               { needs: 'signing-service',        inBrowser: false },
  'pdf-edit':               { needs: 'commercial|qpdf+manual', inBrowser: false },
};

/**
 * A provider registry. In production a real provider is registered by the deployment;
 * locally none is, so convert() throws a clear NOT_CONFIGURED rather than failing silently.
 */
export class ConversionRegistry {
  private providers: ConversionProvider[] = [];
  register(p: ConversionProvider) { this.providers.push(p); }
  providerFor(job: ConversionJob): ConversionProvider | null {
    return this.providers.find(p => p.supports(job)) ?? null;
  }
  async convert(req: ConversionRequest): Promise<ConversionResult> {
    const p = this.providerFor(req.job);
    if (!p) {
      throw Object.assign(
        new Error(`No conversion provider configured for '${req.job}' (needs: ${CONVERSION_JOBS[req.job].needs}).`),
        { code: 'NOT_CONFIGURED', job: req.job }
      );
    }
    return p.convert(req);
  }
}

/** Singleton used by the Worker handler once a provider is wired at deploy time. */
export const conversionRegistry = new ConversionRegistry();
