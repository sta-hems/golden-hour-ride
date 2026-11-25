"""German 1 m terrain (DGM1) from hoehendaten.de, as 1 x 1 km tiles in ETRS89 / UTM.

The state survey offices publish DGM1 as open data; https://hoehendaten.de serves it for all of
Germany through one API (POST /v1/rawtif, no key, about 20 tiles a minute). Tiles are cached, so a
course only downloads them once. Also reads a local DGM1 GeoTIFF, such as the Hessen test tile.

Pure Python (no GDAL or numpy): reads the GeoTIFFs the states publish, i.e. 32-bit float,
uncompressed or LZW, with or without a horizontal-difference predictor, in strips or tiles.
"""
import base64, json, math, os, struct, time, urllib.request, urllib.error
from array import array

API = 'https://api.hoehendaten.de:14444/v1/rawtif'
UA = {'User-Agent': 'golden-hour-ride-course-builder', 'Content-Type': 'application/json',
      'Accept': 'application/json', 'Accept-Encoding': 'gzip'}
NODATA = -9999


def http(url, data=None, headers=None, timeout=180):
    """GET, or POST when data is given. Uses curl: the Python that ships with macOS can't talk TLS to some of these servers."""
    import subprocess
    cmd = ['curl', '-sS', '--fail', '--compressed', '-m', str(timeout), '-A', 'golden-hour-ride-course-builder']
    for k, v in (headers or {}).items():
        if k.lower() not in ('user-agent', 'accept-encoding'): cmd += ['-H', f'{k}: {v}']
    if data is not None: cmd += ['--data-binary', '@-']
    r = subprocess.run(cmd + [url], input=data, capture_output=True)
    if r.returncode: raise IOError(f'curl {r.returncode}: {r.stderr.decode(errors="replace").strip()}')
    return r.stdout


def lzw_decode(data):
    """TIFF LZW (MSB first, early change)."""
    out = bytearray(); table = [bytes([i]) for i in range(256)] + [b'', b'']
    bits, buf, nbits, pos, prev = 9, 0, 0, 0, None
    n = len(data)
    while True:
        while nbits < bits:
            if pos >= n: return bytes(out)
            buf = (buf << 8) | data[pos]; pos += 1; nbits += 8
        code = (buf >> (nbits - bits)) & ((1 << bits) - 1); nbits -= bits
        if code == 256:
            table = table[:258]; bits = 9; prev = None; continue
        if code == 257: return bytes(out)
        if prev is None:
            entry = table[code]
        else:
            entry = table[code] if code < len(table) else prev + prev[:1]
            table.append(prev + entry[:1])
        out += entry; prev = entry
        if len(table) + 1 >= (1 << bits) and bits < 12: bits += 1


