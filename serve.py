"""
Static server for the split-compare page.

Python's stock http.server handles one request at a time, which is fatal here:
the two iframes pull ~25 MB of ES modules in parallel and the second one gets
a connection reset while the first is still streaming. ThreadingHTTPServer
gives each request its own thread.
"""
import functools
import http.server
import socketserver
import os
import sys

# Bind address is the second argument. Default to loopback; pass 0.0.0.0 to
# serve the LAN.
HOST = sys.argv[2] if len(sys.argv) > 2 else "127.0.0.1"
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 5173
ROOT = os.path.dirname(os.path.abspath(__file__))


class Handler(http.server.SimpleHTTPRequestHandler):
    # ES modules must be served as JavaScript, not text/plain.
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".html": "text/html",
    }

    def end_headers(self):
        # No caching while iterating: a stale three.module.js is very confusing.
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):
        pass  # keep the console clean


class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


if __name__ == "__main__":
    handler = functools.partial(Handler, directory=ROOT)
    with Server((HOST, PORT), handler) as httpd:
        print(f"split-compare on http://{HOST}:{PORT}/host/index.html")
        if HOST == "0.0.0.0":
            print("  LAN: http://<this-machine-ip>:%d/host/index.html" % PORT)
        httpd.serve_forever()
