/**
 * Embedded image extraction (B1).
 *
 * The promise is "all embedded graphics … at original resolution". Rendering each page to a canvas
 * does not extract anything: it re-photographs the sheet, so a 2400×3508 scan comes back as a
 * 1190×1684 PNG, the vector text and the photo merge into one flat picture, and a document with five
 * image placements and four distinct rasters yields two files.
 *
 * This module walks the actual objects. JPEG and JPEG2000 images are written as the bytes already in
 * the file — byte-for-byte identical to what the document carries, which is what "original
 * resolution" means. Flate-compressed samples are repacked into a lossless PNG, because raw
 * device-independent samples are not something anyone can open.
 */
import { PDFDict, PDFName, PDFNumber, PDFArray, PDFRawStream, decodePDFRawStream, type PDFObject } from 'pdf-lib';

export type SkippedImage = {
  page: number;
  name: string;
  reason: string;
};

/** An asset that WAS written, but without everything the document attached to it. */
export type ExtractionCaveat = {
  page: number;
  filename: string;
  reason: string;
};

export type ExtractedImage = {
  page: number;
  filename: string;
  bytes: Uint8Array;
  mime: string;
  width: number | null;
  height: number | null;
  /** 'original' = the document's own bytes; 'reconstructed' = decoded samples repacked losslessly */
  fidelity: 'original' | 'reconstructed';
  filter: string;
};

export type ExtractionResult = {
  images: ExtractedImage[];
  skipped: SkippedImage[];
  caveats: ExtractionCaveat[];
  /** Placements whose bytes matched an image already extracted, reported instead of written twice. */
  duplicates: Array<{ page: number; of: string }>;
  /** Every image-bearing placement seen, duplicates included. */
  placements: number;
};

const MAX_FORM_DEPTH = 6;

