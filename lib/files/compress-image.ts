/**
 * Client-side image compression (V2-09c 09C-05, R-15, FT-04; PWA §6.5). Browser APIs only, no library.
 *
 * Every JPEG, PNG or WEBP is decoded and re-encoded as a JPEG, at most 2,000 px on the long edge, quality 0.82, then 0.7, 0.6 and 0.5, then scaled down by 0.8
 * a step, until it is at most 1 MB (at most six attempts). Re-encoding draws pixels only: the Exif block, with its location tags, the thumbnail and the maker's
 * notes, is not carried over, so a phone photo reaches the server without where it was taken; whatever metadata an engine's own encoder adds (Safari writes an
 * Exif block) is cut from the result (`stripJpegMetadata`). A PDF (or anything that is not an image) passes unchanged.
 *
 * When the picture cannot be decoded the original goes up if it is within the server's 4 MB limit (the server still checks the bytes against the type), and is
 * refused with a fixed text otherwise. The smallest result that fits the server's limit is accepted when the 1 MB target is out of reach in six attempts.
 * Nothing here reads or reports the file's content: the failure tag is `files.compress.failed` with the error's class only.
 */
import { reportClientError } from "@/lib/log/client";

export const COMPRESS_TARGET_BYTES = 1024 * 1024;
export const COMPRESS_MAX_EDGE = 2000;
export const COMPRESS_MAX_ATTEMPTS = 6;
/** What the server takes (R-U): the result of the compression and an original that could not be compressed are both held to it. */
export const UPLOAD_LIMIT_BYTES = 4 * 1024 * 1024;
export const COMPRESS_FAILED_MESSAGE = "This photo could not be compressed. Try a smaller photo or a PDF.";

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export function isCompressibleImage(type: string): boolean {
  return (IMAGE_TYPES as readonly string[]).includes(type);
}

export interface CompressAttempt {
  /** JPEG quality, 0 to 1. */
  quality: number;
  /** Factor applied to the (already capped) dimensions. */
  scale: number;
}

/** The six attempts in order: the quality steps at full size, then the same lowest quality at 0.8 and 0.64 of the size. */
export const COMPRESS_ATTEMPTS: readonly CompressAttempt[] = [
  { quality: 0.82, scale: 1 },
  { quality: 0.7, scale: 1 },
  { quality: 0.6, scale: 1 },
  { quality: 0.5, scale: 1 },
  { quality: 0.5, scale: 0.8 },
  { quality: 0.5, scale: 0.64 },
];

/** The output size of a picture of `width` x `height`: the long edge at most `maxEdge`, then `scale`, never below 1 px. */
export function scaledSize(width: number, height: number, scale = 1, maxEdge = COMPRESS_MAX_EDGE): { width: number; height: number } {
  const fit = Math.min(1, maxEdge / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * fit * scale)), height: Math.max(1, Math.round(height * fit * scale)) };
}

/** `IMG_1234.PNG` becomes `IMG_1234.jpg`. */
export function jpegName(name: string): string {
  const stem = name.replace(/\.[^./\\]+$/, "");
  return `${stem || "photo"}.jpg`;
}

export type PrepareResult =
  | {
      ok: true;
      file: File;
      /** True when the file was re-encoded; false for a PDF or an original sent because it could not be decoded. */
      compressed: boolean;
      inputBytes: number;
      outputBytes: number;
      width?: number;
      height?: number;
    }
  | { ok: false; error: string };

interface Decoded {
  source: CanvasImageSource;
  width: number;
  height: number;
  release: () => void;
}

async function decode(file: File): Promise<Decoded | null> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() };
    } catch (err) {
      reportClientError("files.compress.failed", err);
    }
  }
  // A browser without createImageBitmap options: the image element applies the photo's orientation by itself.
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, release: () => URL.revokeObjectURL(url) };
  } catch (err) {
    URL.revokeObjectURL(url);
    reportClientError("files.compress.failed", err);
    return null;
  }
}

function encode(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), "image/jpeg", quality));
}

