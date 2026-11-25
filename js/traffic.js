// Oncoming traffic: a few cars on the other side of the road, coming towards the rider. Three body styles
// (hatchback, saloon, estate), built from rounded side profiles, in a handful of paint colours.
// The Traffic button turns them off and on (remembered).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const KEY = 'golden-hour-ride-traffic';
export const PAINTS = [0x1d3d6e, 0x9a1b1f, 0xd9dcdf, 0x2b2e33, 0x6f7479, 0x0f4d3c, 0xe6e2d6, 0x3a5f8a];

// side profiles: x runs from the tail (0) to the nose (len), y up; wheels sit at rear and front
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
  const COUNT = Math.max(2, Math.min(7, Math.round(LEN / 1300))), kinds = Object.keys(styles), cars = [];
  for (let n = 0; n < COUNT; n++) {
    const parts = styles[kinds[n % kinds.length]], car = new THREE.Group();
    const paint = new THREE.MeshPhysicalMaterial({ color: PAINTS[Math.floor(rnd() * PAINTS.length)], metalness: 0.55, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.08 });
    for (const [k, g] of Object.entries(parts)) { const m = new THREE.Mesh(g, k === 'body' ? paint : mats[k]); m.castShadow = true; m.receiveShadow = k === 'body'; car.add(m); }
    group.add(car);
    cars.push({ car, s: (n + 0.3 + rnd() * 0.4) / COUNT * LEN + 600, v: 0, want: 18 + rnd() * 6 });
  }

  ctx.st.cars = cars;                                    // for checking
  const pose = mkPose(), ahead = mkPose(), behind = mkPose(), aim = new THREE.Vector3();
  const off = -LANE;                                      // the other side of the road
  return dt => {
    if (!on) return;
    for (const c of cars) {
      at(c.s, pose); at(c.s - 12, ahead); at(c.s + 12, behind);
      const kappa = ahead.t.distanceTo(behind.t) / 24;    // slow for bends: about 3 m/s² sideways at most
      const limit = Math.min(c.want, Math.sqrt(3 / Math.max(kappa, 1e-4)));
      c.v += Math.max(-4 * dt, Math.min(2 * dt, limit - c.v));
      c.s = ((c.s - c.v * dt) % LEN + LEN) % LEN;          // they come towards you, against the direction of the ride
      at(c.s, pose); at(c.s - 3, ahead);
      c.car.position.copy(pose.p).addScaledVector(pose.r, off);
      aim.copy(ahead.p).addScaledVector(ahead.r, off);
      c.car.lookAt(aim);
    }
  };
}
