"""Builds a ride course anywhere in Germany from the states' 1 m terrain survey (DGM1) and OpenStreetMap.

    python3 tools/build_course_de.py tools/courses/idstein.json [--tile local.tif ...]

The course file names the course and gives its route, either as waypoints (routed along roads by the
OpenStreetMap routing service) or as a GPX track ("gpx": "path/to/ride.gpx"). Writes:
  assets/<id>.js       road line and terrain heights (same format as assets/leckhampton.js)
  assets/<id>_osm.js   buildings, woods, single trees, hedges and walls
  assets/courses.js    the list of courses the ride offers (this course is added or updated)

Heights: DGM1 tiles from hoehendaten.de (see dgm_de.py), cached in tools/.cache. --tile adds GeoTIFFs
already on disk, such as a state's test tile, so those squares are not downloaded.
"""
import base64, hashlib, json, math, os, re, struct, sys, time, urllib.parse, urllib.request
sys.path.insert(0, os.path.dirname(__file__))
from dgm_de import DGM, ll_to_utm, http

args = sys.argv[1:]
local = [args[k + 1] for k, a in enumerate(args) if a == '--tile']
cfg_path = next(a for k, a in enumerate(args) if not a.startswith('--') and (k == 0 or args[k - 1] != '--tile'))
cfg = json.load(open(cfg_path))
CID, ZONE = cfg['id'], cfg.get('zone', 32)
CACHE = 'tools/.cache'
os.makedirs(CACHE, exist_ok=True)
UA = {'User-Agent': 'golden-hour-ride-course-builder'}
MARGIN = cfg.get('margin', 1000)        # terrain around the route, metres


def get(url, name, data=None):
    """Cached download; the cache name carries a hash of the request, so a changed route or area is fetched afresh."""
    root, ext = os.path.splitext(name)
    name = f'{root}_{hashlib.sha1(url.encode() + (data or b"")).hexdigest()[:10]}{ext}'
    path = os.path.join(CACHE, name)
    if not os.path.exists(path):
        for attempt in range(5):
            try: body = http(url, data); break
            except Exception as ex:
                if attempt == 4: raise
                print('  retrying', name, ex); time.sleep(10 + attempt * 10)
        open(path, 'wb').write(body)
    return open(path, 'rb').read()


def hav(a, b):
    p1, p2 = math.radians(a[0]), math.radians(b[0]); dp = p2 - p1; dl = math.radians(b[1] - a[1])
    return 2 * 6371000 * math.asin(math.sqrt(math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2))


# ---- route: a GPX track, or waypoints routed along the roads
if cfg.get('gpx'):
    gpx = open(cfg['gpx'], encoding='utf-8').read()
    latlon = [(float(a), float(b)) for a, b in re.findall(r'<(?:trkpt|rtept)[^>]*?lat="([-\d.]+)"[^>]*?lon="([-\d.]+)"', gpx)]
    latlon += [(float(a), float(b)) for b, a in re.findall(r'<(?:trkpt|rtept)[^>]*?lon="([-\d.]+)"[^>]*?lat="([-\d.]+)"', gpx)] if not latlon else []
    print('gpx:', len(latlon), 'points')
else:
    prof = cfg.get('profile', 'car')
    url = f'https://routing.openstreetmap.de/routed-{prof}/route/v1/driving/' + ';'.join(f'{lon},{lat}' for lat, lon in cfg['waypoints']) + '?overview=full&geometries=geojson'
    data = json.loads(get(url, f'route_{CID}.json'))
    latlon = [(lat, lon) for lon, lat in data['routes'][0]['geometry']['coordinates']]
    print('router:', len(latlon), 'points,', round(data['routes'][0]['distance']), 'm')

out, i = [], 0                      # cut out-and-back spurs the router adds at waypoints
while i < len(latlon):
    out.append(latlon[i]); skip, run, j = -1, 0, i + 1
    while j < len(latlon) and run < 600:
        run += hav(latlon[j - 1], latlon[j])
        if run > 20 and hav(latlon[i], latlon[j]) < 8: skip = j
        j += 1
    i = skip + 1 if skip > 0 else i + 1
