// Oncoming traffic: a few cars on the other side of the road, coming towards the rider. Three body styles
// (hatchback, saloon, estate) built from rounded side profiles, in a handful of paint colours, unless real models are given.
// The Traffic button turns them off and on (remembered).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { level } from './sound.js';

// Real car models, if there are any: listed in assets/cars/cars.json as
//   { "cars": [ { "file": "milano/scene.gltf", "title": "Milano '95", "author": "…", "license": "CC BY 4.0", "url": "…",
//                 "length": 4.2, "rotate": 0 } ] }
// Each is scaled to its real length, turned nose-first (rotate: degrees, when the model faces another way), set on the
// ground, and credited on screen. Models that aren't there are skipped; with none, the cars built below are used.
export async function loadModels() {
  let list;
  const dir = new URL('../assets/cars/', import.meta.url);           // wherever the page is, the models sit beside js/
  try { const r = await fetch(new URL('cars.json', dir), { cache: 'no-cache' }); if (!r.ok) return []; list = (await r.json()).cars || []; } catch { return []; }
  const loader = new GLTFLoader(), out = [];
  for (const c of list) {
    const url = new URL(c.file, dir).href;
    try { if (!(await fetch(url, { method: 'HEAD' })).ok) continue; }    // not downloaded: skip it quietly
    catch { continue; }
    try { out.push({ model: fit((await loader.loadAsync(url)).scene, c), info: c }); }
    catch (err) { console.warn('car model', c.file, err); }
  }
  return out;
}
// the car's own extent: badges and number plates are left out, as some models keep spare ones far from the car
function measure(scene, box) {
  box.makeEmpty();
  scene.traverse(m => { if (m.isMesh && !/badge|plate|decal/i.test(m.name + ' ' + (m.material && m.material.name))) box.expandByObject(m); });
  return box;
}
function fit(scene, c) {
  const holder = new THREE.Group(), box = new THREE.Box3(), size = new THREE.Vector3(), mid = new THREE.Vector3();
  scene.rotation.y = (c.rotate || 0) * Math.PI / 180;
  scene.updateMatrixWorld(true); measure(scene, box).getSize(size);
  if (size.x > size.z) { scene.rotation.y += Math.PI / 2; scene.updateMatrixWorld(true); measure(scene, box).getSize(size); }   // lying across: turn it lengthways first, then by rotate
  scene.scale.multiplyScalar((c.length || 4.4) / size.z);
  scene.updateMatrixWorld(true); measure(scene, box).getCenter(mid);
  scene.position.set(-mid.x, -box.min.y, -mid.z);                       // centred, wheels on the ground
  scene.traverse(m => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
  holder.add(scene);
  return holder;
}

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

// The cars used when no models are given (assets/cars/cars.json): side profiles, x from the tail (0) to the nose (len), y up,
// pushed out to the car's width with rounded edges; wheels sit at rear and front
export const STYLES = {
  hatch: { len: 4.08, wid: 1.76, rear: 0.78, front: 3.33, body: [[0, 0.42], [0.02, 0.9], [0.22, 0.99], [2.9, 0.95], [3.8, 0.8], [4.08, 0.58], [4.05, 0.27]],
           glass: [[0.12, 0.99], [0.5, 1.44], [2.05, 1.45], [2.9, 0.95]] },
  saloon: { len: 4.7, wid: 1.82, rear: 0.95, front: 3.75, body: [[0, 0.44], [0.03, 0.97], [0.75, 1.02], [3.35, 0.96], [4.35, 0.8], [4.7, 0.58], [4.66, 0.27]],
            glass: [[0.75, 1.02], [1.3, 1.42], [2.55, 1.44], [3.35, 0.96]] },
  estate: { len: 4.75, wid: 1.84, rear: 0.95, front: 3.8, body: [[0, 0.45], [0.02, 1.0], [0.2, 1.03], [3.4, 0.98], [4.4, 0.82], [4.75, 0.6], [4.71, 0.28]],
            glass: [[0.1, 1.03], [0.3, 1.5], [2.6, 1.52], [3.4, 0.98]] },
};
const WHEEL_R = 0.33;

function extrude(shape, width, bevel = 0.06) {
  const g = new THREE.ExtrudeGeometry(shape, { depth: width - 2 * bevel, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 4, curveSegments: 14 });
  g.translate(0, 0, -(width - 2 * bevel) / 2);
  return g;
}

export function buildStyle(st) {
  const { len, wid, rear, front, body, glass } = st, r = WHEEL_R + 0.06, y0 = 0.27;
  const s = new THREE.Shape();                          // the lower body, with arches over the wheels
  s.moveTo(0.06, y0);
  s.lineTo(rear - r, y0); s.absarc(rear, WHEEL_R, r, Math.PI, 0, true);
  s.lineTo(front - r, y0); s.absarc(front, WHEEL_R, r, Math.PI, 0, true);
  s.lineTo(body[6][0], body[6][1]);
  s.quadraticCurveTo(len + 0.02, (body[5][1] + body[6][1]) / 2, body[5][0], body[5][1]);
  s.quadraticCurveTo(len - 0.05, body[4][1] + 0.02, body[4][0], body[4][1]);
  s.lineTo(body[3][0], body[3][1]); s.lineTo(body[2][0], body[2][1]);
  s.quadraticCurveTo(body[1][0], body[2][1], body[1][0], body[1][1]);
  s.lineTo(body[0][0], body[0][1]); s.lineTo(0.06, y0);
  const paint = [extrude(s, wid, 0.07)];
  const gs = new THREE.Shape(); gs.moveTo(...glass[0]); glass.slice(1).forEach(p => gs.lineTo(...p)); gs.lineTo(...glass[0]);
  const glassGeo = extrude(gs, wid - 0.16, 0.05);
  const roof = new THREE.Shape();                       // a roof panel over the glass, so it reads as a car and not a bubble
  roof.moveTo(glass[1][0] + 0.05, glass[1][1] - 0.03); roof.lineTo(glass[2][0] - 0.05, glass[2][1] - 0.03);
  roof.lineTo(glass[2][0] - 0.12, glass[2][1] + 0.03); roof.lineTo(glass[1][0] + 0.1, glass[1][1] + 0.03);
  paint.push(extrude(roof, wid - 0.2, 0.04));
  for (const z of [-1, 1]) {                            // the pillars between the windows
    const pil = new THREE.BoxGeometry(0.09, 0.42, 0.05);
    const mx = (glass[1][0] + glass[2][0]) / 2; pil.translate(mx - 0.25, (glass[1][1] + body[2][1]) / 2 + 0.03, z * (wid / 2 - 0.1));
    paint.push(pil);
  }
  const body3 = mergeGeometries(paint.map(g => g.toNonIndexed()));
  const fy = body[5][1];                                 // the front face, just under the bonnet's leading edge
  const trim = [new THREE.BoxGeometry(0.14, 0.2, wid * 0.46).translate(len + 0.02, fy - 0.12, 0),       // grille
                new THREE.BoxGeometry(0.16, 0.13, wid - 0.1).translate(len + 0.0, 0.33, 0),          // front bumper, black lower part
                new THREE.BoxGeometry(0.14, 0.14, wid - 0.1).translate(0.0, 0.36, 0),                // rear bumper
                new THREE.BoxGeometry(len - 1.7, 0.07, wid + 0.02).translate(len / 2, 0.37, 0)];    // sills
  for (const z of [-1, 1]) trim.push(new THREE.BoxGeometry(0.2, 0.11, 0.16).translate(glass[3][0] - 0.12, body[3][1] + 0.06, z * (wid / 2 + 0.06)));   // mirrors
  const head = [], tail = [];
  for (const z of [-1, 1]) {
    head.push(new THREE.BoxGeometry(0.14, 0.13, 0.42).translate(len - 0.01, fy + 0.02, z * (wid / 2 - 0.32)));
    tail.push(new THREE.BoxGeometry(0.12, 0.16, 0.38).translate(0.0, body[1][1] - 0.16, z * (wid / 2 - 0.27)));
  }
  const tyre = new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, 0.22, 22).rotateX(Math.PI / 2);
  const rim = new THREE.CylinderGeometry(WHEEL_R * 0.62, WHEEL_R * 0.62, 0.235, 12).rotateX(Math.PI / 2);
  const tyres = [], rims = [];
  for (const x of [rear, front]) for (const z of [-1, 1]) {
    tyres.push(tyre.clone().translate(x, WHEEL_R, z * (wid / 2 - 0.13)));
    rims.push(rim.clone().translate(x, WHEEL_R, z * (wid / 2 - 0.12)));
  }
  const parts = { body: body3, glass: glassGeo, trim: mergeGeometries(trim), head: mergeGeometries(head), tail: mergeGeometries(tail), tyre: mergeGeometries(tyres), rim: mergeGeometries(rims) };
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
  loadModels().then(models => {                          // swap in the real models once they have loaded
    if (!models.length) return;
    cars.forEach((c, n) => { const m = models[n % models.length].model.clone(true); c.car.clear(); c.car.add(m); });
    const credit = ctx.$('credit'), names = models.map(({ info: i }) => `${i.title}${i.author ? ' by ' + i.author : ''}${i.license ? ' (' + i.license + ')' : ''}`);
    if (credit) credit.textContent += ' Cars: ' + names.join(', ') + '.';
  });
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
