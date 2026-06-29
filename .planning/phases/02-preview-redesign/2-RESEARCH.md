# Phase 2: Preview Redesign - Research

**Researched:** 2026-03-01
**Domain:** React, Data-Grid interaction, File Blob streaming. 
**Confidence:** HIGH

---

## Summary
The current UI for extracted data review attempts to render bounding boxes over PDF images. As discovered in previous iterations ("pasted image UI causes problems"), this is inherently unstable due to DPI/coordinate drift between `pdfjs` coordinates and HTML canvas resolutions. The redesign discards spatial bounding boxes in favor of a Side-by-Side review architecture.

**Primary recommendation:** Replace the bounding box logic with a Split-Pane view. Left side: standard native PDF renderer. Right side: editable HTML/React table with clear mathematical-reconciliation warnings.

## Common Pitfalls

### Pitfall 1: Memory Leaks from Canvas/Blob rendering
**What goes wrong:** Rendering high-res PDF images to a React canvas per-page to draw highlight-boxes bloats the browser memory quickly, especially on 20+ page statements.
**How to avoid:** Use a simple `<object>` or `<iframe>` tag to offload the PDF rendering to the native browser engine.

### Pitfall 2: Uneditable Cell States
**What goes wrong:** Users hover over an extracted element but can't fix minor OCR typos.
**How to avoid:** The resulting `transactions` table must be mapped to state-controlled `input` fields so the user can literally fix the cell before hitting "Save Extraction".

## Architecture Patterns

### Side-by-Side Review
```tsx
<div className="flex h-[80vh]">
  <!-- Left Side: Native Browser PDF View -->
  <div className="w-1/2">
     <object data={pdfUrl} type="application/pdf" className="w-full h-full" />
  </div>

  <!-- Right Side: Editable Data Grid -->
  <div className="w-1/2 overflow-auto">
     <table>
        {transactions.map((tx, idx) => (
           <tr key={idx} className={tx._reconciled ? '' : 'bg-red-50'}>
              <td><input value={tx.Date} /></td>
              ...
           </tr>
        ))}
     </table>
  </div>
</div>
```

## State of the Art
| Old Approach | Current Approach | Impact |
|--------------|------------------|--------|
| Bounding Boxes over Canvas | Native object PDF + Web Table | Dramatically less memory usage, far easier to implement reliably, better user editing experience. |

## Open Questions
1. **Can we highlight the exact row in the native PDF viewer?**
   - *What we know:* Native PDF viewers (like Chrome's) do not expose an API to highlight specific coordinates via JS. 
   - *Recommendation:* Abandon spatial highlighting. The user can simply scroll the PDF visually while comparing against the side-by-side data grid. It's safe, performant, and reliable.