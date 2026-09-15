#!/usr/bin/env python3
"""خادم ثابت بسيط لمشروع MISTEKAWE AI-3D (مكتبة Python القياسية فقط).

الغرض: تشغيل الاستوديو محليًا دون أي اعتماد خارجي، وتأكيد أن كل المعالجة
تتم داخل المتصفح على جهاز المستخدم (لا يوجد أي API خارجي).

التشغيل:
    python3 server/serve.py            # http://0.0.0.0:8000
    python3 server/serve.py --port 8080
    python3 server/serve.py --host 127.0.0.1 --no-browser
"""
from __future__ import annotations

import argparse
import contextlib
import http.server
import os
import socketserver
import sys
import webbrowser

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

EXTRA_TYPES = {
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".glb": "model/gltf-binary",
    ".gltf": "model/gltf+json",
    ".obj": "model/obj",
    ".stl": "model/stl",
    ".ply": "application/octet-stream",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
}


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def guess_type(self, path):  # noqa: D102
        ext = os.path.splitext(path)[1].lower()
        if ext in EXTRA_TYPES:
            return EXTRA_TYPES[ext]
        return super().guess_type(path)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        # السماح بتشغيل مسارات العمل (إن أُضيف WebGPU/Threads لاحقًا)
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        super().end_headers()

    def log_message(self, fmt, *args):  # سجلّ مختصر
        sys.stderr.write("  %s\n" % (fmt % args))


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


def main() -> int:
    ap = argparse.ArgumentParser(description="MISTEKAWE AI-3D static server")
    ap.add_argument("--host", default="0.0.0.0")
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--no-browser", action="store_true")
    args = ap.parse_args()

    with Server((args.host, args.port), Handler) as httpd:
        url = f"http://localhost:{args.port}/studio.html"
        print(f"MISTEKAWE AI-3D — serving {ROOT}")
        print(f"  Studio:  {url}")
        print("  ملاحظة: كل المعالجة تتم في متصفحك — لا يتم إرسال أي صورة إلى الخارج.")
        if not args.no_browser:
            with contextlib.suppress(Exception):
                webbrowser.open(url)
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nتم الإيقاف.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
