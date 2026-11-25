// Builds a ride course in the browser, from place names to a finished course, the same way
// tools/build_course_de.py does it: OpenStreetMap routing, the German 1 m terrain survey (DGM1) from
// hoehendaten.de, and buildings, woods, bridges and side roads from OpenStreetMap.
import { llToUtm, utmToLl, haversine, readGeoTiff, halve, Terrain, b64ToBytes, bytesToB64 } from './geo.js';
import * as store from './store.js';
import { get, getJSON, sleep } from './net.js';

const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const OSRM = 'https://routing.openstreetmap.de/routed-car/route/v1/driving/';
const DGM_API = 'https://api.hoehendaten.de:14444/v1/rawtif';
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter'];
const TERRARIUM = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/';
const STEP = 5, CELL = 10, MARGIN = 900, CORRIDOR = 1100;

/* ---------- places ---------- */
export async function findPlace(q) {
  const m = q.match(/^\s*(-?\d+(?:\.\d+)?)\s*[,; ]\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (m) return { lat: +m[1], lon: +m[2], label: `${(+m[1]).toFixed(5)}, ${(+m[2]).toFixed(5)}` };
  const r = await getJSON(`${NOMINATIM}?format=jsonv2&limit=1&countrycodes=de&accept-language=de&q=${encodeURIComponent(q)}`);
  if (!r.length) throw new Error(`“${q}” was not found (Germany only)`);
  return { lat: +r[0].lat, lon: +r[0].lon, label: r[0].display_name.split(',').slice(0, 3).join(',') };
}

/* ---------- route ---------- */
function cutSpurs(pts) {          // the router likes to dip into a village centre and back out: cut those out-and-back stretches
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + haversine(pts[i - 1], pts[i]));
  const total = cum[cum.length - 1], LIMIT = Math.min(3500, total * 0.3), out = [];
  let i = 0;
  while (i < pts.length) {
    out.push(pts[i]);
    let skip = -1;
    for (let j = i + 1; j < pts.length && cum[j] - cum[i] < LIMIT; j++) {
      const run = cum[j] - cum[i], d = haversine(pts[i], pts[j]);
      if ((run > 20 && d < 8) || (run > 150 && d < 25 && d < run * 0.06)) skip = j;
    }
    i = skip > 0 ? skip + 1 : i + 1;
  }
  return out;
}

async function route(places, loop) {
  const wps = loop ? [...places, places[0]] : places;
  const url = OSRM + wps.map(p => `${p.lon},${p.lat}`).join(';') + '?overview=full&geometries=geojson&continue_straight=true';
  const r = await getJSON(url);
  if (!r.routes || !r.routes.length) throw new Error('no route found between those places');
  return { pts: r.routes[0].geometry.coordinates.map(([lon, lat]) => [lat, lon]), distance: r.routes[0].distance };
}

/* ---------- terrain tiles ---------- */
async function fetchTile(zone, i, j, log) {
  const key = `${zone}_${i}_${j}`, have = await store.getTile(key).catch(() => null);
  if (have) return have;
  const body = JSON.stringify({ Type: 'RawTIFRequest', ID: key, Attributes: { Zone: zone, Easting: i * 1000 + 500, Northing: j * 1000 + 500 } });
  let res;
  for (let attempt = 0; ; attempt++) {
    try { res = await getJSON(DGM_API, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body }); break; }
    catch (err) {
      if (err.status === 400) { res = { IsError: true }; break; }      // a square the survey doesn't cover (abroad, or open sea)
      if (attempt >= 3) throw err;
      log(`terrain server busy, trying again… (${err.message})`); await sleep(8000 + attempt * 8000);
    }
  }
  const a = res.Attributes || {};
  let rec = { key, empty: true, credit: '' };
  if (!res.IsError && a.RawTIFs && a.RawTIFs.length) {
    let best = null;
    for (const t of a.RawTIFs) {         // a tile on a state border comes once per state: merge them
      const g = readGeoTiff(b64ToBytes(t.Data));
      if (!best) best = g; else for (let k = 0; k < g.data.length; k++) if (!(best.data[k] > -500) && g.data[k] > -500) best.data[k] = g.data[k];
      rec.credit = [rec.credit, t.Attribution].filter(Boolean).join('; ');
    }
    rec = { ...rec, ...halve(best), empty: false };
  }
  await store.putTile(rec).catch(() => {});
  rec.fresh = true;
  return rec;
}

async function zoneFor(lat, lon) {      // the survey offices use UTM zone 33 in Brandenburg, Berlin, Mecklenburg-Vorpommern and Sachsen
  if (lon < 11.2) return 32;
  for (const zone of [32, 33]) {
    const [E, N] = llToUtm(lat, lon, zone), t = await fetchTile(zone, Math.floor(E / 1000), Math.floor(N / 1000), () => {});
    if (!t.empty) return zone;
  }
  return 32;
}

