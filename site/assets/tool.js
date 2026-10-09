/* Prism File Hero: per-tool runtime. Renders a working in-browser tool for the
   client-side-capable tools and an honest "runs in the app" panel for the rest.
   Lazy-loads pdf-lib, pdf.js and jszip only when a tool needs them. */
(function () {
  "use strict";

  var B = (document.body.getAttribute("data-base")) || "";
  var PDFLIB = B + "assets/vendor/pdf-lib.min.js";
  var PDFLIB_SRI = "sha384-weMABwrltA6jWR8DDe9Jp5blk+tZQh7ugpCsF3JwSA53WZM9/14PjS5LAJNHNjAI";

  function loadScript(src, integrity) {
    return new Promise(function (res, rej) {
      var s = document.createElement("script");
      s.src = src; if (integrity) { s.integrity = integrity; s.crossOrigin = "anonymous"; }
      s.onload = res; s.onerror = function () { rej(new Error("load failed: " + src)); };
      document.head.appendChild(s);
    });
  }
  var libP = null;
  function pdfLib() { if (!libP) libP = window.PDFLib ? Promise.resolve(window.PDFLib) : loadScript(PDFLIB, PDFLIB_SRI).then(function () { return window.PDFLib; }); return libP; }
  var pdfjsP = null;
  function pdfJs() {
    if (!pdfjsP) pdfjsP = import(B + "assets/vendor/pdf/pdf.min.mjs").then(function (m) {
      m.GlobalWorkerOptions.workerSrc = B + "assets/vendor/pdf/pdf.worker.min.mjs";
      return m;
    });
    return pdfjsP;
  }
  var zipP = null;
  function jszip() { if (!zipP) zipP = window.JSZip ? Promise.resolve(window.JSZip) : loadScript(B + "assets/vendor/jszip.min.js").then(function () { return window.JSZip; }); return zipP; }
  var docxP = null;
  function docxLib() { if (!docxP) docxP = window.docx ? Promise.resolve(window.docx) : loadScript(B + "assets/vendor/docx.umd.min.js").then(function () { return window.docx; }); return docxP; }
  var excelP = null;
  function excelLib() { if (!excelP) excelP = window.ExcelJS ? Promise.resolve(window.ExcelJS) : loadScript(B + "assets/vendor/exceljs.min.js").then(function () { return window.ExcelJS; }); return excelP; }
  var encP = null;
  function pdfEncrypt() { if (!encP) encP = import(B + "assets/vendor/pdfencrypt/pdf-encrypt.mjs").then(function (m) { return m.encryptPDF; }); return encP; }
  var tessP = null;
  function tessLib() { if (!tessP) tessP = window.Tesseract ? Promise.resolve(window.Tesseract) : loadScript(B + "assets/vendor/tesseract.min.js").then(function () { return window.Tesseract; }); return tessP; }

  function bytes(file) { return file.arrayBuffer().then(function (b) { return new Uint8Array(b); }); }
  function canvasJpeg(page, scale, quality) {
    var vp = page.getViewport({ scale: scale || 1.5 });
    var c = document.createElement("canvas"); c.width = vp.width; c.height = vp.height;
    return page.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise.then(function () {
      return new Promise(function (r) { c.toBlob(function (b) { r(b); }, "image/jpeg", quality || 0.85); });
    });
  }
  function parseRange(str, max) {
    var out = [];
    (str || "").split(",").forEach(function (part) {
      part = part.trim(); if (!part) return;
      var m = part.match(/^(\d+)\s*-\s*(\d+)$/);
      if (m) { for (var i = +m[1]; i <= +m[2]; i++) if (i >= 1 && i <= max) out.push(i - 1); }
      else if (/^\d+$/.test(part)) { if (+part >= 1 && +part <= max) out.push(+part - 1); }
    });
    return out;
  }

  // Each runner: fn(files, opts) -> Promise<[{blob, name}]>
  var TOOLS = {
    "merge-pdf": { accept: ".pdf,application/pdf", multi: true, min: 2,
      run: function (f) { return pdfLib().then(function (L) {
        return Promise.all(f.map(function (x) { return bytes(x).then(function (b) { return L.PDFDocument.load(b, { ignoreEncryption: true }); }); }))
          .then(function (docs) { return L.PDFDocument.create().then(function (out) {
            return docs.reduce(function (p, d) { return p.then(function () { return out.copyPages(d, d.getPageIndices()).then(function (ps) { ps.forEach(function (pg) { out.addPage(pg); }); }); }); }, Promise.resolve())
              .then(function () { return out.save(); }).then(function (b) { return [{ blob: new Blob([b], { type: "application/pdf" }), name: "merged.pdf" }]; });
          }); });
      }); } },
    "split-pdf": { accept: ".pdf,application/pdf", multi: false, min: 1,
      opts: [{ key: "range", label: "Pages to extract", type: "text", def: "1", hint: "e.g. 1-3, 5, 8-10" }],
      run: function (f, o) { return pdfLib().then(function (L) {
        return bytes(f[0]).then(function (b) { return L.PDFDocument.load(b, { ignoreEncryption: true }); }).then(function (src) {
          var idx = parseRange(o.range, src.getPageCount()); if (!idx.length) idx = [0];
          return L.PDFDocument.create().then(function (out) {
            return out.copyPages(src, idx).then(function (ps) { ps.forEach(function (p) { out.addPage(p); }); return out.save(); })
              .then(function (b) { return [{ blob: new Blob([b], { type: "application/pdf" }), name: "extracted.pdf" }]; });
          });
        });
      }); } },
    "rotate-pdf": { accept: ".pdf,application/pdf", multi: false, min: 1,
      opts: [{ key: "angle", label: "Turn", type: "select", def: "90", choices: [["90", "90°"], ["180", "180°"], ["270", "270°"]] }],
      run: function (f, o) { return pdfLib().then(function (L) {
        return bytes(f[0]).then(function (b) { return L.PDFDocument.load(b, { ignoreEncryption: true }); }).then(function (d) {
          var a = +o.angle; d.getPages().forEach(function (p) { p.setRotation(L.degrees((p.getRotation().angle + a) % 360)); });
          return d.save().then(function (b2) { return [{ blob: new Blob([b2], { type: "application/pdf" }), name: "rotated.pdf" }]; });
        });
      }); } },
    "jpg-to-pdf": { accept: ".jpg,.jpeg,.png,image/jpeg,image/png", multi: true, min: 1,
      run: function (f) { return pdfLib().then(function (L) {
        return L.PDFDocument.create().then(function (out) {
          return f.reduce(function (p, file) { return p.then(function () { return bytes(file).then(function (b) {
            var embed = /\.png$/i.test(file.name) || file.type === "image/png" ? out.embedPng(b) : out.embedJpg(b);
            return embed.then(function (e) { var pg = out.addPage([e.width, e.height]); pg.drawImage(e, { x: 0, y: 0, width: e.width, height: e.height }); });
          }); }); }, Promise.resolve()).then(function () { return out.save(); })
            .then(function (b) { return [{ blob: new Blob([b], { type: "application/pdf" }), name: "images.pdf" }]; });
        });
      }); } },
    "pdf-to-jpg": { accept: ".pdf,application/pdf", multi: false, min: 1,
      run: function (f) { return Promise.all([pdfJs(), jszip()]).then(function (r) {
        var js = r[0], Z = r[1]; return bytes(f[0]).then(function (b) { return js.getDocument({ data: b }).promise; }).then(function (doc) {
          var zip = new Z(); var seq = Promise.resolve();
          for (var n = 1; n <= doc.numPages; n++) (function (n) {
            seq = seq.then(function () { return doc.getPage(n).then(function (p) { return canvasJpeg(p, 2, 0.9).then(function (blob) { zip.file("page-" + n + ".jpg", blob); }); }); });
          })(n);
          return seq.then(function () { return zip.generateAsync({ type: "blob" }); }).then(function (z) { return [{ blob: z, name: "pages.zip" }]; });
        });
      }); } },
    "pdf-to-plain-text": { accept: ".pdf,application/pdf", multi: false, min: 1,
      run: function (f) { return pdfJs().then(function (js) {
        return bytes(f[0]).then(function (b) { return js.getDocument({ data: b }).promise; }).then(function (doc) {
          var text = "", n = 1;
          function page() { if (n > doc.numPages) return Promise.resolve(); return doc.getPage(n++).then(function (p) { return p.getTextContent(); }).then(function (tc) { text += tc.items.map(function (i) { return i.str; }).join(" ") + "\n\n"; return page(); }); }
          return page().then(function () { return [{ blob: new Blob([text.trim()], { type: "text/plain" }), name: "text.txt" }]; });
        });
      }); } },
    "edit-metadata": { accept: ".pdf,application/pdf", multi: false, min: 1,
      run: function (f) { return pdfLib().then(function (L) {
        return bytes(f[0]).then(function (b) { return L.PDFDocument.load(b, { ignoreEncryption: true }); }).then(function (d) {
          ["setTitle", "setAuthor", "setSubject", "setProducer", "setCreator"].forEach(function (m) { try { d[m](undefined); } catch (e) {} });
          try { d.setKeywords([]); } catch (e) {}
          return d.save().then(function (b2) { return [{ blob: new Blob([b2], { type: "application/pdf" }), name: "clean.pdf" }]; });
        });
      }); } },
    "compress-pdf": { accept: ".pdf,application/pdf", multi: false, min: 1,
      opts: [{ key: "quality", label: "Quality", type: "select", def: "0.6", choices: [["0.75", "High"], ["0.6", "Balanced"], ["0.4", "Small"]] }],
      run: function (f, o) { return Promise.all([pdfJs(), pdfLib()]).then(function (r) {
        var js = r[0], L = r[1];
        return bytes(f[0]).then(function (b) { return js.getDocument({ data: b }).promise; }).then(function (doc) {
          return L.PDFDocument.create().then(function (out) {
            var seq = Promise.resolve();
            for (var n = 1; n <= doc.numPages; n++) (function (n) {
              seq = seq.then(function () { return doc.getPage(n).then(function (p) { var vp = p.getViewport({ scale: 1.4 }); return canvasJpeg(p, 1.4, +o.quality).then(function (blob) { return blob.arrayBuffer(); }).then(function (ab) { return out.embedJpg(new Uint8Array(ab)).then(function (e) { var pg = out.addPage([vp.width, vp.height]); pg.drawImage(e, { x: 0, y: 0, width: vp.width, height: vp.height }); }); }); }); });
            })(n);
            return seq.then(function () { return out.save(); }).then(function (b2) { return [{ blob: new Blob([b2], { type: "application/pdf" }), name: "compressed.pdf" }]; });
          });
        });
      }); } }
  };

  function el(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }

  // Second wave: the remaining client-side-capable tools (Organize, Optimize, Convert).
  function toPdf(b, name) { return [{ blob: new Blob([b], { type: "application/pdf" }), name: name }]; }
  function loadPdf(f) { return pdfLib().then(function (L) { return bytes(f).then(function (b) { return L.PDFDocument.load(b, { ignoreEncryption: true }).then(function (d) { return { L: L, d: d, b: b }; }); }); }); }
  Object.assign(TOOLS, {
    "add-page-numbers": { accept: ".pdf,application/pdf", multi: false, min: 1,
      run: function (f) { return loadPdf(f[0]).then(function (r) { var ps = r.d.getPages(); ps.forEach(function (p, i) { p.drawText(String(i + 1), { x: p.getSize().width / 2 - 8, y: 16, size: 11 }); }); return r.d.save().then(function (b) { return toPdf(b, "numbered.pdf"); }); }); } },
    "header-and-footer": { accept: ".pdf,application/pdf", multi: false, min: 1,
      opts: [{ key: "text", label: "Header text", type: "text", def: "Prism File Hero" }],
      run: function (f, o) { return loadPdf(f[0]).then(function (r) { var ps = r.d.getPages(), n = ps.length, txt = o.text || " "; ps.forEach(function (p, i) { var w = p.getSize().width, h = p.getSize().height; p.drawText(txt, { x: w / 2 - txt.length * 2.6, y: h - 20, size: 9 }); p.drawText("Page " + (i + 1) + " of " + n, { x: w / 2 - 20, y: 14, size: 9 }); }); return r.d.save().then(function (b) { return toPdf(b, "stamped.pdf"); }); }); } },
    "watermark": { accept: ".pdf,application/pdf", multi: false, min: 1,
      opts: [{ key: "text", label: "Watermark text", type: "text", def: "DRAFT" }],
      run: function (f, o) { return loadPdf(f[0]).then(function (r) { var t = (o.text || "DRAFT").toUpperCase(); r.d.getPages().forEach(function (p) { var s = p.getSize(); p.drawText(t, { x: s.width / 2 - t.length * 17, y: s.height / 2, size: 54, opacity: 0.16, rotate: r.L.degrees(30) }); }); return r.d.save().then(function (b) { return toPdf(b, "watermarked.pdf"); }); }); } },
    "add-stamp-badge": { accept: ".pdf,application/pdf", multi: false, min: 1,
      opts: [{ key: "word", label: "Stamp", type: "select", def: "APPROVED", choices: [["APPROVED", "Approved"], ["CONFIDENTIAL", "Confidential"], ["PAID", "Paid"], ["DRAFT", "Draft"]] }],
      run: function (f, o) { return loadPdf(f[0]).then(function (r) { var t = o.word || "APPROVED"; r.d.getPages().forEach(function (p) { var s = p.getSize(); p.drawText(t, { x: 40, y: s.height - 90, size: 30, color: r.L.rgb(0.78, 0.06, 0.18), rotate: r.L.degrees(-14) }); }); return r.d.save().then(function (b) { return toPdf(b, "stamped.pdf"); }); }); } },
    "delete-pages": { accept: ".pdf,application/pdf", multi: false, min: 1,
      opts: [{ key: "range", label: "Pages to delete", type: "text", def: "", hint: "e.g. 2, 4-5" }],
      run: function (f, o) { return loadPdf(f[0]).then(function (r) { parseRange(o.range, r.d.getPageCount()).sort(function (a, b) { return b - a; }).forEach(function (i) { r.d.removePage(i); }); return r.d.save().then(function (b) { return toPdf(b, "trimmed.pdf"); }); }); } },
    "extract-pages": { accept: ".pdf,application/pdf", multi: false, min: 1,
      opts: [{ key: "range", label: "Pages to keep", type: "text", def: "1", hint: "e.g. 1-3, 5" }],
      run: function (f, o) { return loadPdf(f[0]).then(function (r) { var idx = parseRange(o.range, r.d.getPageCount()); if (!idx.length) idx = [0]; return r.L.PDFDocument.create().then(function (out) { return out.copyPages(r.d, idx).then(function (ps) { ps.forEach(function (p) { out.addPage(p); }); return out.save(); }).then(function (b) { return toPdf(b, "extracted.pdf"); }); }); }); } },
    "reorder-pages": { accept: ".pdf,application/pdf", multi: false, min: 1,
      opts: [{ key: "order", label: "New order", type: "text", def: "", hint: "e.g. 3,1,2 (blank = reverse)" }],
      run: function (f, o) { return loadPdf(f[0]).then(function (r) { var n = r.d.getPageCount(), idx = o.order && o.order.trim() ? parseRange(o.order, n) : Array.from({ length: n }, function (_, i) { return n - 1 - i; }); if (idx.length !== n) { var seen = {}; idx = idx.filter(function (i) { if (seen[i]) return false; seen[i] = 1; return true; }); for (var i = 0; i < n; i++) if (!seen[i]) idx.push(i); } return r.L.PDFDocument.create().then(function (out) { return out.copyPages(r.d, idx).then(function (ps) { ps.forEach(function (p) { out.addPage(p); }); return out.save(); }).then(function (b) { return toPdf(b, "reordered.pdf"); }); }); }); } },
    "repair-pdf": { accept: ".pdf,application/pdf", multi: false, min: 1,
      run: function (f) { return loadPdf(f[0]).then(function (r) { return r.d.save({ useObjectStreams: false }).then(function (b) { return toPdf(b, "repaired.pdf"); }); }); } },
    "multi-page-layout": { accept: ".pdf,application/pdf", multi: false, min: 1,
      opts: [{ key: "per", label: "Pages per sheet", type: "select", def: "2", choices: [["2", "2-up"], ["4", "4-up"]] }],
      run: function (f, o) { return pdfLib().then(function (L) { return bytes(f[0]).then(function (b) { return L.PDFDocument.load(b, { ignoreEncryption: true }).then(function (src) { var n = src.getPageCount(); return L.PDFDocument.create().then(function (out) { return out.embedPdf(b, Array.from({ length: n }, function (_, i) { return i; })).then(function (emb) { var per = +o.per, W = 595.28, H = 841.89, cols = per === 4 ? 2 : 1, rows = per === 4 ? 2 : 1; for (var s = 0; s < n; s += per) { var sheet = out.addPage([W, H]); for (var k = 0; k < per && (s + k) < n; k++) { var c = k % cols, rw = Math.floor(k / cols), cw = W / cols, ch = H / rows, e = emb[s + k], sc = Math.min(cw / e.width, ch / e.height) * 0.96, dw = e.width * sc, dh = e.height * sc; sheet.drawPage(e, { x: c * cw + (cw - dw) / 2, y: H - (rw + 1) * ch + (ch - dh) / 2, width: dw, height: dh }); } } return out.save(); }).then(function (bb) { return toPdf(bb, "n-up.pdf"); }); }); }); }); }); } },
    "pdf-to-markdown": { accept: ".pdf,application/pdf", multi: false, min: 1,
      run: function (f) { return pdfJs().then(function (js) { return bytes(f[0]).then(function (b) { return js.getDocument({ data: b }).promise; }).then(function (doc) { var md = "", n = 1; function page() { if (n > doc.numPages) return Promise.resolve(); md += "\n\n## Page " + n + "\n\n"; return doc.getPage(n++).then(function (p) { return p.getTextContent(); }).then(function (tc) { md += tc.items.map(function (i) { return i.str; }).join(" ") + "\n"; return page(); }); } return page().then(function () { return [{ blob: new Blob([md.trim() + "\n"], { type: "text/markdown" }), name: "document.md" }]; }); }); }); } }
  });

  // Third wave: completes the Optimize family. crop is pure pdf-lib; the visual
  // tools render each page through pdf.js, filter the pixels, and re-embed as images.
  function invertPixels(d) { for (var i = 0; i < d.length; i += 4) { d[i] = 255 - d[i]; d[i + 1] = 255 - d[i + 1]; d[i + 2] = 255 - d[i + 2]; } }
  function scannerPixels(d) {
    for (var i = 0; i < d.length; i += 4) {
      var g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      var v = g > 190 ? 255 : Math.max(0, Math.min(255, (g - 128) * 1.7 + 128));
      d[i] = d[i + 1] = d[i + 2] = v;
    }
  }
  function renderPageFiltered(doc, n, filter, quality, out, maxW) {
    return doc.getPage(n).then(function (p) {
      var vp0 = p.getViewport({ scale: 1 });
      var sc = Math.min(1, (maxW || 1000) / Math.max(1, vp0.width));
      var vp = p.getViewport({ scale: sc });
      var c = document.createElement("canvas"); c.width = Math.max(1, Math.ceil(vp.width)); c.height = Math.max(1, Math.ceil(vp.height));
      var ctx = c.getContext("2d");
      return p.render({ canvasContext: ctx, viewport: vp }).promise.then(function () {
        if (filter) { var img = ctx.getImageData(0, 0, c.width, c.height); filter(img.data); ctx.putImageData(img, 0, 0); }
        return new Promise(function (rr) { c.toBlob(function (b) { rr(b); }, "image/jpeg", quality || 0.85); });
      }).then(function (blob) { return blob.arrayBuffer(); }).then(function (ab) {
        return out.embedJpg(new Uint8Array(ab)).then(function (e) { var pg = out.addPage([c.width, c.height]); pg.drawImage(e, { x: 0, y: 0, width: c.width, height: c.height }); });
      });
    });
  }
  function renderToImagePdf(f, filter, quality, outName, maxW) {
    return Promise.all([pdfJs(), pdfLib()]).then(function (r) {
      var js = r[0], L = r[1];
      return bytes(f[0]).then(function (b) { return js.getDocument({ data: b }).promise; }).then(function (doc) {
        return L.PDFDocument.create().then(function (out) {
          var seq = Promise.resolve();
          for (var n = 1; n <= doc.numPages; n++) (function (n) { seq = seq.then(function () { return renderPageFiltered(doc, n, filter, quality, out, maxW); }); })(n);
          return seq.then(function () { return out.save(); }).then(function (b) { return toPdf(b, outName); });
        });
      });
    });
  }
  Object.assign(TOOLS, {
    "crop-and-resize": { accept: ".pdf,application/pdf", multi: false, min: 1,
      opts: [{ key: "margin", label: "Trim from each edge", type: "text", def: "36", hint: "points · 72 = 1 inch" }],
      run: function (f, o) { return loadPdf(f[0]).then(function (r) {
        var m = Math.max(0, parseInt(o.margin, 10) || 0);
        r.d.getPages().forEach(function (p) { var bx = p.getMediaBox(), w = bx.width - 2 * m, h = bx.height - 2 * m; if (w <= 0 || h <= 0) return; p.setMediaBox(bx.x + m, bx.y + m, w, h); p.setCropBox(bx.x + m, bx.y + m, w, h); });
        return r.d.save().then(function (b) { return toPdf(b, "cropped.pdf"); }); }); } },
    "invert-colors": { accept: ".pdf,application/pdf", multi: false, min: 1,
      run: function (f) { return renderToImagePdf(f, invertPixels, 0.9, "inverted.pdf", 1000); } },
    "scanner-paper-look": { accept: ".pdf,application/pdf", multi: false, min: 1,
      run: function (f) { return renderToImagePdf(f, scannerPixels, 0.92, "scanned.pdf", 1200); } },
    "remove-blank-pages": { accept: ".pdf,application/pdf", multi: false, min: 1,
      run: function (f) { return Promise.all([pdfJs(), pdfLib()]).then(function (r) {
        var js = r[0], L = r[1], buf, marks;
        return bytes(f[0]).then(function (b) { buf = b; return js.getDocument({ data: b.slice(0) }).promise; }).then(function (doc) {
          marks = new Array(doc.numPages); var seq = Promise.resolve();
          for (var n = 1; n <= doc.numPages; n++) (function (n) {
            seq = seq.then(function () { return doc.getPage(n).then(function (p) {
              var vp0 = p.getViewport({ scale: 1 }), sc = Math.min(1, 500 / Math.max(1, vp0.width)), vp = p.getViewport({ scale: sc });
              var c = document.createElement("canvas"); c.width = Math.max(1, Math.ceil(vp.width)); c.height = Math.max(1, Math.ceil(vp.height));
              var ctx = c.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
              return p.render({ canvasContext: ctx, viewport: vp }).promise.then(function () {
                var d = ctx.getImageData(0, 0, c.width, c.height).data, dark = 0;
                for (var i = 0; i < d.length; i += 4) { if (d[i] < 140 && d[i + 1] < 140 && d[i + 2] < 140 && ++dark > 6) break; }
                marks[n - 1] = dark > 6;
              });
            }); });
          })(n);
          return seq;
        }).then(function () { return L.PDFDocument.load(buf, { ignoreEncryption: true }).then(function (src) {
          var keep = []; for (var i = 0; i < src.getPageCount(); i++) { if (marks[i] !== false) keep.push(i); } if (!keep.length) keep = [0];
          return L.PDFDocument.create().then(function (out) { return out.copyPages(src, keep).then(function (ps) { ps.forEach(function (p) { out.addPage(p); }); return out.save(); }).then(function (b) { return toPdf(b, "no-blanks.pdf"); }); });
        }); });
      }); } }
  });

  // Fourth wave: Security-family tools that run purely on pdf-lib / pdf.js.
  function saveDoc(L, d, name) {
    return d.save({ useObjectStreams: true }).catch(function () {
      var n = d.getPageCount();
      return L.PDFDocument.create().then(function (clean) {
        return clean.copyPages(d, Array.from({ length: n }, function (_, i) { return i; })).then(function (ps) { ps.forEach(function (p) { clean.addPage(p); }); return clean.save({ useObjectStreams: true }); });
      });
    }).then(function (b) { return toPdf(b, name); });
  }
  // pdf.js can decrypt a standard security handler; pdf-lib cannot, so a truly
  // password-locked file is rebuilt as page images (text becomes raster).
  function rasterizeUnlock(js, L, file, pw) {
    return bytes(file).then(function (b) { return js.getDocument(pw ? { data: b, password: pw } : { data: b }).promise; }).then(function (doc) {
      return L.PDFDocument.create().then(function (out) { var seq = Promise.resolve();
        for (var n = 1; n <= doc.numPages; n++) (function (n) { seq = seq.then(function () { return doc.getPage(n).then(function (p) {
          var ov = p.getViewport({ scale: 1 }), vp = p.getViewport({ scale: 2 }); var c = document.createElement("canvas"); c.width = Math.max(1, Math.round(vp.width)); c.height = Math.max(1, Math.round(vp.height)); var ctx = c.getContext("2d");
          return p.render({ canvasContext: ctx, viewport: vp }).promise.then(function () { return new Promise(function (res) { c.toBlob(function (bl) { res(bl); }, "image/jpeg", 0.95); }); }).then(function (bl) { return bl.arrayBuffer(); }).then(function (ab) { return out.embedJpg(new Uint8Array(ab)).then(function (img) { var np = out.addPage([ov.width, ov.height]); np.drawImage(img, { x: 0, y: 0, width: ov.width, height: ov.height }); }); });
        }); }); })(n);
        return seq.then(function () { return out.save({ useObjectStreams: true }); }).then(function (b2) { return toPdf(b2, "unlocked.pdf"); });
      });
    });
  }
  Object.assign(TOOLS, {
    "flatten-pdf": { accept: ".pdf,application/pdf", multi: false, min: 1,
      run: function (f) { return loadPdf(f[0]).then(function (r) { var L = r.L, d = r.d, N = L.PDFName;
        try { d.getForm().flatten(); } catch (e) {}
        try { if (d.catalog.has(N.of("AcroForm"))) d.catalog.delete(N.of("AcroForm")); } catch (e) {}
        d.getPages().forEach(function (page) { try {
          var ref = page.node.get(N.of("Annots")); if (!ref) return; var annots = d.context.lookup(ref);
          if (annots instanceof L.PDFArray) { var keep = []; for (var i = 0; i < annots.size(); i++) { var it = annots.get(i); var dict = d.context.lookup(it);
            if (dict instanceof L.PDFDict) { var st = dict.get(N.of("Subtype")); if (!(st && st.toString() === "/Widget")) keep.push(it); } else keep.push(it); }
            if (!keep.length) page.node.delete(N.of("Annots")); else if (keep.length !== annots.size()) page.node.set(N.of("Annots"), d.context.obj(keep));
          }
        } catch (e) {} });
        return saveDoc(L, d, "flattened.pdf"); }); } },
    "sanitize-pdf": { accept: ".pdf,application/pdf", multi: false, min: 1,
      run: function (f) { return loadPdf(f[0]).then(function (r) { var L = r.L, d = r.d, N = L.PDFName, cat = d.catalog;
        ["OpenAction", "AA", "JavaScript", "JS", "Launch", "URI", "EmbeddedFiles", "AF", "Metadata", "PieceInfo", "SpiderInfo"].forEach(function (k) { try { cat.delete(N.of(k)); } catch (e) {} });
        try { d.getForm().getFields().forEach(function (field) { try { field.acroField.dict.delete(N.of("AA")); field.acroField.dict.delete(N.of("A")); } catch (e) {} }); } catch (e) {}
        try { var nr = cat.get(N.of("Names")); if (nr) { var nd = d.context.lookup(nr); if (nd instanceof L.PDFDict) { nd.delete(N.of("JavaScript")); nd.delete(N.of("EmbeddedFiles")); } cat.delete(N.of("Names")); } } catch (e) {}
        try { d.setTitle(""); d.setAuthor(""); d.setSubject(""); d.setKeywords([]); d.setProducer(""); d.setCreator(""); } catch (e) {}
        d.getPages().forEach(function (page) { try {
          page.node.delete(N.of("AA")); page.node.delete(N.of("AF")); page.node.delete(N.of("Metadata")); page.node.delete(N.of("PieceInfo"));
          var ref = page.node.get(N.of("Annots")); if (!ref) return; var annots = d.context.lookup(ref);
          if (annots instanceof L.PDFArray) { var keep = []; for (var i = 0; i < annots.size(); i++) { var it = annots.get(i); var dict = d.context.lookup(it);
            if (dict instanceof L.PDFDict) { var st = dict.get(N.of("Subtype")), ar = dict.get(N.of("A")), ad = ar ? d.context.lookup(ar) : null, at = (ad instanceof L.PDFDict) && ad.get(N.of("S")) ? ad.get(N.of("S")).toString() : null;
              try { dict.delete(N.of("AA")); if (at === "/JavaScript" || at === "/Launch") dict.delete(N.of("A")); } catch (e) {}
              var isLink = (st && st.toString() === "/Link") || at === "/URI" || at === "/Launch" || at === "/GoToR"; if (isLink) continue;
              keep.push(it);
            } else keep.push(it); }
            if (!keep.length) page.node.delete(N.of("Annots")); else if (keep.length !== annots.size()) page.node.set(N.of("Annots"), d.context.obj(keep));
          }
        } catch (e) {} });
        return saveDoc(L, d, "sanitized.pdf"); }); } },
    "auto-rotate-pages": { accept: ".pdf,application/pdf", multi: false, min: 1,
      run: function (f) { return loadPdf(f[0]).then(function (r) { r.d.getPages().forEach(function (p) { var s = p.getSize(); if (s.width > s.height * 1.1) p.setRotation(r.L.degrees((p.getRotation().angle + 90) % 360)); }); return r.d.save().then(function (b) { return toPdf(b, "auto-rotated.pdf"); }); }); } },
    "unlock-pdf": { accept: ".pdf,application/pdf", multi: false, min: 1,
      opts: [{ key: "password", label: "Password", type: "password", def: "", hint: "blank = open it but it won't let you edit" }],
      run: function (f, o) { var pw = o.password || "";
        return Promise.all([pdfJs(), pdfLib()]).then(function (rr) { var js = rr[0], L = rr[1];
          if (pw) return rasterizeUnlock(js, L, f[0], pw);
          return bytes(f[0]).then(function (b) { return L.PDFDocument.load(b).then(function (d) { return d.save().then(function (bb) { return toPdf(bb, "unlocked.pdf"); }); }); }).catch(function (err) {
            if (err && (/ncrypt/i.test(err.message || "") || /ncrypt/i.test(err.name || ""))) return rasterizeUnlock(js, L, f[0], "");
            throw err; });
        }); } }
  });

  // Fifth wave: extract the actual embedded raster images (not page snapshots).
  function rgbaFromImg(img) {
    var w = img.width, h = img.height, d = img.data;
    if (!d || !w || !h) return null;
    if (d.length === w * h * 4) return new ImageData(new Uint8ClampedArray(d), w, h);
    var out = new Uint8ClampedArray(w * h * 4);
    if (d.length === w * h * 3) { for (var i = 0, j = 0; i < w * h; i++) { out[j++] = d[i * 3]; out[j++] = d[i * 3 + 1]; out[j++] = d[i * 3 + 2]; out[j++] = 255; } return new ImageData(out, w, h); }
    if (d.length === w * h) { for (var i = 0, j = 0; i < w * h; i++) { var g = d[i]; out[j++] = g; out[j++] = g; out[j++] = g; out[j++] = 255; } return new ImageData(out, w, h); }
    return null;
  }
  function imageBlobFromObj(obj) {
    return new Promise(function (res) {
      var c = document.createElement("canvas");
      if (obj.bitmap) { c.width = obj.width; c.height = obj.height; c.getContext("2d").drawImage(obj.bitmap, 0, 0); return c.toBlob(function (b) { res(b); }, "image/png"); }
      var id = rgbaFromImg(obj); if (!id) return res(null);
      c.width = obj.width; c.height = obj.height; c.getContext("2d").putImageData(id, 0, 0); c.toBlob(function (b) { res(b); }, "image/png");
    });
  }
  Object.assign(TOOLS, {
    "extract-images": { accept: ".pdf,application/pdf", multi: false, min: 1,
      run: function (f) { return Promise.all([pdfJs(), jszip()]).then(function (r) { var js = r[0], Z = r[1], OPS = js.OPS;
        return bytes(f[0]).then(function (b) { return js.getDocument({ data: b }).promise; }).then(function (doc) {
          var zip = new Z(), count = 0, seq = Promise.resolve();
          for (var n = 1; n <= doc.numPages; n++) (function (n) { seq = seq.then(function () { return doc.getPage(n).then(function (page) {
            var vp = page.getViewport({ scale: 1 }); var c = document.createElement("canvas"); c.width = Math.max(1, vp.width | 0); c.height = Math.max(1, vp.height | 0);
            // Rendering first forces pdf.js to decode and cache the page's image objects.
            return page.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise.then(function () { return page.getOperatorList(); }).then(function (ol) {
              var chain = Promise.resolve();
              for (var i = 0; i < ol.fnArray.length; i++) (function (fn, args) {
                if (fn === OPS.paintImageXObject && args && args[0] != null) { var name = args[0];
                  chain = chain.then(function () { return new Promise(function (res) { try { page.objs.get(name, function (v) { res(v); }); } catch (e) { res(page.objs.get(name)); } }); })
                    .then(function (obj) { if (!obj) return; return imageBlobFromObj(obj).then(function (bl) { if (bl) zip.file("image-" + String(++count).padStart(3, "0") + ".png", bl); }); });
                }
              })(ol.fnArray[i], ol.argsArray[i]);
              return chain; });
          }); }); })(n);
          return seq.then(function () { return doc.destroy().catch(function () {}); }).then(function () { if (!count) throw new Error("No embedded images found in this PDF"); return zip.generateAsync({ type: "blob" }); }).then(function (z) { return [{ blob: z, name: "images.zip" }]; });
        }); }); } }
  });

  // Sixth wave: Word/Excel output and encryption, reusing the app's libraries.
  Object.assign(TOOLS, {
    "pdf-to-word": { accept: ".pdf,application/pdf", multi: false, min: 1,
      run: function (f) { return Promise.all([pdfJs(), docxLib()]).then(function (r) { var js = r[0], D = r[1];
        return bytes(f[0]).then(function (b) { return js.getDocument({ data: b }).promise; }).then(function (doc) {
          var children = [], n = 1;
          function page() { if (n > doc.numPages) return Promise.resolve(); var i = n++;
            return doc.getPage(i).then(function (p) { return p.getTextContent(); }).then(function (tc) {
              var items = tc.items, lines = [], cur = "", lastY = null;
              items.forEach(function (it) { if (!it || typeof it.str !== "string") return; var y = it.transform ? Math.round(it.transform[5]) : null;
                if (lastY !== null && y !== null && Math.abs(y - lastY) > 4) { if (cur.trim()) lines.push(cur.trim()); cur = it.str; } else cur += (cur ? " " : "") + it.str;
                if (y !== null) lastY = y; if (it.hasEOL) { if (cur.trim()) lines.push(cur.trim()); cur = ""; lastY = null; } });
              if (cur.trim()) lines.push(cur.trim());
              if (doc.numPages > 1) children.push(new D.Paragraph({ text: "Page " + i, heading: D.HeadingLevel.HEADING_2, spacing: { before: 200, after: 100 } }));
              lines.forEach(function (line) { children.push(new D.Paragraph({ children: [new D.TextRun(line)], spacing: { after: 80 } })); });
              return page(); }); }
          return page().then(function () { if (!children.length) children.push(new D.Paragraph({ children: [new D.TextRun("")] }));
            return D.Packer.toBlob(new D.Document({ sections: [{ properties: {}, children: children }] })); }).then(function (blob) { return [{ blob: blob, name: "document.docx" }]; });
        }); }); } },
    "pdf-to-excel": { accept: ".pdf,application/pdf", multi: false, min: 1,
      run: function (f) { return Promise.all([pdfJs(), excelLib()]).then(function (r) { var js = r[0], E = r[1];
        return bytes(f[0]).then(function (b) { return js.getDocument({ data: b }).promise; }).then(function (doc) {
          var wb = new E.Workbook(), any = false, n = 1;
          function page() { if (n > doc.numPages) return Promise.resolve(); var i = n++, ws = wb.addWorksheet("Page " + i);
            return doc.getPage(i).then(function (p) { return p.getTextContent(); }).then(function (tc) {
              var items = (tc.items || []).filter(function (it) { return it && typeof it.str === "string" && it.str.trim(); });
              if (items.length) { var byLine = {}; items.forEach(function (it) { var y = Math.round(it.transform ? it.transform[5] : 0); (byLine[y] = byLine[y] || []).push(it); });
                Object.keys(byLine).map(Number).sort(function (a, b) { return b - a; }).forEach(function (y) { ws.addRow(byLine[y].sort(function (a, b) { return a.transform[4] - b.transform[4]; }).map(function (it) { return it.str.trim(); })); any = true; }); }
              return page(); }); }
          return page().then(function () { if (!any) throw new Error("No text found - scanned pages need OCR in the app"); return wb.xlsx.writeBuffer(); })
            .then(function (buf) { return [{ blob: new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), name: "table.xlsx" }]; });
        }); }); } },
    "protect-pdf": { accept: ".pdf,application/pdf", multi: false, min: 1,
      opts: [{ key: "password", label: "Password", type: "password", def: "", hint: "used to open the file" }],
      run: function (f, o) { var pw = o.password || ""; if (!pw) throw new Error("Enter a password first");
        return Promise.all([pdfEncrypt(), loadPdf(f[0])]).then(function (r) { var encPDF = r[0], rr = r[1];
          return rr.d.save({ useObjectStreams: true }).then(function (bytes) { return encPDF(bytes, pw, pw); }).then(function (out) {
            var u8 = out instanceof Uint8Array ? out : new Uint8Array(out); return [{ blob: new Blob([u8], { type: "application/pdf" }), name: "protected.pdf" }]; }); }); } }
  });

  // Seventh wave: real redaction and the deterministic Ledger Guard, ported from
  // services/reconciliationService.ts + ledgerGuard.ts. Both are pure arithmetic;
  // no libraries beyond pdf.js/pdf-lib and no backend.
  function parseMoney(str) {
    if (typeof str === "number") return str;
    if (!str || typeof str !== "string") return 0;
    var clean = str.replace(/[R$£€\s,]/g, "").replace(/\*/g, "");
    if (clean.startsWith("(") && clean.endsWith(")")) clean = "-" + clean.substring(1, clean.length - 1);
    var neg = false, lower = clean.toLowerCase();
    if (lower.endsWith("dr")) { neg = true; clean = clean.slice(0, -2); }
    else if (lower.endsWith("cr")) { clean = clean.slice(0, -2); }
    else if (clean.startsWith("-")) { neg = true; clean = clean.slice(1); }
    else if (clean.endsWith("-")) { neg = true; clean = clean.slice(0, -1); }
    var num = parseFloat(clean); if (!Number.isFinite(num)) return 0;
    return neg ? -Math.abs(num) : Math.abs(num);
  }
  function normKey(k) { return String(k).toLowerCase().replace(/\(.*?\)/g, "").replace(/[^a-z]/g, ""); }
  function findKey(keys, targets) { return keys.find(function (k) { return targets.indexOf(normKey(k)) >= 0; }) || ""; }
  function nearly(a, b) { return Math.abs(a - b) < 0.02; }
  function isOpeningRow(r) { var t = JSON.stringify(r).toLowerCase(); return t.indexOf("opening") >= 0 || t.indexOf("brought forward") >= 0; }
  function isClosingRow(r) { var t = JSON.stringify(r).toLowerCase(); return t.indexOf("closing") >= 0 || t.indexOf("carried forward") >= 0; }
  function isInfoRow(r) { var t = JSON.stringify(r).toLowerCase(); return t.indexOf("summary") >= 0 || t.indexOf("total charges") >= 0; }
  function reconcileBank(rows, openingStr) {
    var running = parseMoney(openingStr), keys = Object.keys(rows[0]);
    var debitKey = findKey(keys, ["debit", "debits", "debiet", "uit", "withdrawals", "withdrawal"]);
    var creditKey = findKey(keys, ["credit", "credits", "krediet", "deposit", "deposits"]);
    var feeKey = findKey(keys, ["fee", "fees", "charge", "charges"]);
    var amountKey = findKey(keys, ["amount", "geld", "bedrag"]);
    var balanceKey = findKey(keys, ["balance", "saldo"]) || "Balance";
    return rows.map(function (row) {
      var rec = Object.assign({}, row), stated = parseMoney(row[balanceKey] || "0");
      if (isOpeningRow(row) || isClosingRow(row) || isInfoRow(row)) { rec.Amount = 0; rec._math_reconciled = true; rec.Direction = ""; if (stated !== 0) running = stated; return rec; }
      var debit = parseMoney(row[debitKey] || "0"), credit = parseMoney(row[creditKey] || "0"), fee = parseMoney(row[feeKey] || "0"), net = null, ok = false;
      if (debitKey || creditKey) {
        var a1 = +(credit - debit - fee).toFixed(2); if (nearly(running + a1, stated)) { net = a1; ok = true; }
        if (!ok) { var a2 = +(credit - debit).toFixed(2); if (nearly(running + a2, stated)) { net = a2; ok = true; } }
        if (!ok && fee > 0 && debit === 0 && credit === 0) { var a3 = -Math.abs(fee); if (nearly(running + a3, stated)) { net = +a3.toFixed(2); ok = true; } }
      }
      if (!ok && amountKey) { var raw = row[amountKey], signed = /[-(]|\bdr\b|\bcr\b/i.test(String(raw)) || parseMoney(raw) < 0, abs = Math.abs(parseMoney(raw));
        if (signed) net = +(parseMoney(raw) - Math.abs(fee)).toFixed(2); else { var sp = running + abs - Math.abs(fee), sn = running - abs - Math.abs(fee); net = +(((Math.abs(sp - stated) <= Math.abs(sn - stated)) ? +1 : -1) * abs - Math.abs(fee)).toFixed(2); }
        if (net !== null && nearly(running + net, stated)) ok = true; }
      if (!ok || net === null) { net = +(stated - running).toFixed(2); ok = true;
        if (debit > 0 && credit === 0 && net > 0) rec._math_error = "Debit row but balance increased by " + net;
        if (credit > 0 && debit === 0 && net < 0) rec._math_error = "Credit row but balance decreased by " + net; }
      rec.Amount = +net.toFixed(2); rec._math_reconciled = ok; rec.Direction = net >= 0 ? "In" : "Out"; running = stated; return rec;
    });
  }
  function parseCSV(text) {
    text = text.replace(/\r\n?/g, "\n"); var rows = [], row = [], field = "", q = false;
    for (var i = 0; i < text.length; i++) { var ch = text[i];
      if (q) { if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; } else field += ch; }
      else if (ch === '"') q = true;
      else if (ch === ",") { row.push(field); field = ""; }
      else if (ch === "\n") { row.push(field); field = ""; if (row.some(function (x) { return x !== ""; })) rows.push(row); row = []; }
      else field += ch; }
    if (field !== "" || row.length) { row.push(field); if (row.some(function (x) { return x !== ""; })) rows.push(row); }
    if (!rows.length) return []; var hdr = rows[0].map(function (h) { return h.trim(); });
    return rows.slice(1).map(function (r) { var o = {}; hdr.forEach(function (h, idx) { o[h] = r[idx] !== undefined ? r[idx] : ""; }); return o; });
  }
  function toCSV(rows) { if (!rows.length) return ""; var keys = []; rows.forEach(function (r) { Object.keys(r).forEach(function (k) { if (keys.indexOf(k) < 0) keys.push(k); }); }); var esc = function (v) { v = v == null ? "" : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }; return keys.join(",") + "\n" + rows.map(function (r) { return keys.map(function (k) { return esc(r[k]); }).join(","); }).join("\n"); }
  Object.assign(TOOLS, {
    "redact-pdf": { accept: ".pdf,application/pdf", multi: false, min: 1,
      opts: [{ key: "terms", label: "Text to redact", type: "text", def: "", hint: "comma-separated words or phrases" }],
      run: function (f, o) { var terms = (o.terms || "").split(",").map(function (t) { return t.trim().toLowerCase(); }).filter(Boolean);
        if (!terms.length) throw new Error("Enter at least one term to redact");
        return Promise.all([pdfJs(), pdfLib()]).then(function (r) { var js = r[0], L = r[1];
          return bytes(f[0]).then(function (b) { return js.getDocument({ data: b.slice(0) }).promise; }).then(function (doc) {
            return L.PDFDocument.create().then(function (out) { var seq = Promise.resolve(), hits = 0;
              for (var n = 1; n <= doc.numPages; n++) (function (n) { seq = seq.then(function () { return doc.getPage(n).then(function (p) {
                var vp = p.getViewport({ scale: 2 }); var c = document.createElement("canvas"); c.width = Math.max(1, Math.round(vp.width)); c.height = Math.max(1, Math.round(vp.height)); var ctx = c.getContext("2d");
                return p.render({ canvasContext: ctx, viewport: vp }).promise.then(function () { return p.getTextContent(); }).then(function (tc) {
                  tc.items.forEach(function (it) { if (!it || typeof it.str !== "string") return; var s = it.str.toLowerCase();
                    if (!terms.some(function (t) { return s.indexOf(t) >= 0; })) return; hits++;
                    var tx = it.transform[4], ty = it.transform[5], w = it.width || 0, h = it.height || 12, rc = vp.convertToViewportRectangle([tx, ty, tx + w, ty + h]);
                    ctx.fillStyle = "#000"; ctx.fillRect(Math.min(rc[0], rc[2]) - 1, Math.min(rc[1], rc[3]) - 1, Math.abs(rc[2] - rc[0]) + 2, Math.abs(rc[3] - rc[1]) + 2); });
                }).then(function () { return new Promise(function (res) { c.toBlob(function (bl) { res(bl); }, "image/jpeg", 0.9); }); }).then(function (bl) { return bl.arrayBuffer(); }).then(function (ab) { return out.embedJpg(new Uint8Array(ab)).then(function (img) { var np = out.addPage([c.width, c.height]); np.drawImage(img, { x: 0, y: 0, width: c.width, height: c.height }); }); });
              }); }); })(n);
              return seq.then(function () { if (!hits) throw new Error("No matching text found in this PDF"); return out.save({ useObjectStreams: true }); }).then(function (b2) { return toPdf(b2, "redacted.pdf"); }); });
          }); }); } },
    "ledger-guard": { accept: ".csv,text/csv", multi: false, min: 1,
      opts: [{ key: "opening", label: "Opening balance", type: "text", def: "0", hint: "R / currency amount" }],
      run: function (f, o) { return f[0].text().then(function (txt) { var rows = parseCSV(txt); if (!rows.length) throw new Error("CSV is empty");
        var opening = parseMoney(o.opening), rec = reconcileBank(rows, o.opening), balKey = findKey(Object.keys(rows[0]), ["balance", "saldo"]) || "Balance";
        var sum = 0; rec.forEach(function (r) { sum += parseMoney(r.Amount) || 0; });
        var last = rec[rec.length - 1], lastBal = last ? parseMoney(last[balKey]) : opening, expected = +(opening + sum).toFixed(2);
        var lineErrors = rec.filter(function (r) { return r._math_error; }).map(function (r) { return (r.Date ? r.Date + ": " : "") + (r.Description ? r.Description + " - " : "") + r._math_error; });
        var badRows = rec.filter(function (r) { return r._math_reconciled === false || r._math_error; }).length;
        var issues = lineErrors.slice();
        if (Math.abs(expected - lastBal) > 0.05) issues.push("Flow conservation: opening(" + opening.toFixed(2) + ") + sum(" + sum.toFixed(2) + ") = " + expected.toFixed(2) + " but reported closing is " + lastBal.toFixed(2) + ". Diff " + Math.abs(expected - lastBal).toFixed(2));
        var status = "OK"; if (issues.length) { status = "WARN"; var txn = rec.filter(function (r) { return !isOpeningRow(r) && !isClosingRow(r) && !isInfoRow(r); }).length; if (txn > 0 && badRows / txn > 0.3) status = "BLOCKED"; }
        var report = "PRISM LEDGER GUARD\n===================\nStatus: " + status + "\nRows checked: " + rec.length + "\nOpening balance: " + opening.toFixed(2) + "\nSum of movements: " + sum.toFixed(2) + "\nExpected closing: " + expected.toFixed(2) + "\nReported closing: " + lastBal.toFixed(2) + "\nBad rows: " + badRows + "\n\nIssues:\n" + (issues.length ? issues.map(function (i) { return "- " + i; }).join("\n") : "- none, the ledger balances from opening to closing") + "\n";
        return [{ blob: new Blob([report], { type: "text/plain" }), name: "ledger-report.txt" }, { blob: new Blob([toCSV(rec)], { type: "text/csv" }), name: "ledger-annotated.csv" }]; }); } }
  });

  var tessP = null;
  function tessLib() { if (!tessP) tessP = window.Tesseract ? Promise.resolve(window.Tesseract) : loadScript(B + "assets/vendor/tesseract.min.js").then(function () { return window.Tesseract; }); return tessP; }
  function tessWords(data) {
    if (data && data.words && data.words.length) return data.words;
    var ws = [];
    try { (data && data.blocks || []).forEach(function (b) { (b.paragraphs || []).forEach(function (p) { (p.lines || []).forEach(function (l) { (l.words || []).forEach(function (w) { ws.push(w); }); }); }); }); } catch (e) {}
    return ws;
  }
  Object.assign(TOOLS, {
    "ocr-to-markdown": { accept: ".pdf,application/pdf,image/jpeg,image/png", multi: false, min: 1,
      run: function (f) { return Promise.all([pdfJs(), tessLib()]).then(function (r) { var js = r[0], T = r[1];
        return bytes(f[0]).then(function (b) { return js.getDocument({ data: b }).promise; }).then(function (doc) {
          return T.createWorker("eng", 1).then(function (w) {
            var md = "", seq = Promise.resolve();
            for (var n = 1; n <= doc.numPages; n++) (function (n) { seq = seq.then(function () { return doc.getPage(n).then(function (p) {
              var vp = p.getViewport({ scale: 2 }); var c = document.createElement("canvas"); c.width = Math.max(1, Math.round(vp.width)); c.height = Math.max(1, Math.round(vp.height));
              return p.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise.then(function () { return w.recognize(c); }).then(function (rec) { md += "\n\n## Page " + n + "\n\n" + ((rec.data.text || "").trim()) + "\n"; });
            }); }); })(n);
            return seq.then(function () { return w.terminate().catch(function () {}); }).then(function () { if (!md.trim()) throw new Error("OCR found no readable text on this page"); return [{ blob: new Blob([md.trim() + "\n"], { type: "text/markdown" }), name: "ocr.md" }]; });
          }); }); }); } },
    "ocr-to-searchable-pdf": { accept: ".pdf,application/pdf,image/jpeg,image/png", multi: false, min: 1,
      run: function (f) { return Promise.all([pdfJs(), pdfLib(), tessLib()]).then(function (rr) { var js = rr[0], L = rr[1], T = rr[2];
        return bytes(f[0]).then(function (b) { return js.getDocument({ data: b }).promise; }).then(function (doc) {
          return Promise.all([T.createWorker("eng", 1), L.PDFDocument.create()]).then(function (p2) { var w = p2[0], out = p2[1];
            return out.embedFont(L.StandardFonts.Helvetica).then(function (HFONT) {
              var seq = Promise.resolve(), pagesSeen = 0;
              for (var n = 1; n <= doc.numPages; n++) (function (n) { seq = seq.then(function () { return doc.getPage(n).then(function (p) {
                var scale = 2, ov = p.getViewport({ scale: 1 }), vp = p.getViewport({ scale: scale });
                var c = document.createElement("canvas"); c.width = Math.max(1, Math.round(vp.width)); c.height = Math.max(1, Math.round(vp.height));
                return p.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise
                  .then(function () { return w.recognize(c, {}, { blocks: true, text: true }); }).then(function (rec) { pagesSeen++; return { words: tessWords(rec.data) }; })
                  .then(function (res) { return new Promise(function (b2) { c.toBlob(function (bl) { b2(bl); }, "image/jpeg", 0.9); }).then(function (bl) { return bl.arrayBuffer(); }).then(function (ab) { return out.embedJpg(new Uint8Array(ab)).then(function (e) {
                    var np = out.addPage([ov.width, ov.height]); np.drawImage(e, { x: 0, y: 0, width: ov.width, height: ov.height });
                    res.words.forEach(function (wd) { if (!wd || !wd.bbox || !wd.text) return; np.drawText(wd.text, { x: wd.bbox.x0 / scale, y: ov.height - wd.bbox.y1 / scale, size: Math.max(1, (wd.bbox.y1 - wd.bbox.y0) / scale), font: HFONT, color: L.rgb(0, 0, 0), opacity: 0 }); });
                  }); }); });
              }); }); })(n);
              return seq.then(function () { return w.terminate().catch(function () {}); }).then(function () { if (!pagesSeen) throw new Error("OCR found no readable text on this page"); return out.save({ useObjectStreams: true }); }).then(function (b3) { return toPdf(b3, "searchable.pdf"); });
            }); });
        }); }); } }
  });

  // Tenth wave: the four AI tools. They render pages to JPEG, then POST to the
  // Cloudflare Worker /api/ai (same contract as services/geminiService.ts) with a
  // Clerk session JWT. Premium-gated server-side; we surface sign-in/upgrade/limits.
  function blobB64(blob) { return new Promise(function (res) { var fr = new FileReader(); fr.onload = function () { res(String(fr.result).split(",")[1]); }; fr.readAsDataURL(blob); }); }
  function pageImgsB64(f, maxPages) { return pdfJs().then(function (js) { return bytes(f).then(function (b) { return js.getDocument({ data: b }).promise; }).then(function (doc) {
    var arr = [], n = 1;
    function p() { if (n > doc.numPages || arr.length >= maxPages) return Promise.resolve(); return doc.getPage(n++).then(function (pg) { return canvasJpeg(pg, 1.4, 0.85).then(blobB64).then(function (s) { arr.push(s); return p(); }); }); }
    return p().then(function () { return arr; }); }); }); }
  var AI_SYS = {
    "compare": "Compare the two provided documents thoroughly and list all differences, additions, and deletions.",
    "grammar-check": "Perform a comprehensive grammar, spelling, and style check. Return corrected text with brief explanations.",
    "pdf-qa": "You are an expert document assistant. Answer the question with absolute fidelity based solely on the provided document images. Be concise and cite pages.",
    "pdf-summary": "Provide a comprehensive, highly structured executive summary. Include key takeaways, main topics, critical dates/numbers, and action items."
  };
  function aiUserText(toolId, o) { o = o || {}; if (toolId === "pdf-qa") return "User Question: " + (o.qaQuestion || "Summarize the key points.") + "\nAnswer based on these pages."; if (toolId === "pdf-summary") { var s = "Generate a document summary."; if (o.summaryLength) s += " Summary length: " + o.summaryLength + "."; if (o.summaryFocus) s += " Focus area: " + o.summaryFocus + "."; return s; } return "Process the images according to the system prompt."; }
  function aiCall(toolId, imgs, options) {
    var worker = (window.PRISM && window.PRISM.WORKER) || "";
    if (!worker) return Promise.reject(new Error("AI endpoint not configured"));
    if (!window.PRFAuth) return Promise.reject(new Error("Please open the site normally and sign in at account.html"));
    return window.PRFAuth.getToken().then(function (tok) {
      if (!tok) throw new Error("Please sign in to use this AI tool.");
      var content = imgs.map(function (b) { return { type: "image_url", image_url: { url: "data:image/jpeg;base64," + b } }; });
      content.push({ type: "text", text: aiUserText(toolId, options) });
      var payload = { toolId: toolId, messages: [{ role: "system", content: AI_SYS[toolId] || "Extract data accurately." }, { role: "user", content: content }], options: options || {} };
      return fetch(worker + "/api/ai", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + tok }, body: JSON.stringify(payload) });
    }).then(function (r) {
      if (r.status === 401) throw new Error("Please sign in again to use AI.");
      if (r.status === 402) throw new Error("This AI tool is a Premium feature.");
      if (r.status === 429) throw new Error("AI rate limit reached - try again shortly.");
      if (!r.ok) return r.json().catch(function () { return {}; }).then(function (e) { throw new Error((e && e.error) || ("AI request failed " + r.status)); });
      return r.json();
    }).then(function (d) { return (d && d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content) || (d && d.data) || (typeof d === "string" ? d : "(no response)"); });
  }
  function aiOut(text, name, mime) { return [{ blob: new Blob([text], { type: mime || "text/plain" }), name: name }]; }
  Object.assign(TOOLS, {
    "compare-pdf": { accept: ".pdf,application/pdf", multi: true, min: 2,
      run: function (f) { return Promise.all([pageImgsB64(f[0], 1), pageImgsB64(f[1], 1)]).then(function (a) { var imgs = a[0].concat(a[1]); if (imgs.length < 2) throw new Error("Need two readable PDFs"); return aiCall("compare", imgs.slice(0, 2), {}); }).then(function (t) { return aiOut(t, "comparison.txt"); }); } },
    "grammar-and-spell-check": { accept: ".pdf,application/pdf", multi: false, min: 1,
      run: function (f) { return pageImgsB64(f[0], 2).then(function (imgs) { if (!imgs.length) throw new Error("No readable pages"); return aiCall("grammar-check", imgs, {}); }).then(function (t) { return aiOut(t, "grammar-check.txt"); }); } },
    "pdf-qa-assistant": { accept: ".pdf,application/pdf", multi: false, min: 1,
      opts: [{ key: "q", label: "Question", type: "text", def: "", hint: "Ask anything about the document" }],
      run: function (f, o) { if (!o.q || !o.q.trim()) throw new Error("Type a question first"); return pageImgsB64(f[0], 2).then(function (imgs) { return aiCall("pdf-qa", imgs, { qaQuestion: o.q }); }).then(function (t) { return aiOut(t, "answer.txt"); }); } },
    "pdf-summary": { accept: ".pdf,application/pdf", multi: false, min: 1,
      opts: [{ key: "len", label: "Length", type: "select", def: "medium", choices: [["short", "Short"], ["medium", "Medium"], ["long", "Detailed"]] }, { key: "focus", label: "Focus (optional)", type: "text", def: "" }],
      run: function (f, o) { return pageImgsB64(f[0], 2).then(function (imgs) { return aiCall("pdf-summary", imgs, { summaryLength: o.len, summaryFocus: o.focus }); }).then(function (t) { return aiOut(t, "summary.md", "text/markdown"); }); } }
  });

  function fallback(host, name, slug) {
    host.innerHTML = "";
    var desktopOnly = { "vat-ready-workbooks": 1, "per-client-rules-engine": 1, "industry-templates": 1 };
    var card = el("div", "tool-fallback");
    card.appendChild(el("p", "tool-fb-title", name + " runs in the full app"));
    card.appendChild(el("p", "tool-fb-body", desktopOnly[slug]
      ? "This is a desktop pipeline job - it runs the offline engine against your local data on your machine, so it isn't available as a browser preview."
      : "This tool uses the AI models, which run server-side behind sign-in. It isn't wired to that backend on this preview page yet, so it can't run here in the browser."));
    var a = el("a", "tool-fb-btn", "Download the app");
    a.href = B + "download.html"; card.appendChild(a);
    host.appendChild(card);
  }

  function build(host, cfg, name) {
    host.innerHTML = "";
    var wrap = el("div", "tool");
    var inCol = el("div", "tool-in");
    var outCol = el("div", "tool-out");

    var dz = el("div", "tool-drop");
    dz.setAttribute("role", "button"); dz.tabIndex = 0;
    dz.innerHTML = '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 15V3"/><path d="M7 8l5-5 5 5"/><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/></svg>' +
      '<p class="tool-drop-t">Drop ' + (cfg.multi ? "files" : "a file") + ' here</p><p class="tool-drop-s">or click to choose &middot; ' + cfg.accept.split(",")[0].replace(/[.*]/g, "").toUpperCase() + '</p>';
    var input = el("input"); input.type = "file"; input.accept = cfg.accept; if (cfg.multi) input.multiple = true; input.className = "hidden"; input.tabIndex = -1;
    var list = el("div", "tool-files");
    inCol.appendChild(dz); inCol.appendChild(input); inCol.appendChild(list);

    var optWrap = el("div", "tool-opts");
    (cfg.opts || []).forEach(function (o) {
      var row = el("label", "tool-opt");
      row.appendChild(el("span", "tool-opt-l", o.label));
      var ctl;
      if (o.type === "select") { ctl = el("select", "tool-select"); o.choices.forEach(function (c) { var op = el("option", null, c[1]); op.value = c[0]; if (c[0] === o.def) op.selected = true; ctl.appendChild(op); }); }
      else { ctl = el("input", "tool-text"); ctl.type = o.type === "password" ? "password" : "text"; ctl.value = o.def || ""; }
      ctl.id = "opt-" + o.key; row.appendChild(ctl);
      if (o.hint) row.appendChild(el("span", "tool-opt-h", o.hint));
      optWrap.appendChild(row);
    });
    if ((cfg.opts || []).length) inCol.appendChild(optWrap);

    var run = el("button", "tool-run", "Run " + name.toLowerCase()); run.type = "button"; run.disabled = true;
    inCol.appendChild(run);

    var outIdle = el("div", "tool-idle", "Your result appears here, on this device.");
    outCol.appendChild(outIdle);

    wrap.appendChild(inCol); wrap.appendChild(outCol); host.appendChild(wrap);

    var files = [];
    function refresh() {
      run.disabled = files.length < (cfg.min || 1);
      list.innerHTML = "";
      files.forEach(function (f) { var r = el("div", "tool-file"); r.appendChild(el("span", "tool-file-n", f.name)); r.appendChild(el("span", "tool-file-s", Math.max(1, Math.round(f.size / 1024)) + " KB")); list.appendChild(r); });
    }
    function addFiles(fl) { var arr = Array.prototype.slice.call(fl || []); if (!arr.length) return; files = cfg.multi ? files.concat(arr).slice(0, 20) : [arr[0]]; refresh(); }
    dz.addEventListener("click", function () { input.click(); });
    dz.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); } });
    dz.addEventListener("dragover", function (e) { e.preventDefault(); dz.classList.add("is-drop"); });
    dz.addEventListener("dragleave", function () { dz.classList.remove("is-drop"); });
    dz.addEventListener("drop", function (e) { e.preventDefault(); dz.classList.remove("is-drop"); addFiles(e.dataTransfer && e.dataTransfer.files); });
    input.addEventListener("change", function () { addFiles(input.files); input.value = ""; });

    run.addEventListener("click", function () {
      run.disabled = true; var label = run.textContent; run.textContent = "Working…";
      outCol.innerHTML = ""; outCol.appendChild(el("div", "tool-idle", "Processing on your device…"));
      var opts = {}; (cfg.opts || []).forEach(function (o) { var c = document.getElementById("opt-" + o.key); opts[o.key] = c && c.value; });
      Promise.resolve().then(function () { return cfg.run(files, opts); }).then(function (outs) {
        outCol.innerHTML = "";
        outs.forEach(function (o) {
          var card = el("div", "tool-result");
          card.appendChild(el("p", "tool-result-n", o.name));
          card.appendChild(el("p", "tool-result-s", Math.max(1, Math.round(o.blob.size / 1024)) + " KB · done on this device"));
          var a = el("a", "tool-result-dl", "Download"); a.href = URL.createObjectURL(o.blob); a.download = o.name; card.appendChild(a);
          outCol.appendChild(card);
        });
      }).catch(function (err) {
        outCol.innerHTML = ""; var e2 = el("div", "tool-error", "Couldn't run that here. " + ((err && err.message) || "") + " Try the app for this file."); outCol.appendChild(e2);
      }).then(function () { run.textContent = label; run.disabled = false; });
    });
  }

  function mount() {
    var host = document.getElementById("tool-mount");
    if (!host) return;
    var slug = host.getAttribute("data-tool");
    var name = host.getAttribute("data-name") || "this tool";
    var cfg = TOOLS[slug];
    if (cfg) build(host, cfg, name); else fallback(host, name, slug);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
  else mount();
})();