utm = [ll_to_utm(*p, ZONE) for p in out]
STEP = 5; line = [utm[0]]; carry = 0    # resample every 5 m
for a, b in zip(utm, utm[1:]):
    L = math.hypot(b[0] - a[0], b[1] - a[1])
    if L == 0: continue
    d = STEP - carry
    while d <= L:
        line.append((a[0] + (b[0] - a[0]) * d / L, a[1] + (b[1] - a[1]) * d / L)); d += STEP
    carry = L - (d - STEP)
gap = math.hypot(line[0][0] - line[-1][0], line[0][1] - line[-1][1])
print('route: %d m after cleaning; gap between ends %d m' % (len(line) * STEP, gap))
twice = set()
for i in range(0, len(line), 4):
    for j in range(i + 24, len(line), 4):
        if min(j - i, len(line) - j + i) * STEP > 120 and math.hypot(line[i][0] - line[j][0], line[i][1] - line[j][1]) < 20: twice.add(round(i * STEP / 100) / 10)
if twice: print('  WARNING: the route passes the same place twice near km', sorted(twice), '- move a waypoint onto the road you want, so the router does not double back')

# ---- the terrain square: route bounding box plus a margin, on a 10 m grid
Es, Ns = [p[0] for p in line], [p[1] for p in line]
CELL = 10
size = math.ceil((max(max(Es) - min(Es), max(Ns) - min(Ns)) + 2 * MARGIN) / 200) * 200
cE, cN = round((min(Es) + max(Es)) / 2 / CELL) * CELL, round((min(Ns) + max(Ns)) / 2 / CELL) * CELL
cells = size // CELL
dgm = DGM(CACHE, ZONE, local)
keys = {(i, j) for i in range(math.floor((cE - size / 2 - CELL) / 1000), math.floor((cE + size / 2 + CELL) / 1000) + 1)
        for j in range(math.floor((cN - size / 2 - CELL) / 1000), math.floor((cN + size / 2 + CELL) / 1000) + 1)}
print('terrain: %d m square, %d cells, %d tiles of 1 km (%d already here)' % (size, cells, len(keys), sum(1 for k in keys if k in dgm.tiles or os.path.exists(os.path.join(CACHE, f'dgm1_{ZONE}_{k[0]}_{k[1]}.f32')))))
dgm.need(keys)

# ---- OpenStreetMap, fetched before the road heights: bridges and side roads shape the road itself
HALF = size / 2
lat0, lon0 = out[0]
def utm_to_ll(E, N):                   # good enough to draw a query box: step from a known point
    la, lo_ = lat0, lon0
    for _ in range(6):
        e, n = ll_to_utm(la, lo_, ZONE)
        la += (N - n) / 111320; lo_ += (E - e) / (111320 * math.cos(math.radians(la)))
    return la, lo_
s_, w_ = utm_to_ll(cE - HALF, cN - HALF); n_, e_ = utm_to_ll(cE + HALF, cN + HALF)
s_, w_ = min(s_, utm_to_ll(cE + HALF, cN - HALF)[0]), min(w_, utm_to_ll(cE - HALF, cN + HALF)[1])
n_, e_ = max(n_, utm_to_ll(cE - HALF, cN + HALF)[0]), max(e_, utm_to_ll(cE + HALF, cN - HALF)[1])
bb = f'{s_:.5f},{w_:.5f},{n_:.5f},{e_:.5f}'
query = f'[out:json][timeout:180];(way["building"]({bb});way["natural"="wood"]({bb});way["landuse"="forest"]({bb});relation["natural"="wood"]({bb});relation["landuse"="forest"]({bb});node["natural"="tree"]({bb});way["barrier"~"^(hedge|wall|retaining_wall)$"]({bb});node["place"~"^(city|town|village|suburb|hamlet)$"]({bb}););out geom;'
def overpass(query, name):
    for k, server in enumerate(('https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter')):
        try:
            body = get(server, name, urllib.parse.urlencode({'data': query}).encode())
            return json.loads(body).get('elements', [])
        except (ValueError, IOError) as ex:           # a busy server answers with an HTML page instead of JSON
            print('  overpass', server, 'failed:', str(ex)[:80])
            cached = [f for f in os.listdir(CACHE) if f.startswith(os.path.splitext(name)[0] + '_')]
            for f in cached: os.remove(os.path.join(CACHE, f))
    sys.exit('OpenStreetMap (Overpass) did not answer; try again in a few minutes')
