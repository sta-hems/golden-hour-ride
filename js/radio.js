// Web radio: SWR, hr and BBC stations (all are on offer everywhere). Click the button to switch the radio on or off;
// point at it for the list of stations. By voice, say the station's name, "radio off", "louder" or "quieter".
const swr = n => `https://liveradio.swr.de/sw282p3/${n}/play.mp3`, hr = n => `https://dispatcher.rndfnk.com/hr/${n}/live/mp3/high`;
const bbc = (pool, n) => `https://as-hls-ww-live.akamaized.net/pool_${pool}/live/ww/bbc_radio_${n}/bbc_radio_${n}.isml/bbc_radio_${n}-audio%3d96000.norewind.m3u8`;
const STATIONS = [
  { id: 'swr1', name: 'SWR1', url: swr('swr1rp'), say: /\b(s\s?w\s?r\s?(1|eins|one))\b/ },
  { id: 'swr2', name: 'SWR2', url: swr('swr2'), say: /\b(s\s?w\s?r\s?(2|zwei|two))\b/ },
  { id: 'swr3', name: 'SWR3', url: swr('swr3'), say: /\b(s\s?w\s?r\s?(3|drei|three))\b/ },
  { id: 'hr1', name: 'hr1', url: hr('hr1'), say: /\b(h\s?r\s?(1|eins|one))\b/ },
  { id: 'hr2', name: 'hr2', url: hr('hr2'), say: /\b(h\s?r\s?(2|zwei|two))\b/ },
  { id: 'hr3', name: 'hr3', url: hr('hr3'), say: /\b(h\s?r\s?(3|drei|three)|hessischer rundfunk)\b/ },
  { id: 'bbc1', name: 'BBC Radio 1', hls: true, url: bbc('01505109', 'one'), say: /\b(radio (1|one|eins)|bbc (1|one|eins))\b/ },
  { id: 'bbc2', name: 'BBC Radio 2', hls: true, url: bbc('74208725', 'two'), say: /\b(radio (2|two|zwei)|bbc (2|two|zwei))\b/ },
  { id: 'bbc3', name: 'BBC Radio 3', hls: true, url: bbc('23461179', 'three'), say: /\b(radio (3|three|drei)|bbc (3|three|drei))\b/ },
].sort((a, b) => a.name.localeCompare(b.name, 'de', { numeric: true, sensitivity: 'base' }));
const KEY = 'golden-hour-ride-radio';
import { sound, set, level, onChange } from './sound.js';