/** Markers whose segments carry metadata, not picture: APP1 (Exif, XMP), APP13 (Photoshop and IPTC) and COM (comments). APP0, the ICC profile (APP2) and the picture stay. */
const METADATA_MARKERS = new Set([0xe1, 0xed, 0xfe]);

/**
 * Removes the metadata segments of a JPEG (every APP1, APP13 and comment) and returns the rest byte for byte. A browser's encoder normally writes none, but
 * Safari's writes an Exif block of its own (picture size, colour space); the upload carries no Exif at all, whatever engine made it (T-09C-10). Bytes that are
 * not a JPEG, or whose segments cannot be walked, come back unchanged.
 */
export function stripJpegMetadata(bytes: Uint8Array): Uint8Array {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return bytes;
  const kept: Uint8Array[] = [bytes.subarray(0, 2)];
  let i = 2;
  while (i + 4 <= bytes.length) {
    if (bytes[i] !== 0xff) return bytes;
    const marker = bytes[i + 1];
    if (marker === 0xff) {
      i += 1;
      continue;
    }
    // The scan (and every marker without a length) starts the picture data: everything from here on is kept.
    if (marker === 0xda || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      kept.push(bytes.subarray(i));
      return concat(kept);
    }
    const length = (bytes[i + 2] << 8) | bytes[i + 3];
    if (length < 2 || i + 2 + length > bytes.length) return bytes;
    if (!METADATA_MARKERS.has(marker)) kept.push(bytes.subarray(i, i + 2 + length));
    i += 2 + length;
  }
  return bytes;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/**
 * Makes `file` ready to upload: re-encodes an image within the budget, passes anything else through. Never throws; a refusal is `{ ok: false, error }`.
 * `limit` is the server's size limit (the 4 MB of R-U unless a caller knows better).
 */
export async function prepareImageForUpload(file: File, limit = UPLOAD_LIMIT_BYTES): Promise<PrepareResult> {
  const passThrough = (): PrepareResult =>
    file.size <= limit
      ? { ok: true, file, compressed: false, inputBytes: file.size, outputBytes: file.size }
      : { ok: false, error: isCompressibleImage(file.type) ? COMPRESS_FAILED_MESSAGE : "File is larger than 4 MB, the upload limit. Please upload a smaller file." };

  if (!isCompressibleImage(file.type)) return passThrough();

  const decoded = await decode(file);
  if (!decoded || decoded.width < 1 || decoded.height < 1) return passThrough();

  try {
    let smallest: { blob: Blob; width: number; height: number } | null = null;
    for (const attempt of COMPRESS_ATTEMPTS.slice(0, COMPRESS_MAX_ATTEMPTS)) {
      const size = scaledSize(decoded.width, decoded.height, attempt.scale);
      const canvas = document.createElement("canvas");
      canvas.width = size.width;
      canvas.height = size.height;
      const context = canvas.getContext("2d");
      if (!context) return passThrough();
      // A JPEG has no transparency: a PNG's clear pixels would turn black.
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, size.width, size.height);
      context.drawImage(decoded.source, 0, 0, size.width, size.height);
      const blob = await encode(canvas, attempt.quality);
      canvas.width = 0;
      canvas.height = 0;
      if (!blob) return passThrough();
      if (!smallest || blob.size < smallest.blob.size) smallest = { blob, ...size };
      if (blob.size <= COMPRESS_TARGET_BYTES) break;
    }
    if (!smallest || smallest.blob.size > limit) return passThrough();
    // The encoder's own metadata goes too (Safari writes an Exif block): the stored bytes carry no APP1 segment at all.
    const clean = stripJpegMetadata(new Uint8Array(await smallest.blob.arrayBuffer()));
    const out = new File([clean as BlobPart], jpegName(file.name), { type: "image/jpeg", lastModified: Date.now() });
    return { ok: true, file: out, compressed: true, inputBytes: file.size, outputBytes: out.size, width: smallest.width, height: smallest.height };
  } catch (err) {
    reportClientError("files.compress.failed", err);
    return passThrough();
  } finally {
    decoded.release();
  }
}