els = overpass(query, f'osm_{CID}.json')
rb = [utm_to_ll(min(Es) - 250, min(Ns) - 250), utm_to_ll(max(Es) + 250, max(Ns) + 250)]      # roads: only near the route
rbb = f'{rb[0][0]:.5f},{rb[0][1]:.5f},{rb[1][0]:.5f},{rb[1][1]:.5f}'
ways = overpass(f'[out:json][timeout:120];way["highway"]["highway"!~"^(footway|path|steps|pedestrian|bridleway|corridor|elevator|proposed|construction|platform)$"]({rbb});out tags geom;', f'osm_{CID}_roads.json')
print('osm elements:', len(els), '+ roads', len(ways))

# ---- road heights from the 1 m survey
hts = []
for k, (E, N) in enumerate(line):
    a, b = line[max(0, k - 1)], line[min(len(line) - 1, k + 1)]
    L = math.hypot(b[0] - a[0], b[1] - a[1]) or 1; pe, pn = -(b[1] - a[1]) / L, (b[0] - a[0]) / L
    best = None
    for off in range(-6, 7):              # the road surface: flattest point across the road
        h0, h1, h2 = dgm.at(E + pe * (off - 1.5), N + pn * (off - 1.5)), dgm.at(E + pe * off, N + pn * off), dgm.at(E + pe * (off + 1.5), N + pn * (off + 1.5))
        if None in (h0, h1, h2): continue
        flat = abs(h2 - h0) + abs(off) * 0.02
        if best is None or flat < best[0]: best = (flat, h1)
    hts.append(best[1] if best else None)
miss = sum(h is None for h in hts)
if miss == len(hts): sys.exit('no heights along the route: is it inside Germany, and is the zone right?')
for k in range(len(hts)):
    if hts[k] is None: hts[k] = hts[k - 1] if k and hts[k - 1] is not None else next(h for h in hts if h is not None)
# bridges: the terrain model has none, so a road over a stream would drop into the stream bed. Where
# OpenStreetMap says the route is on a bridge, the road runs straight from one end to the other instead,
# and the ride builds a bridge there.
DRIVE = {'motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street', 'service', 'track',
         'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link', 'cycleway', 'road'}
segs = []
for e in ways:
    t = e.get('tags', {})
    if t.get('highway') in DRIVE and t.get('bridge', 'no') != 'no' and 'geometry' in e:
        u = [ll_to_utm(p['lat'], p['lon'], ZONE) for p in e['geometry']]
        segs += list(zip(u, u[1:]))
def seg_hit(E, N, dE, dN):             # is this point of the route on a bridge running the same way?
    for (a, b) in segs:
        vx, vy = b[0] - a[0], b[1] - a[1]; L2 = vx * vx + vy * vy
        if L2 < 1: continue
        t = max(0, min(1, ((E - a[0]) * vx + (N - a[1]) * vy) / L2))
        if math.hypot(E - a[0] - t * vx, N - a[1] - t * vy) < 4 and abs(vx * dE + vy * dN) / math.sqrt(L2) > 0.85: return True
    return False
on = []
for k, (E, N) in enumerate(line):
    a, b = line[max(0, k - 1)], line[min(len(line) - 1, k + 1)]
    L = math.hypot(b[0] - a[0], b[1] - a[1]) or 1
    on.append(seg_hit(E, N, (b[0] - a[0]) / L, (b[1] - a[1]) / L))
