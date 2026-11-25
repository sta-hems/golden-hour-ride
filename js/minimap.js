// A small map of the course in the top left corner: north up, the road you have ridden this lap picked out,
// where you are and which way you face, the cars coming the other way, and the height profile underneath.
// Click it to make it bigger or smaller; it hides with everything else (H).
import { utmToLl } from './geo.js';
import { get } from './net.js';

const RANK = { city: 0, town: 1, suburb: 2, village: 3, hamlet: 4 };

// towns and villages: from the course data when it has them, otherwise asked of OpenStreetMap once and kept in this browser
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
async function loadPlaces(id, real) {
  if (real.osm && real.osm.places) return real.osm.places;
  if (!real.zone) return [];                                           // only the German courses carry UTM coordinates
  const key = 'golden-hour-ride-places-' + id;
  try { const c = JSON.parse(localStorage.getItem(key)); if (Array.isArray(c)) return c; } catch {}
  const [cE, cN] = real.origin, H = real.size / 2, zone = real.zone;
  const ll = [[-H, -H], [H, -H], [-H, H], [H, H]].map(([x, z]) => utmToLl(cE + x, cN - z, zone));
  const bb = [Math.min(...ll.map(p => p[0])), Math.min(...ll.map(p => p[1])), Math.max(...ll.map(p => p[0])), Math.max(...ll.map(p => p[1]))].map(v => v.toFixed(5)).join(',');
  const q = `[out:json][timeout:25];node["place"~"^(city|town|village|suburb|hamlet)$"](${bb});out;`;
  for (const server of OVERPASS) {
    try {
      const els = (await (await get(server, { method: 'POST', body: new URLSearchParams({ data: q }), signal: AbortSignal.timeout(30000) })).json()).elements || [];
      const { llToUtm } = await import('./geo.js');
      const out = els.filter(e => e.tags && e.tags.name).map(e => { const [E, N] = llToUtm(e.lat, e.lon, zone); return [Math.round(E - cE), Math.round(cN - N), e.tags.name, e.tags.place]; });
      try { localStorage.setItem(key, JSON.stringify(out)); } catch {}
      return out;
    } catch (err) { /* next server */ }
  }
  // the map servers are busy: ask the place search instead, which village each point of a coarse grid belongs to
  // (one question a second, as Nominatim asks; done once, then kept)
  const { llToUtm } = await import('./geo.js'), found = new Map(), step = Math.max(1200, real.size / 6);
  for (let x = -H + step / 2; x < H; x += step) for (let z = -H + step / 2; z < H; z += step) {
    const [lat, lon] = utmToLl(cE + x, cN - z, zone);
    try {
      const r = await (await get(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=13&accept-language=de&lat=${lat.toFixed(5)}&lon=${lon.toFixed(5)}`)).json();
      const kind = r.addresstype || r.type;
      if (r.name && RANK[kind] !== undefined && !found.has(r.name)) {
        const [E, N] = llToUtm(+r.lat, +r.lon, zone);
        found.set(r.name, [Math.round(E - cE), Math.round(cN - N), r.name, kind]);
      }
    } catch (err) { /* skip that point */ }
    await new Promise(res => setTimeout(res, 1100));
  }
  const out = [...found.values()];
  if (out.length) try { localStorage.setItem(key, JSON.stringify(out)); } catch {}
  return out;
}

const CSS = `
  #minimap { position: fixed; left: 18px; top: 18px; border-radius: 14px; overflow: hidden; cursor: pointer; z-index: 2;
    background: rgba(20,16,12,.45); border: 1px solid rgba(255,255,255,.3); backdrop-filter: blur(6px); }
  #minimap canvas { display: block; }
  body.clean #minimap { display: none; }
  body.has-minimap #ctl { left: 240px; }
  body.has-minimap.big-minimap #ctl { left: 380px; }
`;

export function init(ctx) {
  const { P, N, LEN, st, real, COURSE_INFO } = ctx;
  let places = [];
  if (!document.getElementById('minimap-css')) { const s = document.createElement('style'); s.id = 'minimap-css'; s.textContent = CSS; document.head.append(s); }
  const box = document.createElement('div'); box.id = 'minimap'; box.title = 'Course map – click to make it bigger or smaller';
  const cv = document.createElement('canvas'); box.append(cv); document.body.append(box);
  document.body.classList.add('has-minimap');
  let big = localStorage.getItem('golden-hour-ride-minimap') === 'big';
  const dpr = Math.min(2, devicePixelRatio || 1);
  let W, MH, PH, base, g, toPx;

  // bounds of the road, and of the height profile
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const p of P) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }

  function layout() {
    W = big ? 340 : 200; MH = W; PH = big ? 64 : 44;
    cv.width = W * dpr; cv.height = (MH + PH) * dpr; cv.style.width = W + 'px'; cv.style.height = (MH + PH) + 'px';
    document.body.classList.toggle('big-minimap', big);
    g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const pad = 14, sc = Math.min((W - 2 * pad) / (x1 - x0 || 1), (MH - 2 * pad) / (z1 - z0 || 1));
    const ox = (W - (x1 - x0) * sc) / 2, oz = (MH - (z1 - z0) * sc) / 2;
    toPx = (x, z) => [ox + (x - x0) * sc, oz + (z - z0) * sc];      // world z runs south, as the canvas does
    // what doesn't move: side roads, the course, the profile
    base = document.createElement('canvas'); base.width = cv.width; base.height = cv.height;
    const b = base.getContext('2d'); b.setTransform(dpr, 0, 0, dpr, 0, 0);
    b.lineCap = b.lineJoin = 'round';
    if (real && real.osm && real.osm.side) {
      b.strokeStyle = 'rgba(255,255,255,.22)'; b.lineWidth = 1.2;
      for (const [, , f] of real.osm.side) { b.beginPath(); for (let k = 0; k < f.length; k += 3) b[k ? 'lineTo' : 'moveTo'](...toPx(f[k], f[k + 2])); b.stroke(); }
    }
    b.strokeStyle = 'rgba(255,255,255,.7)'; b.lineWidth = big ? 3.2 : 2.6; b.beginPath();
    for (let i = 0; i <= N; i += 2) b[i ? 'lineTo' : 'moveTo'](...toPx(P[i % N].x, P[i % N].z));
    b.stroke();
    // towns and villages: a dot and the name, the bigger places first; a name that would overlap another is left out
    const taken = [];
    b.textBaseline = 'middle';
    for (const [x, z, name, kind] of [...places].sort((p, q) => RANK[p[3]] - RANK[q[3]])) {
      if (kind === 'hamlet' && !big) continue;
      const [px, py] = toPx(x, z);
      if (px < 4 || py < 4 || px > W - 4 || py > MH - 4) continue;
      const size = kind === 'city' || kind === 'town' ? (big ? 12 : 10.5) : kind === 'hamlet' ? 8.5 : (big ? 10.5 : 9);
      b.font = `${kind === 'city' || kind === 'town' ? 700 : 500} ${size}px -apple-system, Helvetica, Arial, sans-serif`;
      const w = b.measureText(name).width, h = size + 2;
      const spots = [[px + 5, py, 'left'], [px - 5, py, 'right'], [px, py - h, 'center'], [px, py + h, 'center']];
      const fit = spots.map(([lx, ly, al]) => { const x0 = al === 'left' ? lx : al === 'right' ? lx - w : lx - w / 2; return [x0, ly - h / 2, w, h, lx, ly, al]; })
        .find(([x0, y0, ww, hh]) => x0 > 2 && x0 + ww < W - 2 && y0 > 2 && y0 + hh < MH - 2 && !taken.some(t => x0 < t[0] + t[2] && x0 + ww > t[0] && y0 < t[1] + t[3] && y0 + hh > t[1]));
      b.fillStyle = 'rgba(255,255,255,.85)'; b.beginPath(); b.arc(px, py, kind === 'hamlet' ? 1.3 : kind === 'city' || kind === 'town' ? 2.6 : 1.9, 0, 6.283); b.fill();
      if (!fit) continue;
      taken.push(fit);
      b.textAlign = fit[6]; b.lineWidth = 3; b.strokeStyle = 'rgba(15,12,9,.75)'; b.strokeText(name, fit[4], fit[5]);
      b.fillStyle = kind === 'hamlet' ? 'rgba(255,255,255,.7)' : 'rgba(255,255,255,.95)'; b.fillText(name, fit[4], fit[5]);
    }
    b.textAlign = 'left'; b.textBaseline = 'alphabetic';
    const [sx, sy] = toPx(P[0].x, P[0].z);                          // the start line
    b.fillStyle = '#fff'; b.fillRect(sx - 3, sy - 3, 6, 6);
    // height profile
    b.fillStyle = 'rgba(0,0,0,.22)'; b.fillRect(0, MH, W, PH);
    const prof = i => MH + PH - 6 - (P[i].y - y0) / (y1 - y0 || 1) * (PH - 14);
    b.beginPath(); b.moveTo(0, MH + PH);
    for (let c = 0; c <= W; c++) b.lineTo(c, prof(Math.min(N - 1, Math.floor(c / W * N))));
    b.lineTo(W, MH + PH); b.closePath();
    b.fillStyle = 'rgba(255,255,255,.22)'; b.fill();
    b.font = '10px -apple-system, Helvetica, Arial, sans-serif'; b.fillStyle = 'rgba(255,255,255,.7)';
    b.fillText(`${Math.round(y1)} m`, 4, MH + 11); b.fillText(`${Math.round(y0)} m`, 4, MH + PH - 3);
  }
  layout();
  if (real) loadPlaces(COURSE_INFO.id, real).then(p => { places = p; layout(); draw(); }).catch(() => {});
  box.addEventListener('click', () => { big = !big; localStorage.setItem('golden-hour-ride-minimap', big ? 'big' : 'small'); layout(); draw(); });

  function draw() {
    g.clearRect(0, 0, W, MH + PH);
    g.drawImage(base, 0, 0, W, MH + PH);
    const i = Math.floor(((st.s % LEN) + LEN) % LEN / LEN * N) % N;
    // the part of the lap you have ridden
    g.strokeStyle = '#ffcf8f'; g.lineWidth = big ? 3.6 : 3; g.lineCap = g.lineJoin = 'round'; g.beginPath();
    for (let k = 0; k <= i; k += 2) g[k ? 'lineTo' : 'moveTo'](...toPx(P[k].x, P[k].z));
    g.lineTo(...toPx(P[i].x, P[i].z)); g.stroke();
    // the cars
    if (st.cars) {
      g.fillStyle = 'rgba(255,255,255,.95)';
      for (const c of st.cars) if (c.car.parent && c.car.parent.visible) { const [cx, cy] = toPx(c.car.position.x, c.car.position.z); g.beginPath(); g.arc(cx, cy, 2.2, 0, 6.283); g.fill(); }
    }
    // you, and the way you face
    const [px, py] = toPx(P[i].x, P[i].z), j = (i + 6) % N, a = Math.atan2(P[j].z - P[i].z, P[j].x - P[i].x);
    g.save(); g.translate(px, py); g.rotate(a);
    g.fillStyle = '#ffcf8f'; g.strokeStyle = '#1a140e'; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(8, 0); g.lineTo(-5, 5); g.lineTo(-2, 0); g.lineTo(-5, -5); g.closePath(); g.fill(); g.stroke();
    g.restore();
    // where you are on the profile, and how far round
    const cx = i / N * W;
    g.strokeStyle = '#ffcf8f'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(cx, MH + 2); g.lineTo(cx, MH + PH); g.stroke();
    g.font = '600 11px -apple-system, Helvetica, Arial, sans-serif'; g.fillStyle = '#fff'; g.textAlign = 'right';
    g.fillText(`${(st.s / 1000).toFixed(1)} / ${(LEN / 1000).toFixed(1)} km`, W - 6, MH + 12); g.textAlign = 'left';
  }
  let t = 0;
  return dt => { t += dt; if (t > 0.1) { t = 0; draw(); } };
}
