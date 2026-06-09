#!/usr/bin/env python3
"""Local dev server that disables caching, so edits show up immediately.
(Production is GitHub Pages — this file is only for local preview.)"""
import http.server
import socketserver

PORT = 4174


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


if __name__ == "__main__":
    with Server(("", PORT), NoCacheHandler) as httpd:
        print(f"no-cache dev server on http://localhost:{PORT}")
        httpd.serve_forever()
