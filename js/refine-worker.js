// Builds a quick course again at survey quality, in the background while it is being ridden.
// The page starts it (index.html) and hears how far it has got; the finished course replaces the quick one.
import { buildCourse } from './builder.js';
import { getCourse } from './store.js';

onmessage = async e => {
  const { id } = e.data;
  try {
    const rec = await getCourse(id);
    if (!rec || rec.info.quality === 'survey') return postMessage({ done: true, already: true });
    const { warnings, quality } = await buildCourse({ places: rec.resolved, loop: rec.loop, id, quality: 'survey' },
      msg => postMessage({ log: msg }), (n, total) => postMessage({ tile: n, total }));
    postMessage({ done: true, warnings, quality });
  } catch (err) { postMessage({ error: err.message }); }
};
