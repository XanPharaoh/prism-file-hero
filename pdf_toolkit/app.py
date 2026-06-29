import os
import threading
from tkinter import filedialog, StringVar
import customtkinter as ctk
from engine import PDFEngine


# ═══════════════════════════════════════════════════════════════════════════
#  REUSABLE WIDGETS
# ═══════════════════════════════════════════════════════════════════════════

class FileListWidget(ctk.CTkFrame):
    """Multi-file list with add / remove / reorder."""

    def __init__(self, master, filetypes=None, **kw):
        super().__init__(master, fg_color="transparent", **kw)
        self.filetypes = filetypes or [("PDF files", "*.pdf")]
        self.files: list[str] = []
        self.selected = -1
        self._on_change = None

        btn_row = ctk.CTkFrame(self, fg_color="transparent")
        btn_row.pack(fill="x", pady=(0, 6))
        ctk.CTkButton(btn_row, text="+ Add Files", width=110, command=self._add).pack(side="left", padx=(0, 4))
        ctk.CTkButton(btn_row, text="▲", width=36, command=lambda: self._move(-1)).pack(side="left", padx=2)
        ctk.CTkButton(btn_row, text="▼", width=36, command=lambda: self._move(1)).pack(side="left", padx=2)
        ctk.CTkButton(btn_row, text="✕ Remove", width=90, fg_color="#c0392b",
                       hover_color="#e74c3c", command=self._remove).pack(side="left", padx=(4, 0))
        ctk.CTkButton(btn_row, text="Clear All", width=80, fg_color="#7f8c8d",
                       hover_color="#95a5a6", command=self._clear).pack(side="right")

        self.list_frame = ctk.CTkScrollableFrame(self, height=180)
        self.list_frame.pack(fill="both", expand=True)

        self.count_label = ctk.CTkLabel(self, text="0 files", text_color="gray")
        self.count_label.pack(anchor="w", pady=(4, 0))

    def set_on_change(self, cb):
        self._on_change = cb

    def _notify(self):
        if self._on_change:
            self._on_change()

    def _add(self):
        paths = filedialog.askopenfilenames(filetypes=self.filetypes)
        if paths:
            self.files.extend(paths)
            self._rebuild()
            self._notify()

    def _remove(self):
        if 0 <= self.selected < len(self.files):
            self.files.pop(self.selected)
            self.selected = min(self.selected, len(self.files) - 1)
            self._rebuild()
            self._notify()

    def _move(self, direction):
        i = self.selected
        j = i + direction
        if 0 <= i < len(self.files) and 0 <= j < len(self.files):
            self.files[i], self.files[j] = self.files[j], self.files[i]
            self.selected = j
            self._rebuild()

    def _clear(self):
        self.files.clear()
        self.selected = -1
        self._rebuild()
        self._notify()

    def _select(self, idx):
        self.selected = idx
        self._rebuild()

    def _rebuild(self):
        for w in self.list_frame.winfo_children():
            w.destroy()
        for i, fp in enumerate(self.files):
            bg = "#2a5a8c" if i == self.selected else ("#2b2b2b" if i % 2 == 0 else "#333333")
            row = ctk.CTkFrame(self.list_frame, fg_color=bg, corner_radius=4, height=32)
            row.pack(fill="x", pady=1)
            row.pack_propagate(False)

            name = os.path.basename(fp)
            size_kb = os.path.getsize(fp) / 1024
            size_str = f"{size_kb:.0f} KB" if size_kb < 1024 else f"{size_kb/1024:.1f} MB"

            lbl = ctk.CTkLabel(row, text=f"  {i+1}. {name}", anchor="w", font=("", 12))
            lbl.pack(side="left", fill="x", expand=True, padx=4)
            sz = ctk.CTkLabel(row, text=size_str, text_color="gray", font=("", 11))
            sz.pack(side="right", padx=8)

            for widget in (row, lbl, sz):
                widget.bind("<Button-1>", lambda e, idx=i: self._select(idx))

        self.count_label.configure(text=f"{len(self.files)} file{'s' if len(self.files) != 1 else ''}")


