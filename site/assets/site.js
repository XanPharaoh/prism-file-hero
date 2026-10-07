/* Prism File Hero: shared shell: nav/footer, tool data, ticker, filters, billing, motion.
   Each page sets <body data-page="home|tools|financial|pricing"> and provides mount points. */
(function () {
  "use strict";

  // Prefix for pages served from a subfolder (feature pages set data-base="../").
  var BASE = (typeof document !== "undefined" && document.body.getAttribute("data-base")) || "";
  var FEATURE = {}; // name -> slug, filled from window.PRISM at boot

  /* ---------------- data ---------------- */
  var TOOLS = [
    // Organize (11)
    { n: "Merge PDF", d: "Combine multiple PDFs into one document.", c: "Organize" },
    { n: "Split PDF", d: "Extract pages into separate files, zipped.", c: "Organize" },
    { n: "Rotate PDF", d: "Fix orientation: 90°, 180° or 270°.", c: "Organize" },
    { n: "Auto-Rotate Pages", d: "Standardise mixed landscape and portrait.", c: "Organize" },
    { n: "Delete Pages", d: "Remove unwanted pages or ranges.", c: "Organize" },
    { n: "Extract Pages", d: "Pull specific pages into a new PDF.", c: "Organize" },
    { n: "Reorder Pages", d: "Rearrange the page sequence.", c: "Organize" },
    { n: "Add Page Numbers", d: "Dynamic numbering with format and position.", c: "Organize" },
    { n: "Header & Footer", d: "Stamp counts, dates and titles on every page.", c: "Organize" },
    { n: "Multi-Page Layout (N-Up)", d: "Fit 2, 4 or 9 pages onto one sheet.", c: "Organize" },
    { n: "Add Stamp Badge", d: "Rubber APPROVED, CONFIDENTIAL, RECEIVED.", c: "Organize" },
    // Convert (7)
    { n: "PDF to Excel", d: "Table extraction to XLSX, scans or digital.", c: "Convert" },
    { n: "PDF to Markdown", d: "AI reconstruction with formatting kept.", c: "Convert" },
    { n: "PDF to Word (DOCX)", d: "Editable Microsoft Word output.", c: "Convert" },
    { n: "PDF to Plain Text", d: "Pure readable text, instantly.", c: "Convert" },
    { n: "PDF to JPG", d: "One high-quality image per page.", c: "Convert" },
    { n: "JPG to PDF", d: "Combine images into a single document.", c: "Convert" },
    { n: "Extract Images", d: "Pull every embedded graphic into a ZIP.", c: "Convert" },
    // Optimize (6)
    { n: "Compress PDF", d: "Shrink embedded images, keep page size.", c: "Optimize" },
    { n: "Repair PDF", d: "Recover corrupted, unreadable streams.", c: "Optimize" },
    { n: "Crop & Resize", d: "Trim margins or fit A4, Letter, Legal.", c: "Optimize" },
    { n: "Remove Blank Pages", d: "Detect and drop empty pages.", c: "Optimize" },
    { n: "Scanner / Paper Look", d: "Grain, toner contrast, deskew.", c: "Optimize" },
    { n: "Invert Colors", d: "Dark-mode reading, less eye strain.", c: "Optimize" },
    // Security (7)
    { n: "Protect PDF", d: "Encrypt the file with a password.", c: "Security" },
    { n: "Unlock PDF", d: "Remove password and editing locks.", c: "Security" },
    { n: "Redact PDF", d: "Detect and permanently remove PII.", c: "Security" },
    { n: "Watermark", d: "Tile or stamp text and image marks.", c: "Security" },
    { n: "Edit Metadata", d: "Rewrite or strip author, title, producer.", c: "Security" },
    { n: "Flatten PDF", d: "Lock form fields into static pages.", c: "Security" },
    { n: "Sanitize PDF", d: "Strip JavaScript, triggers, attachments.", c: "Security" },
    // AI Labs (6)
    { n: "OCR to Searchable PDF", d: "Turn scans into searchable pages.", c: "AI Labs" },
    { n: "OCR to Markdown", d: "Structured text from scanned documents.", c: "AI Labs" },
    { n: "Compare PDF", d: "Version diff between two documents.", c: "AI Labs" },
    { n: "Grammar & Spell Check", d: "AI grammar, spelling and style pass.", c: "AI Labs" },
    { n: "PDF Q&A Assistant", d: "Source-grounded answers about a file.", c: "AI Labs" },
    { n: "PDF Summary", d: "Executive summaries and action items.", c: "AI Labs" }
  ];

  var FINANCIAL = [
    { n: "Bank Statement to XLSX", d: "Fourteen profiles, one canonical schema." },
    { n: "VAT-Ready Workbooks", d: "Nine-column SARS categories, EN & Afrikaans." },
    { n: "Ledger Guard", d: "Five deterministic checks before export." },
    { n: "Per-Client Rules Engine", d: "Passive learning with hard isolation." },
    { n: "Industry Templates", d: "Bootstrap rules from real client books." },
    { n: "Portfolio Statements", d: "Unit trusts and holdings reconciled." }
  ];

  var TICKER = [
    "Merge", "Split", "Compress", "Repair", "Redact PII", "OCR", "Watermark",
    "PDF to Excel", "PDF to Word", "Flatten", "Sanitize", "Compare versions",
    "Ask your PDF", "Summarise", "Auto-rotate", "N-up layout", "Unlock", "Encrypt",
    "Bank statements", "VAT workbooks", "Reconcile balances", "Portfolio units",
    "Scan on your phone", "Offline desktop"
  ];

  /* ---------------- helpers ---------------- */
  function el(html) {
    var t = document.createElement("template");
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }

  /* ---------------- nav ---------------- */
  function mountNav() {
    var root = document.getElementById("nav-root");
    if (!root) return;
    var page = document.body.getAttribute("data-page") || "";
    var links = [
      { k: "tools", t: "Tools", href: BASE + "tools.html" },
      { k: "financial", t: "Financial Engine", href: BASE + "financial.html" },
      { k: "pricing", t: "Pricing", href: BASE + "pricing.html" }
    ];
    var linkHtml = links.map(function (l) {
      var cur = l.k === page ? ' aria-current="page"' : "";
      return '<a href="' + l.href + '" class="nav-link" data-nav="' + l.k + '"' + cur + ">" + l.t + "</a>";
    }).join("");
    root.innerHTML =
      '<a href="#main" class="skip-link">Skip to content</a>' +
      '<header class="fixed top-4 inset-x-0 z-50 px-4 pointer-events-none">' +
        '<nav class="pointer-events-auto mx-auto max-w-5xl flex items-center justify-between gap-4 rounded-full border px-5 py-2.5 backdrop-blur-md shadow-lg shadow-black/20" ' +
          'style="border-color:rgba(242,244,248,.16);background:rgba(11,15,22,.85);color:#f2f4f8;">' +
          '<a href="' + BASE + 'index.html" class="font-display font-semibold tracking-tight text-sm">Prism File Hero</a>' +
          '<div class="hidden lg:flex items-center gap-7 text-xs tracking-wide" style="color:#9aa4b2;">' + linkHtml + "</div>" +
          '<div class="flex items-center gap-2">' +
            '<a href="' + BASE + 'pricing.html" class="hidden sm:inline-block rounded-full border px-4 py-1.5 text-xs font-semibold transition-colors hover:bg-white/10" style="border-color:rgba(242,244,248,.3);color:#f2f4f8;">Sign in</a>' +
            '<a href="' + BASE + 'download.html" class="rounded-full bg-white px-4 py-1.5 text-xs font-semibold hover:bg-slate-200 transition-colors" style="color:#0b0f16;">Download</a>' +
          "</div>" +
        "</nav>" +
      "</header>";
  }

  /* ---------------- footer ---------------- */
  function mountFooter() {
    var root = document.getElementById("footer-root");
    if (!root) return;
    root.innerHTML =
      '<footer class="relative isolate overflow-hidden" style="background:var(--slab);color:var(--slab-ink);">' +
        '<div class="mx-auto max-w-6xl px-6 py-16">' +
          '<div class="flex flex-col md:flex-row md:items-start justify-between gap-10">' +
            "<div>" +
              '<p class="font-display font-semibold tracking-tight text-lg">Prism File Hero</p>' +
              '<p class="mt-2 text-sm max-w-xs" style="color:#9aa4b2;">Local-first document suite, plus a South African financial engine that has to balance before it exports.</p>' +
            "</div>" +
            '<div class="grid grid-cols-2 gap-x-16 gap-y-2 text-sm" style="color:#9aa4b2;">' +
              '<a href="' + BASE + 'tools.html" class="hover:text-white transition-colors">Tools</a>' +
              '<a href="' + BASE + 'financial.html" class="hover:text-white transition-colors">Financial Engine</a>' +
              '<a href="' + BASE + 'pricing.html" class="hover:text-white transition-colors">Pricing</a>' +
              '<a href="' + BASE + 'pricing.html#faq" class="hover:text-white transition-colors">FAQ</a>' +
              '<a href="' + BASE + 'download.html" class="hover:text-white transition-colors">Download</a>' +
              '<a href="' + BASE + 'download.html" class="hover:text-white transition-colors">Windows &middot; Linux &middot; Android</a>' +
            "</div>" +
          "</div>" +
          '<div class="mt-12 border-t pt-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-sm" style="border-color:rgba(242,244,248,.14);color:#9aa4b2;">' +
            "<p>&copy; " + new Date().getFullYear() + " Prism File Hero.</p>" +
            "<p>Local-first &middot; POPIA-aligned.</p>" +
          "</div>" +
        "</div>" +
      "</footer>";
  }

  /* ---------------- ticker ---------------- */
  function mountTicker() {
    var track = document.querySelector("[data-ticker]");
    if (!track) return;
    var set = TICKER.map(function (w) {
      return '<span class="whitespace-nowrap">' + w + "</span><span class=\"text-accent\">&middot;</span>";
    }).join("");
    track.innerHTML = set + set; // two identical halves for a seamless -50% loop
  }

  /* ---------------- tool grid: five category chapters, gapless 6-col rows ---------------- */
  var FEATURED = { Organize: "Merge PDF", Convert: "PDF to Excel", Optimize: "Compress PDF", Security: "Redact PDF", "AI Labs": "PDF Q&A Assistant" };

  function mountTools() {
    var root = document.getElementById("tool-groups");
    if (!root) return;
    var cats = [];
    TOOLS.forEach(function (t) { if (cats.indexOf(t.c) < 0) cats.push(t.c); });

    function slugOf(name) {
      if (FEATURE[name]) return FEATURE[name];
      return name.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    }
    function toolHref(name) {
      var slug = slugOf(name);
      return (window.PRISM && window.PRISM.appHref) ? window.PRISM.appHref(slug) : BASE + "features/" + slug + ".html";
    }
    function card(t, featured) {
      var href = toolHref(t.n);
      if (featured) {
        return '<a href="' + href + '" class="tool-card group relative overflow-hidden rounded-2xl border border-line bg-surface p-7 col-span-full lg:col-span-3 block" data-cat="' + t.c + '">' +
            '<span class="absolute -right-3 -bottom-12 font-display font-extrabold leading-none pointer-events-none select-none" style="font-size:9rem;color:var(--ink);opacity:.07;" aria-hidden="true">' + t.c.charAt(0) + "</span>" +
            '<h3 class="font-display font-bold text-2xl tracking-tight text-ink">' + t.n + "</h3>" +
            '<p class="mt-2 text-sm leading-relaxed text-muted max-w-sm">' + t.d + "</p>" +
          "</a>";
      }
      return '<a href="' + href + '" class="tool-card rounded-2xl border border-line bg-surface p-5 lg:col-span-2 block" data-cat="' + t.c + '">' +
          '<h3 class="font-display font-semibold text-[15px] tracking-tight text-ink">' + t.n + "</h3>" +
        "</a>";
    }

    function group(cat, items, chrome) {
      var feat = items.find(function (t) { return t.n === FEATURED[cat]; });
      var rest = items.filter(function (t) { return t !== feat; });
      var cells = [];
      if (chrome) {
        cells.push({ s: 3, h: '<div class="rounded-2xl p-7 col-span-full lg:col-span-3 flex flex-col justify-end" style="background:var(--sunken);">' +
            '<p class="font-display font-extrabold leading-[0.9] tracking-tighter text-ink" style="font-size:clamp(3rem,5vw,4.6rem);opacity:.14;">' + cat + "</p>" +
          "</div>" });
      }
      if (feat) cells.push({ s: 3, h: card(feat, true) });
      if (!chrome && feat) {
        cells.push({ s: 3, h: '<div class="rounded-2xl col-span-full lg:col-span-3 grid place-items-center" style="border:1px dashed var(--line);">' +
            '<p class="font-mono text-xs text-muted">every tool, unlimited on Pro &middot; see pricing</p></div>' });
      }
      rest.forEach(function (t) { cells.push({ s: 2, h: card(t, false) }); });
      if (chrome) {
        cells.push({ s: 2, h: '<div class="rounded-2xl p-5 grid place-items-center lg:col-span-2" style="background:var(--surface);border:1px dashed var(--line);" aria-hidden="true">' +
            '<span class="font-display font-extrabold text-4xl num text-ink">' + items.length + "</span></div>" });
      }
      var sum = cells.reduce(function (s, c) { return s + c.s; }, 0);
      var pad = (6 - (sum % 6)) % 6;
      if (pad) {
        cells.push({ s: pad, h: '<div class="rounded-2xl col-span-full px-4 py-5 lg:col-span-' + pad + ' grid place-items-center text-center" style="border:1px dashed var(--line);">' +
            '<p class="font-mono text-xs text-muted">every tool, unlimited on Pro &middot; see pricing</p></div>' });
      }
      return '<section class="tool-group" data-cat="' + cat + '">' +
          '<div class="mt-20 mb-6 flex items-baseline justify-between gap-4">' +
            '<h2 class="font-display font-bold tracking-tight text-ink" style="font-size:clamp(1.5rem,2.4vw,2.1rem);">' + cat + "</h2>" +
            '<p class="font-mono text-xs text-muted num">' + items.length + " tools</p>" +
          "</div>" +
          '<div class="grid grid-cols-2 lg:grid-cols-6 grid-flow-dense gap-4">' + cells.map(function (c) { return c.h; }).join("") + "</div>" +
        "</section>";
    }

    root.innerHTML = cats.map(function (c) { return group(c, TOOLS.filter(function (t) { return t.c === c; }), true); }).join("");

    var buttons = Array.prototype.slice.call(document.querySelectorAll(".filter-btn"));
    function apply(cat) {
      root.innerHTML = (cat === "all" ? cats : [cat]).map(function (c) {
        return group(c, TOOLS.filter(function (t) { return t.c === c; }), cat === "all");
      }).join("");
      buttons.forEach(function (b) {
        b.setAttribute("aria-pressed", b.getAttribute("data-filter") === cat ? "true" : "false");
      });
      if (window.gsap) {
        gsap.utils.toArray(".tool-group").forEach(function (node) {
          gsap.from(node, { y: 30, opacity: 0, duration: 0.6, ease: "power3.out",
            scrollTrigger: { trigger: node, start: "top 92%" } });
        });
      }
    }
    buttons.forEach(function (b) {
      b.addEventListener("click", function () { apply(b.getAttribute("data-filter")); });
    });
  }

  /* ---------------- home tool grid (ilovepdf-style front door) ---------------- */
  var FAM_ICON = {
    Organize: "M4 6h16M4 12h16M4 18h10", Convert: "M7 8l4-4 4 4M7 16l4 4 4-4",
    Optimize: "M4 14l5-5 4 4 7-7", Security: "M12 3l7 3v6c0 4-3 6-7 9-4-3-7-5-7-9V6z",
    "AI Labs": "M12 4v4M12 16v4M4 12h4M16 12h4M7 7l2 2M15 15l2 2M17 7l-2 2M9 15l-2 2"
  };
  function mountHomeTools() {
    var root = document.getElementById("home-tools");
    if (!root || !window.PRISM) return;
    var fams = [];
    PRISM.TOOLS.forEach(function (t) { if (fams.indexOf(t.family) < 0) fams.push(t.family); });
    root.innerHTML = fams.map(function (fam) {
      var items = PRISM.TOOLS.filter(function (t) { return t.family === fam; });
      var cards = items.map(function (t) {
        return '<a href="' + PRISM.appHref(t.slug) + '" class="htool group flex items-start gap-3 rounded-xl border border-line bg-surface p-4 transition-all duration-300 hover:-translate-y-0.5 hover:border-[color:var(--accent)]">' +
          '<span class="htool-ico grid place-items-center h-9 w-9 shrink-0 rounded-lg" style="background:var(--sunken);color:var(--accent)">' +
            '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="' + (FAM_ICON[fam] || FAM_ICON.Organize) + '"/></svg></span>' +
          '<span class="min-w-0"><span class="block font-display font-semibold text-[15px] tracking-tight text-ink">' + t.name + '</span>' +
          '<span class="block mt-0.5 text-xs leading-snug text-muted">' + t.tag + '</span></span></a>';
      }).join("");
      return '<div class="mt-10 first:mt-0"><div class="mb-3 flex items-baseline justify-between"><h3 class="font-display font-bold tracking-tight text-ink text-lg">' + fam + '</h3><span class="font-mono text-[11px] text-muted num">' + items.length + '</span></div><div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">' + cards + "</div></div>";
    }).join("");
  }

  /* ---------------- financial band ---------------- */
  function mountFinBand() {
    var band = document.getElementById("fin-band");
    if (!band) return;
    band.innerHTML = FINANCIAL.map(function (t, i) {
      var hot = i === 0;
      return '<div class="rounded-2xl bg-surface p-6 ' + (hot ? "border-2" : "border border-line") + '"' +
          (hot ? ' style="border-color:var(--accent);"' : "") + ">" +
          (hot ? '<p class="text-[10px] uppercase tracking-[0.16em] font-semibold text-accent">Flagship</p>' : "") +
          '<h3 class="' + (hot ? "mt-1 " : "") + 'font-display font-semibold text-base tracking-tight text-ink">' + t.n + "</h3>" +
          '<p class="mt-1.5 text-sm text-muted">' + t.d + "</p>" +
        "</div>";
    }).join("");
  }

  /* ---------------- billing toggle ---------------- */
  function mountBilling() {
    var buttons = Array.prototype.slice.call(document.querySelectorAll(".bill-switch"));
    if (!buttons.length) return;
    var prices = Array.prototype.slice.call(document.querySelectorAll("[data-price]"));
    var notes = Array.prototype.slice.call(document.querySelectorAll("[data-bill-note]"));
    function apply(mode) {
      prices.forEach(function (elx) {
        elx.textContent = "R" + (mode === "monthly" ? elx.getAttribute("data-monthly") : elx.getAttribute("data-annual"));
      });
      notes.forEach(function (elx) {
        elx.textContent = mode === "monthly" ? "· billed monthly" : "· billed annually";
      });
      buttons.forEach(function (b) {
        b.setAttribute("aria-pressed", b.getAttribute("data-bill") === mode ? "true" : "false");
      });
    }
    buttons.forEach(function (b) {
      b.addEventListener("click", function () { apply(b.getAttribute("data-bill")); });
    });
  }

  /* ---------------- hero demo window ---------------- */
  var libQueue = null;
  function ensureLib(cb) {
    if (window.PDFLib) return cb(window.PDFLib);
    if (libQueue) { libQueue.push(cb); return; }
    libQueue = [cb];
    var s = document.createElement("script");
    s.src = "assets/vendor/pdf-lib.min.js";
    s.integrity = "sha384-weMABwrltA6jWR8DDe9Jp5blk+tZQh7ugpCsF3JwSA53WZM9/14PjS5LAJNHNjAI";
    s.crossOrigin = "anonymous";
    s.onload = function () { var q = libQueue; libQueue = null; q.forEach(function (f) { f(window.PDFLib); }); };
    s.onerror = function () { var q = libQueue; libQueue = null; q.forEach(function (f) { f(null); }); };
    document.head.appendChild(s);
  }

  function mountDemo() {
    var win = document.getElementById("demo-window");
    if (!win) return;
    var zone = win.querySelector("#drop-zone");
    var list = win.querySelector("#drop-list");
    var idle = win.querySelector("#drop-idle");
    var input = win.querySelector("#pdf-input");
    var bar = win.querySelector(".demo-proc-bar");
    var pEmpty = win.querySelector('[data-state="empty"]');
    var pJobs = win.querySelector('[data-state="jobs"]');
    var pResult = win.querySelector('[data-state="result"]');
    var rTitle = win.querySelector("#result-title");
    var rNote = win.querySelector("#result-note");
    var rBadge = win.querySelector("#result-badge");
    var rStats = win.querySelector("#result-stats");
    var rDl = win.querySelector("#result-dl");
    var jobGrid = win.querySelector("#job-grid");
    var fileCount = win.querySelector("#file-count");
    var docs = [], lastUrl = null, busy = false;

    function setState(name) {
      [[pEmpty, "empty"], [pJobs, "jobs"], [pResult, "result"]].forEach(function (p) {
        p[0].hidden = p[1] !== name;
      });
    }
    function sweep() {
      if (!bar) return;
      bar.style.transition = "none"; bar.style.width = "0";
      requestAnimationFrame(function () { bar.style.transition = "width .7s ease-in-out"; bar.style.width = "100%"; });
    }
    function total() { return docs.reduce(function (s, d) { return s + (d.pages || 0); }, 0); }
    function valid() { return docs.filter(function (d) { return d.doc; }); }

    function addFiles(files) {
      var pdfs = Array.prototype.filter.call(files, function (f) { return /\.pdf$/i.test(f.name) || f.type === "application/pdf"; });
      if (!pdfs.length) return;
      if (!docs.length && idle) { idle.style.opacity = "0"; idle.style.visibility = "hidden"; }
      if (list) list.style.visibility = "visible";
      pdfs.slice(0, 12 - docs.length).forEach(chip);
      setState("jobs");
    }

    function chip(file) {
      var row = document.createElement("div");
      row.className = "demo-chip flex items-center gap-3 rounded-lg px-3 py-2.5";
      row.style.cssText = "background:rgba(255,255,255,.04);border:1px solid var(--slab-line);";
      var tag = document.createElement("span");
      tag.className = "shrink-0 rounded font-mono text-[9px] px-1.5 py-0.5";
      tag.style.cssText = "background:rgba(200,16,46,.18);color:#ff5266;";
      tag.textContent = "PDF";
      var nm = document.createElement("span");
      nm.className = "text-xs truncate"; nm.style.color = "#c3cad4"; nm.textContent = file.name; nm.title = file.name;
      var pg = document.createElement("span");
      pg.className = "ml-auto shrink-0 font-mono text-[10px]"; pg.style.color = "#67717f"; pg.textContent = "…";
      row.appendChild(tag); row.appendChild(nm); row.appendChild(pg);
      if (list) list.appendChild(row);
      var entry = { doc: null, pages: 0 };
      docs.push(entry);
      ensureLib(function (PDFLib) {
        if (!PDFLib) { pg.textContent = "n/a"; refresh(); return; }
        file.arrayBuffer().then(function (buf) { return PDFLib.PDFDocument.load(buf, { ignoreEncryption: true }); })
          .then(function (d) { entry.doc = d; entry.pages = d.getPageCount(); pg.textContent = entry.pages + " pp"; })
          .catch(function () { pg.textContent = "unreadable"; })
          .then(refresh);
      });
    }

    function refresh() {
      if (fileCount) { var n = docs.length; fileCount.textContent = n + (n === 1 ? " file" : " files") + (total() ? " · " + total() + " pp" : ""); }
      if (jobGrid) Array.prototype.forEach.call(jobGrid.querySelectorAll("[data-job]"), function (b) {
        var need = +b.getAttribute("data-needs") || 1;
        var ok = valid().length >= need;
        b.disabled = !ok;
        b.title = ok ? "" : "Needs " + need + " valid PDF" + (need > 1 ? "s" : "");
      });
    }

    function showResult(o) {
      if (rTitle) rTitle.textContent = o.title;
      if (rNote) rNote.textContent = o.note;
      if (rStats) { rStats.hidden = !o.stats; if (o.stats) rStats.textContent = o.stats; }
      if (rBadge) {
        rBadge.textContent = o.badge || (o.bytes ? "Done · on this device" : "Read");
        rBadge.style.background = o.ok === false ? "rgba(255,82,102,.14)" : "rgba(65,192,127,.14)";
        rBadge.style.color = o.ok === false ? "#ff5266" : "#41c07f";
      }
      if (rDl) {
        if (lastUrl) { URL.revokeObjectURL(lastUrl); lastUrl = null; }
        if (o.bytes) {
          lastUrl = URL.createObjectURL(new Blob([o.bytes], { type: "application/pdf" }));
          rDl.href = lastUrl; rDl.setAttribute("download", o.filename || "prism.pdf");
          rDl.textContent = "Download " + (o.filename || "prism.pdf");
          rDl.hidden = false;
        } else { rDl.hidden = true; rDl.removeAttribute("href"); }
      }
      setState("result");
    }

    var JOBS = {
      merge: { needs: 2, run: function (PDFLib) {
        return PDFLib.PDFDocument.create().then(function (out) {
          return Promise.all(valid().map(function (d) {
            return out.copyPages(d.doc, d.doc.getPageIndices()).then(function (ps) { ps.forEach(function (p) { out.addPage(p); }); });
          })).then(function () { return out.save(); }).then(function (bytes) {
            return { bytes: bytes, filename: "combined.pdf", title: "combined.pdf",
              note: valid().length + " files, " + total() + " pages merged in your browser. Nothing uploaded." };
          });
        });
      } },
      rotate: { needs: 1, run: function (PDFLib) {
        var d = valid()[0].doc;
        d.getPages().forEach(function (p) { p.setRotation(PDFLib.degrees((p.getRotation().angle + 90) % 360)); });
        return d.save().then(function (bytes) {
          return { bytes: bytes, filename: "rotated.pdf", title: "rotated.pdf", note: "All " + d.getPageCount() + " pages turned 90 degrees." };
        });
      } },
      meta: { needs: 1, run: function (PDFLib) {
        var d = valid()[0].doc;
        ["setTitle", "setAuthor", "setSubject", "setProducer", "setCreator"].forEach(function (m) { try { d[m](undefined); } catch (e) {} });
        try { d.setKeywords([]); } catch (e) {}
        return d.save().then(function (bytes) {
          return { bytes: bytes, filename: "clean.pdf", title: "clean.pdf", note: "Author, title and producer stripped from the file." };
        });
      } },
      pagenum: { needs: 1, run: function (PDFLib) {
        var d = valid()[0].doc, pages = d.getPages();
        pages.forEach(function (p, i) { var s = p.getSize(); p.drawText(String(i + 1), { x: s.width / 2 - 8, y: 18, size: 10, color: PDFLib.rgb(0.42, 0.42, 0.42) }); });
        return d.save().then(function (bytes) {
          return { bytes: bytes, filename: "numbered.pdf", title: "numbered.pdf", note: "All " + pages.length + " pages numbered, bottom centre." };
        });
      } },
      watermark: { needs: 1, run: function (PDFLib) {
        var d = valid()[0].doc, pages = d.getPages();
        pages.forEach(function (p) { var s = p.getSize(); p.drawText("DRAFT", { x: s.width / 2 - 78, y: s.height / 2, size: 60, color: PDFLib.rgb(0.78, 0.06, 0.18), opacity: 0.18, rotate: PDFLib.degrees(30) }); });
        return d.save().then(function (bytes) {
          return { bytes: bytes, filename: "watermarked.pdf", title: "watermarked.pdf", note: "A DRAFT mark laid across every page." };
        });
      } },
      info: { needs: 1, run: function () {
        var d = valid()[0].doc, size = d.getPage(0).getSize();
        return { title: "Page details",
          note: "Read locally, in a few milliseconds.",
          stats: valid().length + " file(s) \u00b7 " + total() + " pages \u00b7 first page " + Math.round(size.width) + "\u00d7" + Math.round(size.height) + " pt" };
      } }
    };

    function runJob(key) {
      var job = JOBS[key]; if (!job || busy) return;
      if (valid().length < job.needs) { return; }
      busy = true; sweep(); setState("result");
      if (rTitle) rTitle.textContent = "Working…";
      if (rNote) rNote.textContent = "Running this in your browser.";
      if (rStats) rStats.hidden = true;
      if (rBadge) { rBadge.textContent = "In progress"; rBadge.style.background = "rgba(255,255,255,.06)"; rBadge.style.color = "#8b95a3"; }
      if (rDl) rDl.hidden = true;
      ensureLib(function (PDFLib) {
        if (!PDFLib) { busy = false; showResult({ title: "Engine unavailable", note: "The in-browser engine didn't load.", ok: false }); return; }
        Promise.resolve(job.run(PDFLib)).then(showResult).catch(function (e) {
          showResult({ title: "Couldn't run that", note: (e && e.message) || "Try a different file.", ok: false });
        }).then(function () { busy = false; });
      });
    }

    if (zone) {
      zone.addEventListener("click", function () { if (input) input.click(); });
      zone.addEventListener("keydown", function (e) { if ((e.key === "Enter" || e.key === " ") && input) { e.preventDefault(); input.click(); } });
      zone.addEventListener("dragover", function (e) { e.preventDefault(); zone.classList.add("is-drop"); });
      zone.addEventListener("dragleave", function (e) { if (!zone.contains(e.relatedTarget)) zone.classList.remove("is-drop"); });
      zone.addEventListener("drop", function (e) { e.preventDefault(); zone.classList.remove("is-drop"); addFiles(e.dataTransfer && e.dataTransfer.files); });
    }
    if (input) input.addEventListener("change", function () { addFiles(input.files); input.value = ""; });
    if (jobGrid) jobGrid.addEventListener("click", function (e) {
      var b = e.target.closest("[data-job]"); if (b && !b.disabled) { e.preventDefault(); runJob(b.getAttribute("data-job")); }
    });
    Array.prototype.forEach.call(win.querySelectorAll("[data-reset]"), function (r) {
      r.addEventListener("click", function () { setState(docs.length ? "jobs" : "empty"); });
    });

    setState("empty");
    refresh();
    if (typeof gsap !== "undefined" && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      gsap.from(win, { y: 24, opacity: 0, duration: 0.8, ease: "power3.out", scrollTrigger: { trigger: win, start: "top 88%" } });
    }
  }

  /* ---------------- motion (guarded per element) ---------------- */
  function motion() {
    var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced || typeof gsap === "undefined") return;
    gsap.registerPlugin(ScrollTrigger);

    gsap.utils.toArray(".hero-in").length &&
      gsap.from(".hero-in", { y: 26, opacity: 0, duration: 0.9, stagger: 0.12, ease: "power3.out" });

    gsap.utils.toArray(".rise").forEach(function (node) {
      gsap.from(node, { y: 36, opacity: 0, duration: 0.8, ease: "power3.out",
        scrollTrigger: { trigger: node, start: "top 92%" } });
    });

    if (document.getElementById("band-img")) {
      gsap.fromTo("#band-img", { scale: 0.9, opacity: 0.45 },
        { scale: 1, opacity: 0.9, ease: "none",
          scrollTrigger: { trigger: "#band", start: "top bottom", end: "center center", scrub: true } });
    }

    gsap.utils.toArray(".tool-group").forEach(function (node) {
      gsap.from(node, { y: 30, opacity: 0, duration: 0.6, ease: "power3.out",
        scrollTrigger: { trigger: node, start: "top 92%" } });
    });

    var guard = document.querySelector(".guard-cards");
    if (guard) {
      gsap.from(guard.children, { y: 42, opacity: 0, duration: 0.7, stagger: 0.09, ease: "power3.out",
        scrollTrigger: { trigger: guard, start: "top 84%" } });
      var v = document.getElementById("variance");
      if (v) {
        var state = { val: 12480.14 };
        gsap.to(state, {
          val: 0, duration: 1.6, ease: "power2.inOut",
          scrollTrigger: { trigger: v, start: "top 90%" },
          onUpdate: function () {
            v.textContent = state.val.toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, " ");
          },
          onComplete: function () { v.textContent = "0,00"; },
        });
      }
    }

    var p = document.getElementById("scrub");
    if (p) {
      var nodes = Array.prototype.slice.call(p.childNodes), words = [];
      nodes.forEach(function (n) {
        if (n.nodeType === 3 && n.textContent.trim()) {
          var frag = document.createDocumentFragment();
          n.textContent.split(/(\s+)/).forEach(function (part) {
            if (part.trim()) { var s = document.createElement("span"); s.textContent = part; frag.appendChild(s); words.push(s); }
            else if (part) { frag.appendChild(document.createTextNode(part)); }
          });
          p.replaceChild(frag, n);
        } else if (n.nodeType === 1 && !n.getAttribute("role")) { words.push(n); }
      });
      gsap.set(words, { opacity: 0.14 });
      gsap.to(words, { opacity: 1, stagger: 0.06, ease: "none",
        scrollTrigger: { trigger: p, start: "top 78%", end: "bottom 55%", scrub: true } });
    }

    if (document.getElementById("pipe") && document.getElementById("pipe-left")) {
      var mm = gsap.matchMedia();
      mm.add("(min-width: 1024px)", function () {
        ScrollTrigger.create({ trigger: "#pipe", start: "top top", end: "bottom bottom", pin: "#pipe-left", pinSpacing: false });
      });
    }
  }

  /* ---------------- boot ---------------- */
  function boot() {
    if (window.PRISM) window.PRISM.ALL.forEach(function (f) { FEATURE[f.name] = f.slug; });
    mountNav(); mountFooter(); mountTicker(); mountTools(); mountHomeTools(); mountFinBand(); mountBilling(); mountDemo(); motion();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();

  window.PrismSite = { TOOLS: TOOLS, FINANCIAL: FINANCIAL };
})();
