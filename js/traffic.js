// Oncoming traffic: a few cars on the other side of the road, coming towards the rider. Three body styles
// (hatchback, saloon, estate), lofted from rounded cross-sections, in a handful of paint colours.
// The Traffic button turns them off and on (remembered).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { level } from './sound.js';

// the sound of a passing electric car: the soft two-note hum their pedestrian-warning speakers make,
// and the hiss of tyres on tarmac. Pitch follows the speed, with a little Doppler as it goes by.
let noise = null;
function carVoice(ac) {
  if (!noise) {
    noise = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
    const d = noise.getChannelData(0); let b = 0;
    for (let i = 0; i < d.length; i++) { b = 0.97 * b + 0.03 * (Math.random() * 2 - 1); d[i] = b * 6; }   // a darker noise than white
  }
  const out = ac.createGain(); out.gain.value = 0;
  const pan = ac.createStereoPanner(); out.connect(pan).connect(ac.destination);
  const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 850; lp.Q.value = 0.5;
  const hum = ac.createGain(); hum.gain.value = 0; lp.connect(hum).connect(out);
  const o1 = ac.createOscillator(), o2 = ac.createOscillator(), g2 = ac.createGain();
  o1.type = 'sine'; o2.type = 'triangle'; g2.gain.value = 0.22;
  o1.connect(lp); o2.connect(g2).connect(lp);
  const lfo = ac.createOscillator(), lg = ac.createGain(); lfo.frequency.value = 2.6 + Math.random(); lg.gain.value = 3;   // a slow shimmer
  lfo.connect(lg); lg.connect(o1.frequency); lg.connect(o2.frequency);
  const n = ac.createBufferSource(); n.buffer = noise; n.loop = true;
  const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 600; bp.Q.value = 0.5;
  const tyre = ac.createGain(); tyre.gain.value = 0; n.connect(bp).connect(tyre).connect(out);
  const t = ac.currentTime; o1.start(t); o2.start(t); lfo.start(t); n.start(t, Math.random() * 1.9);
  return { out, pan, o1, o2, bp, hum, tyre, d: null };
}

const KEY = 'golden-hour-ride-traffic';
export const PAINTS = [0x1d3d6e, 0x9a1b1f, 0xd9dcdf, 0x2b2e33, 0x6f7479, 0x0f4d3c, 0xe6e2d6, 0x3a5f8a];

// Each car is lofted: rounded cross-sections at many points from tail to nose, so the body is curved every way
// (in plan, in elevation and across), not a side view pushed out sideways. x runs from the tail (0) to the nose (len).
//   top:  the body's upper line: boot, belt, bonnet           roof: the cabin's roof line, from rear window to windscreen
export const STYLES = {
  hatch: { len: 4.08, wid: 1.78, rear: 0.76, front: 3.34, plan: 5,
    top: [[0, 0.62], [0.06, 0.9], [0.3, 0.98], [1.2, 0.99], [2.75, 0.97], [3.2, 0.92], [3.75, 0.82], [4.02, 0.68], [4.08, 0.5]],
    roof: [[0.1, 0.98], [0.28, 1.3], [0.62, 1.45], [1.95, 1.47], [2.75, 0.97]] },
  saloon: { len: 4.72, wid: 1.82, rear: 0.98, front: 3.78, plan: 5.5,
    top: [[0, 0.62], [0.05, 0.92], [0.35, 1.0], [0.8, 1.02], [3.3, 0.98], [3.75, 0.92], [4.35, 0.82], [4.66, 0.66], [4.72, 0.5]],
    roof: [[0.8, 1.01], [1.25, 1.33], [1.7, 1.43], [2.6, 1.44], [3.3, 0.98]] },
  estate: { len: 4.78, wid: 1.84, rear: 0.98, front: 3.82, plan: 5.5,
    top: [[0, 0.62], [0.05, 0.94], [0.3, 1.02], [1.5, 1.02], [3.35, 1.0], [3.8, 0.94], [4.4, 0.84], [4.72, 0.68], [4.78, 0.5]],
    roof: [[0.1, 1.02], [0.18, 1.4], [0.45, 1.5], [2.65, 1.51], [3.35, 1.0]] },
};
const WHEEL_R = 0.33;

