// Builds a quick course again at survey quality, in the background while it is being ridden.
// The page starts it (index.html) and hears how far it has got; the finished course replaces the quick one.
import { buildCourse, MAP_VERSION } from './builder.js';
import { getCourse } from './store.js';
import { utmToLl } from './geo.js';

onmessage = async e => {
  const { id } = e.data;
  try {
    const rec = await getCourse(id);
    if (!rec || ((rec.info.quality || 'survey') === 'survey' && rec.osm?.buildings?.length && (rec.info.mapVersion || 1) >= MAP_VERSION)) return postMessage({ done: true, already: true });
    // the routed line it was built on (stored since map version 3); older routes are routed again, and only if the
    // routing server is down rebuilt along a curve smoothed through the stored road (every 15 m)
    const c = rec.course, fallback = c?.road?.length && c.origin && c.zone ? smoothLine(c.road, rec.loop).map(([x, z]) => utmToLl(x + c.origin[0], c.origin[1] - z, c.zone)) : undefined;
    const { warnings, quality } = await buildCourse({ places: rec.resolved, names: rec.places, loop: rec.loop, id, quality: 'survey', track: rec.track, fallback },
      msg => postMessage({ log: msg }), (n, total) => postMessage({ tile: n, total }));
    postMessage({ done: true, warnings, quality });
  } catch (err) { postMessage({ error: err.message }); }
};

// Centripetal Catmull-Rom through the stored road points, a point every metre or so: the curve the ride draws.
function smoothLine(road, loop) {
  const p = road.map(([x, , z]) => [x, z]), n = p.length, out = [];
  const pt = i => p[loop ? (i + n) % n : Math.max(0, Math.min(n - 1, i))];
  for (let i = 0; i < (loop ? n : n - 1); i++) {
    const P0 = pt(i - 1), P1 = pt(i), P2 = pt(i + 1), P3 = pt(i + 2);
    const tj = (a, b) => Math.max(1e-4, Math.sqrt(Math.hypot(b[0] - a[0], b[1] - a[1])));
    const t1 = tj(P0, P1), t2 = t1 + tj(P1, P2), t3 = t2 + tj(P2, P3);
    const steps = Math.max(1, Math.round(Math.hypot(P2[0] - P1[0], P2[1] - P1[1])));
    for (let s = 0; s < steps; s++) {
      const t = t1 + (t2 - t1) * s / steps, L = (A, B, ta, tb) => [0, 1].map(k => ((tb - t) * A[k] + (t - ta) * B[k]) / (tb - ta));
      const A1 = L(P0, P1, 0, t1), A2 = L(P1, P2, t1, t2), A3 = L(P2, P3, t2, t3);
      const B1 = L(A1, A2, 0, t2), B2 = L(A2, A3, t1, t3);
      out.push(L(B1, B2, t1, t2));
    }
  }
  out.push(loop ? p[0] : p[n - 1]);
  return out;
}
