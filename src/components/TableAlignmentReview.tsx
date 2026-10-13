import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { TableAlignmentResult } from '../../services/spatialTableExtractor';
import { recomputeTableAlignment } from '../../services/spatialTableExtractor';
import { loadDividerTemplate, saveDividerTemplate } from '../../services/alignmentTemplateStore';

type Props = {
  alignment: TableAlignmentResult;
  sourceFile: File | null;
  canPassReview: boolean;
  onRecompute: (result: TableAlignmentResult, passed: boolean) => void;
  onConfirm: () => void;
};

export default function TableAlignmentReview({ alignment, sourceFile, canPassReview, onRecompute, onConfirm }: Props) {
  const [page, setPage] = useState(alignment.pages[0]?.page ?? 1);
  const [dividers, setDividers] = useState(alignment.dividers);
  const [dragging, setDragging] = useState<number | null>(null);
  const [savedTemplate, setSavedTemplate] = useState(false);
  const surface = useRef<HTMLDivElement>(null);
  const sourceUrl = useMemo(() => sourceFile ? URL.createObjectURL(sourceFile) : null, [sourceFile]);

  useEffect(() => () => { if (sourceUrl) URL.revokeObjectURL(sourceUrl); }, [sourceUrl]);
  useEffect(() => {
    setDividers(alignment.dividers);
    setPage(alignment.pages[0]?.page ?? 1);
  }, [alignment]);
  useEffect(() => {
    if (alignment.coordinateSource !== 'text-layer' || !alignment.templateFingerprint) return;
    void loadDividerTemplate(alignment.templateFingerprint).then((template) => {
      if (template?.dividers?.length) {
        setDividers(template.dividers);
        setSavedTemplate(true);
      }
    });
  }, [alignment.coordinateSource, alignment.templateFingerprint]);

  useEffect(() => {
    if (dragging === null) return;
    const move = (event: PointerEvent) => {
      const bounds = surface.current?.getBoundingClientRect();
      if (!bounds) return;
      const lower = dividers[dragging - 1] + 0.02;
      const upper = dividers[dragging + 1] - 0.02;
      const value = Math.max(lower, Math.min(upper, (event.clientX - bounds.left) / bounds.width));
      setDividers((current) => current.map((divider, index) => index === dragging ? value : divider));
    };
    const stop = () => setDragging(null);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop, { once: true });
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
    };
  }, [dragging, dividers]);

  async function recompute() {
    const updated = recomputeTableAlignment(alignment, dividers);
    if (updated.coordinateSource === 'text-layer' && alignment.templateFingerprint) {
      await saveDividerTemplate({
        fingerprint: alignment.templateFingerprint,
        dividers,
        coordinateConvention: updated.coordinateConvention,
        updatedAt: new Date().toISOString(),
      });
    }
    // A grid that recomputes above the threshold can be exported without an
    // additional acknowledgement. Reconciliation failures still require it.
    onRecompute(updated, canPassReview && updated.confidence >= 0.75);
  }

  const currentPage = alignment.pages.find((entry) => entry.page === page);
  return (
    <section className="rounded-[32px] border border-amber-200 bg-amber-50/60 p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <h2 className="text-lg font-black text-slate-900">Check inferred table columns</h2>
          <p className="text-xs font-semibold text-slate-600 mt-1">
            Export is paused because this extraction needs review. Drag dividers, then recompute the grid.
          </p>
          {alignment.diagnostics.map((reason) => <p key={reason} className="text-xs text-amber-800 mt-1">{reason}</p>)}
        </div>
        <div className="flex gap-2">
          <button onClick={() => setDividers(alignment.dividers)} className="px-3 py-2 text-xs font-bold rounded-lg border border-slate-300 bg-surface">Reset</button>
          <button onClick={recompute} className="px-3 py-2 text-xs font-bold rounded-lg bg-brand-600 text-white">Recompute grid</button>
          <button onClick={onConfirm} className="px-3 py-2 text-xs font-bold rounded-lg bg-amber-600 text-white">Export with warning</button>
        </div>
      </div>
      <div className="flex gap-2 mb-3 text-xs font-bold text-slate-600">
        {alignment.pages.map((entry) => <button key={entry.page} onClick={() => setPage(entry.page)} className={`px-2 py-1 rounded ${page === entry.page ? 'bg-slate-900 text-white' : 'bg-surface border border-slate-200'}`}>Page {entry.page}</button>)}
        {savedTemplate && <span className="self-center text-emerald-700">Saved text-layout correction loaded</span>}
      </div>
      <div ref={surface} className="relative overflow-hidden rounded-xl bg-slate-200 aspect-[0.72] max-h-[650px]">
        {sourceUrl ? <iframe title={`Source PDF page ${page}`} src={`${sourceUrl}#page=${page}&zoom=page-width`} className="absolute inset-0 w-full h-full pointer-events-none bg-surface" /> : <div className="p-6 text-sm text-slate-600">Source PDF is no longer available. Re-upload to adjust columns.</div>}
        {currentPage && dividers.slice(1, -1).map((divider, index) => {
          const dividerIndex = index + 1;
          return <button key={dividerIndex} aria-label={`Column divider ${dividerIndex}`} onPointerDown={(event) => { event.preventDefault(); setDragging(dividerIndex); }} style={{ left: `${divider * 100}%` }} className="absolute top-0 bottom-0 w-3 -ml-1.5 cursor-col-resize bg-brand-500/50 hover:bg-brand-600 border-x border-hairline" />;
        })}
      </div>
    </section>
  );
}
