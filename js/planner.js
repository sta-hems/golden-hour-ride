// The route planner panel: type the places, build the course, keep it, mark favourites.
import * as store from './store.js';

const CSS = `
  #planner { position: fixed; top: 64px; right: 18px; width: 380px; max-height: calc(100vh - 90px); overflow: auto; padding: 16px 18px; border-radius: 14px; z-index: 5;
    background: rgba(20,16,12,.82); border: 1px solid rgba(255,255,255,.3); backdrop-filter: blur(10px); font-size: 13px; color: #fff; letter-spacing: .02em; }
  #planner h3 { margin: 4px 0 10px; font-size: 11px; font-weight: 600; letter-spacing: .12em; text-transform: uppercase; opacity: .75; }
  #planner .row { display: flex; gap: 6px; align-items: center; margin-bottom: 6px; }
  #planner input[type=text] { flex: 1; font: inherit; color: #fff; background: rgba(255,255,255,.1); border: 1px solid rgba(255,255,255,.3); border-radius: 8px; padding: 7px 9px; }
  #planner input[type=text]::placeholder { color: rgba(255,255,255,.45); }
  #planner button { font: inherit; color: #fff; background: rgba(255,255,255,.08); border: 1px solid rgba(255,255,255,.35); border-radius: 999px; padding: 5px 11px; cursor: pointer; }
  #planner button:hover { background: rgba(255,255,255,.2); }
  #planner button.go { background: #c98a3b; border-color: #e7b06a; font-weight: 600; }
  #planner button:disabled { opacity: .45; cursor: default; }
  #planner .x { padding: 3px 8px; }
  #planner .lab { width: 44px; font-size: 10px; letter-spacing: .1em; text-transform: uppercase; opacity: .65; }
  #planner pre { white-space: pre-wrap; font: 12px/1.45 ui-monospace, Menlo, monospace; background: rgba(0,0,0,.25); border-radius: 8px; padding: 8px 10px; max-height: 190px; overflow: auto; margin: 10px 0 4px; }
  #planner pre:empty { display: none; }
  #planner .warn { color: #ffcf8f; }
  #planner table { width: 100%; border-collapse: collapse; }
  #planner td { padding: 6px 2px; border-top: 1px solid rgba(255,255,255,.14); vertical-align: middle; }
  #planner td.n { width: 100%; }
  #planner td.n small { display: block; opacity: .6; margin-top: 2px; }
  #planner .star { border: none; background: none; font-size: 17px; padding: 0 4px; color: #ffcf6b; }
  #planner .muted { opacity: .65; }
  #planner .top { display: flex; justify-content: space-between; align-items: center; }
`;

let panel = null;