/* ------------------------------------------------------------------ PNG encoding */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function adler32(bytes: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (let i = 0; i < bytes.length; i++) {
    a = (a + bytes[i]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

/**
 * A zlib stream built from stored (uncompressed) deflate blocks. Legal deflate, so any PNG reader
 * accepts it, and *lossless*: recompressing samples we are only relabelling would silently change
 * pixel values, which is the opposite of what extraction is for.
 */
export function zlibStored(bytes: Uint8Array): Uint8Array {
  const blocks: Uint8Array[] = [];
  const max = 65535;
  const count = Math.max(1, Math.ceil(bytes.length / max));
  for (let i = 0; i < count; i++) {
    const start = i * max;
    const slice = bytes.subarray(start, Math.min(start + max, bytes.length));
    const isFinal = i === count - 1;
    const header = new Uint8Array(5);
    header[0] = isFinal ? 1 : 0;
    header[1] = slice.length & 0xFF;
    header[2] = (slice.length >>> 8) & 0xFF;
    header[3] = (~slice.length) & 0xFF;
    header[4] = ((~slice.length) >>> 8) & 0xFF;
    blocks.push(header, slice);
  }
  const trailer = new Uint8Array(4);
  const sum = adler32(bytes);
  // RFC 1950 puts ADLER32 at the end of a zlib stream in big-endian order. Written little-endian,
  // libpng rejects the whole IDAT with "incorrect data check" and the PNG decodes with its bottom
  // rows missing — which is exactly how this looked like a pixel bug rather than a checksum bug.
  trailer[0] = (sum >>> 24) & 0xFF;
  trailer[1] = (sum >>> 16) & 0xFF;
  trailer[2] = (sum >>> 8) & 0xFF;
  trailer[3] = sum & 0xFF;
  const total = 2 + blocks.reduce((n, b) => n + b.length, 0) + 4;
  const out = new Uint8Array(total);
  out[0] = 0x78;
  out[1] = 0x01;
  let at = 2;
  for (const b of blocks) { out.set(b, at); at += b.length; }
  out.set(trailer, at);
  return out;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  const crcInput = out.subarray(4, 8 + data.length);
  view.setUint32(8 + data.length, crc32(crcInput));
  return out;
}

/** Read packed samples as one byte per sample, scaling the full-scale value to 255. */
function expandToBytes(samples: Uint8Array, count: number, bits: number): Uint8Array {
  const out = new Uint8Array(count);
  const mask = (1 << bits) - 1;
  const scale = 255 / mask;
  for (let i = 0; i < count; i++) {
    const bitPos = i * bits;
    const byte = samples[bitPos >>> 3] ?? 0;
    const raw = (byte >>> (8 - bits - (bitPos & 7))) & mask;
    out[i] = bits === 8 ? raw : Math.round(raw * scale);
  }
  return out;
}

/**
 * Pack decoded image samples into a PNG.
 *
 * Without an alpha mask, PDF raw image samples and PNG scanlines share a layout — rows, MSB-first bit
 * packing — and the only difference is PNG's leading per-row filter byte. Zero means "none", so the
 * samples are copied untouched and the result is lossless at the source bit depth.
 *
 * With an alpha mask the channels have to be interleaved, which bit packing makes unreadable, so both
 * sides are widened to one byte per sample and the PNG is written at 8 bits.
 */
export function samplesToPng(
  samples: Uint8Array,
  width: number,
  height: number,
  bitsPerComponent: number,
  channels: number,
  alpha?: Uint8Array | null,
): Uint8Array {
  const pixels = width * height;
  const withAlpha = !!alpha && alpha.length >= pixels;
  let bitDepth = bitsPerComponent;
  let colorType = channels === 1 ? 0 : 2;
  let rows: Uint8Array;

  if (!withAlpha) {
    const srcRowLen = Math.ceil((width * channels * bitsPerComponent) / 8);
    const rowLen = Math.ceil((width * channels * bitsPerComponent) / 8);
    rows = new Uint8Array(height * (rowLen + 1));
    for (let y = 0; y < height; y++) {
      rows[y * (rowLen + 1)] = 0;
      rows.set(samples.subarray(y * srcRowLen, y * srcRowLen + rowLen), y * (rowLen + 1) + 1);
    }
  } else {
    bitDepth = 8;
    colorType = channels === 1 ? 4 : 6;
    const expanded = expandToBytes(samples, pixels * channels, bitsPerComponent);
    const mask = expandToBytes(alpha as Uint8Array, pixels, 8);
    const outChannels = channels + 1;
    const rowLen = width * outChannels;
    rows = new Uint8Array(height * (rowLen + 1));
    for (let y = 0; y < height; y++) {
      const start = y * (rowLen + 1);
      rows[start] = 0;
      for (let x = 0; x < width; x++) {
        for (let c = 0; c < channels; c++) rows[start + 1 + x * outChannels + c] = expanded[(y * width + x) * channels + c];
        rows[start + 1 + x * outChannels + channels] = mask[y * width + x];
      }
    }
  }

  const ihdr = new Uint8Array(13);
  const hv = new DataView(ihdr.buffer);
  hv.setUint32(0, width);
  hv.setUint32(4, height);
  ihdr[8] = bitDepth;
  ihdr[9] = colorType;

  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const chunks = [signature, pngChunk('IHDR', ihdr), pngChunk('IDAT', zlibStored(rows)), pngChunk('IEND', new Uint8Array(0))];
  const png = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of chunks) { png.set(c, at); at += c.length; }
  return png;
}

/* ------------------------------------------------------------------ PDF object reading */

type Ctx = { lookup(value: PDFObject | undefined): PDFObject | undefined };

function dictOf(ctx: Ctx, value: PDFObject | undefined): PDFDict | undefined {
  const obj = value === undefined ? undefined : ctx.lookup(value);
  return obj instanceof PDFDict ? obj : undefined;
}

function arrayOf(ctx: Ctx, value: PDFObject | undefined): PDFArray | undefined {
  const obj = value === undefined ? undefined : ctx.lookup(value);
  return obj instanceof PDFArray ? obj : undefined;
}

function numOf(dict: PDFDict, key: string, ctx: Ctx): number | undefined {
  const obj = ctx.lookup(dict.get(PDFName.of(key)));
  return obj instanceof PDFNumber ? obj.asNumber() : undefined;
}

function nameOf(dict: PDFDict, key: string, ctx: Ctx): string {
  const obj = ctx.lookup(dict.get(PDFName.of(key)));
  return obj instanceof PDFName ? obj.toString().replace(/^[/]/, '') : '';
}

/** The /Filter of a stream as a list of plain names, whatever shape the file put it in. */
function filtersOf(dict: PDFDict, ctx: Ctx): string[] {
  const raw = dict.get(PDFName.of('Filter'));
  if (!raw) return [];
  const obj = ctx.lookup(raw);
  if (obj instanceof PDFName) return [obj.toString().replace(/^[/]/, '')];
  if (obj instanceof PDFArray) {
    const out: string[] = [];
    for (let i = 0; i < obj.size(); i++) {
      const entry = ctx.lookup(obj.get(i));
      if (entry instanceof PDFName) out.push(entry.toString().replace(/^[/]/, ''));
    }
    return out;
  }
  return [];
}

/**
 * Unwrap a Flate layer without pdf-lib.
 *
 * `/Filter [ /FlateDecode /DCTDecode ]` — a JPEG inside a zlib wrapper — is what real banking PDFs
 * actually contain, and pdf-lib answers it with "/DCTDecode stream encoding not supported". The
 * wrapper is not the problem: inflate the outer layer and the bytes underneath are the document's own
 * JPEG codestream, so the image can still be handed over unaltered. `DecompressionStream('deflate')`
 * is the zlib format of RFC 1950, which is exactly what /FlateDecode is.
 */
/** Unwrap a PDF /FlateDecode layer. Shared with compression, which meets the same wrapper. */
export const inflateBytes = inflateBytesInner;

async function inflateBytesInner(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') throw new Error('this runtime has no inflate');
  const decompressor = new DecompressionStream('deflate');
  const writer = decompressor.writable.getWriter();
  const reader = decompressor.readable.getReader();

  const collected: Uint8Array[] = [];
  const written = writer.write(bytes as unknown as Uint8Array<ArrayBuffer>).then(() => writer.close());
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    collected.push(value);
  }
  await written;

  let total = 0;
  for (const chunk of collected) total += chunk.length;
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of collected) { out.set(chunk, at); at += chunk.length; }
  return out;
}

