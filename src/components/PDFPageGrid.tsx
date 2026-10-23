import React, { useEffect, useState, useRef } from 'react';
import { openForRead, type OpenedForRead } from '../../services/pdf/intake';
import { Loader2, ArrowLeft, ArrowRight, Layers, CheckCircle } from './ui/Icon';

export interface PDFPageGridProps {
  file: File | null;
  selectedPages?: number[];
  onTogglePage?: (pageNum: number) => void;
  onSelectAll?: () => void;
  onDeselectAll?: () => void;
  onPageClick?: (pageNum: number) => void;
  onReorderPages?: (newPageOrder: number[]) => void;
  selectable?: boolean;
  reorderable?: boolean;
  showControls?: boolean;
  className?: string;
  maxPagesToRender?: number;
}

export const PDFPageGrid: React.FC<PDFPageGridProps> = ({
  file,
  selectedPages = [],
  onTogglePage,
  onSelectAll,
  onDeselectAll,
  onPageClick,
  onReorderPages,
  selectable = true,
  reorderable = false,
  showControls = true,
  className = '',
  maxPagesToRender = 60,
}) => {
  const [totalPages, setTotalPages] = useState<number>(0);
  const [thumbnails, setThumbnails] = useState<Record<number, string>>({});
  const [loadingPages, setLoadingPages] = useState<Record<number, boolean>>({});
  const [pageOrder, setPageOrder] = useState<number[]>([]);
  const [isLoadingDoc, setIsLoadingDoc] = useState<boolean>(false);
  const [docError, setDocError] = useState<string | null>(null);
  const renderTaskRef = useRef<number>(0);

  useEffect(() => {
    if (!file) {
      setTotalPages(0);
      setThumbnails({});
      setPageOrder([]);
      setDocError(null);
      return;
    }

    const currentTaskId = ++renderTaskRef.current;
    let isCancelled = false;
    setIsLoadingDoc(true);
    setDocError(null);
    setThumbnails({});

    (async () => {
      let opened: OpenedForRead | null = null;
      try {
        const arrayBuf = await file.arrayBuffer();
        if (isCancelled || currentTaskId !== renderTaskRef.current) return;

        opened = await openForRead(new Uint8Array(arrayBuf), { operation: 'Loading page previews' });
        const pdfDoc = opened.pdf;
        if (isCancelled || currentTaskId !== renderTaskRef.current) return;

        const count = pdfDoc.numPages;
        setTotalPages(count);
        const initialOrder = Array.from({ length: count }, (_, i) => i + 1);
        setPageOrder(initialOrder);
        setIsLoadingDoc(false);

        const pagesToLoad = Math.min(count, maxPagesToRender);

        for (let p = 1; p <= pagesToLoad; p++) {
          if (isCancelled || currentTaskId !== renderTaskRef.current) return;

          setLoadingPages(prev => ({ ...prev, [p]: true }));
          try {
            const page = await pdfDoc.getPage(p);
            const viewport = page.getViewport({ scale: 0.4 });
            const canvas = document.createElement('canvas');
            const context = canvas.getContext('2d', { willReadFrequently: true });

            if (context) {
              canvas.width = viewport.width;
              canvas.height = viewport.height;
              await page.render({ canvasContext: context, viewport }).promise;
              const dataUrl = canvas.toDataURL('image/jpeg', 0.85);

              if (!isCancelled && currentTaskId === renderTaskRef.current) {
                setThumbnails(prev => ({ ...prev, [p]: dataUrl }));
              }
            }
          } catch (err: any) {
            console.warn(`Failed rendering thumbnail for page ${p}:`, err);
          } finally {
            if (!isCancelled && currentTaskId === renderTaskRef.current) {
              setLoadingPages(prev => ({ ...prev, [p]: false }));
            }
          }
        }
      } catch (err: any) {
        if (!isCancelled && currentTaskId === renderTaskRef.current) {
          setIsLoadingDoc(false);
          setDocError(err.message || 'Failed to load PDF pages');
        }
      } finally {
        await opened?.release();
      }
    })();

    return () => {
      isCancelled = true;
    };
  }, [file, maxPagesToRender]);

  const handleMovePage = (index: number, direction: 'left' | 'right') => {
    const targetIndex = direction === 'left' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= pageOrder.length) return;

    const newOrder = [...pageOrder];
    const temp = newOrder[index];
    newOrder[index] = newOrder[targetIndex];
    newOrder[targetIndex] = temp;

    setPageOrder(newOrder);
    onReorderPages?.(newOrder);
  };

  const isPageSelected = (pageNum: number) => selectedPages.includes(pageNum);

  const handleToggle = (pageNum: number) => {
    if (onTogglePage) {
      onTogglePage(pageNum);
    }
  };

  if (!file) {
    return null;
  }

  return (
    <div className={`space-y-4 ${className}`}>
      {/* Controls / Header */}
      {showControls && (
        <div className="flex flex-wrap items-center justify-between gap-3 p-3 bg-slate-50 dark:bg-slate-800/60 rounded-2xl border border-slate-200 dark:border-slate-700">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-brand-600 dark:text-brand-400" />
            <span className="text-xs font-bold text-slate-700 dark:text-slate-200">
              {totalPages} {totalPages === 1 ? 'Page' : 'Pages'}
            </span>
            {selectable && selectedPages.length > 0 && (
              <span className="text-xs font-semibold text-brand-600 dark:text-brand-400 bg-brand-50 dark:bg-brand-950/60 px-2 py-0.5 rounded-full border border-brand-200 dark:border-brand-800">
                {selectedPages.length} selected
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {selectable && (
              <>
                {onSelectAll && (
                  <button
                    type="button"
                    onClick={onSelectAll}
                    className="px-2.5 py-1 text-xs font-bold text-slate-600 dark:text-slate-300 hover:text-brand-600 bg-surface dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg hover:border-brand-300 transition-colors"
                  >
                    Select All
                  </button>
                )}
                {onDeselectAll && (
                  <button
                    type="button"
                    onClick={onDeselectAll}
                    className="px-2.5 py-1 text-xs font-bold text-slate-600 dark:text-slate-300 hover:text-slate-900 bg-surface dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg transition-colors"
                  >
                    Clear Selection
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* Loading / Error States */}
      {isLoadingDoc && (
        <div className="flex items-center justify-center py-12 text-slate-400 dark:text-slate-500">
          <Loader2 className="w-6 h-6 animate-spin mr-2 text-brand-500" />
          <span className="text-xs font-bold">Rendering page previews...</span>
        </div>
      )}

      {docError && (
        <div className="p-4 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-xl text-xs text-amber-700 dark:text-amber-300">
          {docError}
        </div>
      )}

      {/* Thumbnail Grid */}
      {!isLoadingDoc && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3 max-h-[420px] overflow-y-auto p-1 rounded-2xl">
          {pageOrder.map((pageNum, index) => {
            const isSelected = isPageSelected(pageNum);
            const thumb = thumbnails[pageNum];
            const isLoading = loadingPages[pageNum];

            return (
              <div
                key={`page-${pageNum}-${index}`}
                onClick={() => {
                  if (selectable) handleToggle(pageNum);
                  onPageClick?.(pageNum);
                }}
                className={`group relative flex flex-col items-center bg-surface dark:bg-slate-800 rounded-xl border p-2 cursor-pointer transition-all duration-150 shadow-sm hover:shadow-md ${
                  isSelected
                    ? 'border-brand-500 ring-2 ring-brand-500/20 bg-brand-50/20 dark:bg-brand-950/30'
                    : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'
                }`}
              >
                {/* Page Number Badge & Selection Checkbox */}
                <div className="w-full flex items-center justify-between mb-1.5 px-0.5">
                  <span className="text-[10px] font-black text-slate-500 dark:text-slate-400">
                    Page {pageNum}
                  </span>
                  {selectable && (
                    <div
                      className={`w-4 h-4 rounded flex items-center justify-center border transition-colors ${
                        isSelected
                          ? 'bg-brand-600 border-brand-600 text-white'
                          : 'bg-surface dark:bg-slate-700 border-slate-300 dark:border-slate-600'
                      }`}
                    >
                      {isSelected && <CheckCircle className="w-3.5 h-3.5 text-white fill-current" />}
                    </div>
                  )}
                </div>

                {/* Thumbnail Canvas / Image */}
                <div className="relative w-full aspect-[3/4] bg-slate-100 dark:bg-slate-900 rounded-lg overflow-hidden flex items-center justify-center border border-slate-100 dark:border-slate-800">
                  {thumb ? (
                    <img
                      src={thumb}
                      alt={`Page ${pageNum}`}
                      className="w-full h-full object-contain pointer-events-none"
                    />
                  ) : isLoading ? (
                    <Loader2 className="w-4 h-4 animate-spin text-slate-400" />
                  ) : (
                    <span className="text-[10px] font-bold text-slate-400">Page {pageNum}</span>
                  )}
                </div>

                {/* Reorder Buttons */}
                {reorderable && (
                  <div className="flex items-center justify-between w-full mt-2 pt-1 border-t border-slate-100 dark:border-slate-700/60" onClick={e => e.stopPropagation()}>
                    <button
                      type="button"
                      disabled={index === 0}
                      onClick={() => handleMovePage(index, 'left')}
                      className="p-1 rounded text-slate-400 hover:text-brand-600 disabled:opacity-20 disabled:hover:text-slate-400"
                      title="Move left"
                    >
                      <ArrowLeft className="w-3 h-3" />
                    </button>
                    <span className="text-[9px] font-bold text-slate-400">#{index + 1}</span>
                    <button
                      type="button"
                      disabled={index === pageOrder.length - 1}
                      onClick={() => handleMovePage(index, 'right')}
                      className="p-1 rounded text-slate-400 hover:text-brand-600 disabled:opacity-20 disabled:hover:text-slate-400"
                      title="Move right"
                    >
                      <ArrowRight className="w-3 h-3" />
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default PDFPageGrid;