# ═══════════════════════════════════════════════════════════════════════════
#  BASE TOOL PAGE
# ═══════════════════════════════════════════════════════════════════════════

class ToolPage(ctk.CTkFrame):
    title = "Tool"
    icon = "🔧"
    description = ""

    def __init__(self, master, app_ref=None):
        super().__init__(master, fg_color="transparent")
        self.app_ref = app_ref

        hdr = ctk.CTkFrame(self, fg_color="transparent")
        hdr.pack(fill="x", padx=20, pady=(20, 0))
        ctk.CTkLabel(hdr, text=self.icon, font=("", 36)).pack(side="left", padx=(0, 12))
        title_frame = ctk.CTkFrame(hdr, fg_color="transparent")
        title_frame.pack(side="left", fill="x")
        ctk.CTkLabel(title_frame, text=self.title, font=("", 22, "bold")).pack(anchor="w")
        if self.description:
            ctk.CTkLabel(title_frame, text=self.description, text_color="gray",
                         font=("", 12)).pack(anchor="w")
        ctk.CTkFrame(self, height=2, fg_color="#444").pack(fill="x", padx=20, pady=10)

        self.content = ctk.CTkScrollableFrame(self, fg_color="transparent")
        self.content.pack(fill="both", expand=True, padx=20)

        action_bar = ctk.CTkFrame(self, fg_color="transparent")
        action_bar.pack(fill="x", padx=20, pady=(10, 20))

        self.btn = ctk.CTkButton(action_bar, text="▶  Process", height=40, font=("", 14, "bold"),
                                  command=self._on_run)
        self.btn.pack(side="left")
        self.progress = ctk.CTkProgressBar(action_bar, height=14)
        self.progress.pack(side="left", fill="x", expand=True, padx=(12, 0))
        self.progress.set(0)
        self.status = ctk.CTkLabel(self, text="", font=("", 12))
        self.status.pack(padx=20, pady=(0, 8))

        self.build_content()

    def build_content(self):
        pass

    def validate(self) -> str | None:
        return None

    def process(self) -> str:
        raise NotImplementedError

    def _on_run(self):
        err = self.validate()
        if err:
            self.status.configure(text=f"❌  {err}", text_color="#e74c3c")
            return
        self.btn.configure(state="disabled")
        self.progress.configure(mode="indeterminate")
        self.progress.start()
        self.status.configure(text="Processing…", text_color="gray")
        threading.Thread(target=self._worker, daemon=True).start()

    def _worker(self):
        try:
            msg = self.process()
            self.after(0, self._done, msg)
        except Exception as e:
            self.after(0, self._error, str(e))

    def _done(self, msg):
        self.progress.stop()
        self.progress.configure(mode="determinate")
        self.progress.set(1.0)
        self.btn.configure(state="normal")
        self.status.configure(text=f"✅  {msg}", text_color="#2ecc71")

    def _error(self, msg):
        self.progress.stop()
        self.progress.configure(mode="determinate")
        self.progress.set(0)
        self.btn.configure(state="normal")
        self.status.configure(text=f"❌  {msg}", text_color="#e74c3c")

    def make_file_picker(self, parent, label="Select PDF:", ftypes=None):
        ftypes = ftypes or [("PDF files", "*.pdf")]
        frame = ctk.CTkFrame(parent, fg_color="transparent")
        frame.pack(fill="x", pady=(0, 10))
        ctk.CTkLabel(frame, text=label, font=("", 13)).pack(anchor="w")
        row = ctk.CTkFrame(frame, fg_color="transparent")
        row.pack(fill="x", pady=4)
        entry = ctk.CTkEntry(row, placeholder_text="Browse for file…")
        entry.pack(side="left", fill="x", expand=True, padx=(0, 6))
        info_label = ctk.CTkLabel(frame, text="", text_color="gray", font=("", 11))
        info_label.pack(anchor="w")

        def browse():
            path = filedialog.askopenfilename(filetypes=ftypes)
            if path:
                entry.delete(0, "end")
                entry.insert(0, path)
                try:
                    nfo = PDFEngine.get_info(path)
                    info_label.configure(text=f"   {nfo['pages']} pages  •  {nfo['size']/1024:.0f} KB")
                except Exception:
                    info_label.configure(text="")

        ctk.CTkButton(row, text="Browse", width=80, command=browse).pack(side="right")
        return entry


