// A menu that opens while the pointer is over a button and closes a moment after it leaves (the radio's station
// list works the same way). The button itself still does something on a click: steps to the next choice, or switches
// something on and off.

let styled = false;
function style() {
  if (styled) return; styled = true;
  const css = document.createElement('style');
  css.textContent = `.hpop { position: fixed; z-index: 6; padding: 6px; border-radius: 12px; font-size: 11px; letter-spacing: .06em; color: #fff;
      background: rgba(20,16,12,.8); border: 1px solid rgba(255,255,255,.3); backdrop-filter: blur(8px); display: grid; gap: 2px; min-width: 130px; }
    .hpop[hidden] { display: none; }
    .hpop > button { all: unset; cursor: pointer; padding: 5px 10px; border-radius: 8px; white-space: nowrap; }
    .hpop > button:hover { background: rgba(255,255,255,.14); }
    .hpop > button.on { color: #ffcf8f; } .hpop > button.on::before { content: '✓ '; }
    .hpop hr { border: 0; border-top: 1px solid rgba(255,255,255,.18); margin: 3px 4px; }
    body.clean .hpop { display: none; }`;
  document.head.append(css);
}

// fill(pop) puts the content in, each time the menu opens. Returns { pop, hide }.
export function hoverMenu(btn, fill, { cls = '' } = {}) {
  style();
  const pop = document.createElement('div'); pop.className = 'hpop ' + cls; pop.hidden = true;
  for (const ev of ['keydown', 'keyup']) pop.addEventListener(ev, e => e.stopPropagation());   // sliders keep the arrow keys
  document.body.append(pop);
  let t = 0;
  const show = () => {
    clearTimeout(t);
    if (pop.hidden) { pop.replaceChildren(); fill(pop); }
    pop.hidden = false;
    const r = btn.getBoundingClientRect();
    pop.style.top = (r.bottom + 6) + 'px';
    pop.style.left = Math.max(8, Math.min(innerWidth - pop.offsetWidth - 8, r.left + r.width / 2 - pop.offsetWidth / 2)) + 'px';
  };
  const hideSoon = ms => { clearTimeout(t); t = setTimeout(() => { if (pop.matches(':hover') || btn.matches(':hover') || pop.contains(document.activeElement)) hideSoon(400); else pop.hidden = true; }, ms); };
  btn.addEventListener('mouseenter', show);
  btn.addEventListener('mouseleave', () => hideSoon(500));
  pop.addEventListener('mouseenter', () => clearTimeout(t));
  pop.addEventListener('mouseleave', () => hideSoon(500));
  return { pop, hide: () => { clearTimeout(t); pop.hidden = true; }, refresh: () => { if (!pop.hidden) { pop.replaceChildren(); fill(pop); } } };
}

// A list of choices: items() gives [{ id, label, on }] (or { sep: true } for a line), pick(id) acts on one.
export function choiceMenu(btn, items, pick) {
  const m = hoverMenu(btn, pop => {
    for (const it of items()) {
      if (it.sep) { pop.append(document.createElement('hr')); continue; }
      const b = document.createElement('button'); b.textContent = it.label; b.classList.toggle('on', !!it.on);
      b.onclick = () => { pick(it.id); m.refresh(); setTimeout(m.hide, 600); };
      pop.append(b);
    }
  });
  return m;
}
