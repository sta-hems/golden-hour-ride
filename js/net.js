// Fetching from the open-data services. Most of them let a web page read them directly; for the few that
// don't (hessenschau.de, sometimes a busy Overpass server), the local server (serve.py) passes the request on.
const PROXY = '/proxy?url=';
let proxyOk = null;                     // unknown until first needed

async function hasProxy() {
  if (proxyOk === null) {
    try { proxyOk = (await fetch('/proxy?ping=1', { cache: 'no-store' })).ok; } catch { proxyOk = false; }
  }
  return proxyOk;
}

export async function get(url, opts = {}, { viaProxyFirst = false } = {}) {
  const tryProxy = async () => {
    if (!(await hasProxy())) throw new Error('the page could not reach ' + new URL(url).host + ' (start the ride with serve.py to get around that)');
    const r = await fetch(PROXY + encodeURIComponent(url), opts);
    if (!r.ok) throw new Error(new URL(url).host + ' answered ' + r.status);
    return r;
  };
  if (viaProxyFirst && await hasProxy()) return tryProxy();
  try {
    const r = await fetch(url, opts);
    if (!r.ok) throw Object.assign(new Error(new URL(url).host + ' answered ' + r.status), { status: r.status });
    return r;
  } catch (err) {
    if (err.status) throw err;          // the server answered: no point going round
    return tryProxy();                  // blocked by the browser (no CORS) or unreachable
  }
}
export const getJSON = async (url, opts, how) => (await get(url, opts, how)).json();
export const getText = async (url, opts, how) => (await get(url, opts, how)).text();
export const sleep = ms => new Promise(r => setTimeout(r, ms));
