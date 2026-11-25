// Roadside boards every 1 to 1.5 km showing the latest headlines: tagesschau.de and hessenschau.de on the
// German courses, BBC News on the British ones. The News button turns them off and on (remembered).
import * as THREE from 'three';
import { getText } from './net.js';

const FEEDS = {
  de: [
    { name: 'tagesschau', url: 'https://www.tagesschau.de/infoservices/alle-meldungen-100~rss2.xml', bg: '#0c2a59', fg: '#ffffff', tag: '#e2001a' },
    { name: 'hessenschau', url: 'https://www.hessenschau.de/index.rss', bg: '#005aa0', fg: '#ffffff', tag: '#f4b400', viaProxyFirst: true },
  ],
  uk: [{ name: 'BBC News', url: 'https://feeds.bbci.co.uk/news/rss.xml', bg: '#b80000', fg: '#ffffff', tag: '#ffffff', viaProxyFirst: true }],
};
const KEY = 'golden-hour-ride-news';

function parseRss(xml) {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const strip = s => (s || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
  return [...doc.querySelectorAll('item')].slice(0, 20).map(it => ({
    title: strip(it.querySelector('title')?.textContent),
    text: strip(it.querySelector('description')?.textContent),
    time: new Date(it.querySelector('pubDate')?.textContent || Date.now()),
  })).filter(i => i.title);
}

function wrap(g, text, maxW, maxLines) {
  const words = text.split(' '), lines = [];
  let line = '';
  for (const w of words) {
    const t = line ? line + ' ' + w : w;
    if (g.measureText(t).width > maxW && line) { lines.push(line); line = w; if (lines.length === maxLines) break; } else line = t;
  }
  if (lines.length < maxLines && line) lines.push(line);
  if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length) lines[maxLines - 1] = lines[maxLines - 1].replace(/\s*\S*$/, '') + ' …';
  return lines;
}

function paint(canvas, feed, item) {
  const g = canvas.getContext('2d'), W = canvas.width, H = canvas.height;
  g.fillStyle = '#f5f2ea'; g.fillRect(0, 0, W, H);
  g.fillStyle = feed.bg; g.fillRect(0, 0, W, 118);
  g.fillStyle = feed.tag; g.fillRect(0, 118, W, 8);
  g.fillStyle = feed.fg; g.font = '700 62px Helvetica, Arial, sans-serif'; g.textBaseline = 'middle';
  g.fillText(feed.name, 44, 62);
  if (item) {
    g.font = '500 34px Helvetica, Arial, sans-serif'; g.textAlign = 'right';
    g.fillText(item.time.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }), W - 44, 64); g.textAlign = 'left';
    g.fillStyle = '#16181c'; g.font = '700 58px Helvetica, Arial, sans-serif'; g.textBaseline = 'top';
    const head = wrap(g, item.title, W - 88, 3);
    head.forEach((l, i) => g.fillText(l, 44, 160 + i * 68));
    g.fillStyle = '#3b3f46'; g.font = '400 38px Helvetica, Arial, sans-serif';
    wrap(g, item.text, W - 88, 3).forEach((l, i) => g.fillText(l, 44, 175 + head.length * 68 + i * 48));
  } else {
    g.fillStyle = '#8a8d93'; g.font = '500 40px Helvetica, Arial, sans-serif'; g.textBaseline = 'top'; g.fillText('No news just now', 44, 170);
  }
}