# ═══════════════════════════════════════════════════════════════════════════
#  TOOL IMPLEMENTATIONS
# ═══════════════════════════════════════════════════════════════════════════

class MergeTool(ToolPage):
    title = "Merge PDF"
    icon = "📎"
    description = "Combine multiple PDFs into one document"

    def build_content(self):
        self.file_list = FileListWidget(self.content)
        self.file_list.pack(fill="both", expand=True)

    def validate(self):
        if len(self.file_list.files) < 2:
            return "Add at least 2 PDF files"
        self._out = filedialog.asksaveasfilename(defaultextension=".pdf",
                                                  filetypes=[("PDF", "*.pdf")])
        if not self._out:
            return "No output file selected"
        return None

    def process(self):
        PDFEngine.merge(self.file_list.files, self._out)
        return f"Merged {len(self.file_list.files)} files → {os.path.basename(self._out)}"


class SplitTool(ToolPage):
    title = "Split PDF"
    icon = "✂️"
    description = "Split a PDF into multiple files"

    def build_content(self):
        self.entry = self.make_file_picker(self.content)

        ctk.CTkLabel(self.content, text="Split Mode:", font=("", 13)).pack(anchor="w", pady=(10, 4))
        self.mode = StringVar(value="all")

        modes_frame = ctk.CTkFrame(self.content, fg_color="transparent")
        modes_frame.pack(fill="x")
        ctk.CTkRadioButton(modes_frame, text="Every page", variable=self.mode,
                            value="all").pack(anchor="w", pady=2)
        r2_row = ctk.CTkFrame(modes_frame, fg_color="transparent")
        r2_row.pack(fill="x", pady=2)
        ctk.CTkRadioButton(r2_row, text="Every N pages:", variable=self.mode,
                            value="every_n").pack(side="left")
        self.n_entry = ctk.CTkEntry(r2_row, width=60, placeholder_text="N")
        self.n_entry.pack(side="left", padx=8)

        r3_row = ctk.CTkFrame(modes_frame, fg_color="transparent")
        r3_row.pack(fill="x", pady=2)
        ctk.CTkRadioButton(r3_row, text="Page ranges:", variable=self.mode,
                            value="ranges").pack(side="left")
        self.ranges_entry = ctk.CTkEntry(r3_row, width=200, placeholder_text="e.g. 1-3, 5-7, 10-12")
        self.ranges_entry.pack(side="left", padx=8)

    def validate(self):
        if not self.entry.get():
            return "Select a PDF file"
        self._dir = filedialog.askdirectory(title="Output folder")
        if not self._dir:
            return "No output folder selected"
        return None

    def process(self):
        path = self.entry.get()
        mode = self.mode.get()
        if mode == "all":
            n = PDFEngine.split_all(path, self._dir)
            return f"Split into {n} individual pages"
        elif mode == "every_n":
            n = int(self.n_entry.get() or "1")
            cnt = PDFEngine.split_every_n(path, self._dir, n)
            return f"Split into {cnt} files ({n} pages each)"
        else:
            ranges = []
            for part in self.ranges_entry.get().split(","):
                a, b = part.strip().split("-")
                ranges.append((int(a.strip()), int(b.strip())))
            cnt = PDFEngine.split_ranges(path, self._dir, ranges)
            return f"Created {cnt} files from ranges"


class CompressTool(ToolPage):
    title = "Compress PDF"
    icon = "🗜️"
    description = "Reduce PDF file size"

    def build_content(self):
        self.entry = self.make_file_picker(self.content)
        ctk.CTkLabel(self.content, text="Quality:", font=("", 13)).pack(anchor="w", pady=(10, 4))
        self.quality = ctk.CTkSegmentedButton(self.content, values=["low", "medium", "high"])
        self.quality.set("medium")
        self.quality.pack(anchor="w")

    def validate(self):
        if not self.entry.get():
            return "Select a PDF file"
        self._out = filedialog.asksaveasfilename(defaultextension=".pdf",
                                                  filetypes=[("PDF", "*.pdf")])
        if not self._out:
            return "No output file selected"
        return None

    def process(self):
        orig, comp = PDFEngine.compress(self.entry.get(), self._out, self.quality.get())
        pct = (1 - comp / orig) * 100 if orig > 0 else 0
        return f"Compressed: {orig//1024} KB → {comp//1024} KB  ({pct:.1f}% reduction)"