/* ---------- OpenStreetMap ---------- */
async function overpass(query, log, wait = 150000, rounds = 1) {
  // The public servers are often busy. Ask the first; if it has not answered after a few seconds, ask the next one
  // as well, and so on: the first good answer wins and the others are called off.
  const ask = async (server, signal) => {
    const r = await get(server, { method: 'POST', body: new URLSearchParams({ data: query }), signal });
    if (!r.ok) throw new Error(`${r.status}`);
    const j = await r.json();
    // a busy server can answer "200 OK" with a runtime error (timeout, out of memory) and no or only some elements
    if (/error/i.test(j.remark || '')) throw new Error(j.remark);
    return j.elements || [];
  };
  const STAGGER = Math.min(10000, wait / 3);
  for (let round = 0; round < rounds; round++) {
    const stop = new AbortController(), timer = setTimeout(() => stop.abort(), wait);
    try {
      return await new Promise((ok, no) => {
        let left = OVERPASS.length, next = 0, nudge = 0;
        const start = () => {
          if (next >= OVERPASS.length || stop.signal.aborted) return;
          const server = OVERPASS[next++];
          clearTimeout(nudge); nudge = setTimeout(start, STAGGER);
          ask(server, stop.signal).then(ok, err => {
            if (!stop.signal.aborted) log(`map server ${new URL(server).host} did not answer (${String(err.message || err).slice(0, 60)}), trying another…`);
            if (--left === 0 || (next >= OVERPASS.length && left === 0)) no(err);
            else if (!stop.signal.aborted) start();
          });
        };
        stop.signal.addEventListener('abort', () => { clearTimeout(nudge); no(new Error('timed out')); });
        start();
      });
    } catch (err) {
      if (round + 1 < rounds) await sleep(30000);
    } finally { clearTimeout(timer); stop.abort(); }
  }
  throw new Error('OpenStreetMap (Overpass) did not answer; try again in a few minutes');
}

/* ---------- quick terrain: the open Terrarium tiles (about 6 m a pixel here; SRTM and national surveys) ---------- */
// Good enough to ride on straight away; the survey's 1 m terrain follows in the background (see refine below).
async function quickTerrain(minLat, minLon, maxLat, maxLon, zone, log) {
  const Z = 14, n = 2 ** Z;
  const tx = lon => (lon + 180) / 360 * n, ty = lat => { const r = lat * Math.PI / 180; return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n; };
  const jobs = [], tiles = new Map();
  for (let x = Math.floor(tx(minLon)); x <= Math.floor(tx(maxLon)); x++) for (let y = Math.floor(ty(maxLat)); y <= Math.floor(ty(minLat)); y++) jobs.push([x, y]);
  log(`Terrain (quick preview): ${jobs.length} map tiles…`);
  const one = async ([x, y]) => {
    const blob = await (await get(`${TERRARIUM}${Z}/${x}/${y}.png`)).blob();
    const bmp = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
    const c = new OffscreenCanvas(256, 256), g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(bmp, 0, 0);
    const px = g.getImageData(0, 0, 256, 256).data, h = new Float32Array(65536);
    for (let k = 0; k < 65536; k++) h[k] = px[k * 4] * 256 + px[k * 4 + 1] + px[k * 4 + 2] / 256 - 32768;
    tiles.set(x + '_' + y, h);
  };
  for (let k = 0; k < jobs.length; k += 8) await Promise.all(jobs.slice(k, k + 8).map(one));
  const pix = (X, Y) => { const t = tiles.get((X >> 8) + '_' + (Y >> 8)); return t ? t[(Y & 255) * 256 + (X & 255)] : null; };
  return {
    tiles,
    at(E, N) {
      const [lat, lon] = utmToLl(E, N, zone), X = tx(lon) * 256 - 0.5, Y = ty(lat) * 256 - 0.5, x = Math.floor(X), y = Math.floor(Y), u = X - x, v = Y - y;
      const a = pix(x, y), b = pix(x + 1, y), c = pix(x, y + 1), d = pix(x + 1, y + 1);
      if (a === null || b === null || c === null || d === null) return null;
      return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
    },
  };
}

/* ---------- the build ---------- */
// quality 'quick': open terrain tiles, ready in a minute or less. quality 'survey': the 1 m state survey, a tile
// every 3 seconds. A quick course is built again at survey quality in the background, under the same id.
// Bumped when the way the map is laid out changes; a route built with an older one is rebuilt in the background
// on its next ride (2: houses up to 700 m from the road, footprints cut into boxes, buildings with courtyards;
// 3: rebuilt along the routed line again, as 2's rebuild from the 15 m road took the route's own bends for side roads;
// 4: each building says what kind it is, so towns and villages can be drawn differently; pitched roofs up to 22 m deep).
export const MAP_VERSION = 4;

