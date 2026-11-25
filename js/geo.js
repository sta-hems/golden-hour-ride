// Geodata helpers for building courses in the browser: UTM maths, and the German 1 m terrain survey (DGM1)
// as GeoTIFF tiles from hoehendaten.de. Mirrors tools/dgm_de.py.

/* ---------- WGS84 latitude/longitude <-> ETRS89 / UTM (the two agree to well under a metre) ---------- */
const A = 6378137.0, F = 1 / 298.257222101, E2 = F * (2 - F), EP2 = E2 / (1 - E2), K0 = 0.9996;

export function llToUtm(lat, lon, zone = 32) {
  const p = lat * Math.PI / 180, l = (lon - (zone * 6 - 183)) * Math.PI / 180;
  const N = A / Math.sqrt(1 - E2 * Math.sin(p) ** 2), T = Math.tan(p) ** 2, C = EP2 * Math.cos(p) ** 2, Aa = Math.cos(p) * l;
  const M = A * ((1 - E2 / 4 - 3 * E2 ** 2 / 64 - 5 * E2 ** 3 / 256) * p - (3 * E2 / 8 + 3 * E2 ** 2 / 32 + 45 * E2 ** 3 / 1024) * Math.sin(2 * p)
    + (15 * E2 ** 2 / 256 + 45 * E2 ** 3 / 1024) * Math.sin(4 * p) - (35 * E2 ** 3 / 3072) * Math.sin(6 * p));
  const E = 500000 + K0 * N * (Aa + (1 - T + C) * Aa ** 3 / 6 + (5 - 18 * T + T * T + 72 * C - 58 * EP2) * Aa ** 5 / 120);
  const Nn = K0 * (M + N * Math.tan(p) * (Aa * Aa / 2 + (5 - T + 9 * C + 4 * C * C) * Aa ** 4 / 24 + (61 - 58 * T + T * T + 600 * C - 330 * EP2) * Aa ** 6 / 720));
  return [E, Nn];
}

export function utmToLl(E, N, zone = 32) {
  const x = E - 500000, m = N / K0, mu = m / (A * (1 - E2 / 4 - 3 * E2 ** 2 / 64 - 5 * E2 ** 3 / 256));
  const e1 = (1 - Math.sqrt(1 - E2)) / (1 + Math.sqrt(1 - E2));
  const p = mu + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * Math.sin(2 * mu) + (21 * e1 ** 2 / 16 - 55 * e1 ** 4 / 32) * Math.sin(4 * mu) + (151 * e1 ** 3 / 96) * Math.sin(6 * mu);
  const C = EP2 * Math.cos(p) ** 2, T = Math.tan(p) ** 2, Nn = A / Math.sqrt(1 - E2 * Math.sin(p) ** 2), R = A * (1 - E2) / (1 - E2 * Math.sin(p) ** 2) ** 1.5, D = x / (Nn * K0);
  const lat = p - (Nn * Math.tan(p) / R) * (D * D / 2 - (5 + 3 * T + 10 * C - 4 * C * C - 9 * EP2) * D ** 4 / 24);
  const lon = (D - (1 + 2 * T + C) * D ** 3 / 6) / Math.cos(p);
  return [lat * 180 / Math.PI, zone * 6 - 183 + lon * 180 / Math.PI];
}

export function haversine(a, b) {
  const r = Math.PI / 180, p1 = a[0] * r, p2 = b[0] * r, dp = p2 - p1, dl = (b[1] - a[1]) * r;
  return 2 * 6371000 * Math.asin(Math.sqrt(Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2));
}

/* ---------- GeoTIFF: 32-bit float, uncompressed or LZW, with or without a predictor, in strips or tiles ---------- */
function lzw(src, size) {
  const out = new Uint8Array(size), prefix = new Int32Array(4096), suffix = new Uint8Array(4096), first = new Uint8Array(4096), len = new Int32Array(4096);
  for (let i = 0; i < 256; i++) { prefix[i] = -1; suffix[i] = i; first[i] = i; len[i] = 1; }
  let next = 258, bits = 9, buf = 0, nbits = 0, pos = 0, prev = -1, op = 0;
  const put = c => {                    // write the string for code c
    const n = len[c]; if (op + n > size) return false;
    for (let k = n - 1, cc = c; k >= 0; k--, cc = prefix[cc]) out[op + k] = suffix[cc];
    op += n; return true;
  };
  for (;;) {
    while (nbits < bits) { if (pos >= src.length) return out; buf = ((buf << 8) | src[pos++]) & 0xffffff; nbits += 8; }
    const code = (buf >>> (nbits - bits)) & ((1 << bits) - 1); nbits -= bits;
    if (code === 256) { next = 258; bits = 9; prev = -1; continue; }
    if (code === 257) return out;
    if (prev === -1) { if (op < size) out[op++] = code; prev = code; continue; }
    let f;
    if (code < next) { if (!put(code)) return out; f = first[code]; }
    else { if (!put(prev) || op >= size) return out; out[op++] = first[prev]; f = first[prev]; }
    if (next < 4096) { prefix[next] = prev; suffix[next] = f; first[next] = first[prev]; len[next] = len[prev] + 1; next++; }
    if (next + 1 >= (1 << bits) && bits < 12) bits++;
    prev = code;
  }
}