export async function init(ctx) {
  const { scene, P, T, R, N, LEN, meshH, onBridge, nearSide, LANE, COURSE_INFO, rnd } = ctx;
  if (COURSE_INFO.vintage) return;                       // no news boards in the 19th century
  const feeds = COURSE_INFO.drive === 'left' ? FEEDS.uk : FEEDS.de;
  const btn = document.createElement('button'); btn.id = 'newsbtn';
  btn.title = 'Roadside boards with the latest headlines (' + feeds.map(f => f.name).join(', ') + ')';
  ctx.$('clean').before(btn);
  let on = localStorage.getItem(KEY) !== 'off';
  const group = new THREE.Group(); scene.add(group);
  const label = () => { btn.textContent = 'News: ' + (on ? 'on' : 'off'); btn.classList.toggle('on', on); group.visible = on; };
  btn.onclick = () => { on = !on; localStorage.setItem(KEY, on ? 'on' : 'off'); label(); if (on) refresh(); };
  label();

  // where the boards go: on the rider's side of the road, every 1 to 1.5 km, never on a bridge or across a side road
  const side = Math.sign(LANE) || 1, boards = [];
  const postMat = new THREE.MeshStandardMaterial({ color: 0x5a5e63, metalness: 0.6, roughness: 0.45 });
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x2b2d31, metalness: 0.3, roughness: 0.6 });
  const BW = 4.4, BH = 2.75, LIFT = 2.1;
  for (let s = 350 + rnd() * 300; s < LEN - 400; s += 1000 + rnd() * 500) {
    let i = -1;
    for (let tries = 0, ss = s; tries < 12; tries++, ss += 25) {
      const k = Math.floor(ss / LEN * N) % N, x = P[k].x + R[k].x * side * 8, z = P[k].z + R[k].z * side * 8, sd = nearSide(x, z);
      let bridge = false; for (let d = -20; d <= 20; d++) if (onBridge[(k + d + N) % N]) bridge = true;
      if (!bridge && !(sd && sd.d < 6)) { i = k; break; }
    }
    if (i < 0) continue;
    const x = P[i].x + R[i].x * side * 8, z = P[i].z + R[i].z * side * 8, y = Math.min(meshH(x, z), P[i].y);
    const face = new THREE.Vector3(-T[i].x * 0.9 - R[i].x * side * 0.45, 0, -T[i].z * 0.9 - R[i].z * side * 0.45).normalize();   // toward the oncoming rider, turned a little to the road
    const b = new THREE.Group();
    b.position.set(x, y, z); b.rotation.y = Math.atan2(face.x, face.z);
    const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = 640;
    const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 16; tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter;
    // the poster sits 5 cm proud of the frame and is pulled forward in the depth test, so the two never fight (that flickered)
    const panelMat = new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.16, roughness: 0.85,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(BW, BH), panelMat); panel.position.set(0, LIFT + BH / 2, 0.03);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(BW + 0.2, BH + 0.2, 0.12), frameMat); frame.position.set(0, LIFT + BH / 2, -0.08);
    b.add(panel, frame);
    for (const px of [-BW / 2 + 0.5, BW / 2 - 0.5]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, LIFT + BH + 0.6, 10), postMat);
      post.position.set(px, (LIFT + BH + 0.6) / 2 - 0.6, -0.22); b.add(post);
    }
    b.traverse(m => { if (m.isMesh && m !== panel) { m.castShadow = true; m.receiveShadow = true; } });     // no shadow speckle on the poster itself
    group.add(b);
    boards.push({ canvas, tex, s: i * LEN / N });
  }

  ctx.st.boards = boards;                                // for checking
  let items = [], fetched = 0;
  async function refresh() {
    if (!on || performance.now() - fetched < 9 * 60e3 && items.length) return;
    fetched = performance.now();
    const lists = await Promise.all(feeds.map(async f => {
      try { return parseRss(await getText(f.url, {}, { viaProxyFirst: f.viaProxyFirst })).map(it => ({ feed: f, it })); }
      catch (err) { console.warn('news:', f.name, err.message); return []; }
    }));
    items = [];
    for (let k = 0; k < 20; k++) for (const l of lists) if (l[k]) items.push(l[k]);     // take turns between the sources
    ctx.st.news = items.length;
    boards.forEach((b, n) => { const e = items[n % Math.max(1, items.length)]; paint(b.canvas, e ? e.feed : feeds[n % feeds.length], e && e.it); b.tex.needsUpdate = true; });
  }
  boards.forEach((b, n) => { paint(b.canvas, feeds[n % feeds.length], null); b.tex.needsUpdate = true; });
  refresh();
  setInterval(refresh, 10 * 60e3);
  ctx.addVoice(/\b(news|nachrichten)( on| an)?\b$/, 'News on', () => { if (!on) btn.click(); });
  ctx.addVoice(/\b(news|nachrichten) (off|aus)\b/, 'News off', () => { if (on) btn.click(); });
}