class PdfToImagesTool(ToolPage):
    title = "PDF to Images"
    icon = "🖼️"
    description = "Convert each page to an image"

    def build_content(self):
        self.entry = self.make_file_picker(self.content)

        opts = ctk.CTkFrame(self.content, fg_color="transparent")
        opts.pack(fill="x", pady=(10, 0))

        ctk.CTkLabel(opts, text="Format:", font=("", 13)).pack(side="left")
        self.fmt = ctk.CTkSegmentedButton(opts, values=["png", "jpg"], width=140)
        self.fmt.set("png")
        self.fmt.pack(side="left", padx=(8, 20))

        ctk.CTkLabel(opts, text="DPI:", font=("", 13)).pack(side="left")
        self.dpi = ctk.CTkEntry(opts, width=60)
        self.dpi.insert(0, "150")
        self.dpi.pack(side="left", padx=8)

    def validate(self):
        if not self.entry.get():
            return "Select a PDF file"
        self._dir = filedialog.askdirectory(title="Output folder")
        if not self._dir:
            return "No output folder selected"
        return None

    def process(self):
        dpi = int(self.dpi.get() or "150")
        n = PDFEngine.pdf_to_images(self.entry.get(), self._dir, self.fmt.get(), dpi)
        return f"Exported {n} images ({self.fmt.get().upper()}, {dpi} DPI)"


class ImagesToPdfTool(ToolPage):
    title = "Images to PDF"
    icon = "📄"
    description = "Convert images into a PDF document"

    def build_content(self):
        self.file_list = FileListWidget(self.content,
            filetypes=[("Images", "*.png *.jpg *.jpeg *.bmp *.tiff *.webp")])
        self.file_list.pack(fill="both", expand=True)

        opts = ctk.CTkFrame(self.content, fg_color="transparent")
        opts.pack(fill="x", pady=(10, 0))
        ctk.CTkLabel(opts, text="Page size:", font=("", 13)).pack(side="left")
        self.page_size = ctk.CTkSegmentedButton(opts, values=["A4", "Letter"], width=140)
        self.page_size.set("A4")
        self.page_size.pack(side="left", padx=8)

    def validate(self):
        if len(self.file_list.files) < 1:
            return "Add at least 1 image"
        self._out = filedialog.asksaveasfilename(defaultextension=".pdf",
                                                  filetypes=[("PDF", "*.pdf")])
        if not self._out:
            return "No output file selected"
        return None

    def process(self):
        PDFEngine.images_to_pdf(self.file_list.files, self._out, self.page_size.get())
        return f"Created PDF with {len(self.file_list.files)} pages"


class RotateTool(ToolPage):
    title = "Rotate PDF"
    icon = "🔄"
    description = "Rotate pages by 90°, 180°, or 270°"

    def build_content(self):
        self.entry = self.make_file_picker(self.content)

        opts = ctk.CTkFrame(self.content, fg_color="transparent")
        opts.pack(fill="x", pady=(10, 0))
        ctk.CTkLabel(opts, text="Angle:", font=("", 13)).pack(side="left")
        self.angle = ctk.CTkSegmentedButton(opts, values=["90", "180", "270"], width=180)
        self.angle.set("90")
        self.angle.pack(side="left", padx=(8, 20))

        ctk.CTkLabel(opts, text="Pages:", font=("", 13)).pack(side="left")
        self.pages = ctk.CTkEntry(opts, width=160, placeholder_text="all  or  1,3,5-8")
        self.pages.insert(0, "all")
        self.pages.pack(side="left", padx=8)

    def validate(self):
        if not self.entry.get():
            return "Select a PDF file"
        self._out = filedialog.asksaveasfilename(defaultextension=".pdf",
                                                  filetypes=[("PDF", "*.pdf")])
        if not self._out:
            return "No output file selected"
        return None

    def process(self):
        PDFEngine.rotate(self.entry.get(), self._out, int(self.angle.get()),
                         self.pages.get() or "all")
        return f"Rotated {self.pages.get()} by {self.angle.get()}°"


