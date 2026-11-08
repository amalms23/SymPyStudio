"""Local server for SymPyStudio with cross-origin isolation enabled.

    python tools/serve.py [port]      # default port 8000, then open http://localhost:8000

The COOP/COEP headers make the page "cross-origin isolated", which enables
SharedArrayBuffer.  The kernel uses it so the Stop button can interrupt a running
SymPy computation while keeping your variables.  Without these headers (opening
index.html from disk, GitHub Pages, ...) the app still works, but Stop has to
restart the kernel.

COEP 'credentialless' lets the CDN scripts and Google Fonts load without CORP
headers; it is supported by Chromium-based browsers and Firefox.
"""

import http.server
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class IsolatedHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        self.send_header('Cross-Origin-Opener-Policy', 'same-origin')
        self.send_header('Cross-Origin-Embedder-Policy', 'credentialless')
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    server = http.server.ThreadingHTTPServer(('127.0.0.1', port), IsolatedHandler)
    print(f'SymPyStudio: http://localhost:{port}  (Ctrl+C to stop)')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main()
