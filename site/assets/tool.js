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

  function fallback(host, name) {
    host.innerHTML = "";
    var card = el("div", "tool-fallback");
    card.appendChild(el("p", "tool-fb-title", name + " runs in the full app"));
    card.appendChild(el("p", "tool-fb-body", "This tool needs the desktop engine (OCR, AI, table extraction or the bank parser). It isn't wired to a backend on this preview page yet, so it can't run here in the browser."));
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
      else { ctl = el("input", "tool-text"); ctl.type = "text"; ctl.value = o.def || ""; }
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
    if (cfg) build(host, cfg, name); else fallback(host, name);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
  else mount();
})();