class WatermarkTool(ToolPage):
    title = "Watermark PDF"
    icon = "💧"
    description = "Add text watermark to all pages"

    def build_content(self):
        self.entry = self.make_file_picker(self.content)

        ctk.CTkLabel(self.content, text="Watermark text:", font=("", 13)).pack(anchor="w", pady=(10, 4))
        self.wm_text = ctk.CTkEntry(self.content, placeholder_text="CONFIDENTIAL")
        self.wm_text.pack(fill="x", pady=(0, 10))

        row = ctk.CTkFrame(self.content, fg_color="transparent")
        row.pack(fill="x")
        for label, default, attr in [("Font size:", "48", "fs_entry"),
                                      ("Opacity (0-1):", "0.3", "op_entry"),
                                      ("Rotation°:", "45", "rot_entry")]:
            ctk.CTkLabel(row, text=label, font=("", 12)).pack(side="left")
            e = ctk.CTkEntry(row, width=60)
            e.insert(0, default)
            e.pack(side="left", padx=(4, 16))
            setattr(self, attr, e)

    def validate(self):
        if not self.entry.get():
            return "Select a PDF file"
        if not self.wm_text.get().strip():
            return "Enter watermark text"
        self._out = filedialog.asksaveasfilename(defaultextension=".pdf",
                                                  filetypes=[("PDF", "*.pdf")])
        if not self._out:
            return "No output file selected"
        return None

    def process(self):
        PDFEngine.watermark(self.entry.get(), self._out, self.wm_text.get(),
                            int(self.fs_entry.get()), float(self.op_entry.get()),
                            int(self.rot_entry.get()))
        return f'Watermark "{self.wm_text.get()}" applied'


class ProtectTool(ToolPage):
    title = "Protect PDF"
    icon = "🔒"
    description = "Encrypt PDF with a password"

    def build_content(self):
        self.entry = self.make_file_picker(self.content)
        ctk.CTkLabel(self.content, text="Password:", font=("", 13)).pack(anchor="w", pady=(10, 4))
        self.pw = ctk.CTkEntry(self.content, show="•", placeholder_text="Enter password")
        self.pw.pack(fill="x")

    def validate(self):
        if not self.entry.get():
            return "Select a PDF file"
        if not self.pw.get():
            return "Enter a password"
        self._out = filedialog.asksaveasfilename(defaultextension=".pdf",
                                                  filetypes=[("PDF", "*.pdf")])
        if not self._out:
            return "No output file selected"
        return None

    def process(self):
        PDFEngine.protect(self.entry.get(), self._out, self.pw.get())
        return "PDF encrypted successfully"


class UnlockTool(ToolPage):
    title = "Unlock PDF"
    icon = "🔓"
    description = "Remove password protection"

    def build_content(self):
        self.entry = self.make_file_picker(self.content)
        ctk.CTkLabel(self.content, text="Password:", font=("", 13)).pack(anchor="w", pady=(10, 4))
        self.pw = ctk.CTkEntry(self.content, show="•", placeholder_text="Enter current password")
        self.pw.pack(fill="x")

    def validate(self):
        if not self.entry.get():
            return "Select a PDF file"
        self._out = filedialog.asksaveasfilename(defaultextension=".pdf",
                                                  filetypes=[("PDF", "*.pdf")])
        if not self._out:
            return "No output file selected"
        return None

    def process(self):
        PDFEngine.unlock(self.entry.get(), self._out, self.pw.get())
        return "PDF unlocked successfully"