spans, k = [], 0
near_bridge = [False] * len(line)       # the bridge and its approaches: no junctions here, only roads passing underneath
while k < len(on):
    if on[k]:
        j = k
        while j + 1 < len(on) and on[j + 1]: j += 1
        a, b = max(0, k - 2), min(len(hts) - 1, j + 2)      # 10 m on firm ground at each end
        for m in range(a + 1, b): hts[m] = hts[a] + (hts[b] - hts[a]) * (m - a) / (b - a)
        spans.append((k, j)); k = j + 1
        for m in range(a, b + 1): near_bridge[m] = True
    else: k += 1
print('bridges on the route:', len(spans), ['%d m' % ((j - k + 1) * STEP) for k, j in spans])
med = [sorted(hts[max(0, k - 2): k + 3])[len(hts[max(0, k - 2): k + 3]) // 2] for k in range(len(hts))]
for _ in range(2):                      # median of 5 (25 m), then two passes of a 35 m moving average
    med = [sum(med[max(0, k - 3): k + 4]) / len(med[max(0, k - 3): k + 4]) for k in range(len(med))]
hts = med
print('road heights: min %.1f max %.1f, missing %d of %d' % (min(hts), max(hts), miss, len(hts)))
grades = [(hts[k + 4] - hts[k]) / 20 * 100 for k in range(len(hts) - 4)]
climb = sum(max(0, hts[k + 1] - hts[k]) for k in range(len(hts) - 1))
print('steepest up %.1f%%, steepest down %.1f%%, climb %.0f m' % (max(grades), min(grades), climb))

# ---- terrain heights: each 10 m cell is the mean of a 3 x 3 sample, so single lidar pixels don't spike it
grid, holes = [], 0
for iz in range(cells + 1):            # row 0 is the north edge (local z = -N)
    N = cN + size / 2 - iz * CELL
    for ix in range(cells + 1):
        E = cE - size / 2 + ix * CELL
        s = [h for h in (dgm.at(E + dx, N + dz) for dx in (-3, 0, 3) for dz in (-3, 0, 3)) if h is not None]
        if not s: holes += 1
        grid.append(sum(s) / len(s) if s else None)
for k in range(len(grid)):             # fill no-data from the left / above
    if grid[k] is None: grid[k] = grid[k - 1] if k % (cells + 1) and grid[k - 1] is not None else (grid[k - cells - 1] if k > cells and grid[k - cells - 1] is not None else None)
fallback = sum(hts) / len(hts)
grid = [fallback if h is None else h for h in grid]
lo, hi = min(grid), max(grid)
print('terrain heights: %.1f to %.1f m, no-data cells %d' % (lo, hi, holes))
dem_bytes = struct.pack('<%dH' % len(grid), *[round((h - lo) / (hi - lo) * 65535) for h in grid])

road = [[round(line[k][0] - cE, 2), round(hts[k], 2), round(-(line[k][1] - cN), 2)] for k in range(0, len(line) - 1, 3)]
bridges = [[round(line[k][0] - cE, 1), round(-(line[k][1] - cN), 1), round(line[j][0] - cE, 1), round(-(line[j][1] - cN), 1)] for k, j in spans]

# side roads: where another road meets the route, lay the first stretch of it (up to 150 m), so junctions look like junctions
BIN = 40; bins = {}
for k in range(len(line)): bins.setdefault((int(line[k][0] // BIN), int(line[k][1] // BIN)), []).append(k)
def route_near(E, N):                  # -> (distance to the route line, nearest index)
    bx, by = int(E // BIN), int(N // BIN); best = (1e9, -1)
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            for k in bins.get((bx + dx, by + dy), ()):
                k2 = min(k + 1, len(line) - 1); a, b = line[k], line[k2]
                vx, vy = b[0] - a[0], b[1] - a[1]; L2 = vx * vx + vy * vy or 1
                t = max(0, min(1, ((E - a[0]) * vx + (N - a[1]) * vy) / L2))
                d = math.hypot(E - a[0] - t * vx, N - a[1] - t * vy)
                if d < best[0]: best = (d, k)
    return best
WIDTH = {'motorway': 8, 'trunk': 7.5, 'primary': 7, 'secondary': 6.5, 'tertiary': 6, 'unclassified': 5, 'residential': 5.5, 'road': 5,
         'living_street': 4.5, 'service': 3.6, 'track': 3, 'cycleway': 2.6}
stubs = []
for e in ways:
    t = e.get('tags', {}); hw = t.get('highway', '').replace('_link', '') if t.get('highway', '').endswith('_link') else t.get('highway')
    if hw not in WIDTH or 'geometry' not in e: continue
    if t.get('bridge', 'no') != 'no' or t.get('tunnel', 'no') != 'no' or t.get('layer', '0') not in ('0', ''): continue   # crosses over or under, does not meet
    u = [ll_to_utm(p['lat'], p['lon'], ZONE) for p in e['geometry']]
    pts = [u[0]]                       # every 3 m
    for a, b in zip(u, u[1:]):
        L = math.hypot(b[0] - a[0], b[1] - a[1]); n = max(1, math.ceil(L / 3))
        pts += [(a[0] + (b[0] - a[0]) * m / n, a[1] + (b[1] - a[1]) * m / n) for m in range(1, n + 1)]
    d = [route_near(*p) for p in pts]
    if min(x[0] for x in d) > 3.5: continue
    paved = t.get('surface', 'asphalt' if hw != 'track' else 'gravel') in ('asphalt', 'paved', 'concrete', 'concrete:plates', 'paving_stones', 'sett', 'chipseal')
    for m in range(len(pts)):           # each place it touches the route, walk away from it both ways
        if d[m][0] > 3.5 or near_bridge[d[m][1]] or not ((m > 0 and d[m - 1][0] > 3.5) or (m + 1 < len(pts) and d[m + 1][0] > 3.5)): continue
        for step in (-1, 1):
            if not (0 <= m + step < len(pts)) or d[m + step][0] <= 3.5: continue
            arm, run, q = [m], 0, m + step
            while 0 <= q < len(pts) and run < 150 and d[q][0] > 3.5:
                run += 3; arm.append(q); q += step
            if d[arm[-1]][0] < 12 or len(arm) < 4: continue       # it runs alongside the route instead of leaving it
            hj = hts[d[m][1]]
            ys = []
            for n_, q in enumerate(arm):
                h = dgm.at(*pts[q]); h = hj if h is None else h
                f = min(1, n_ * 3 / 25); f = f * f * (3 - 2 * f)    # meet the route at its own height, then follow the ground
                ys.append(hj * (1 - f) + h * f)
            ys = [sum(ys[max(0, n_ - 2): n_ + 3]) / len(ys[max(0, n_ - 2): n_ + 3]) if n_ > 2 else ys[n_] for n_ in range(len(ys))]
            flat = []
            for q, y in zip(arm, ys): flat += [round(pts[q][0] - cE, 1), round(y, 2), round(-(pts[q][1] - cN), 1)]
            stubs.append([WIDTH[hw], 0 if paved else 1, flat])
print('side roads at junctions:', len(stubs))
stub_pts = [(s[2][k] , s[2][k + 2], s[0] / 2) for s in stubs for k in range(0, len(s[2]), 3)]
SB = {}
for x, z, hw_ in stub_pts: SB.setdefault((int(x // 20), int(z // 20)), []).append((x, z, hw_))
def stub_gap(x, z):                    # distance from a side road's edge (negative: on it)
    best = 1e9
    for dx in (-1, 0, 1):
        for dz in (-1, 0, 1):
            for sx, sz, hw_ in SB.get((int(x // 20) + dx, int(z // 20) + dz), ()): best = min(best, math.hypot(x - sx, z - sz) - hw_)
    return best
route_credit = 'Route © OpenStreetMap contributors.' if not cfg.get('gpx') else ''
height_credit = 'Heights: DGM1 via hoehendaten.de; ' + '; '.join(sorted(dgm.credits)) + '.'
course = {'name': cfg['name'], 'size': size, 'cells': cells, 'origin': [cE, cN], 'zone': ZONE, 'demMin': lo, 'demMax': hi, 'road': road, 'bridges': bridges,
          'credit': (route_credit + ' ' + height_credit).strip(), 'dem': base64.b64encode(dem_bytes).decode()}
open(f'assets/{CID}.js', 'w').write('window.RIDE_COURSES = window.RIDE_COURSES || {};\nwindow.RIDE_COURSES.' + CID + ' = ' + json.dumps(course) + ';\n')
print(f'wrote assets/{CID}.js', os.path.getsize(f'assets/{CID}.js') // 1024, 'KB;', len(road), 'road points')


def local(lat, lon):
    E, N = ll_to_utm(lat, lon, ZONE); return (E - cE, -(N - cN))
xz = [(p[0], p[2]) for p in road]
def road_dist(x, z): return math.sqrt(min((px - x) ** 2 + (pz - z) ** 2 for px, pz in xz))
ring = lambda geom: [local(p['lat'], p['lon']) for p in geom]
inside = lambda x, z, m=0: abs(x) < HALF - m and abs(z) < HALF - m

def best_box(pts):                       # smallest rectangle around a footprint, trying each wall's direction
    best = None
    for (x1, z1), (x2, z2) in zip(pts, pts[1:]):
        L = math.hypot(x2 - x1, z2 - z1)
        if L < 0.5: continue
        ux, uz = (x2 - x1) / L, (z2 - z1) / L
        us = [x * ux + z * uz for x, z in pts]; vs = [-x * uz + z * ux for x, z in pts]
        w, d = max(us) - min(us), max(vs) - min(vs)
        if best is None or w * d < best[0]:
            cu, cv = (max(us) + min(us)) / 2, (max(vs) + min(vs)) / 2
            best = (w * d, cu * ux - cv * uz, cu * uz + cv * ux, w, d, math.atan2(uz, ux))
    return best

def height(t):
    try: return max(2.5, float(str(t.get('height', '')).replace('m', '').strip()))
    except ValueError: pass
    try: return max(2.5, float(t['building:levels']) * 3 + 1)
    except (KeyError, ValueError): pass
    b = t.get('building')
    if b == 'church' or t.get('amenity') == 'place_of_worship': return 14
    if b in ('garage', 'garages', 'shed', 'hut', 'carport', 'roof', 'greenhouse'): return 2.6
    return 6.5

buildings, woods, holes, trees, lines, places = [], [], [], [], [], []
for e in els:
    t = e.get('tags', {})
    if e['type'] == 'node':
        if t.get('place') and t.get('name'):          # towns and villages, for the map
            x, z = local(e['lat'], e['lon'])
            if inside(x, z): places.append([round(x), round(z), t['name'], t['place']])
        if t.get('natural') == 'tree':
            x, z = local(e['lat'], e['lon'])
            if inside(x, z, 20) and road_dist(x, z) > 4.5 and stub_gap(x, z) > 2: trees.append([round(x, 1), round(z, 1)])
        continue
    if e['type'] == 'way' and 'geometry' in e:
        pts = ring(e['geometry'])
        if t.get('building') and len(pts) >= 4:
            b = best_box(pts)
            if not b: continue
            _, x, z, w, d, ang = b
            if w < d: w, d, ang = d, w, ang + math.pi / 2
            if not inside(x, z, 40) or w > 90 or w < 2 or d < 2: continue
            rd = road_dist(x, z)
            if rd > 700 or rd < d / 2 + 4.5 or stub_gap(x, z) < d / 2 + 1: continue
            h = height(t); small = h < 3.5
            buildings.append([round(x, 1), round(z, 1), round(w, 1), round(d, 1), round(ang, 3), round(h, 1), 0 if (small or d > 14) else 1])
        elif t.get('natural') == 'wood' or t.get('landuse') == 'forest':
            if len(pts) >= 4: woods.append(pts)
        elif t.get('barrier') in ('hedge', 'wall', 'retaining_wall'):
            kind = 0 if t['barrier'] == 'hedge' else 1
            for (x1, z1), (x2, z2) in zip(pts, pts[1:]):
                L = math.hypot(x2 - x1, z2 - z1); n = max(1, math.ceil(L / 6))
                for k in range(n):
                    ax, az = x1 + (x2 - x1) * k / n, z1 + (z2 - z1) * k / n; bx, bz = x1 + (x2 - x1) * (k + 1) / n, z1 + (z2 - z1) * (k + 1) / n
                    mx, mz = (ax + bx) / 2, (az + bz) / 2
                    if inside(mx, mz, 20) and 4.4 < road_dist(mx, mz) < 400 and stub_gap(mx, mz) > 1: lines.append([round(ax, 1), round(az, 1), round(bx, 1), round(bz, 1), kind])
    elif e['type'] == 'relation' and (t.get('natural') == 'wood' or t.get('landuse') == 'forest'):
        for m in e.get('members', []):
            if m.get('type') == 'way' and 'geometry' in m and len(m['geometry']) >= 3:
                (holes if m.get('role') == 'inner' else woods).append(ring(m['geometry']))

W = cells + 1; mask = bytearray(W * W)   # woodland as a grid matching the terrain's vertices
def fill(poly, val):
    if poly[0] != poly[-1]: poly = poly + [poly[0]]
    zs = [p[1] for p in poly]
    for iz in range(max(0, math.ceil((min(zs) + HALF) / size * cells)), min(cells, math.floor((max(zs) + HALF) / size * cells)) + 1):
        z = -HALF + iz * size / cells; xs = []
        for (x1, z1), (x2, z2) in zip(poly, poly[1:]):
            if (z1 <= z < z2) or (z2 <= z < z1): xs.append(x1 + (z - z1) / (z2 - z1) * (x2 - x1))
        xs.sort()
        for a, b in zip(xs[::2], xs[1::2]):
            for ix in range(max(0, math.ceil((a + HALF) / size * cells)), min(cells, math.floor((b + HALF) / size * cells)) + 1): mask[iz * W + ix] = val
for p in woods: fill(p, 1)
for p in holes: fill(p, 0)
bits = bytearray((len(mask) + 7) // 8)
for i, v in enumerate(mask):
    if v: bits[i >> 3] |= 1 << (i & 7)
print('buildings %d, single trees %d, hedge/wall pieces %d, woodland %.2f km2' % (len(buildings), len(trees), len(lines), sum(mask) * (size / cells) ** 2 / 1e6))
osm = {'buildings': buildings, 'trees': trees, 'lines': lines, 'side': stubs, 'places': places, 'woods': base64.b64encode(bytes(bits)).decode(), 'credit': 'Buildings, woods and hedges © OpenStreetMap contributors.'}
open(f'assets/{CID}_osm.js', 'w').write(f'window.RIDE_COURSES.{CID}.osm = ' + json.dumps(osm, separators=(',', ':')) + ';\n')
print(f'wrote assets/{CID}_osm.js', os.path.getsize(f'assets/{CID}_osm.js') // 1024, 'KB')

# ---- add the course to the ride's list
LIST = 'assets/courses.js'
lst = json.loads(open(LIST).read().split(' = ', 1)[1].rstrip().rstrip(';')) if os.path.exists(LIST) else []
entry = {'id': CID, 'name': cfg['name'], 'short': cfg.get('short', cfg['name']), 'km': round(len(line) * STEP / 1000, 1), 'climb': round(climb),
         'start': cfg.get('start', 0), 'drive': cfg.get('drive', 'right')}
lst = [c for c in lst if c['id'] != CID] + [entry]
open(LIST, 'w').write('window.RIDE_COURSE_LIST = ' + json.dumps(lst, ensure_ascii=False, indent=1) + ';\n')
print('course list:', ', '.join(c['short'] for c in lst))
