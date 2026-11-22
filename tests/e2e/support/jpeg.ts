/**
 * JPEG bytes for the capture specs (V2-09c 09C-05, R-15, T-09C-10): reads the dimensions and the marker segments of a JPEG, and builds an Exif APP1 segment with
 * GPS tags to splice into a synthetic photo. No image library: the specs assert on stored bytes, not on what a decoder would show.
 */

export interface JpegInfo {
  width: number;
  height: number;
  /** The marker bytes of every segment before the scan, in order (0xE0 = APP0, 0xE1 = APP1, 0xC0 = SOF0...). */
  markers: number[];
  /** An APP1 segment that starts with "Exif". */
  hasExif: boolean;
  /** Any APP1 segment at all (Exif or XMP). */
  hasApp1: boolean;
  /** The text "GPS" or the synthetic coordinates appear anywhere in the bytes. */
  hasGpsBytes: boolean;
}

const SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

export function jpegInfo(bytes: Buffer): JpegInfo {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error("not a JPEG (no SOI)");
  const markers: number[] = [];
  let width = 0;
  let height = 0;
  let hasExif = false;
  let hasApp1 = false;
  let i = 2;
  while (i + 4 <= bytes.length) {
    if (bytes[i] !== 0xff) throw new Error(`bad marker at ${i}`);
    const marker = bytes[i + 1];
    if (marker === 0xff) {
      i += 1;
      continue;
    }
    if (marker === 0xda) break; // start of scan: the headers are behind us
    markers.push(marker);
    const length = bytes.readUInt16BE(i + 2);
    if (marker === 0xe1) {
      hasApp1 = true;
      if (bytes.subarray(i + 4, i + 8).toString("latin1") === "Exif") hasExif = true;
    }
    if (SOF.has(marker)) {
      height = bytes.readUInt16BE(i + 5);
      width = bytes.readUInt16BE(i + 7);
    }
    i += 2 + length;
  }
  return { width, height, markers, hasExif, hasApp1, hasGpsBytes: bytes.includes(Buffer.from("GPS\0")) || bytes.includes(GPS_MARKER_TEXT) };
}

/** A text the synthetic Exif carries in its maker note, so a leftover of it is found even if the tags were re-ordered. */
export const GPS_MARKER_TEXT = Buffer.from("E2E-GPS-LAT-12.9716-LON-77.5946");

function u16(n: number): Buffer {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n);
  return b;
}
function u32(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n);
  return b;
}
function entry(tag: number, type: number, count: number, value: Buffer): Buffer {
  return Buffer.concat([u16(tag), u16(type), u32(count), value.length === 4 ? value : Buffer.concat([value, Buffer.alloc(4 - value.length)])]);
}
function rational3(a: number, b: number, c: number): Buffer {
  return Buffer.concat([u32(a), u32(1), u32(b), u32(1), u32(c), u32(100)]);
}

/** A little-endian Exif APP1 segment (marker, length, "Exif", TIFF) with IFD0 -> GPS IFD (latitude 12 deg 58', longitude 77 deg 35') and the marker text. */
export function exifGpsSegment(): Buffer {
  const header = Buffer.concat([Buffer.from("II*\0", "latin1"), u32(8)]);
  const ifd0Size = 2 + 12 * 1 + 4;
  const gpsOffset = 8 + ifd0Size;
  const ifd0 = Buffer.concat([u16(1), entry(0x8825, 4, 1, u32(gpsOffset)), u32(0)]);
  const gpsEntries = 4;
  const gpsSize = 2 + 12 * gpsEntries + 4;
  const dataOffset = gpsOffset + gpsSize;
  const lat = rational3(12, 58, 1700);
  const lon = rational3(77, 35, 3900);
  const gps = Buffer.concat([
    u16(gpsEntries),
    entry(0x0001, 2, 2, Buffer.from("N\0", "latin1")),
    entry(0x0002, 5, 3, u32(dataOffset)),
    entry(0x0003, 2, 2, Buffer.from("E\0", "latin1")),
    entry(0x0004, 5, 3, u32(dataOffset + lat.length)),
    u32(0),
  ]);
  const tiff = Buffer.concat([header, ifd0, gps, lat, lon, GPS_MARKER_TEXT]);
  const body = Buffer.concat([Buffer.from("Exif\0\0", "latin1"), tiff]);
  const length = Buffer.alloc(2);
  length.writeUInt16BE(body.length + 2);
  return Buffer.concat([Buffer.from([0xff, 0xe1]), length, body]);
}

/** `jpeg` with an Exif APP1 segment (GPS tags) inserted right after SOI, before any other segment. */
export function withExifGps(jpeg: Buffer): Buffer {
  return Buffer.concat([jpeg.subarray(0, 2), exifGpsSegment(), jpeg.subarray(2)]);
}