function profile(pts) {                 // a smooth line through the points, as y for a given x
  const s = new THREE.SplineCurve(pts.map(p => new THREE.Vector2(p[0], p[1]))).getPoints(300);
  return x => {
    if (x <= s[0].x) return s[0].y;
    for (let i = 1; i < s.length; i++) if (s[i].x >= x) { const a = s[i - 1], b = s[i], t = (x - a.x) / (b.x - a.x || 1); return a.y + (b.y - a.y) * t; }
    return s[s.length - 1].y;
  };
}

// a closed surface through superellipse cross-sections; sec(x) gives bottom, top, half width, squareness and tumblehome
function loft(x0, x1, M, sec, K = 36) {
  const pos = [], idx = [], ends = [];
  for (let i = 0; i <= M; i++) {
    const u = i / M, x = x0 + (x1 - x0) * (0.5 - 0.5 * Math.cos(Math.PI * u));      // closer stations at the ends, where it curves most
    const { yb, yt, hw, n, tumble } = sec(x), yc = (yb + yt) / 2, hy = Math.max(2e-3, (yt - yb) / 2), m = 2 / n;
    for (let k = 0; k < K; k++) {
      const th = k / K * Math.PI * 2, c = Math.cos(th), sn = Math.sin(th);
      const y = yc + hy * Math.sign(sn) * Math.abs(sn) ** m, up = Math.max(0, (y - yc) / hy);
      pos.push(x, y, Math.max(2e-3, hw) * Math.sign(c) * Math.abs(c) ** m * (1 - tumble * up * up));
    }
    if (i === 0 || i === M) ends.push([x, yc]);
  }
  for (let i = 0; i < M; i++) for (let k = 0; k < K; k++) {
    const a = i * K + k, b = i * K + (k + 1) % K;
    idx.push(a, b, a + K, b, b + K, a + K);
  }
  const c0 = pos.length / 3; pos.push(ends[0][0], ends[0][1], 0); const c1 = c0 + 1; pos.push(ends[1][0], ends[1][1], 0);
  for (let k = 0; k < K; k++) { idx.push(c0, (k + 1) % K, k); idx.push(c1, M * K + k, M * K + (k + 1) % K); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  return g;
}

const blob = (rx, ry, rz) => new THREE.SphereGeometry(1, 18, 12).scale(rx, ry, rz);     // lamps, mirrors, grille: rounded, not boxes

export function buildStyle(st) {
  const { len, wid, rear, front, plan } = st, top = profile(st.top), roofY = profile(st.roof), W2 = wid / 2;
  const hw = x => { const u = Math.min(1, Math.abs(x - len / 2) / (len / 2)); return W2 * Math.pow(Math.max(0, 1 - u ** plan), 1 / plan); };   // rounded in plan
  const bottom = x => {                                  // the sills, rising into an arch over each wheel and up at the bumpers
    let y = 0.3;
    for (const w of [rear, front]) { const d = Math.abs(x - w), r = WHEEL_R + 0.07; if (d < r) y = Math.max(y, WHEEL_R + Math.sqrt(r * r - d * d) * 0.92); }
    const e = Math.min(x, len - x); if (e < 0.3) y = Math.max(y, 0.3 + (0.3 - e) * 0.55);
    return y;
  };
  const body = loft(0, len, 72, x => ({ yb: bottom(x), yt: top(x), hw: hw(x), n: 4.6, tumble: 0.08 }));
  const r0 = st.roof[0][0], r1 = st.roof[st.roof.length - 1][0];
  const glass = loft(r0, r1, 44, x => ({ yb: top(x) - 0.06, yt: roofY(x), hw: hw(x) * 0.75, n: 4.6, tumble: 0.2 }), 32);     // narrower than the shoulders, so it sits on them
  const f0 = st.roof[2][0] - 0.04, f1 = st.roof[3][0] + 0.06;          // the roof panel over the glass, in the paint
  const roof = loft(f0, f1, 30, x => { const y = roofY(x), e = Math.min(x - f0, f1 - x), t = Math.min(1, e / 0.25);
    return { yb: y - 0.06 * t, yt: y + 0.016 * t, hw: hw(x) * 0.75 * (1 - 0.2) * 0.97, n: 5, tumble: 0.02 }; }, 32);
  const paint = [body, roof];
  const nx = len - 0.2, ny = top(nx) - 0.1, tx = 0.16, ty = top(tx) - 0.14;
  const trim = [blob(0.05, 0.05, hw(len - 0.1) * 0.5).translate(len - 0.07, ny - 0.13, 0),           // grille, set into the nose
                blob(0.06, 0.045, hw(len - 0.08) * 0.8).translate(len - 0.07, 0.37, 0),             // the dark lower bumper
                blob(0.06, 0.045, hw(0.08) * 0.8).translate(0.07, 0.39, 0)];
  const head = [], tail = [];
  for (const z of [-1, 1]) {
    head.push(blob(0.07, 0.045, 0.19).translate(nx + 0.06, ny, z * (hw(nx) - 0.27)));
    tail.push(blob(0.06, 0.055, 0.18).translate(tx - 0.08, ty, z * (hw(tx) - 0.25)));
    const mx = st.roof[st.roof.length - 1][0] - 0.12;                                                // mirrors
    trim.push(blob(0.07, 0.055, 0.09).translate(mx, top(mx) + 0.07, z * (hw(mx) * 0.78 + 0.07)));
  }
  const tyre = new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, 0.22, 28).rotateX(Math.PI / 2);
  const rim = new THREE.CylinderGeometry(WHEEL_R * 0.64, WHEEL_R * 0.6, 0.235, 16).rotateX(Math.PI / 2);
  const tyres = [], rims = [];
  for (const x of [rear, front]) for (const z of [-1, 1]) {
    const zz = z * (hw(x) - 0.14);
    tyres.push(tyre.clone().translate(x, WHEEL_R, zz)); rims.push(rim.clone().translate(x, WHEEL_R, zz + z * 0.005));
  }
  const plain = g => { const h = g.index ? g.toNonIndexed() : g; h.deleteAttribute('uv'); return h; };     // the lofts carry no texture coordinates
  const parts = { body: mergeGeometries(paint.map(plain)), glass, trim: mergeGeometries(trim), head: mergeGeometries(head),
                  tail: mergeGeometries(tail), tyre: mergeGeometries(tyres), rim: mergeGeometries(rims) };
  for (const g of Object.values(parts)) { g.translate(-len / 2, 0, 0); g.rotateY(-Math.PI / 2); }   // nose toward +z
  return parts;
}

