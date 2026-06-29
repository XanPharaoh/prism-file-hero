import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as pdfjsLib from 'pdfjs-dist';

const isTauri = typeof window !== 'undefined' && (window as any).__TAURI__ !== undefined;

pdfjsLib.GlobalWorkerOptions.workerSrc = isTauri
  ? 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.worker.min.mjs'
  : new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();

type Props = {
  url: string;
};

export default function PdfViewer({ url }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [pdf, setPdf] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [scale, setScale] = useState(1.2);
  const [rendering, setRendering] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const renderTaskRef = useRef<any>(null);

  // Load PDF document
  useEffect(() => {
    let cancelled = false;
    const loadPdf = async () => {
      try {
        const doc = await pdfjsLib.getDocument(url).promise;
        if (!cancelled) {
          setPdf(doc);
          setTotalPages(doc.numPages);
          setCurrentPage(1);
        }
      } catch (err) {
        console.error('Failed to load PDF:', err);
      }
    };
    loadPdf();
    return () => {
      cancelled = true;
    };
  }, [url]);

  // Render current page to canvas
  const renderPage = useCallback(async () => {
    if (!pdf || !canvasRef.current) return;
    if (rendering) return;

    // Cancel any in-progress render
    if (renderTaskRef.current) {
      try { renderTaskRef.current.cancel(); } catch {}
    }

    setRendering(true);
    try {
      const page = await pdf.getPage(currentPage);
      const viewport = page.getViewport({ scale });
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      canvas.height = viewport.height;
      canvas.width = viewport.width;

      const task = page.render({ canvasContext: ctx, viewport });
      renderTaskRef.current = task;
      await task.promise;
    } catch (err: any) {
      if (err?.name !== 'RenderingCancelledException') {
        console.error('Render error:', err);
      }
    } finally {
      setRendering(false);
    }
  }, [pdf, currentPage, scale, rendering]);

  useEffect(() => {
    renderPage();
  }, [pdf, currentPage, scale]);

  const goToPrevPage = () => setCurrentPage((p) => Math.max(1, p - 1));
  const goToNextPage = () => setCurrentPage((p) => Math.min(totalPages, p + 1));
  const zoomIn = () => setScale((s) => Math.min(3, +(s + 0.2).toFixed(1)));
  const zoomOut = () => setScale((s) => Math.max(0.4, +(s - 0.2).toFixed(1)));

  if (totalPages === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">
        Loading PDF...
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Controls */}
      <div className="flex-none flex items-center justify-between px-3 py-1.5 bg-slate-50 border-b border-slate-200 text-xs">
        <div className="flex items-center gap-1">
          <button onClick={goToPrevPage} disabled={currentPage <= 1} className="px-2 py-1 bg-white border border-slate-200 rounded font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-40 transition-all">←</button>
          <span className="font-semibold text-slate-600 px-2">{currentPage} / {totalPages}</span>
          <button onClick={goToNextPage} disabled={currentPage >= totalPages} className="px-2 py-1 bg-white border border-slate-200 rounded font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-40 transition-all">→</button>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={zoomOut} className="px-2 py-1 bg-white border border-slate-200 rounded font-semibold text-slate-600 hover:bg-slate-100 transition-all">−</button>
          <span className="font-semibold text-slate-500 w-12 text-center">{Math.round(scale * 100)}%</span>
          <button onClick={zoomIn} className="px-2 py-1 bg-white border border-slate-200 rounded font-semibold text-slate-600 hover:bg-slate-100 transition-all">+</button>
        </div>
      </div>
      {/* Canvas area */}
      <div ref={containerRef} className="flex-1 overflow-auto bg-slate-200 flex justify-center p-4">
        <canvas ref={canvasRef} className="shadow-lg bg-white" />
      </div>
    </div>
  );
}
