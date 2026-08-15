import * as pdfjsLib from 'pdfjs-dist';
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import 'pdfjs-dist/build/pdf.worker.mjs';

// Loading the worker module registers PDF.js's supported in-process handler.
// This avoids browser worker failures while retaining PDF.js decryption/text mapping.
// Vite also emits the matching worker asset for consumers that require a worker URL.
if (typeof window !== 'undefined' && typeof import.meta !== 'undefined' && !import.meta.env?.TEST && typeof workerSrc === 'string') {
  pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;
}

export { pdfjsLib };
