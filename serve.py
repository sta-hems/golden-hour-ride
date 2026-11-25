"""Serves the ride locally, like `python3 -m http.server`, plus a small pass-through for the few open-data
services a web page can't read directly (hessenschau.de's news feed, BBC News, a busy Overpass server).

    python3 serve.py            then open http://localhost:8791/
    python3 serve.py 9000       on another port

Only the hosts listed in ALLOWED can be reached through /proxy?url=..., and only over https.
"""
import os, subprocess, sys, urllib.parse
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

ROOT = os.path.dirname(os.path.abspath(__file__))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8791
ALLOWED = {'www.hessenschau.de', 'www.tagesschau.de', 'feeds.bbci.co.uk', 'overpass-api.de', 'overpass.kumi.systems', 'maps.mail.ru',
           'api.hoehendaten.de', 'nominatim.openstreetmap.org', 'routing.openstreetmap.de'}


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw): super().__init__(*a, directory=ROOT, **kw)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')        # always the latest files while working on the ride
        super().end_headers()

    def _proxy(self, body=None):
        q = urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query)
        if 'ping' in q: return self._send(200, b'ok', 'text/plain')
        url = (q.get('url') or [''])[0]; u = urllib.parse.urlsplit(url)
        if u.scheme != 'https' or u.hostname not in ALLOWED: return self._send(403, b'not allowed', 'text/plain')
        # curl rather than urllib: the Python that ships with macOS can't talk TLS to some of these servers
        cmd = ['curl', '-sS', '-L', '--compressed', '-m', '180', '-A', 'golden-hour-ride (local)', '-w', '\n%{http_code} %{content_type}']
        if body is not None: cmd += ['--data-binary', '@-', '-H', 'Content-Type: ' + self.headers.get('Content-Type', 'application/octet-stream')]
        r = subprocess.run(cmd + [url], input=body, capture_output=True)
        if r.returncode: return self._send(502, r.stderr or b'fetch failed', 'text/plain')
        data, _, tail = r.stdout.rpartition(b'\n')
        code, _, ctype = tail.decode().partition(' ')
        self._send(int(code or 502), data, ctype or 'application/octet-stream')

    def _send(self, code, data, ctype):
        self.send_response(code); self.send_header('Content-Type', ctype); self.send_header('Content-Length', str(len(data)))
        self.end_headers(); self.wfile.write(data)

    def do_GET(self):
        if self.path.startswith('/proxy'): return self._proxy()
        super().do_GET()

    def do_POST(self):
        if not self.path.startswith('/proxy'): return self._send(405, b'', 'text/plain')
        self._proxy(self.rfile.read(int(self.headers.get('Content-Length') or 0)))


if __name__ == '__main__':
    print(f'Golden Hour Ride on http://localhost:{PORT}/  (Ctrl+C to stop)')
    ThreadingHTTPServer(('localhost', PORT), Handler).serve_forever()