export const materials = () => ({
  glass: new THREE.MeshPhysicalMaterial({ color: 0x0d1419, metalness: 0.2, roughness: 0.05, clearcoat: 1, envMapIntensity: 1.5 }),
  trim: new THREE.MeshStandardMaterial({ color: 0x111214, roughness: 0.6 }),
  head: new THREE.MeshStandardMaterial({ color: 0xfff6e0, emissive: 0xfff1d6, emissiveIntensity: 2.2 }),
  tail: new THREE.MeshStandardMaterial({ color: 0x7a0a0a, emissive: 0xff1a12, emissiveIntensity: 0.9 }),
  tyre: new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.9 }),
  rim: new THREE.MeshStandardMaterial({ color: 0xc9ccd0, metalness: 0.9, roughness: 0.3 }),
});

export function init(ctx) {
  const { scene, at, mkPose, LEN, N, T, LANE, COURSE_INFO, rnd } = ctx;
  if (COURSE_INFO.vintage) return;                       // no motor cars in the 19th century
  const btn = document.createElement('button'); btn.id = 'trafficbtn';
  btn.title = 'A few cars coming the other way';
  ctx.$('clean').before(btn);
  let on = localStorage.getItem(KEY) !== 'off';
  const group = new THREE.Group(); scene.add(group);
  const label = () => { btn.textContent = 'Traffic: ' + (on ? 'on' : 'off'); btn.classList.toggle('on', on); group.visible = on; };
  btn.onclick = () => { on = !on; localStorage.setItem(KEY, on ? 'on' : 'off'); label(); };
  label();

  const styles = Object.fromEntries(Object.entries(STYLES).map(([k, s]) => [k, buildStyle(s)]));
  const mats = materials();
  // a few cars, about one for every 1.5 km of road: most come towards you, some go your way and overtake
  const COUNT = Math.max(2, Math.min(6, Math.round(LEN / 1500))), kinds = Object.keys(styles), cars = [];
  for (let n = 0; n < COUNT; n++) {
    const parts = styles[kinds[n % kinds.length]], car = new THREE.Group();
    const paint = new THREE.MeshPhysicalMaterial({ color: PAINTS[Math.floor(rnd() * PAINTS.length)], metalness: 0.55, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.08 });
    for (const [k, g] of Object.entries(parts)) { const m = new THREE.Mesh(g, k === 'body' ? paint : mats[k]); m.castShadow = true; m.receiveShadow = k === 'body'; car.add(m); }
    group.add(car);
    const dir = n % 5 === 1 || n % 5 === 3 ? 1 : -1;                       // +1: your way, -1: towards you
    cars.push({ car, dir, s: ((n + 0.3 + rnd() * 0.4) / COUNT * LEN + (dir < 0 ? 600 : -500) + LEN) % LEN, v: 12, want: 17 + rnd() * 6, lat: dir * LANE, latV: 0, passing: false });
  }

  // how fast the road can be taken at each point: at most 2 m/s² sideways in a bend, and braking at 2.5 m/s² beforehand
  const DS = LEN / N, LAT = 2.0, BRAKE = 2.5, bend = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const a = T[(i - 8 + N) % N], b = T[(i + 8) % N];
    const kappa = Math.hypot(b.x - a.x, b.z - a.z) / (16 * DS);
    bend[i] = Math.min(30, Math.sqrt(LAT / Math.max(kappa, 1e-5)));
  }
  const ahead = (from, step) => {                                        // the limit, looking ahead in the direction of travel
    const out = bend.slice();
    for (let pass = 0; pass < 2; pass++) for (let k = 0; k < N; k++) {
      const i = step > 0 ? (N - 1 - k) : k, nxt = (i + step + N) % N;
      out[i] = Math.min(out[i], Math.sqrt(out[nxt] * out[nxt] + 2 * BRAKE * DS));
    }
    return out;
  };
  const limit = { 1: ahead(bend, 1), '-1': ahead(bend, -1) };
  const idx = s => Math.floor(((s % LEN) + LEN) % LEN / DS) % N;
  const fwd = (a, b) => (((b - a) % LEN) + LEN) % LEN;                    // how far b is ahead of a, along the ride

  ctx.st.cars = cars;                                    // for checking
  const pose = mkPose(), front = mkPose(), aim = new THREE.Vector3(), rel = new THREE.Vector3();
  const hush = () => { for (const c of cars) if (c.voice) c.voice.out.gain.setTargetAtTime(0, c.voice.out.context.currentTime, 0.1); };
  btn.addEventListener('click', () => { if (!on) hush(); });
  btn.title = 'A few cars, both ways; they give the rider plenty of room';
  return dt => {
    if (!on) return;
    const ac = ctx.audio(), vol = level('traffic'), me = ctx.st;
    for (const c of cars) {
      let want = Math.min(c.want, limit[c.dir][idx(c.s)]);
      // keep a distance to the car in front going the same way
      for (const o of cars) if (o !== c && o.dir === c.dir) {
        const gap = c.dir > 0 ? fwd(c.s, o.s) : fwd(o.s, c.s);
        if (gap < 40) want = Math.min(want, o.v + (gap - 25) * 0.3);
      }
      if (c.dir > 0) {                                     // coming up behind the rider
        const gap = fwd(c.s, me.s), past = fwd(me.s, c.s);
        if (past < 30) want = Math.max(want, me.v + 3);                 // just ahead of a fast rider (downhill): keep pulling away
        if (gap < 6 || past < 6) c.passing = true;                       // never sit on top of the rider: take the other lane
        if (c.passing && past > 20 && past < LEN / 2) c.passing = false;     // well clear in front: back to the right lane
        if (!c.passing && gap < 70) {
          // overtake only with the other lane clear for 320 m and no tight bend coming
          let clear = true;
          for (const o of cars) if (o.dir < 0 && fwd(c.s, o.s) < 320) clear = false;
          for (let d = 0; d < 160 && clear; d += 10) if (bend[idx(c.s + d)] < 15) clear = false;
          if (clear && c.v > me.v + 1) c.passing = true;
          else if (gap < 45) want = Math.min(want, me.v + (gap - 25) * 0.25);   // otherwise wait behind, well back
        }
      }
      want = Math.max(0, want);
      c.v += Math.max(-4 * dt, Math.min(2 * dt, want - c.v));
      c.s = ((c.s + c.dir * c.v * dt) % LEN + LEN) % LEN;
      // the lane: your side for cars going your way, the other side for oncoming ones and for overtaking
      const lane = c.dir > 0 && !c.passing ? LANE : -LANE;
      // a critically damped spring: the car eases out, drifts across and eases in again, a smooth S without a kink at either end
      const K = 0.9, h = Math.min(dt, 0.05);
      c.latV += (K * (lane - c.lat) - 2 * Math.sqrt(K) * c.latV) * h;
      c.lat += c.latV * h;
      at(c.s, pose); at(c.s + c.dir * 4, front);
      c.car.position.copy(pose.p).addScaledVector(pose.r, c.lat);
      aim.copy(front.p).addScaledVector(front.r, c.lat + c.latV * 4 / Math.max(c.v, 3));     // point the nose where the sideways drift takes it
      c.car.lookAt(aim);
      if (!ac || dt <= 0) continue;
      const v = c.voice || (c.voice = carVoice(ac)), now = ac.currentTime;
      const d = c.car.position.distanceTo(ctx.camera.position), closing = v.d === null ? 0 : (v.d - d) / dt;
      v.d = d;
      const near = d > 320 || document.hidden ? 0 : 1 / (1 + (d / 14) ** 2);
      const dop = 343 / (343 - Math.max(-60, Math.min(60, closing))), f = (140 + c.v * 5) * dop;
      v.o1.frequency.setTargetAtTime(f, now, 0.08); v.o2.frequency.setTargetAtTime(f * 1.5, now, 0.08);
      v.bp.frequency.setTargetAtTime((420 + c.v * 22) * dop, now, 0.08);
      v.hum.gain.setTargetAtTime(0.16, now, 0.2); v.tyre.gain.setTargetAtTime(Math.min(1, c.v / 22) * 0.55, now, 0.2);
      v.out.gain.setTargetAtTime(near * vol * 0.9, now, 0.06);
      rel.copy(c.car.position).applyMatrix4(ctx.camera.matrixWorldInverse);
      v.pan.pan.setTargetAtTime(Math.max(-1, Math.min(1, rel.x / (Math.abs(rel.z) + 4))), now, 0.06);
    }
  };
}