export async function togglePlanner({ current }) {
  if (panel) { panel.remove(); panel = null; return; }
  if (!document.getElementById('planner-css')) { const s = document.createElement('style'); s.id = 'planner-css'; s.textContent = CSS; document.head.append(s); }
  panel = document.createElement('div'); panel.id = 'planner';
  // keys typed here must not steer the ride
  for (const ev of ['keydown', 'keyup', 'keypress']) panel.addEventListener(ev, e => e.stopPropagation());
  document.body.append(panel);
  const last = JSON.parse(localStorage.getItem('golden-hour-ride-plan') || 'null') || { names: ['', '', ''], loop: true };
  panel.innerHTML = `
    <div class="top"><h3>Plan a route</h3><button class="x" id="pl-close" aria-label="Close">✕</button></div>
    <div id="pl-places"></div>
    <div class="row"><button id="pl-add">+ Add a place</button><label style="margin-left:auto"><input type="checkbox" id="pl-loop"> back to the start</label></div>
    <div class="row"><input type="text" id="pl-name" placeholder="Name (optional)"></div>
    <div class="row"><button class="go" id="pl-build">Build the course</button><span class="muted">Germany only · places or “lat, lon”</span></div>
    <div class="muted" style="font-size:11px">For a round trip, give three places or more, so the way back can take other roads. You can set off within a minute: the route starts on quick terrain, and the 1 m survey heights follow while you ride.</div>
    <pre id="pl-log"></pre>
    <h3 style="margin-top:16px">Your routes</h3>
    <div id="pl-list"></div>
    <div class="muted" style="margin-top:10px;font-size:11px">Saved in this browser. Terrain tiles are kept too, so routes nearby build faster.</div>`;
  const $ = id => panel.querySelector('#' + id);
  $('pl-close').onclick = () => togglePlanner({});
  $('pl-loop').checked = last.loop;
  const places = $('pl-places');
  const addPlace = (v = '') => {
    const row = document.createElement('div'); row.className = 'row';
    row.innerHTML = `<span class="lab"></span><input type="text" placeholder="Town, village or address"><button class="x" aria-label="Remove">✕</button>`;
    row.querySelector('input').value = v;
    row.querySelector('button').onclick = () => { if (places.children.length > 2) { row.remove(); relabel(); } };
    row.querySelector('input').addEventListener('keydown', e => { if (e.key === 'Enter') $('pl-build').click(); });
    places.append(row); relabel();
  };
  const relabel = () => [...places.children].forEach((r, i, a) => { r.querySelector('.lab').textContent = i === 0 ? 'Start' : (i === a.length - 1 && !$('pl-loop').checked ? 'End' : 'Via'); });
  $('pl-loop').onchange = relabel;
  (last.names.length >= 2 ? last.names : ['', '']).forEach(addPlace);
  $('pl-add').onclick = () => { addPlace(); places.lastChild.querySelector('input').focus(); };

  const logBox = $('pl-log');
  const log = (msg, replace) => {
    const lines = logBox.textContent ? logBox.textContent.split('\n') : [];
    if (replace && lines.length && lines[lines.length - 1].startsWith('  tile')) lines.pop();
    lines.push(msg); logBox.textContent = lines.join('\n'); logBox.scrollTop = 1e9;
  };

  $('pl-build').onclick = async () => {
    const names = [...places.querySelectorAll('input')].map(i => i.value.trim()).filter(Boolean);
    if (names.length < 2) { logBox.textContent = 'Give at least two places: a start and somewhere to ride to.'; return; }
    localStorage.setItem('golden-hour-ride-plan', JSON.stringify({ names, loop: $('pl-loop').checked }));
    $('pl-build').disabled = true; logBox.textContent = '';
    try {
      const { buildCourse } = await import('./builder.js');
      const { id, warnings } = await buildCourse({ names, loop: $('pl-loop').checked, name: $('pl-name').value.trim(), quality: 'quick' }, log);
      log('The 1 m survey heights load in the background while you ride.');
      for (const w of warnings) { const s = document.createElement('div'); s.className = 'warn'; s.textContent = '⚠ ' + w; logBox.append('\n'); logBox.append(s); }
      await drawList();
      const go = document.createElement('button'); go.className = 'go'; go.textContent = 'Ride it now'; go.style.marginTop = '8px';
      go.onclick = () => ride(id); logBox.after(go);
    } catch (err) { log('Stopped: ' + err.message); }
    $('pl-build').disabled = false;
  };

  const ride = id => { const q = new URLSearchParams(location.search); q.set('course', id); location.search = q.toString(); };
  const drawList = async () => {
    const list = await store.listCourses().catch(() => []), box = $('pl-list');
    if (!list.length) { box.innerHTML = '<div class="muted">None yet: build one above.</div>'; return; }
    box.innerHTML = '<table></table>';
    const tb = box.firstChild;
    for (const c of list) {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td><button class="star" title="Favourite: listed first in the course menu">${c.fav ? '★' : '☆'}</button></td>
        <td class="n"></td><td><button>${c.id === current ? 'Riding' : 'Ride'}</button></td><td><button class="x" title="Delete">🗑</button></td>`;
      const n = tr.querySelector('.n'); n.textContent = c.name;
      const sm = document.createElement('small'); sm.textContent = `${c.km} km · ${c.climb} m up` + (c.places ? ' · ' + c.places.join(' → ') : ''); n.append(sm);
      n.title = 'Double-click to rename'; n.ondblclick = async () => { const v = prompt('Name for this route', c.name); if (v && v.trim()) { await store.rename(c.id, v.trim()); drawList(); } };
      const [star, rideBtn, del] = tr.querySelectorAll('button');
      star.onclick = async () => { await store.setFavourite(c.id, !c.fav); drawList(); };
      rideBtn.onclick = () => ride(c.id); rideBtn.disabled = c.id === current;
      del.onclick = async () => { if (confirm(`Delete “${c.name}” from this browser?`)) { await store.deleteCourse(c.id); drawList(); } };
      tb.append(tr);
    }
  };
  drawList();
}
