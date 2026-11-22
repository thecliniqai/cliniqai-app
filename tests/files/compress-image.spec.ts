/**
 * V2-09c 09C-05 (R-15, T-09C-10): the pure parts of the browser's photo compression: the attempt schedule, the output size, the file name and the removal
 * of metadata segments from a JPEG. The browser half (decoding, the canvas, the budget on real photos) is proved in tests/e2e/consult/capture-compress.spec.ts.
 */
import { describe, expect, it } from "vitest";
import {
  COMPRESS_ATTEMPTS,
  COMPRESS_MAX_ATTEMPTS,
  COMPRESS_TARGET_BYTES,
  isCompressibleImage,
  jpegName,
  prepareImageForUpload,
  scaledSize,
  stripJpegMetadata,
  UPLOAD_LIMIT_BYTES,
} from "@/lib/files/compress-image";
import { exifGpsSegment, GPS_MARKER_TEXT, jpegInfo, withExifGps } from "../e2e/support/jpeg";

/** A tiny but structurally valid JPEG: SOI, APP0 (JFIF), DQT-like filler, SOF0 (width x height), SOS, entropy bytes, EOI. */
function tinyJpeg(width = 40, height = 30): Buffer {
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]);
  const dqt = Buffer.concat([Buffer.from([0xff, 0xdb, 0x00, 0x43, 0x00]), Buffer.alloc(64, 8)]);
  const sof = Buffer.from([0xff, 0xc0, 0x00, 0x0b, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x01, 0x01, 0x11, 0x00]);
  const sos = Buffer.from([0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0xaa, 0xbb, 0xcc, 0xff, 0xd9]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, dqt, sof, sos]);
}

describe("the attempt schedule (R-15)", () => {
  it("is quality 0.82, 0.7, 0.6, 0.5 at full size, then 0.5 at 0.8 and 0.64 of the size: six attempts, the target 1 MB, the server's limit 4 MB", () => {
    expect(COMPRESS_ATTEMPTS).toEqual([
      { quality: 0.82, scale: 1 },
      { quality: 0.7, scale: 1 },
      { quality: 0.6, scale: 1 },
      { quality: 0.5, scale: 1 },
      { quality: 0.5, scale: 0.8 },
      { quality: 0.5, scale: 0.64 },
    ]);
    expect(COMPRESS_MAX_ATTEMPTS).toBe(6);
    expect(COMPRESS_TARGET_BYTES).toBe(1024 * 1024);
    expect(UPLOAD_LIMIT_BYTES).toBe(4 * 1024 * 1024);
  });
});

describe("scaledSize", () => {
  it.each([
    [4000, 3000, 1, { width: 2000, height: 1500 }],
    [3000, 4000, 1, { width: 1500, height: 2000 }],
    [1600, 1200, 1, { width: 1600, height: 1200 }],
    [4000, 3000, 0.8, { width: 1600, height: 1200 }],
    [4000, 3000, 0.64, { width: 1280, height: 960 }],
    [2000, 2000, 1, { width: 2000, height: 2000 }],
    [10, 1, 0.64, { width: 6, height: 1 }],
  ])("%i x %i at scale %f is %o", (w, h, scale, expected) => {
    expect(scaledSize(w, h, scale)).toEqual(expected);
  });
});

describe("file names and types", () => {
  it("the extension becomes .jpg", () => {
    expect(jpegName("IMG_1234.PNG")).toBe("IMG_1234.jpg");
    expect(jpegName("scan.final.webp")).toBe("scan.final.jpg");
    expect(jpegName("noext")).toBe("noext.jpg");
    expect(jpegName(".png")).toBe("photo.jpg");
  });
  it("only JPEG, PNG and WEBP are compressed", () => {
    expect(["image/jpeg", "image/png", "image/webp"].every(isCompressibleImage)).toBe(true);
    expect(["application/pdf", "image/gif", "image/heic", ""].some(isCompressibleImage)).toBe(false);
  });
});