class ExtractTextTool(ToolPage):
    title = "Extract Text"
    icon = "📝"
    description = "Extract all text from PDF to a text file"

    def build_content(self):
        self.entry = self.make_file_picker(self.content)

    def validate(self):
        if not self.entry.get():
            return "Select a PDF file"
        self._out = filedialog.asksaveasfilename(defaultextension=".txt",
                                                  filetypes=[("Text files", "*.txt")])
        if not self._out:
            return "No output file selected"
        return None

    def process(self):
        PDFEngine.extract_text(self.entry.get(), self._out)
        return f"Text extracted → {os.path.basename(self._out)}"


class PageNumbersTool(ToolPage):
    title = "Page Numbers"
    icon = "#️⃣"
    description = "Add page numbers to every page"

    def build_content(self):
        self.entry = self.make_file_picker(self.content)

        row = ctk.CTkFrame(self.content, fg_color="transparent")
        row.pack(fill="x", pady=(10, 0))

        ctk.CTkLabel(row, text="Position:", font=("", 13)).pack(side="left")
        self.pos = ctk.CTkOptionMenu(row, values=[
            "bottom-center", "bottom-left", "bottom-right",
            "top-center", "top-left", "top-right"], width=160)
        self.pos.set("bottom-center")
        self.pos.pack(side="left", padx=(8, 20))

        ctk.CTkLabel(row, text="Font size:", font=("", 13)).pack(side="left")
        self.fs = ctk.CTkEntry(row, width=50)
        self.fs.insert(0, "12")
        self.fs.pack(side="left", padx=(4, 16))

        ctk.CTkLabel(row, text="Start #:", font=("", 13)).pack(side="left")
        self.start = ctk.CTkEntry(row, width=50)
        self.start.insert(0, "1")
        self.start.pack(side="left", padx=4)

    def validate(self):
        if not self.entry.get():
            return "Select a PDF file"
        self._out = filedialog.asksaveasfilename(defaultextension=".pdf",
                                                  filetypes=[("PDF", "*.pdf")])
        if not self._out:
            return "No output file selected"
        return None

    def process(self):
        PDFEngine.add_page_numbers(self.entry.get(), self._out, self.pos.get(),
                                    int(self.fs.get()), int(self.start.get()))
        return "Page numbers added"


class OrganizeTool(ToolPage):
    title = "Organize Pages"
    icon = "📑"
    description = "Reorder or delete pages"

    def build_content(self):
        self.entry = self.make_file_picker(self.content)

        ctk.CTkButton(self.content, text="Load Pages", width=120,
                       command=self._load).pack(anchor="w", pady=(4, 8))

        self.pages_list: list[int] = []

        mid = ctk.CTkFrame(self.content, fg_color="transparent")
        mid.pack(fill="both", expand=True)

        self.page_listbox = ctk.CTkScrollableFrame(mid, height=200)
        self.page_listbox.pack(side="left", fill="both", expand=True)

        btns = ctk.CTkFrame(mid, fg_color="transparent", width=90)
        btns.pack(side="right", fill="y", padx=(8, 0))
        ctk.CTkButton(btns, text="▲ Up", width=80, command=lambda: self._pg_move(-1)).pack(pady=4)
        ctk.CTkButton(btns, text="▼ Down", width=80, command=lambda: self._pg_move(1)).pack(pady=4)
        ctk.CTkButton(btns, text="🗑 Delete", width=80, fg_color="#c0392b",
                       hover_color="#e74c3c", command=self._pg_delete).pack(pady=4)

        self.pg_selected = -1

    def _load(self):
        path = self.entry.get()
        if not path:
            return
        try:
            info = PDFEngine.get_info(path)
            self.pages_list = list(range(info["pages"]))
            self.pg_selected = -1
            self._pg_rebuild()
        except Exception as e:
            self.status.configure(text=f"❌  {e}", text_color="#e74c3c")

    def _pg_select(self, idx):
        self.pg_selected = idx
        self._pg_rebuild()

    def _pg_move(self, d):
        i, j = self.pg_selected, self.pg_selected + d
        if 0 <= i < len(self.pages_list) and 0 <= j < len(self.pages_list):
            self.pages_list[i], self.pages_list[j] = self.pages_list[j], self.pages_list[i]
            self.pg_selected = j
            self._pg_rebuild()

    def _pg_delete(self):
        if 0 <= self.pg_selected < len(self.pages_list):
            self.pages_list.pop(self.pg_selected)
            self.pg_selected = min(self.pg_selected, len(self.pages_list) - 1)
            self._pg_rebuild()

    def _pg_rebuild(self):
        for w in self.page_listbox.winfo_children():
            w.destroy()
        for i, pg in enumerate(self.pages_list):
            bg = "#2a5a8c" if i == self.pg_selected else ("#2b2b2b" if i % 2 == 0 else "#333333")
            row = ctk.CTkFrame(self.page_listbox, fg_color=bg, corner_radius=4, height=30)
            row.pack(fill="x", pady=1)
            row.pack_propagate(False)
            lbl = ctk.CTkLabel(row, text=f"  Page {pg + 1}", font=("", 12))
            lbl.pack(side="left", padx=4)
            for w in (row, lbl):
                w.bind("<Button-1>", lambda e, idx=i: self._pg_select(idx))

    def validate(self):
        if not self.entry.get():
            return "Select a PDF file"
        if len(self.pages_list) == 0:
            return "Load pages first"
        self._out = filedialog.asksaveasfilename(defaultextension=".pdf",
                                                  filetypes=[("PDF", "*.pdf")])
        if not self._out:
            return "No output file selected"
        return None

    def process(self):
        PDFEngine.reorder_pages(self.entry.get(), self._out, self.pages_list)
        return f"Saved {len(self.pages_list)} pages in new order"