def read_geotiff(buf):
    """-> (width, height, heights as a flat row-major list, (west, north) of the top-left pixel corner, pixel size)."""
    f = '<' if buf[:2] == b'II' else '>'
    u16 = lambda o: struct.unpack_from(f + 'H', buf, o)[0]
    u32 = lambda o: struct.unpack_from(f + 'I', buf, o)[0]
    ifd = u32(4); tags = {}
    for i in range(u16(ifd)):
        o = ifd + 2 + i * 12; tag, typ, count = u16(o), u16(o + 2), u32(o + 4)
        size = {3: 2, 4: 4, 12: 8}.get(typ, 1)
        at = o + 8 if count * size <= 4 else u32(o + 8)
        if typ == 3: tags[tag] = [u16(at + k * 2) for k in range(count)]
        elif typ == 4: tags[tag] = [u32(at + k * 4) for k in range(count)]
        elif typ == 12: tags[tag] = list(struct.unpack_from(f + '%dd' % count, buf, at))
    w, h = tags[256][0], tags[257][0]
    comp, pred = tags.get(259, [1])[0], tags.get(317, [1])[0]
    if tags.get(258, [32])[0] != 32 or tags.get(339, [3])[0] != 3 or comp not in (1, 5):
        raise ValueError('unsupported GeoTIFF (bits %s, format %s, compression %s)' % (tags.get(258), tags.get(339), comp))
    tiled = 322 in tags
    bw, bh = (tags[322][0], tags[323][0]) if tiled else (w, tags.get(278, [h])[0])
    offs, cnts = (tags[324], tags[325]) if tiled else (tags[273], tags[279])
    across = math.ceil(w / bw)
    out = array('f', bytes(4 * w * h))
    for b, (o, c) in enumerate(zip(offs, cnts)):
        raw = buf[o:o + c]
        if comp == 5: raw = lzw_decode(raw)
        rows = len(raw) // (bw * 4)
        if pred == 2:                       # horizontal differencing on the 32-bit words
            words = list(struct.unpack(f + '%dI' % (rows * bw), raw[:rows * bw * 4]))
            for r in range(rows):
                s = r * bw
                for k in range(s + 1, s + bw): words[k] = (words[k] + words[k - 1]) & 0xFFFFFFFF
            vals = struct.unpack(f + '%df' % len(words), struct.pack(f + '%dI' % len(words), *words))
        elif pred == 3:                     # floating-point predictor: bytes differenced, then split by byte plane
            vals = []
            for r in range(rows):
                row = bytearray(raw[r * bw * 4:(r + 1) * bw * 4])
                for k in range(1, len(row)): row[k] = (row[k] + row[k - 1]) & 0xFF
                planes = [row[p * bw:(p + 1) * bw] for p in range(4)]
                vals += struct.unpack('>%df' % bw, bytes(planes[p][x] for x in range(bw) for p in range(4)))
        else:
            vals = struct.unpack(f + '%df' % (rows * bw), raw[:rows * bw * 4])
        x0, y0 = (b % across) * bw, (b // across) * bh if tiled else b * bh
        for r in range(rows):
            y = y0 + r
            if y >= h: break
            cnt = min(bw, w - x0)
            out[y * w + x0: y * w + x0 + cnt] = array('f', vals[r * bw: r * bw + cnt])
    scale, tie = tags.get(33550), tags.get(33922)
    res = scale[0] if scale else 1.0
    west, north = (tie[3] - tie[0] * res, tie[4] + tie[1] * res) if tie else (None, None)
    return w, h, out, (west, north), res


class DGM:
    """Heights in metres (DHHN2016) at ETRS89 / UTM coordinates, tile by tile, with bilinear lookup."""

    def __init__(self, cache, zone=32, local=()):
        self.cache, self.zone, self.tiles, self.credits = cache, zone, {}, set()
        os.makedirs(cache, exist_ok=True)
        for path in local:                  # GeoTIFFs already on disk, e.g. a state's test tile
            w, h, d, (west, north), res = read_geotiff(open(path, 'rb').read())
            self.tiles[(int(west // 1000), int((north - 1) // 1000))] = (w, h, d, west, north, res)

    def _fetch(self, i, j):
        """One tile, from the decoded cache if there is one (decoding LZW in pure Python takes a few seconds)."""
        f32 = os.path.join(self.cache, f'dgm1_{self.zone}_{i}_{j}.f32')
        if os.path.exists(f32):
            meta = json.load(open(f32 + '.json')); self.credits.update(meta['credits'])
            if meta.get('empty'): return None
            d = array('f'); d.frombytes(open(f32, 'rb').read())
            return (meta['w'], meta['h'], d, meta['west'], meta['north'], meta['res'])
        t = self._download(i, j)
        meta = {'credits': sorted(self.credits)}
        if t: meta.update(w=t[0], h=t[1], west=t[3], north=t[4], res=t[5]); open(f32, 'wb').write(t[2].tobytes())
        else: meta['empty'] = True; open(f32, 'wb').close()
        json.dump(meta, open(f32 + '.json', 'w'))
        return t

    def _download(self, i, j):
        path = os.path.join(self.cache, f'dgm1_{self.zone}_{i}_{j}.json')
        if not os.path.exists(path):
            body = json.dumps({'Type': 'RawTIFRequest', 'ID': f'{self.zone}_{i}_{j}',
                               'Attributes': {'Zone': self.zone, 'Easting': i * 1000 + 500.0, 'Northing': j * 1000 + 500.0}}).encode()
            for attempt in range(6):
                try:
                    data = http(API, body, UA, 120); break
                except IOError as ex:
                    if attempt == 5: raise
                    time.sleep(10 + attempt * 10)
            open(path, 'wb').write(data)
            time.sleep(3.2)                 # stay under the API's 20 tiles a minute
        res = json.load(open(path))
        a = res.get('Attributes') or {}
        if res.get('IsError') or not a.get('RawTIFs'): return None
        best = None
        for t in a['RawTIFs']:              # a tile on a state border comes once per state: merge them
            w, h, d, (west, north), px = read_geotiff(base64.b64decode(t['Data']))
            self.credits.add(t['Attribution'])
            if best is None: best = (w, h, d, west, north, px)
            else:
                bd = best[2]
                for k, v in enumerate(d):
                    if bd[k] <= NODATA + 1 and v > NODATA + 1: bd[k] = v
        os.remove(path)                     # the decoded copy is kept instead
        return best

    def need(self, keys):
        todo = [k for k in sorted(set(keys)) if k not in self.tiles]
        for n, (i, j) in enumerate(todo):
            print(f'  tile {n + 1}/{len(todo)}: {self.zone}_{i}_{j}', flush=True)
            try: self.tiles[(i, j)] = self._fetch(i, j)
            except Exception as ex: print('  tile failed', i, j, ex); self.tiles[(i, j)] = None

    def at(self, E, N):
        t = self.tiles.get((math.floor(E / 1000), math.floor(N / 1000)))
        if not t: return None
        w, h, d, west, north, res = t
        x = (E - west) / res - 0.5; y = (north - N) / res - 0.5
        x0 = max(0, min(w - 2, math.floor(x))); y0 = max(0, min(h - 2, math.floor(y)))
        u = min(1, max(0, x - x0)); v = min(1, max(0, y - y0))
        q = (d[y0 * w + x0], d[y0 * w + x0 + 1], d[(y0 + 1) * w + x0], d[(y0 + 1) * w + x0 + 1])
        if any(not (-500 < hh < 3000) for hh in q): return None
        return (q[0] * (1 - u) + q[1] * u) * (1 - v) + (q[2] * (1 - u) + q[3] * u) * v


def ll_to_utm(lat, lon, zone=32):
    """WGS84 latitude/longitude -> ETRS89 / UTM easting, northing (the two datums agree to well under a metre)."""
    a, f = 6378137.0, 1 / 298.257222101; e2 = f * (2 - f); ep2 = e2 / (1 - e2); k0 = 0.9996
    p, l = math.radians(lat), math.radians(lon - (zone * 6 - 183))
    N = a / math.sqrt(1 - e2 * math.sin(p) ** 2); T = math.tan(p) ** 2; C = ep2 * math.cos(p) ** 2; A = math.cos(p) * l
    M = a * ((1 - e2 / 4 - 3 * e2 ** 2 / 64 - 5 * e2 ** 3 / 256) * p - (3 * e2 / 8 + 3 * e2 ** 2 / 32 + 45 * e2 ** 3 / 1024) * math.sin(2 * p)
             + (15 * e2 ** 2 / 256 + 45 * e2 ** 3 / 1024) * math.sin(4 * p) - (35 * e2 ** 3 / 3072) * math.sin(6 * p))
    E = 500000 + k0 * N * (A + (1 - T + C) * A ** 3 / 6 + (5 - 18 * T + T * T + 72 * C - 58 * ep2) * A ** 5 / 120)
    Nn = k0 * (M + N * math.tan(p) * (A * A / 2 + (5 - T + 9 * C + 4 * C * C) * A ** 4 / 24 + (61 - 58 * T + T * T + 600 * C - 330 * ep2) * A ** 6 / 720))
    return E, Nn