describe("stripJpegMetadata (T-09C-10)", () => {
  it("removes an Exif APP1 with GPS tags and keeps every other byte", () => {
    const plain = tinyJpeg();
    const tagged = withExifGps(plain);
    expect(jpegInfo(tagged).hasExif).toBe(true);
    expect(tagged.includes(GPS_MARKER_TEXT)).toBe(true);
    const stripped = Buffer.from(stripJpegMetadata(tagged));
    expect(stripped.equals(plain)).toBe(true);
    expect(jpegInfo(stripped).hasApp1).toBe(false);
    expect(stripped.includes(GPS_MARKER_TEXT)).toBe(false);
  });
  it("removes several metadata segments (APP1 twice, APP13, a comment) and keeps APP0, the tables and the scan", () => {
    const plain = tinyJpeg();
    const app13 = Buffer.from([0xff, 0xed, 0x00, 0x06, 0x50, 0x68, 0x6f, 0x74]);
    const com = Buffer.from([0xff, 0xfe, 0x00, 0x07, 0x68, 0x65, 0x6c, 0x6c, 0x6f]);
    const messy = Buffer.concat([plain.subarray(0, 2), exifGpsSegment(), app13, com, exifGpsSegment(), plain.subarray(2)]);
    expect(Buffer.from(stripJpegMetadata(messy)).equals(plain)).toBe(true);
  });
  it("keeps an ICC profile (APP2) and the picture size", () => {
    const plain = tinyJpeg(64, 48);
    const icc = Buffer.from([0xff, 0xe2, 0x00, 0x0e, 0x49, 0x43, 0x43, 0x5f, 0x50, 0x52, 0x4f, 0x46, 0x49, 0x4c, 0x45, 0x00]);
    const withIcc = Buffer.concat([plain.subarray(0, 2), icc, exifGpsSegment(), plain.subarray(2)]);
    const stripped = Buffer.from(stripJpegMetadata(withIcc));
    const info = jpegInfo(stripped);
    expect(info.markers).toContain(0xe2);
    expect(info.hasApp1).toBe(false);
    expect([info.width, info.height]).toEqual([64, 48]);
  });
  it("leaves bytes that are not a JPEG, or whose segments cannot be walked, as they are", () => {
    const text = Buffer.from("not a jpeg at all");
    expect(Buffer.from(stripJpegMetadata(text)).equals(text)).toBe(true);
    const truncated = tinyJpeg().subarray(0, 30);
    expect(Buffer.from(stripJpegMetadata(truncated)).equals(truncated)).toBe(true);
    const badLength = Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff, 0x00, 0x00]);
    expect(Buffer.from(stripJpegMetadata(badLength)).equals(badLength)).toBe(true);
  });
});