# ═══════════════════════════════════════════════════════════════════════════
#  HOME PAGE
# ═══════════════════════════════════════════════════════════════════════════

TOOLS = [
    ("merge",       "📎", "Merge PDF",       "Combine multiple PDFs"),
    ("split",       "✂️", "Split PDF",       "Split into multiple files"),
    ("compress",    "🗜️", "Compress",        "Reduce file size"),
    ("pdf2img",     "🖼️", "PDF → Images",    "Export pages as images"),
    ("img2pdf",     "📄", "Images → PDF",    "Images to PDF document"),
    ("rotate",      "🔄", "Rotate",          "Rotate pages"),
    ("watermark",   "💧", "Watermark",       "Add text watermark"),
    ("numbers",     "#️⃣", "Page Numbers",    "Number every page"),
    ("organize",    "📑", "Organize",        "Reorder / delete pages"),
    ("protect",     "🔒", "Protect",         "Encrypt with password"),
    ("unlock",      "🔓", "Unlock",          "Remove password"),
    ("extract",     "📝", "Extract Text",    "PDF to plain text"),
]

TOOL_MAP = {
    "merge": MergeTool, "split": SplitTool, "compress": CompressTool,
    "pdf2img": PdfToImagesTool, "img2pdf": ImagesToPdfTool, "rotate": RotateTool,
    "watermark": WatermarkTool, "numbers": PageNumbersTool, "organize": OrganizeTool,
    "protect": ProtectTool, "unlock": UnlockTool, "extract": ExtractTextTool,
}


