/* Prism File Hero — shared shell: nav/footer, tool data, ticker, filters, billing, motion.
   Each page sets <body data-page="home|tools|financial|pricing"> and provides mount points. */
(function () {
  "use strict";

  var APP_URL = "https://prismfilehero.com";

  /* ---------------- data ---------------- */
  var TOOLS = [
    // Organize (11)
    { n: "Merge PDF", d: "Combine multiple PDFs into one document.", c: "Organize" },
    { n: "Split PDF", d: "Extract pages into separate files, zipped.", c: "Organize" },
    { n: "Rotate PDF", d: "Fix orientation — 90°, 180° or 270°.", c: "Organize" },
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
      { k: "tools", t: "Tools", href: "tools.html" },
      { k: "financial", t: "Financial Engine", href: "financial.html" },
      { k: "pricing", t: "Pricing", href: "pricing.html" }
    ];
    var linkHtml = links.map(function (l) {
      var cur = l.k === page ? ' aria-current="page"' : "";
      return '<a href="' + l.href + '" class="nav-link" data-nav="' + l.k + '"' + cur + ">" + l.t + "</a>";
    }).join("");
    root.innerHTML =
      '<header class="fixed top-4 inset-x-0 z-50 px-4 pointer-events-none">' +
        '<nav class="pointer-events-auto mx-auto max-w-5xl flex items-center justify-between gap-4 rounded-full border px-5 py-2.5 backdrop-blur-md shadow-lg shadow-black/20" ' +
          'style="border-color:rgba(242,244,248,.16);background:rgba(11,15,22,.85);color:#f2f4f8;">' +
          '<a href="index.html" class="font-display font-semibold tracking-tight text-sm">Prism File Hero</a>' +
          '<div class="hidden lg:flex items-center gap-7 text-xs tracking-wide" style="color:#9aa4b2;">' + linkHtml + "</div>" +
          '<div class="flex items-center gap-2">' +
            '<a href="pricing.html" class="hidden sm:inline-block rounded-full border px-4 py-1.5 text-xs font-semibold transition-colors hover:bg-white/10" style="border-color:rgba(242,244,248,.3);color:#f2f4f8;">Sign in</a>' +
            '<a href="' + APP_URL + '" class="rounded-full bg-white px-4 py-1.5 text-xs font-semibold hover:bg-slate-200 transition-colors" style="color:#0b0f16;">Open the app</a>' +
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
              '<p class="mt-2 text-sm max-w-xs" style="color:#9aa4b2;">Local-first document suite and a South African financial engine that proves its own numbers.</p>' +
            "</div>" +
            '<div class="grid grid-cols-2 gap-x-16 gap-y-2 text-sm" style="color:#9aa4b2;">' +
              '<a href="tools.html" class="hover:text-white transition-colors">Tools</a>' +
              '<a href="financial.html" class="hover:text-white transition-colors">Financial Engine</a>' +
              '<a href="pricing.html" class="hover:text-white transition-colors">Pricing</a>' +
              '<a href="pricing.html#faq" class="hover:text-white transition-colors">FAQ</a>' +
              '<a href="' + APP_URL + '" class="hover:text-white transition-colors">Open the app</a>' +
              '<a href="' + APP_URL + '" class="hover:text-white transition-colors">Terms &amp; privacy</a>' +
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

    function card(t, featured) {
      if (featured) {
        return '<article class="tool-card group relative overflow-hidden rounded-2xl border border-line bg-surface p-7 col-span-full lg:col-span-3" data-cat="' + t.c + '">' +
            '<span class="absolute -right-3 -bottom-12 font-display font-extrabold leading-none pointer-events-none select-none" style="font-size:9rem;color:var(--ink);opacity:.07;" aria-hidden="true">' + t.c.charAt(0) + "</span>" +
            '<h3 class="font-display font-bold text-2xl tracking-tight text-ink">' + t.n + "</h3>" +
            '<p class="mt-2 text-sm leading-relaxed text-muted max-w-sm">' + t.d + "</p>" +
          "</article>";
      }
      return '<article class="tool-card rounded-2xl border border-line bg-surface p-5 lg:col-span-2" data-cat="' + t.c + '">' +
          '<h3 class="font-display font-semibold text-[15px] tracking-tight text-ink">' + t.n + "</h3>" +
        "</article>";
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
            '<p class="font-mono text-xs text-muted">every tool, unlimited on Pro &mdash; see pricing</p></div>' });
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
            '<p class="font-mono text-xs text-muted">every tool, unlimited on Pro &mdash; see pricing</p></div>' });
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
    mountNav(); mountFooter(); mountTicker(); mountTools(); mountFinBand(); mountBilling(); motion();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();

  window.PrismSite = { TOOLS: TOOLS, FINANCIAL: FINANCIAL, APP_URL: APP_URL };
})();