export function readGeoTiff(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), le = bytes[0] === 0x49;
  const u16 = o => dv.getUint16(o, le), u32 = o => dv.getUint32(o, le);
  const ifd = u32(4), tags = {};
  for (let i = 0, n = u16(ifd); i < n; i++) {
    const o = ifd + 2 + i * 12, tag = u16(o), typ = u16(o + 2), count = u32(o + 4), size = { 3: 2, 4: 4, 12: 8 }[typ] || 1;
    const at = count * size <= 4 ? o + 8 : u32(o + 8), v = [];
    for (let k = 0; k < count && k < 100000; k++) v.push(typ === 3 ? u16(at + k * 2) : typ === 4 ? u32(at + k * 4) : typ === 12 ? dv.getFloat64(at + k * 8, le) : 0);
    tags[tag] = v;
  }
  const w = tags[256][0], h = tags[257][0], comp = (tags[259] || [1])[0], pred = (tags[317] || [1])[0];
  if ((tags[258] || [32])[0] !== 32 || (tags[339] || [3])[0] !== 3 || (comp !== 1 && comp !== 5)) throw new Error('unsupported GeoTIFF');
  const tiled = !!tags[322], bw = tiled ? tags[322][0] : w, bh = tiled ? tags[323][0] : (tags[278] || [h])[0];
  const offs = tiled ? tags[324] : tags[273], cnts = tiled ? tags[325] : tags[279], across = Math.ceil(w / bw);
  const out = new Float32Array(w * h);
  for (let b = 0; b < offs.length; b++) {
    const raw = bytes.subarray(offs[b], offs[b] + cnts[b]);
    const rows = Math.min(bh, tiled ? bh : h - b * bh), size = rows * bw * 4;
    const blk = comp === 5 ? lzw(raw, size) : raw.slice(0, size);
    let vals;
    if (pred === 2) {                    // horizontal differencing on the 32-bit words
      const u = new Uint32Array(rows * bw);
      const bdv = new DataView(blk.buffer, blk.byteOffset, blk.byteLength);
      for (let k = 0; k < u.length; k++) u[k] = bdv.getUint32(k * 4, le);
      for (let r = 0; r < rows; r++) for (let k = r * bw + 1; k < (r + 1) * bw; k++) u[k] = (u[k] + u[k - 1]) >>> 0;
      vals = new Float32Array(u.buffer);
    } else if (pred === 3) {             // floating point predictor: bytes differenced, then split into byte planes
      vals = new Float32Array(rows * bw); const vdv = new DataView(vals.buffer);
      for (let r = 0; r < rows; r++) {
        const row = blk.slice(r * bw * 4, (r + 1) * bw * 4);
        for (let k = 1; k < row.length; k++) row[k] = (row[k] + row[k - 1]) & 0xff;
        for (let x = 0; x < bw; x++) for (let p = 0; p < 4; p++) vdv.setUint8((r * bw + x) * 4 + (3 - p), row[p * bw + x]);
      }
      if (!new Uint8Array(new Uint16Array([1]).buffer)[0]) throw new Error('big-endian host');
    } else {
      vals = new Float32Array(rows * bw); const bdv = new DataView(blk.buffer, blk.byteOffset, blk.byteLength);
      for (let k = 0; k < vals.length; k++) vals[k] = bdv.getFloat32(k * 4, le);
    }
    const x0 = (b % across) * bw, y0 = Math.floor(b / across) * bh;
    for (let r = 0; r < rows && y0 + r < h; r++) out.set(vals.subarray(r * bw, r * bw + Math.min(bw, w - x0)), (y0 + r) * w + x0);
  }
  const scale = tags[33550], tie = tags[33922], res = scale ? scale[0] : 1;
  return { w, h, data: out, west: tie ? tie[3] - tie[0] * res : 0, north: tie ? tie[4] + tie[1] * res : 0, res };
}

/* ---------- a 1 km tile, kept at 2 m (a quarter of the memory, and plenty for a road) ---------- */
export function halve(t) {
  const w = t.w >> 1, h = t.h >> 1, d = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0, n = 0;
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) { const v = t.data[(y * 2 + dy) * t.w + x * 2 + dx]; if (v > -500 && v < 3000) { s += v; n++; } }
    d[y * w + x] = n ? s / n : -9999;
  }
  return { w, h, data: d, west: t.west, north: t.north, res: t.res * 2 };
}

export class Terrain {
  constructor() { this.tiles = new Map(); }
  set(i, j, t) { this.tiles.set(i + '_' + j, t); }
  at(E, N) {
    const t = this.tiles.get(Math.floor(E / 1000) + '_' + Math.floor(N / 1000));
    if (!t) return null;
    const { w, h, data: d, west, north, res } = t;
    const x = (E - west) / res - 0.5, y = (north - N) / res - 0.5;
    const x0 = Math.max(0, Math.min(w - 2, Math.floor(x))), y0 = Math.max(0, Math.min(h - 2, Math.floor(y)));
    const u = Math.min(1, Math.max(0, x - x0)), v = Math.min(1, Math.max(0, y - y0));
    const a = d[y0 * w + x0], b = d[y0 * w + x0 + 1], c = d[(y0 + 1) * w + x0], e = d[(y0 + 1) * w + x0 + 1];
    if (!(a > -500 && b > -500 && c > -500 && e > -500)) return null;
    return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + e * u) * v;
  }
}

export function b64ToBytes(s) { const bin = atob(s), out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; }
export function bytesToB64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