class HomePage(ctk.CTkScrollableFrame):
    def __init__(self, master, app_ref):
        super().__init__(master, fg_color="transparent")
        self.app_ref = app_ref

        hdr = ctk.CTkFrame(self, fg_color="transparent")
        hdr.pack(fill="x", padx=20, pady=(24, 4))
        ctk.CTkLabel(hdr, text="📄 PDF Toolkit", font=("", 28, "bold")).pack(anchor="w")
        ctk.CTkLabel(hdr, text="Every PDF tool you need — offline, private, no limits.",
                     text_color="gray", font=("", 13)).pack(anchor="w", pady=(2, 0))

        grid = ctk.CTkFrame(self, fg_color="transparent")
        grid.pack(fill="both", expand=True, padx=20, pady=16)

        cols = 3
        for i, (key, icon, name, desc) in enumerate(TOOLS):
            r, c = divmod(i, cols)
            card = ctk.CTkFrame(grid, corner_radius=10, fg_color="#2b2b2b",
                                border_width=1, border_color="#444")
            card.grid(row=r, column=c, padx=6, pady=6, sticky="nsew")

            inner = ctk.CTkFrame(card, fg_color="transparent")
            inner.pack(padx=16, pady=14, fill="both", expand=True)
            ctk.CTkLabel(inner, text=icon, font=("", 28)).pack(anchor="w")
            ctk.CTkLabel(inner, text=name, font=("", 14, "bold")).pack(anchor="w", pady=(6, 2))
            ctk.CTkLabel(inner, text=desc, text_color="gray", font=("", 11)).pack(anchor="w")

            for widget in (card, inner):
                widget.bind("<Button-1>", lambda e, k=key: self.app_ref.show_tool(k))
                widget.bind("<Enter>", lambda e, c=card: c.configure(border_color="#3498db"))
                widget.bind("<Leave>", lambda e, c=card: c.configure(border_color="#444"))
            for child in inner.winfo_children():
                child.bind("<Button-1>", lambda e, k=key: self.app_ref.show_tool(k))

        for c in range(cols):
            grid.columnconfigure(c, weight=1)


# ═══════════════════════════════════════════════════════════════════════════
#  MAIN APPLICATION WINDOW
# ═══════════════════════════════════════════════════════════════════════════

class MainApp(ctk.CTk):
    def __init__(self):
        super().__init__()
        ctk.set_appearance_mode("dark")
        ctk.set_default_color_theme("blue")

        self.title("PDF Toolkit")
        self.geometry("1060x700")
        self.minsize(800, 500)

        # sidebar
        self.sidebar = ctk.CTkScrollableFrame(self, width=190, corner_radius=0,
                                               fg_color="#1a1a2e")
        self.sidebar.pack(side="left", fill="y")

        ctk.CTkLabel(self.sidebar, text="📄 PDF Toolkit", font=("", 17, "bold")).pack(
            padx=12, pady=(16, 12))

        self.nav_buttons: dict[str, ctk.CTkButton] = {}

        self.nav_buttons["home"] = ctk.CTkButton(
            self.sidebar, text="🏠  Dashboard", anchor="w", fg_color="transparent",
            hover_color="#16213e", font=("", 13),
            command=lambda: self.show_tool("home"))
        self.nav_buttons["home"].pack(fill="x", padx=8, pady=2)

        categories = {
            "ORGANIZE":  ["merge", "split", "organize"],
            "OPTIMIZE":  ["compress"],
            "CONVERT":   ["pdf2img", "img2pdf"],
            "EDIT":      ["rotate", "watermark", "numbers"],
            "SECURITY":  ["protect", "unlock"],
            "EXTRACT":   ["extract"],
        }

        tool_labels = {t[0]: f"{t[1]}  {t[2]}" for t in TOOLS}

        for cat, keys in categories.items():
            ctk.CTkLabel(self.sidebar, text=cat, font=("", 10, "bold"),
                         text_color="#666").pack(anchor="w", padx=16, pady=(14, 4))
            for key in keys:
                btn = ctk.CTkButton(
                    self.sidebar, text=tool_labels[key], anchor="w",
                    fg_color="transparent", hover_color="#16213e", font=("", 12),
                    command=lambda k=key: self.show_tool(k))
                btn.pack(fill="x", padx=8, pady=1)
                self.nav_buttons[key] = btn

        # content area
        self.content_area = ctk.CTkFrame(self, fg_color="transparent", corner_radius=0)
        self.content_area.pack(side="right", fill="both", expand=True)

        self.current_page = None
        self.current_key = None
        self.show_tool("home")

    def show_tool(self, key: str):
        if key == self.current_key:
            return

        if self.current_page:
            self.current_page.destroy()

        for k, btn in self.nav_buttons.items():
            btn.configure(fg_color="#16213e" if k == key else "transparent")

        self.current_key = key

        if key == "home":
            self.current_page = HomePage(self.content_area, self)
        else:
            tool_class = TOOL_MAP.get(key)
            if tool_class:
                self.current_page = tool_class(self.content_area, app_ref=self)

        if self.current_page:
            self.current_page.pack(fill="both", expand=True)