export function init(ctx) {
  const uk = ctx.COURSE_INFO.drive === 'left';
  const home = STATIONS.find(st => st.id === (uk ? 'bbc2' : 'swr3'));      // the first station when nothing was chosen yet
  const last = () => STATIONS.find(st => st.id === localStorage.getItem(KEY + '-station')) || home;
  const btn = document.createElement('button'); btn.id = 'radio';
  btn.title = 'Web radio: click to switch it on or off, point at it to pick a station. Voice: “SWR1/2/3”, “hr1/2/3”, “BBC Radio 1/2/3”, “radio off”, “louder”, “quieter”';
  ctx.$('voice').after(btn);
  const audio = new Audio(); audio.preload = 'none';
  let current = null, hls = null;
  const apply = () => { audio.volume = Math.min(1, level('radio')); };      // the mixer sets the level
  onChange(apply); apply();
  const label = (t) => { btn.textContent = 'Radio: ' + (t || (current ? current.name : 'off')); btn.classList.toggle('on', !!current); };

  async function play(st) {
    stop(false);
    current = st; label(st.name + '…');
    localStorage.setItem(KEY, st.id); localStorage.setItem(KEY + '-station', st.id); mark();
    try {
      if (st.hls && !audio.canPlayType('application/vnd.apple.mpegurl')) {
        if (!window.Hls) await new Promise((ok, no) => { const s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/npm/hls.js@1.5.17/dist/hls.light.min.js'; s.onload = ok; s.onerror = no; document.head.append(s); });
        hls = new window.Hls({ lowLatencyMode: false }); hls.loadSource(st.url); hls.attachMedia(audio);
      } else audio.src = st.url;
      await audio.play();
      if (current === st) { label(); set('radioOn', true); }
    } catch (err) { if (current === st) { label('no signal'); current = null; } }
  }
  function stop(save = true) {
    if (hls) { hls.destroy(); hls = null; }
    audio.pause(); audio.removeAttribute('src'); audio.load();
    current = null; label(); set('radioOn', false); mark();
    if (save) localStorage.setItem(KEY, 'off');
  }
  const vol = d => { set('radio', Math.max(0.05, Math.min(1, sound.radio + d))); label(`${current ? current.name : 'off'} · ${Math.round(sound.radio * 100)} %`); setTimeout(() => label(), 1800); };

  btn.onclick = () => { if (current) stop(); else play(last()); };

  // the station list: shown while the pointer is over the button, gone again once a station is picked
  const pop = document.createElement('div'); pop.id = 'radiopop'; pop.hidden = true;
  if (!document.getElementById('radiopop-css')) {
    const css = document.createElement('style'); css.id = 'radiopop-css';
    css.textContent = `#radiopop { position: fixed; z-index: 6; padding: 6px; border-radius: 12px; font-size: 11px; letter-spacing: .06em; color: #fff;
      background: rgba(20,16,12,.8); border: 1px solid rgba(255,255,255,.3); backdrop-filter: blur(8px); display: grid; gap: 2px; min-width: 130px; }
      #radiopop[hidden] { display: none; }
      #radiopop button { all: unset; cursor: pointer; padding: 5px 10px; border-radius: 8px; white-space: nowrap; }
      #radiopop button:hover { background: rgba(255,255,255,.14); }
      #radiopop button.on { color: #ffcf8f; } #radiopop button.on::before { content: '▶ '; }
      #radiopop hr { border: 0; border-top: 1px solid rgba(255,255,255,.18); margin: 3px 4px; }
      body.clean #radiopop { display: none; }`;
    document.head.append(css);
  }
  let group = '';
  for (const st of STATIONS) {
    const g = st.name.slice(0, 2).toLowerCase();
    if (group && g !== group) pop.append(document.createElement('hr'));
    group = g;
    const b = document.createElement('button'); b.textContent = st.name; b.dataset.id = st.id;
    b.onclick = () => { if (current === st) stop(); else play(st); clearTimeout(hideT); hideT = setTimeout(() => { pop.hidden = true; }, 700); };
    pop.append(b);
  }
  document.body.append(pop);
  function mark() { for (const b of pop.querySelectorAll('button')) b.classList.toggle('on', !!current && b.dataset.id === current.id); }
  let hideT = 0;
  const show = () => {
    clearTimeout(hideT); mark();
    const r = btn.getBoundingClientRect();
    pop.hidden = false;
    pop.style.top = (r.bottom + 6) + 'px'; pop.style.left = Math.max(8, Math.min(innerWidth - pop.offsetWidth - 8, r.left + r.width / 2 - pop.offsetWidth / 2)) + 'px';
  };
  const hideSoon = ms => { clearTimeout(hideT); hideT = setTimeout(() => { if (!pop.matches(':hover') && !btn.matches(':hover')) pop.hidden = true; else hideSoon(400); }, ms); };
  btn.addEventListener('mouseenter', show);
  btn.addEventListener('mouseleave', () => hideSoon(500));
  pop.addEventListener('mouseenter', () => clearTimeout(hideT));
  pop.addEventListener('mouseleave', () => hideSoon(500));
  label();

  for (const st of STATIONS) ctx.addVoice(st.say, () => st.name, () => play(st));
  ctx.addVoice(/\b(radio (off|aus|stop)|stop the radio|music off|musik aus)\b/, 'Radio off', () => stop());
  ctx.addVoice(/\b(radio( on| an)?|music|musik)\b$/, () => current ? current.name : 'Radio', () => { if (!current) play(last()); });
  ctx.addVoice(/\b(louder|lauter|volume up)\b/, 'Louder', () => vol(0.15));
  ctx.addVoice(/\b(quieter|leiser|softer|volume down)\b/, 'Quieter', () => vol(-0.15));
}