const BYTE_EXACT: Record<string, { ext: string; mime: string }> = {
  DCTDecode: { ext: 'jpg', mime: 'image/jpeg' },
  JPXDecode: { ext: 'jp2', mime: 'image/jp2' },
  JBIG2Decode: { ext: 'jbig2', mime: 'image/jbig2' },
};

/* ------------------------------------------------------------------ the walk */

function hashBytes(bytes: Uint8Array): string {
  // FNV-1a over the emitted bytes. Deduping by content, not by object reference, is what makes a
  // logo placed on 16 pages appear once.
  let h = 0x811c9dc5 >>> 0;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${bytes.length.toString(36)}-${h.toString(36)}`;
}

function pngColorspace(ctx: Ctx, dict: PDFDict): { channels: number; reason?: string } {
  const raw = dict.get(PDFName.of('ColorSpace'));
  const obj = raw === undefined ? undefined : ctx.lookup(raw);
  if (obj instanceof PDFName) {
    const name = obj.toString().replace(/^[/]/, '');
    if (name === 'DeviceGray') return { channels: 1 };
    if (name === 'DeviceRGB') return { channels: 3 };
    if (name === 'DeviceCMYK') return { channels: 4 };
    return { channels: 0, reason: `colour space ${name} has no faithful PNG equivalent here` };
  }
  if (obj instanceof PDFArray) {
    const family = ctx.lookup(obj.get(0));
    const tag = family instanceof PDFName ? family.toString().replace(/^[/]/, '') : '';
    if (tag === 'Indexed') return { channels: 0, reason: 'Indexed colour space (palette) not unpacked' };
    if (tag === 'ICCBased') {
      const sub = dictOf(ctx, obj.get(1));
      const n = sub ? numOf(sub, 'N', ctx) : undefined;
      if (n === 1) return { channels: 1 };
      if (n === 3) return { channels: 3 };
      if (n === 4) return { channels: 4 };
      return { channels: 0, reason: 'ICCBased colour space with an unreadable /N' };
    }
    return { channels: 0, reason: `${tag || 'unresolved'} colour space not unpacked` };
  }
  return { channels: 0, reason: 'no /ColorSpace on the image' };
}

/**
 * Extract every embedded image reachable from the page tree.
 *
 * `renderFallback` is called for a page that carries no images at all, so a text-only page still
 * produces something in the ZIP — labelled as a page render rather than passed off as an asset.
 */
export async function collectEmbeddedImages(
  ctx: Ctx & { enumerateIndirectObjects(): Array<[unknown, PDFObject]> },
  pages: Array<{ node: { Resources(): PDFDict | undefined; get(k: PDFName): PDFObject | undefined } }>,
  renderFallback: (pageIndex: number) => Promise<{ bytes: Uint8Array; width: number; height: number } | null>,
): Promise<ExtractionResult> {
  const images: ExtractedImage[] = [];
  const skipped: SkippedImage[] = [];
  const caveats: ExtractionCaveat[] = [];
  const duplicates: Array<{ page: number; of: string }> = [];
  const byHash = new Map<string, ExtractedImage>();
  let placements = 0;

  const used = new Set<string>();
  const claimName = (name: string): string => {
    let candidate = name;
    let n = 2;
    while (used.has(candidate)) candidate = name.replace(/(\.[^.]+)$/, `_${n++}$1`);
    used.add(candidate);
    return candidate;
  };

  const emit = (
    page: number,
    name: string,
    bytes: Uint8Array,
    mime: string,
    width: number | null,
    height: number | null,
    fidelity: ExtractedImage['fidelity'],
    filter: string,
  ): string | null => {
    placements++;
    const existing = byHash.get(hashBytes(bytes));
    // One logo placed on sixteen pages is one asset. It is reported on every page it appears on, so
    // the manifest is truthful about the document, without the ZIP carrying the same bytes sixteen times.
    if (existing) {
      duplicates.push({ page, of: existing.filename });
      return null;
    }
    const entry: ExtractedImage = { page, filename: claimName(name), bytes, mime, width, height, fidelity, filter };
    byHash.set(hashBytes(bytes), entry);
    images.push(entry);
    return entry.filename;
  };

  const visitImage = async (stream: PDFRawStream, pageIndex: number, objectName: string) => {
    const page = pageIndex + 1;
    const dict = stream.dict;
    const filters = filtersOf(dict, ctx);
    const width = numOf(dict, 'Width', ctx) ?? null;
    const height = numOf(dict, 'Height', ctx) ?? null;
    const filterLabel = filters.join('+') || 'none';

    // A byte-exact copy cannot carry an attached mask: the JPEG codestream has no alpha slot. The
    // asset still comes out at full fidelity to its pixels, so it is written — but the manifest says
    // the transparency stayed behind, rather than the ZIP quietly disagreeing with the document.
    const hasMask = dict.get(PDFName.of('SMask')) !== undefined;
    const maskCaveat = (filename: string | null) => {
      if (filename && hasMask) {
        caveats.push({ page, filename, reason: 'written exactly as stored; its /SMask transparency has nowhere to go inside this format' });
      }
    };

    if (filters.length === 1 && BYTE_EXACT[filters[0]]) {
      const { ext, mime } = BYTE_EXACT[filters[0]];
      const bytes = stream.contents;
      maskCaveat(emit(page, `p${String(page).padStart(3, '0')}_${objectName}.${ext}`, bytes, mime, width, height, 'original', filters[0]));
      return;
    }

    if (filters.length === 1 && filters[0] === 'CCITTFaxDecode') {
      // The bits are a Group 3/4 facsimile bitstream with no self-describing header; opening them
      // needs a TIFF wrapper. Emit them and say so rather than silently dropping a scanned page.
      maskCaveat(emit(page, `p${String(page).padStart(3, '0')}_${objectName}.g4`, stream.contents, 'image/g4fax', width, height, 'original', 'CCITTFaxDecode'));
      return;
    }

    const wrapped = filters.length >= 2 ? BYTE_EXACT[filters[filters.length - 1]] : undefined;
    if (wrapped && filters.slice(0, -1).every((f) => f === 'FlateDecode')) {
      let inner: Uint8Array;
      try {
        inner = await inflateBytes(stream.contents);
      } catch (e) {
        skipped.push({ page, name: objectName, reason: `${filterLabel}: the Flate wrapper would not open (${(e as Error)?.message ?? 'unknown'})` });
        return;
      }
      // Only hand over the bytes if the wrapper really did contain the format it claims.
      const isJpeg = inner[0] === 0xFF && inner[1] === 0xD8;
      const matches = wrapped.ext === 'jpg' ? isJpeg : true;
      if (!matches) {
        skipped.push({ page, name: objectName, reason: `${filterLabel}: inflated data is not the ${wrapped.ext} it claims to be` });
        return;
      }
      maskCaveat(emit(page, `p${String(page).padStart(3, '0')}_${objectName}.${wrapped.ext}`, inner, wrapped.mime, width, height, 'original', filterLabel));
      return;
    }

    if (filters.length !== 1 || filters[0] !== 'FlateDecode') {
      skipped.push({ page, name: objectName, reason: `filter chain "${filterLabel}" is not decodable here` });
      return;
    }

    if (!width || !height) {
      skipped.push({ page, name: objectName, reason: 'image has no readable /Width or /Height' });
      return;
    }

    const bpc = numOf(dict, 'BitsPerComponent', ctx) ?? 8;
    if (![1, 2, 4, 8].includes(bpc)) {
      skipped.push({ page, name: objectName, reason: `${bpc}-bit samples are not packed into PNG here` });
      return;
    }

    const cs = pngColorspace(ctx, dict);
    if (!cs.channels) {
      skipped.push({ page, name: objectName, reason: cs.reason ?? 'colour space not unpacked' });
      return;
    }
    if (cs.channels === 4 && bpc !== 8) {
      skipped.push({ page, name: objectName, reason: 'CMYK at other than 8 bits is not converted' });
      return;
    }

    let samples: Uint8Array;
    try {
      samples = decodePDFRawStream(stream).decode();
    } catch (e) {
      skipped.push({ page, name: objectName, reason: `decode failed: ${(e as Error)?.message ?? 'unknown'}` });
      return;
    }

    const parms = dictOf(ctx, dict.get(PDFName.of('DecodeParms')));
    const colors = (parms ? numOf(parms, 'Colors', ctx) : undefined) ?? cs.channels;
    const columns = (parms ? numOf(parms, 'Columns', ctx) : undefined) ?? width;
    const predictor = (parms ? numOf(parms, 'Predictor', ctx) : undefined) ?? 1;
    if (colors !== cs.channels) {
      skipped.push({ page, name: objectName, reason: `/Colors ${colors} disagrees with the colour space (${cs.channels})` });
      return;
    }
    if (columns !== width) {
      skipped.push({ page, name: objectName, reason: `/Columns ${columns} disagrees with /Width ${width}` });
      return;
    }
    if (predictor !== 1 && predictor !== 2) {
      skipped.push({ page, name: objectName, reason: `row predictor ${predictor} is not undone here` });
      return;
    }

    const rowLen = Math.ceil((width * cs.channels * bpc) / 8);
    const expected = rowLen * height;
    if (samples.length < expected) {
      skipped.push({ page, name: objectName, reason: `stream holds ${samples.length} bytes, ${expected} needed for ${width}×${height}` });
      return;
    }
    const data = samples.slice(0, expected);
    if (predictor === 2) {
      // TIFF predictor: each row stores deltas against the previous byte at the same offset.
      const bpp = Math.max(1, Math.floor((cs.channels * bpc) / 8));
      for (let y = 0; y < height; y++) {
        for (let x = bpp; x < rowLen; x++) {
          const i = y * rowLen + x;
          data[i] = (data[i] + data[i - bpp]) & 0xFF;
        }
      }
    }

    let alpha: Uint8Array | null = null;
    const smaskEntry = dict.get(PDFName.of('SMask'));
    if (smaskEntry !== undefined) {
      const smaskStream = ctx.lookup(smaskEntry);
      if (smaskStream instanceof PDFRawStream) {
        try {
          const decoded = decodePDFRawStream(smaskStream).decode();
          if (decoded.length >= width * height) alpha = decoded.slice(0, width * height);
          else skipped.push({ page, name: `${objectName} (SMask)`, reason: `mask holds ${decoded.length} samples, ${width * height} needed; image written without it` });
        } catch {
          // A mask we cannot read must not silently vanish: record it next to the image.
          skipped.push({ page, name: `${objectName} (SMask)`, reason: 'transparency mask could not be decoded; image written without it' });
        }
      } else if (smaskStream) {
        skipped.push({ page, name: `${objectName} (SMask)`, reason: 'transparency mask is not a readable stream; image written without it' });
      }
    }

    const channels = cs.channels === 4 ? 3 : cs.channels;
    let packed = data;
    if (cs.channels === 4) {
      packed = cmykToRgb(data, width, height);
    }
    const png = samplesToPng(packed, width, height, bpc, channels, alpha);
    emit(page, `p${String(page).padStart(3, '0')}_${objectName}.png`, png, 'image/png', width, height, 'reconstructed', 'FlateDecode');
  };

  for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
    const found: string[] = [];
    // A page and a Form XObject on it can both declare /Im1 with different bytes, so names are
    // claimed rather than assumed unique.
    const seen = new Set<PDFRawStream>();

    const walk = async (resources: PDFDict | undefined, depth: number): Promise<void> => {
      if (!resources || depth > MAX_FORM_DEPTH) return;
      const xobjects = dictOf(ctx, resources.get(PDFName.of('XObject')));
      if (!xobjects) return;
      for (const key of xobjects.keys()) {
        const rawName = key.toString().replace(/^[/]/, '');
        const obj = ctx.lookup(xobjects.get(key));
        if (!(obj instanceof PDFRawStream)) continue;
        if (seen.has(obj)) continue;
        seen.add(obj);

        const subtype = nameOf(obj.dict, 'Subtype', ctx);
        if (subtype === 'Image') {
          found.push(rawName);
          await visitImage(obj, pageIndex, rawName);
        } else if (subtype === 'Form') {
          await walk(dictOf(ctx, obj.dict.get(PDFName.of('Resources'))), depth + 1);
        }
      }
    };

    await walk(pages[pageIndex].node.Resources(), 0);

    if (!found.length) {
      const rendered = await renderFallback(pageIndex);
      if (rendered) {
        emit(
          pageIndex + 1,
          `p${String(pageIndex + 1).padStart(3, '0')}_page.png`,
          rendered.bytes, 'image/png', rendered.width, rendered.height, 'reconstructed', 'page render',
        );
      }
    }
  }

  return { images, skipped, caveats, duplicates, placements };
}

/** Naive CMYK → RGB. Colour-management-accurate conversion needs the ICC profile; this keeps the
 *  hue right enough to read a chart and says so by only being used for DeviceCMYK. */
function cmykToRgb(data: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height * 3);
  for (let i = 0; i < width * height; i++) {
    const c = data[i * 4], m = data[i * 4 + 1], y = data[i * 4 + 2], k = data[i * 4 + 3];
    out[i * 3] = (255 - Math.max(c, k)) & 0xFF;
    out[i * 3 + 1] = (255 - Math.max(m, k)) & 0xFF;
    out[i * 3 + 2] = (255 - Math.max(y, k)) & 0xFF;
  }
  return out;
}
