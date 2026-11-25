// Courses you plan in the browser, and the terrain tiles they were built from, kept in this browser (IndexedDB).
const DB = 'golden-hour-ride', VERSION = 1;
let dbp = null;

function db() {
  if (!dbp) dbp = new Promise((ok, no) => {
    const r = indexedDB.open(DB, VERSION);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains('courses')) d.createObjectStore('courses', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('tiles')) d.createObjectStore('tiles', { keyPath: 'key' });
    };
    r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error);
  });
  return dbp;
}
const req = r => new Promise((ok, no) => { r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });
async function tx(store, mode, fn) { const d = await db(); return req(fn(d.transaction(store, mode).objectStore(store))); }

// courses: { id, info: {id, name, short, km, climb, start, drive}, places, fav, created, course, osm }
export const getCourse = id => tx('courses', 'readonly', s => s.get(id));
export const putCourse = rec => tx('courses', 'readwrite', s => s.put(rec));
export const deleteCourse = id => tx('courses', 'readwrite', s => s.delete(id));
export async function listCourses() {        // the menu entries only, favourites first, then newest
  const all = await tx('courses', 'readonly', s => s.getAll());
  return all.map(r => ({ ...r.info, fav: !!r.fav, places: r.places, created: r.created }))
    .sort((a, b) => (b.fav - a.fav) || (b.created - a.created));
}
export async function setFavourite(id, fav) { const r = await getCourse(id); if (r) { r.fav = fav; await putCourse(r); } }
export async function rename(id, name) { const r = await getCourse(id); if (r) { r.info.name = r.info.short = name; r.course.name = name; await putCourse(r); } }

// terrain tiles at 2 m: { key: '32_446_5562', w, h, west, north, res, data: Float32Array, credit, empty }
export const getTile = key => tx('tiles', 'readonly', s => s.get(key));
export const putTile = t => tx('tiles', 'readwrite', s => s.put(t));
export async function tileCount() { return tx('tiles', 'readonly', s => s.count()); }
export async function clearTiles() { return tx('tiles', 'readwrite', s => s.clear()); }