describe("prepareImageForUpload without a browser", () => {
  it("passes a PDF through unchanged when it is within the limit, and refuses a file over it with the size text", async () => {
    const pdf = new File([new Uint8Array(1000)], "r.pdf", { type: "application/pdf" });
    const ok = await prepareImageForUpload(pdf);
    expect(ok).toMatchObject({ ok: true, compressed: false, inputBytes: 1000, outputBytes: 1000 });
    expect(ok.ok && ok.file).toBe(pdf);
    const big = new File([new Uint8Array(UPLOAD_LIMIT_BYTES + 1)], "big.pdf", { type: "application/pdf" });
    expect(await prepareImageForUpload(big)).toEqual({ ok: false, error: "File is larger than 4 MB, the upload limit. Please upload a smaller file." });
  });
  // 09C-06a (A-6, S-4): without a browser nothing decodes, so every picture takes the pass-through path: it goes up only without its metadata, or not at all.
  it("an undecodable JPEG with an Exif GPS block goes up without the APP1 segment (and nothing else changed); one over the limit is refused", async () => {
    const withGps = withExifGps(tinyJpeg());
    expect(jpegInfo(withGps)).toMatchObject({ hasApp1: true, hasExif: true, hasGpsBytes: true });
    const res = await prepareImageForUpload(new File([new Uint8Array(withGps)], "IMG_0001.jpg", { type: "image/jpeg" }));
    expect(res).toMatchObject({ ok: true, compressed: false });
    if (!res.ok) return;
    const sent = Buffer.from(await res.file.arrayBuffer());
    expect(jpegInfo(sent)).toMatchObject({ hasApp1: false, hasExif: false, hasGpsBytes: false });
    expect(sent.equals(tinyJpeg())).toBe(true);
    const big = new File([new Uint8Array(UPLOAD_LIMIT_BYTES + 1).fill(0x41)], "broken.jpg", { type: "image/jpeg" });
    expect(await prepareImageForUpload(big)).toEqual({ ok: false, error: "This photo could not be compressed. Try a smaller photo or a PDF." });
  });

  it("an undecodable PNG goes up without its eXIf, tEXt, iTXt and zTXt chunks; the picture chunks are kept byte for byte", async () => {
    const clean = Buffer.concat([PNG_SIG, pngChunk("IHDR", Buffer.alloc(13, 1)), pngChunk("IDAT", Buffer.alloc(20, 2)), pngChunk("IEND", Buffer.alloc(0))]);
    const dirty = Buffer.concat([
      PNG_SIG,
      pngChunk("IHDR", Buffer.alloc(13, 1)),
      pngChunk("eXIf", GPS_MARKER_TEXT),
      pngChunk("tEXt", Buffer.from("Comment\0Synthetic")),
      pngChunk("iTXt", Buffer.from("XML:com.adobe.xmp\0\0\0\0\0<x/>")),
      pngChunk("zTXt", Buffer.from("Raw\0\0xx")),
      pngChunk("IDAT", Buffer.alloc(20, 2)),
      pngChunk("IEND", Buffer.alloc(0)),
    ]);
    const res = await prepareImageForUpload(new File([new Uint8Array(dirty)], "scan.png", { type: "image/png" }));
    expect(res).toMatchObject({ ok: true, compressed: false });
    if (!res.ok) return;
    const sent = Buffer.from(await res.file.arrayBuffer());
    expect(sent.equals(clean)).toBe(true);
    expect(sent.includes(GPS_MARKER_TEXT)).toBe(false);
  });

  it("an undecodable WebP goes up without its EXIF and XMP chunks, the VP8X flags cleared and the RIFF size corrected", async () => {
    const vp8x = Buffer.alloc(10);
    vp8x[0] = 0x0c; // the "has Exif" and "has XMP" flags
    const dirty = webp([webpChunk("VP8X", vp8x), webpChunk("VP8 ", Buffer.alloc(11, 3)), webpChunk("EXIF", GPS_MARKER_TEXT), webpChunk("XMP ", Buffer.from("<x:xmpmeta/>"))]);
    const res = await prepareImageForUpload(new File([new Uint8Array(dirty)], "photo.webp", { type: "image/webp" }));
    expect(res).toMatchObject({ ok: true, compressed: false });
    if (!res.ok) return;
    const sent = Buffer.from(await res.file.arrayBuffer());
    expect(sent.includes(GPS_MARKER_TEXT)).toBe(false);
    expect(sent.includes(Buffer.from("xmpmeta"))).toBe(false);
    expect(sent.equals(webp([webpChunk("VP8X", Buffer.alloc(10)), webpChunk("VP8 ", Buffer.alloc(11, 3))]))).toBe(true);
    expect(sent.readUInt32LE(4)).toBe(sent.length - 8);
  });

  it("a picture whose structure cannot be walked is refused with the fixed text, never sent as it is", async () => {
    for (const [name, type] of [["broken.jpg", "image/jpeg"], ["broken.png", "image/png"], ["broken.webp", "image/webp"]] as const) {
      const junk = new File([new Uint8Array(2000).fill(0x41)], name, { type });
      expect(await prepareImageForUpload(junk)).toEqual({ ok: false, error: "This photo could not be compressed. Try a smaller photo or a PDF." });
    }
    // A JPEG cut off before its picture data cannot be walked to the end of its metadata either.
    const cut = withExifGps(tinyJpeg()).subarray(0, 30);
    expect(await prepareImageForUpload(new File([new Uint8Array(cut)], "cut.jpg", { type: "image/jpeg" }))).toEqual({ ok: false, error: "This photo could not be compressed. Try a smaller photo or a PDF." });
  });
});

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** A PNG chunk: length, type, data, and a CRC (not checked by the stripper; zeros here). */
function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  return Buffer.concat([length, Buffer.from(type, "latin1"), data, Buffer.alloc(4)]);
}
function webpChunk(type: string, data: Buffer): Buffer {
  const size = Buffer.alloc(4);
  size.writeUInt32LE(data.length);
  return Buffer.concat([Buffer.from(type, "latin1"), size, data, data.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0)]);
}
function webp(chunks: Buffer[]): Buffer {
  const body = Buffer.concat([Buffer.from("WEBP", "latin1"), ...chunks]);
  const size = Buffer.alloc(4);
  size.writeUInt32LE(body.length);
  return Buffer.concat([Buffer.from("RIFF", "latin1"), size, body]);
}