export async function buildCourse({ names, places: given, loop = true, name, id: keepId, quality = 'survey', track, fallback }, log = () => {}, progress = () => {}) {
  const t0 = performance.now(), quick = quality === 'quick';
  let places = given;
  if (!places) {
    log('Finding the places…');
    places = [];
    for (const n of names) { places.push({ ...(await findPlace(n)), name: n }); log(`  ${n} → ${places[places.length - 1].label}`); await sleep(1100); }
  }
  names = places.map(p => p.name || p.label);
  if (places.length < 2) throw new Error('give at least two places');

  // A route being rebuilt keeps its own routed line where it has one. Otherwise it is routed along the roads; the
  // line has to follow the mapped roads closely, or their bends are taken for side roads. Only if the routing
  // server is down does a rebuild fall back on the line smoothed through its stored road.
  let ll = track;
  if (!ll) {
    log('Routing along the roads…');
    try { ll = cutSpurs((await route(places, loop)).pts); }
    catch (err) { if (!fallback) throw err; log(`  routing failed (${err.message}), keeping the stored line`); ll = fallback; }
  }
  const zone = await zoneFor(places[0].lat, places[0].lon);
  const utm = ll.map(p => llToUtm(p[0], p[1], zone));
  const line = [utm[0]]; let carry = 0;               // resample every 5 m
  for (let k = 1; k < utm.length; k++) {
    const a = utm[k - 1], b = utm[k], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (!L) continue;
    let d = STEP - carry;
    for (; d <= L; d += STEP) line.push([a[0] + (b[0] - a[0]) * d / L, a[1] + (b[1] - a[1]) * d / L]);
    carry = L - (d - STEP);
  }
  if (line.length < 60) throw new Error('that route is too short');
  log(`  ${(line.length * STEP / 1000).toFixed(1)} km`);
  const warnings = [], twice = new Set();
  for (let i = 0; i < line.length; i += 4) for (let j = i + 24; j < line.length; j += 4)
    if (Math.min(j - i, line.length - j + i) * STEP > 120 && Math.hypot(line[i][0] - line[j][0], line[i][1] - line[j][1]) < 20) twice.add((i * STEP / 1000).toFixed(1));
  if (twice.size) warnings.push(`the route passes the same place twice (near km ${[...twice].slice(0, 6).join(', ')}): add or change a place so it doesn't double back`);

  // the terrain square, and the 1 km tiles near the route
  const Es = line.map(p => p[0]), Ns = line.map(p => p[1]);
  const minE = Math.min(...Es), maxE = Math.max(...Es), minN = Math.min(...Ns), maxN = Math.max(...Ns);
  const size = Math.ceil((Math.max(maxE - minE, maxN - minN) + 2 * MARGIN) / 200) * 200, cells = size / CELL, HALF = size / 2;
  const cE = Math.round((minE + maxE) / 2 / CELL) * CELL, cN = Math.round((minN + maxN) / 2 / CELL) * CELL;
  if (size > 16000) throw new Error('that route spreads over more than 14 km: try a smaller loop');
  const want = new Set();
  for (let k = 0; k < line.length; k += 10) {
    const [E, N] = line[k];
    for (let i = Math.floor((E - CORRIDOR) / 1000); i <= Math.floor((E + CORRIDOR) / 1000); i++)
      for (let j = Math.floor((N - CORRIDOR) / 1000); j <= Math.floor((N + CORRIDOR) / 1000); j++) {
        const dx = Math.max(i * 1000 - E, 0, E - (i + 1) * 1000), dy = Math.max(j * 1000 - N, 0, N - (j + 1) * 1000);
        if (Math.hypot(dx, dy) < CORRIDOR) want.add(i + '_' + j);
      }
  }
  let terrain = new Terrain();
  const credits = new Set(), keys = [...want];
  if (quick) {
    const a = utmToLl(cE - HALF, cN - HALF, zone), b = utmToLl(cE + HALF, cN + HALF, zone), c = utmToLl(cE - HALF, cN + HALF, zone), d = utmToLl(cE + HALF, cN - HALF, zone);
    terrain = await quickTerrain(Math.min(a[0], d[0]), Math.min(a[1], c[1]), Math.max(b[0], c[0]), Math.max(b[1], d[1]), zone, log);
    credits.add('Mapzen Terrain Tiles on AWS Open Data (SRTM and national surveys)');
  } else log(`Terrain: ${keys.length} tiles of 1 km² from the survey…`);
  let fresh = 0;
  for (let n = 0; n < (quick ? 0 : keys.length); n++) {
    const [i, j] = keys[n].split('_').map(Number);
    const t = await fetchTile(zone, i, j, log);
    if (t.fresh) {
      fresh++;
      log(`  tile ${n + 1} of ${keys.length}${keys.length - n > 1 ? ` (about ${Math.ceil((keys.length - n - 1) * 3.4 / 60)} min left)` : ''}`, true);
      if (n < keys.length - 1) await sleep(3100);          // the service allows about 20 tiles a minute
    }
    if (!t.empty) { terrain.set(i, j, t); if (t.credit) t.credit.split('; ').forEach(c => credits.add(c)); }
    progress(n + 1, keys.length);
  }
  if (!quick) log(`  ${keys.length - fresh} tiles were already saved, ${fresh} downloaded`);
  if (!terrain.tiles.size) throw new Error('no terrain data for this route: is it in Germany?');

  // OpenStreetMap: buildings, woods, trees, hedges; and the roads, for bridges and junctions
  const [sLat, wLon] = utmToLl(cE - HALF, cN - HALF, zone), [nLat, eLon] = utmToLl(cE + HALF, cN + HALF, zone);
  const [s2, w2] = utmToLl(cE - HALF, cN + HALF, zone), [n2, e2] = utmToLl(cE + HALF, cN - HALF, zone);
  const bb = [Math.min(sLat, n2), Math.min(wLon, w2), Math.max(nLat, s2), Math.max(eLon, e2)].map(v => v.toFixed(5)).join(',');
  const rA = utmToLl(minE - 250, minN - 250, zone), rB = utmToLl(maxE + 250, maxN + 250, zone);
  const rbb = [rA[0], rA[1], rB[0], rB[1]].map(v => v.toFixed(5)).join(',');
  log('Map: roads, bridges, buildings and woods from OpenStreetMap…');
  let ways = [], els = [], mapOk = false;
  {
    const qRoads = `[out:json][timeout:120];way["highway"]["highway"!~"^(footway|path|steps|pedestrian|bridleway|corridor|elevator|proposed|construction|platform)$"](${rbb});out tags geom;`;
    const qMap = `[out:json][timeout:180];(way["building"](${bb});relation["building"](${bb});way["natural"="wood"](${bb});way["landuse"="forest"](${bb});relation["natural"="wood"](${bb});relation["landuse"="forest"](${bb});node["natural"="tree"](${bb});way["barrier"~"^(hedge|wall|retaining_wall)$"](${bb});node["place"~"^(city|town|village|suburb|hamlet)$"](${bb}););out geom;`;
    // both at once; the quick build waits 25 s at most, and the survey build in the background fetches them again
    const both = Promise.all([overpass(qRoads, log, quick ? 25000 : 150000, quick ? 1 : 2), overpass(qMap, log, quick ? 25000 : 150000, quick ? 1 : 2)]);
    try {
      [ways, els] = quick ? await Promise.race([both, sleep(26000).then(() => { throw new Error('the map server is slow'); })]) : await both;
      mapOk = true;
    } catch (err) {
      both.catch(() => {});
      warnings.push(err.message + (quick ? ' – buildings, woods, bridges and side roads come with the survey heights' : ' – the course has no buildings, woods, bridges or side roads'));
    }
  }

  // road heights from the survey: the flattest point across the road
  const hts = line.map(([E, N], k) => {
    const a = line[Math.max(0, k - 1)], b = line[Math.min(line.length - 1, k + 1)], L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const pe = -(b[1] - a[1]) / L, pn = (b[0] - a[0]) / L;
    let best = null;
    for (let off = -6; off <= 6; off++) {
      const h0 = terrain.at(E + pe * (off - 2), N + pn * (off - 2)), h1 = terrain.at(E + pe * off, N + pn * off), h2 = terrain.at(E + pe * (off + 2), N + pn * (off + 2));
      if (h0 === null || h1 === null || h2 === null) continue;
      const flat = Math.abs(h2 - h0) + Math.abs(off) * 0.02;
      if (!best || flat < best[0]) best = [flat, h1];
    }
    return best ? best[1] : null;
  });
  const firstH = hts.find(h => h !== null);
  if (firstH === undefined) throw new Error('no heights along the route');
  for (let k = 0; k < hts.length; k++) if (hts[k] === null) hts[k] = k ? hts[k - 1] : firstH;

  // bridges: OpenStreetMap says where the route is on one; the road runs straight from end to end there
  const DRIVE = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street', 'service', 'track', 'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link', 'cycleway', 'road']);
  const segs = [];
  for (const e of ways) {
    const t = e.tags || {};
    if (DRIVE.has(t.highway) && t.bridge && t.bridge !== 'no' && e.geometry) {
      const u = e.geometry.map(p => llToUtm(p.lat, p.lon, zone));
      for (let k = 1; k < u.length; k++) segs.push([u[k - 1], u[k]]);
    }
  }
  const onB = line.map(([E, N], k) => {
    const a = line[Math.max(0, k - 1)], b = line[Math.min(line.length - 1, k + 1)], L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, dE = (b[0] - a[0]) / L, dN = (b[1] - a[1]) / L;
    return segs.some(([p, q]) => {
      const vx = q[0] - p[0], vy = q[1] - p[1], L2 = vx * vx + vy * vy;
      if (L2 < 1) return false;
      const t = Math.max(0, Math.min(1, ((E - p[0]) * vx + (N - p[1]) * vy) / L2));
      return Math.hypot(E - p[0] - t * vx, N - p[1] - t * vy) < 4 && Math.abs(vx * dE + vy * dN) / Math.sqrt(L2) > 0.85;
    });
  });
  const spans = [], nearBridge = new Uint8Array(line.length);
  for (let k = 0; k < onB.length; k++) if (onB[k]) {
    let j = k; while (j + 1 < onB.length && onB[j + 1]) j++;
    const a = Math.max(0, k - 2), b = Math.min(hts.length - 1, j + 2);
    for (let m = a + 1; m < b; m++) hts[m] = hts[a] + (hts[b] - hts[a]) * (m - a) / (b - a);
    for (let m = a; m <= b; m++) nearBridge[m] = 1;
    spans.push([k, j]); k = j;
  }
  // smoothing: median of 5, then two passes of a 35 m moving average
  let med = hts.map((_, k) => { const w = hts.slice(Math.max(0, k - 2), k + 3).sort((x, y) => x - y); return w[w.length >> 1]; });
  for (let pass = 0; pass < 2; pass++) med = med.map((_, k) => { const w = med.slice(Math.max(0, k - 3), k + 4); return w.reduce((s, v) => s + v, 0) / w.length; });
  const H = med;
  let climb = 0; for (let k = 1; k < H.length; k++) climb += Math.max(0, H[k] - H[k - 1]);
  log(`  climb ${Math.round(climb)} m${spans.length ? `, ${spans.length} bridge${spans.length > 1 ? 's' : ''}` : ''}`);

  // terrain grid, 10 m; squares without survey tiles are filled in from their neighbours
  log('Shaping the ground…');
  await sleep(0);
  const W = cells + 1, grid = new Float32Array(W * W).fill(NaN);
  for (let iz = 0; iz < W; iz++) {
    const N = cN + HALF - iz * CELL;
    for (let ix = 0; ix < W; ix++) {
      const E = cE - HALF + ix * CELL; let s = 0, n = 0;
      for (const [dx, dz] of [[-2.5, -2.5], [2.5, -2.5], [-2.5, 2.5], [2.5, 2.5]]) { const h = terrain.at(E + dx, N + dz); if (h !== null) { s += h; n++; } }
      if (n) grid[iz * W + ix] = s / n;
    }
  }
  for (let pass = 0, holes = 1; holes && pass < 2000; pass++) {
    holes = 0;
    const next = grid.slice();
    for (let k = 0; k < grid.length; k++) if (Number.isNaN(grid[k])) {
      const x = k % W; let s = 0, n = 0;
      for (const q of [x > 0 ? k - 1 : -1, x < W - 1 ? k + 1 : -1, k - W, k + W]) if (q >= 0 && q < grid.length && !Number.isNaN(grid[q])) { s += grid[q]; n++; }
      if (n) next[k] = s / n; else holes++;
    }
    grid.set(next);
  }
  let lo = Infinity, hi = -Infinity;
  for (const h of grid) { if (h < lo) lo = h; if (h > hi) hi = h; }
  const q = new Uint16Array(grid.length);
  for (let k = 0; k < grid.length; k++) q[k] = Math.round((grid[k] - lo) / (hi - lo || 1) * 65535);

  const road = [];
  for (let k = 0; k < line.length - 1; k += 3) road.push([+(line[k][0] - cE).toFixed(2), +H[k].toFixed(2), +(-(line[k][1] - cN)).toFixed(2)]);
  const bridges = spans.map(([k, j]) => [line[k][0] - cE, -(line[k][1] - cN), line[j][0] - cE, -(line[j][1] - cN)].map(v => +v.toFixed(1)));

  // side roads at junctions
  const BIN = 40, bins = new Map();
  line.forEach((p, k) => { const key = Math.floor(p[0] / BIN) + '_' + Math.floor(p[1] / BIN); (bins.get(key) || bins.set(key, []).get(key)).push(k); });
  const routeNear = (E, N) => {
    const bx = Math.floor(E / BIN), by = Math.floor(N / BIN); let best = [1e9, -1];
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const k of bins.get((bx + dx) + '_' + (by + dy)) || []) {
      const a = line[k], b = line[Math.min(k + 1, line.length - 1)], vx = b[0] - a[0], vy = b[1] - a[1], L2 = vx * vx + vy * vy || 1;
      const t = Math.max(0, Math.min(1, ((E - a[0]) * vx + (N - a[1]) * vy) / L2)), d = Math.hypot(E - a[0] - t * vx, N - a[1] - t * vy);
      if (d < best[0]) best = [d, k];
    }
    return best;
  };
  const WIDTH = { motorway: 8, trunk: 7.5, primary: 7, secondary: 6.5, tertiary: 6, unclassified: 5, residential: 5.5, road: 5, living_street: 4.5, service: 3.6, track: 3, cycleway: 2.6 };
  const PAVED = new Set(['asphalt', 'paved', 'concrete', 'concrete:plates', 'paving_stones', 'sett', 'chipseal']);
  const side = [];
  for (const e of ways) {
    const t = e.tags || {}, hw = (t.highway || '').replace(/_link$/, '');
    if (!WIDTH[hw] || !e.geometry) continue;
    if ((t.bridge && t.bridge !== 'no') || (t.tunnel && t.tunnel !== 'no') || (t.layer && t.layer !== '0')) continue;
    const u = e.geometry.map(p => llToUtm(p.lat, p.lon, zone)), pts = [u[0]];
    for (let k = 1; k < u.length; k++) {
      const a = u[k - 1], b = u[k], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 3));
      for (let m = 1; m <= n; m++) pts.push([a[0] + (b[0] - a[0]) * m / n, a[1] + (b[1] - a[1]) * m / n]);
    }
    const d = pts.map(p => routeNear(p[0], p[1]));
    if (Math.min(...d.map(x => x[0])) > 3.5) continue;
    const paved = PAVED.has(t.surface || (hw === 'track' ? 'gravel' : 'asphalt'));
    for (let m = 0; m < pts.length; m++) {
      if (d[m][0] > 3.5 || nearBridge[d[m][1]] || !((m > 0 && d[m - 1][0] > 3.5) || (m + 1 < pts.length && d[m + 1][0] > 3.5))) continue;
      for (const step of [-1, 1]) {
        if (m + step < 0 || m + step >= pts.length || d[m + step][0] <= 3.5) continue;
        const arm = [m]; let run = 0, qq = m + step;
        while (qq >= 0 && qq < pts.length && run < 150 && d[qq][0] > 3.5) { run += 3; arm.push(qq); qq += step; }
        if (d[arm[arm.length - 1]][0] < 12 || arm.length < 4) continue;
        const hj = H[d[m][1]];
        let ys = arm.map((a, n) => { const h = terrain.at(pts[a][0], pts[a][1]); let f = Math.min(1, n * 3 / 25); f = f * f * (3 - 2 * f); return hj * (1 - f) + (h === null ? hj : h) * f; });
        ys = ys.map((y, n) => { if (n <= 2) return y; const w = ys.slice(Math.max(0, n - 2), n + 3); return w.reduce((s, v) => s + v, 0) / w.length; });
        const flat = [];
        arm.forEach((a, n) => flat.push(+(pts[a][0] - cE).toFixed(1), +ys[n].toFixed(2), +(-(pts[a][1] - cN)).toFixed(1)));
        side.push([WIDTH[hw], paved ? 0 : 1, flat]);
      }
    }
  }
  const SB = new Map();
  for (const [w, , f] of side) for (let k = 0; k < f.length; k += 3) { const key = Math.floor(f[k] / 20) + '_' + Math.floor(f[k + 2] / 20); (SB.get(key) || SB.set(key, []).get(key)).push([f[k], f[k + 2], w / 2]); }
  const stubGap = (x, z) => {
    let best = 1e9; const cx = Math.floor(x / 20), cz = Math.floor(z / 20);
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) for (const [sx, sz, h] of SB.get((cx + dx) + '_' + (cz + dz)) || []) best = Math.min(best, Math.hypot(x - sx, z - sz) - h);
    return best;
  };

  // buildings, woods, trees, hedges and walls
  log('Placing buildings, woods and hedges…');
  await sleep(0);
  const local = (lat, lon) => { const [E, N] = llToUtm(lat, lon, zone); return [E - cE, -(N - cN)]; };
  // routeNear only looks a bin or so around a point; further out, a 20 m distance map of the whole square answers
  const DG = 20, DW = Math.ceil(size / DG) + 1, dmap = new Float32Array(DW * DW).fill(1e9);
  for (const [E, N] of line) { const ix = Math.floor((E - cE + HALF) / DG), iz = Math.floor((cN - N + HALF) / DG); if (ix >= 0 && iz >= 0 && ix < DW && iz < DW) dmap[iz * DW + ix] = 0; }
  for (let pass = 0; pass < 2; pass++) {            // two-pass chamfer distance
    const step = pass ? -1 : 1, from = pass ? DW - 1 : 0, to = pass ? -1 : DW;
    for (let iz = from; iz !== to; iz += step) for (let ix = from; ix !== to; ix += step) {
      let v = dmap[iz * DW + ix];
      for (const [dx, dz, w] of [[-step, 0, DG], [0, -step, DG], [-step, -step, DG * 1.414], [step, -step, DG * 1.414]]) {
        const jx = ix + dx, jz = iz + dz;
        if (jx >= 0 && jz >= 0 && jx < DW && jz < DW) v = Math.min(v, dmap[jz * DW + jx] + w);
      }
      dmap[iz * DW + ix] = v;
    }
  }
  const roadDist = (x, z) => {
    const d = routeNear(x + cE, cN - z)[0];
    if (d < 1e8) return d;
    const ix = Math.floor((x + HALF) / DG), iz = Math.floor((z + HALF) / DG);
    return ix >= 0 && iz >= 0 && ix < DW && iz < DW ? Math.max(40, dmap[iz * DW + ix]) : 1e9;
  };
  const inside = (x, z, m = 0) => Math.abs(x) < HALF - m && Math.abs(z) < HALF - m;
  const bestBox = pts => {
    let best = null;
    for (let k = 1; k < pts.length; k++) {
      const [x1, z1] = pts[k - 1], [x2, z2] = pts[k], L = Math.hypot(x2 - x1, z2 - z1);
      if (L < 0.5) continue;
      const ux = (x2 - x1) / L, uz = (z2 - z1) / L, us = pts.map(([x, z]) => x * ux + z * uz), vs = pts.map(([x, z]) => -x * uz + z * ux);
      const w = Math.max(...us) - Math.min(...us), d = Math.max(...vs) - Math.min(...vs);
      if (!best || w * d < best[0]) { const cu = (Math.max(...us) + Math.min(...us)) / 2, cv = (Math.max(...vs) + Math.min(...vs)) / 2; best = [w * d, cu * ux - cv * uz, cu * uz + cv * ux, w, d, Math.atan2(uz, ux)]; }
    }
    return best;
  };
  // A footprint as one or more boxes: a plain house is one box; an L, a U or a block round a courtyard is cut into
  // strips across its length, each strip as long as the building is deep there, so no box covers the yard or the street.
  const footprint = rings => {
    const all = rings.flat(), b = bestBox(all); if (!b) return [];
    let [, x, z, w, d, ang] = b;
    const ux = Math.cos(ang), uz = Math.sin(ang);
    const area = rings.reduce((sum, r, k) => { let a = 0; for (let i = 1; i < r.length; i++) a += r[i - 1][0] * r[i][1] - r[i][0] * r[i - 1][1]; return sum + (k ? -1 : 1) * Math.abs(a / 2); }, 0);
    if (rings.length === 1 && area > 0.8 * w * d) return [[x, z, w, d, ang, true]];
    const uv = rings.map(r => r.map(([px, pz]) => [px * ux + pz * uz, -px * uz + pz * ux]));
    const us = uv.flat().map(p => p[0]), u0 = Math.min(...us), u1 = Math.max(...us), n = Math.max(1, Math.round((u1 - u0) / 7)), sw = (u1 - u0) / n;
    const out = [];
    for (let i = 0; i < n; i++) {
      const uc = u0 + (i + 0.5) * sw, vs = [];
      for (const r of uv) for (let k = 1; k < r.length; k++) {
        const [a1, b1] = r[k - 1], [a2, b2] = r[k];
        if ((a1 <= uc && uc < a2) || (a2 <= uc && uc < a1)) vs.push(b1 + (uc - a1) / (a2 - a1) * (b2 - b1));
      }
      vs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < vs.length; k += 2) {
        const v1 = vs[k], v2 = vs[k + 1]; if (v2 - v1 < 2) continue;
        const vc = (v1 + v2) / 2;
        out.push([uc * ux - vc * uz, uc * uz + vc * ux, sw, v2 - v1, ang, false]);
      }
    }
    return out;
  };
  const height = t => {
    const hh = parseFloat(String(t.height || '').replace('m', '')); if (hh > 0) return Math.max(2.5, hh);
    const lv = parseFloat(t['building:levels']); if (lv > 0) return Math.max(2.5, lv * 3 + 1);
    if (t.building === 'church' || t.amenity === 'place_of_worship') return 14;
    if (['garage', 'garages', 'shed', 'hut', 'carport', 'roof', 'greenhouse'].includes(t.building)) return 2.6;
    return 6.5;
  };
  const buildings = [], woods = [], holes = [], trees = [], lines = [], towns = [];
  // what kind of building, for how it is drawn: 0 a house, 1 a town house (flats, shops, offices),
  // 2 a barn, shed, garage or works, 3 a church, 4 a farmhouse
  const kindOf = t => {
    const b = t.building;
    if (b === 'church' || b === 'chapel' || b === 'cathedral' || t.amenity === 'place_of_worship') return 3;
    if (['apartments', 'commercial', 'retail', 'office', 'terrace', 'hotel', 'civic', 'public', 'school', 'townhall', 'government', 'university', 'hospital', 'dormitory', 'kindergarten'].includes(b)) return 1;
    if (['industrial', 'warehouse', 'barn', 'farm_auxiliary', 'garage', 'garages', 'shed', 'hut', 'carport', 'roof', 'greenhouse', 'stable', 'cowshed', 'agricultural', 'manufacture', 'service', 'storage_tank', 'hangar', 'sty', 'silo', 'transformer_tower'].includes(b)) return 2;
    if (b === 'farm') return 4;
    return 0;
  };
  const addBuilding = (rings, t) => {
    const h = height(t), kind = kindOf(t);
    for (let [x, z, w, d, ang, whole] of footprint(rings)) {
      if (w < d) { [w, d] = [d, w]; ang += Math.PI / 2; }
      if (!inside(x, z, 40) || w > 150 || w < 2 || d < 2) continue;
      const rd = roadDist(x, z);
      if (rd > 700 || rd < d / 2 + 4.5 || stubGap(x, z) < d / 2 + 1) continue;
      buildings.push([+x.toFixed(1), +z.toFixed(1), +w.toFixed(1), +d.toFixed(1), +ang.toFixed(3), +h.toFixed(1), (!whole || h < 3.5 || d > 22) ? 0 : 1, kind]);
    }
  };
  for (const e of els) {
    const t = e.tags || {};
    if (e.type === 'node') {
      if (t.place && t.name) { const [x, z] = local(e.lat, e.lon); if (inside(x, z)) towns.push([+x.toFixed(0), +z.toFixed(0), t.name, t.place]); }   // towns and villages, for the map
      if (t.natural === 'tree') { const [x, z] = local(e.lat, e.lon); if (inside(x, z, 20) && roadDist(x, z) > 4.5 && stubGap(x, z) > 2) trees.push([+x.toFixed(1), +z.toFixed(1)]); }
      continue;
    }
    if (e.type === 'way' && e.geometry) {
      const pts = e.geometry.map(p => local(p.lat, p.lon));
      if (t.building && pts.length >= 4) addBuilding([pts], t);
      else if (t.natural === 'wood' || t.landuse === 'forest') { if (pts.length >= 4) woods.push(pts); }
      else if (['hedge', 'wall', 'retaining_wall'].includes(t.barrier)) {
        const kind = t.barrier === 'hedge' ? 0 : 1;
        for (let k = 1; k < pts.length; k++) {
          const [x1, z1] = pts[k - 1], [x2, z2] = pts[k], n = Math.max(1, Math.ceil(Math.hypot(x2 - x1, z2 - z1) / 6));
          for (let m = 0; m < n; m++) {
            const ax = x1 + (x2 - x1) * m / n, az = z1 + (z2 - z1) * m / n, bx = x1 + (x2 - x1) * (m + 1) / n, bz = z1 + (z2 - z1) * (m + 1) / n, mx = (ax + bx) / 2, mz = (az + bz) / 2;
            if (inside(mx, mz, 20) && roadDist(mx, mz) > 4.4 && roadDist(mx, mz) < 400 && stubGap(mx, mz) > 1) lines.push([ax, az, bx, bz].map(v => +v.toFixed(1)).concat(kind));
          }
        }
      }
    } else if (e.type === 'relation' && t.building) {
      const rings = (e.members || []).filter(m => m.type === 'way' && m.geometry && m.geometry.length >= 4).sort((a, b) => (a.role === 'inner') - (b.role === 'inner')).map(m => m.geometry.map(p => local(p.lat, p.lon)));
      if (rings.length) addBuilding(rings, t);
    } else if (e.type === 'relation' && (t.natural === 'wood' || t.landuse === 'forest')) {
      for (const m of e.members || []) if (m.type === 'way' && m.geometry && m.geometry.length >= 3) (m.role === 'inner' ? holes : woods).push(m.geometry.map(p => local(p.lat, p.lon)));
    }
  }
  const mask = new Uint8Array(W * W);
  const fill = (poly, val) => {
    if (poly[0][0] !== poly[poly.length - 1][0] || poly[0][1] !== poly[poly.length - 1][1]) poly = poly.concat([poly[0]]);
    const zs = poly.map(p => p[1]);
    for (let iz = Math.max(0, Math.ceil((Math.min(...zs) + HALF) / size * cells)); iz <= Math.min(cells, Math.floor((Math.max(...zs) + HALF) / size * cells)); iz++) {
      const z = -HALF + iz * size / cells, xs = [];
      for (let k = 1; k < poly.length; k++) { const [x1, z1] = poly[k - 1], [x2, z2] = poly[k]; if ((z1 <= z && z < z2) || (z2 <= z && z < z1)) xs.push(x1 + (z - z1) / (z2 - z1) * (x2 - x1)); }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2)
        for (let ix = Math.max(0, Math.ceil((xs[k] + HALF) / size * cells)); ix <= Math.min(cells, Math.floor((xs[k + 1] + HALF) / size * cells)); ix++) mask[iz * W + ix] = val;
    }
  };
  woods.forEach(p => fill(p, 1)); holes.forEach(p => fill(p, 0));
  const bits = new Uint8Array((mask.length + 7) >> 3);
  mask.forEach((v, i) => { if (v) bits[i >> 3] |= 1 << (i & 7); });

  const title = name || (names.length > 1 ? `${names[0]} – ${names.slice(1, loop ? undefined : -1).join(' – ')}${loop ? ' loop' : ` – ${names[names.length - 1]}`}` : names[0]);
  const course = {
    name: title, size, cells, origin: [cE, cN], zone, demMin: lo, demMax: hi, road, bridges,
    credit: `Route © OpenStreetMap contributors. Heights: ${quick ? 'preview from ' : 'DGM1 via hoehendaten.de; '}${[...credits].join('; ')}.`,
    dem: bytesToB64(new Uint8Array(q.buffer)),
  };
  const osm = { buildings, trees, lines, side, places: towns, woods: bytesToB64(bits), credit: 'Buildings, woods and hedges © OpenStreetMap contributors.' };
  const id = keepId || 'my-' + Date.now().toString(36), old = keepId ? await store.getCourse(keepId).catch(() => null) : null;
  const km = +(line.length * STEP / 1000).toFixed(1);
  if (old) course.name = old.info.name;
  const saved = quality === 'survey' && !mapOk ? 'nomap' : quality;      // 'nomap': survey heights, but the map server failed; fetched again next time
  await store.putCourse({ id, info: { id, name: old ? old.info.name : title, short: old ? old.info.short : title, km, climb: Math.round(climb), start: 0, drive: 'right', quality: saved, mapVersion: MAP_VERSION },
    places: names, resolved: places, loop, track: ll.map(p => [+p[0].toFixed(6), +p[1].toFixed(6)]), fav: old ? old.fav : false, created: old ? old.created : Date.now(), course, osm });
  log(`Done in ${Math.round((performance.now() - t0) / 1000)} s: ${km} km, ${Math.round(climb)} m of climbing.`);
  return { id, warnings, quality: saved };
}
