// Web radio: SWR3 and hr3 for the German courses, BBC Radio 1, 2 and 3 for the British ones (all are on offer
// everywhere). The button steps through the stations; by voice, say the station's name, "radio off", "louder" or "quieter".
const STATIONS = [
  { id: 'swr3', name: 'SWR3', url: 'https://liveradio.swr.de/sw282p3/swr3/play.mp3', say: /\b(s\s?w\s?r\s?(3|drei|three))\b/ },
  { id: 'hr3', name: 'hr3', url: 'https://dispatcher.rndfnk.com/hr/hr3/live/mp3/high', say: /\b(h\s?r\s?(3|drei|three)|hessischer rundfunk)\b/ },
  { id: 'bbc1', name: 'BBC Radio 1', hls: true, url: 'https://as-hls-ww-live.akamaized.net/pool_01505109/live/ww/bbc_radio_one/bbc_radio_one.isml/bbc_radio_one-audio%3d96000.norewind.m3u8', say: /\b(radio (1|one|eins)|bbc (1|one|eins))\b/ },
  { id: 'bbc2', name: 'BBC Radio 2', hls: true, url: 'https://as-hls-ww-live.akamaized.net/pool_74208725/live/ww/bbc_radio_two/bbc_radio_two.isml/bbc_radio_two-audio%3d96000.norewind.m3u8', say: /\b(radio (2|two|zwei)|bbc (2|two|zwei))\b/ },
  { id: 'bbc3', name: 'BBC Radio 3', hls: true, url: 'https://as-hls-ww-live.akamaized.net/pool_23461179/live/ww/bbc_radio_three/bbc_radio_three.isml/bbc_radio_three-audio%3d96000.norewind.m3u8', say: /\b(radio (3|three|drei)|bbc (3|three|drei))\b/ },
];
const KEY = 'golden-hour-ride-radio';

export function init(ctx) {
  const uk = ctx.COURSE_INFO.drive === 'left';
  const order = uk ? [...STATIONS.slice(2), ...STATIONS.slice(0, 2)] : STATIONS;
  const btn = document.createElement('button'); btn.id = 'radio';
  btn.title = 'Web radio: click to step through the stations. Voice: “SWR3”, “hr3”, “BBC Radio 1/2/3”, “radio off”, “louder”, “quieter”';
  ctx.$('voice').after(btn);
  const audio = new Audio(); audio.preload = 'none';
  let current = null, hls = null, volume = +(localStorage.getItem(KEY + '-vol') || 0.7);
  audio.volume = volume;
  const label = (t) => { btn.textContent = 'Radio: ' + (t || (current ? current.name : 'off')); btn.classList.toggle('on', !!current); };

  async function play(st) {
    stop(false);
    current = st; label(st.name + '…');
    localStorage.setItem(KEY, st.id);
    try {
      if (st.hls && !audio.canPlayType('application/vnd.apple.mpegurl')) {
        if (!window.Hls) await new Promise((ok, no) => { const s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/npm/hls.js@1.5.17/dist/hls.light.min.js'; s.onload = ok; s.onerror = no; document.head.append(s); });
        hls = new window.Hls({ lowLatencyMode: false }); hls.loadSource(st.url); hls.attachMedia(audio);
      } else audio.src = st.url;
      await audio.play();
      if (current === st) label();
    } catch (err) { if (current === st) { label('no signal'); current = null; } }
  }
  function stop(save = true) {
    if (hls) { hls.destroy(); hls = null; }
    audio.pause(); audio.removeAttribute('src'); audio.load();
    current = null; label();
    if (save) localStorage.setItem(KEY, 'off');
  }
  const vol = d => { volume = Math.max(0.05, Math.min(1, volume + d)); audio.volume = volume; localStorage.setItem(KEY + '-vol', volume); label(`${current ? current.name : 'off'} · ${Math.round(volume * 100)} %`); setTimeout(() => label(), 1800); };

  btn.onclick = () => {
    const i = current ? order.indexOf(current) : -1;
    if (i + 1 >= order.length) stop(); else play(order[i + 1]);
  };
  label();

  for (const st of STATIONS) ctx.addVoice(st.say, () => st.name, () => play(st));
  ctx.addVoice(/\b(radio (off|aus|stop)|stop the radio|music off|musik aus)\b/, 'Radio off', () => stop());
  ctx.addVoice(/\b(radio( on| an)?|music|musik)\b$/, () => current ? current.name : 'Radio', () => { if (!current) play(order.find(s => s.id === localStorage.getItem(KEY)) || order[0]); });
  ctx.addVoice(/\b(louder|lauter|volume up)\b/, 'Louder', () => vol(0.15));
  ctx.addVoice(/\b(quieter|leiser|softer|volume down)\b/, 'Quieter', () => vol(-0.15));
}
