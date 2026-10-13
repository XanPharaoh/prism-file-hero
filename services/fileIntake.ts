import type { ToolHandler } from '../src/types';

const MAX_FILE_SIZE = 50 * 1024 * 1024;

/** Page count of a PDF, 0 for anything pdfjs cannot open or for non-PDF input. */
export async function countPdfPages(file: File): Promise<number> {
  if (file.type !== 'application/pdf') return 0;
  try {
    const pdfjsLib = await import('pdfjs-dist');
    const arrayBuf = await file.arrayBuffer();
    const pdfDoc = await pdfjsLib.getDocument({ data: arrayBuf }).promise;
    return pdfDoc.numPages;
  } catch {
    return 0;
  }
}

export interface FileIntake {
  accepted: File[];
  pages: number;
  warnings: string[];
}

/**
 * Single intake path for every entry point (workspace dropzone and tool landing page).
 * The page total it returns is what the quota gate bills AI work against, so an entry
 * point that skipped it would both show "0 pages" and under-report usage.
 */
export async function intakeFiles(
  tool: ToolHandler,
  files: File[],
  currentBatchSize: number
): Promise<FileIntake> {
  const warnings: string[] = [];

  const typed = files.filter((file) => tool.allowedFileTypes.includes(file.type));
  if (typed.length !== files.length) warnings.push(`Some files are not supported by ${tool.name}.`);

  const sized = typed.filter((file) => file.size <= MAX_FILE_SIZE);
  if (sized.length !== typed.length) warnings.push('Some files exceed the 50MB limit.');

  const remainingSlots = tool.maxFiles > 0 ? Math.max(0, tool.maxFiles - currentBatchSize) : Infinity;
  const accepted = sized.slice(0, remainingSlots);
  if (accepted.length !== sized.length) {
    warnings.push(`${tool.name} accepts a maximum of ${tool.maxFiles} file${tool.maxFiles === 1 ? '' : 's'}.`);
  }

  let pages = 0;
  for (const file of accepted) pages += await countPdfPages(file);

  return { accepted, pages, warnings };
}
