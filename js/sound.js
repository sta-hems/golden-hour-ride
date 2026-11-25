// The sound mixer: one level for each kind of sound, kept in this browser. While the radio plays, the ride's
// own noise (wind and tyres) drops back, or goes quiet altogether if you turn it right down.
const KEY = 'golden-hour-ride-sound';
const DEFAULTS = { master: 0.9, ride: 0.8, weather: 0.8, traffic: 0.7, radio: 0.7, duck: true };
let saved = {};
try { saved = JSON.parse(localStorage.getItem(KEY)) || {}; } catch {}
export const sound = { ...DEFAULTS, ...saved, radioOn: false };
const listeners = new Set();
export const onChange = fn => { listeners.add(fn); return () => listeners.delete(fn); };
export function set(k, v) {
  sound[k] = v;
  if (k in DEFAULTS) try { localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(Object.keys(DEFAULTS).map(n => [n, sound[n]])))); } catch {}
  listeners.forEach(fn => fn(sound));
}
// what each part of the ride plays at, 0..1
export const level = kind => sound.master * sound[kind] * (kind === 'ride' && sound.radioOn && sound.duck ? 0.2 : 1);

const CSS = `
  #mixer { position: fixed; top: 64px; right: 18px; width: 300px; padding: 14px 16px 12px; border-radius: 14px; z-index: 5;
    background: rgba(20,16,12,.82); border: 1px solid rgba(255,255,255,.3); backdrop-filter: blur(10px); font-size: 12px; color: #fff; letter-spacing: .03em; }
  #mixer h3 { margin: 2px 0 10px; font-size: 11px; font-weight: 600; letter-spacing: .12em; text-transform: uppercase; opacity: .75; display: flex; justify-content: space-between; }
  #mixer h3 button { font: inherit; color: #fff; background: none; border: none; cursor: pointer; opacity: .8; }
  #mixer label { display: grid; grid-template-columns: 92px 1fr 38px; align-items: center; gap: 8px; margin: 7px 0; }
  #mixer input[type=range] { width: 100%; accent-color: #ffcf8f; }
  #mixer .v { text-align: right; opacity: .75; font-variant-numeric: tabular-nums; }
  #mixer .duck { display: flex; gap: 8px; margin-top: 10px; opacity: .9; }
`;
const ROWS = [['master', 'All'], ['ride', 'Wind & tyres'], ['weather', 'Rain'], ['traffic', 'Traffic'], ['radio', 'Radio']];
let panel = null;
export function toggleMixer() {
  if (panel) { panel.remove(); panel = null; return; }
  if (!document.getElementById('mixer-css')) { const s = document.createElement('style'); s.id = 'mixer-css'; s.textContent = CSS; document.head.append(s); }
  panel = document.createElement('div'); panel.id = 'mixer';
  for (const ev of ['keydown', 'keyup']) panel.addEventListener(ev, e => e.stopPropagation());
  panel.innerHTML = `<h3>Sound<button aria-label="Close">✕</button></h3>` +
    ROWS.map(([k, name]) => `<label>${name}<input type="range" min="0" max="100" step="1" data-k="${k}"><span class="v"></span></label>`).join('') +
    `<label class="duck"><input type="checkbox" id="mx-duck"> wind and tyres quieter while the radio plays</label>`;
  panel.querySelector('h3 button').onclick = toggleMixer;
  for (const inp of panel.querySelectorAll('input[type=range]')) {
    const k = inp.dataset.k, out = inp.nextElementSibling;
    inp.value = Math.round(sound[k] * 100); out.textContent = inp.value + ' %';
    inp.oninput = () => { set(k, inp.value / 100); out.textContent = inp.value + ' %'; };
  }
  const d = panel.querySelector('#mx-duck'); d.checked = sound.duck; d.onchange = () => set('duck', d.checked);
  document.body.append(panel);
}
