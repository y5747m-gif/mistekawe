#!/usr/bin/env python3
"""خادم رحيق: ملفات ثابتة + واجهة رفع الطلبات والمستندات (مكتبة Python القياسية فقط).

المسارات:
    GET  /                          موقع رحيق (index.html)
    GET  /api/health                حالة الواجهة وقدراتها
    POST /api/registrations         رفع طلب تسجيل مع صور المستندات (JSON + base64)
    GET  /api/yaseen-config         مساعد التسجيل رحيق (يُمرَّر إلى server/yaseen-server.js)
    POST /api/yaseen-chat           محادثة رحيق (منطق البوت على الخادم فقط)
    GET  /api/registrations         قائمة الطلبات        (يتطلب X-Admin-Token)
    GET  /api/registrations/<order> تفاصيل طلب           (يتطلب X-Admin-Token)
    GET  /api/registrations/<order>/<docKey>  ملف المستند (يتطلب X-Admin-Token)

التشغيل:
    python3 server/serve.py                       # http://0.0.0.0:8000
    python3 server/serve.py --port 8080
    python3 server/serve.py --host 127.0.0.1 --no-browser
    RAHEEQ_ADMIN_TOKEN=... python3 server/serve.py    # لتفعيل قراءة الطلبات

المستندات تُحفظ في data/uploads/<رقم الطلب>/ والسجلات في data/registrations/.
"""
from __future__ import annotations

import argparse
import contextlib
import atexit
import http.client
import http.server
import json
import os
import shutil
import signal
import socket
import socketserver
import subprocess
import sys
import urllib.parse
import webbrowser

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import api as raheeq_api  # noqa: E402  (واجهة الرفع بجوار هذا الملف)

DEFAULT_DATA_DIR = os.path.join(ROOT, "data")

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
    ".woff2": "font/woff2",
    ".woff": "font/woff",
    ".webmanifest": "application/manifest+json",
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".ogg": "audio/ogg",
    ".opus": "audio/ogg",
    ".flac": "audio/flac",
    ".m4a": "audio/mp4",
    ".aac": "audio/aac",
}


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    # إعدادات تُمرَّر من main()
    data_dir = DEFAULT_DATA_DIR
    admin_token = None
    limiter = raheeq_api.RateLimiter()
    yaseen_port = None          # منفذ خادم رحيق المحلي (Node) إن كان يعمل
    trust_proxy = False         # الوثوق بترويسة X-Forwarded-For (خلف وكيل عكسي فقط)

    # ------------------------------------------------------------------ أدوات
    def _json(self, status, payload, extra_headers=None):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        for key, value in (extra_headers or {}).items():
            self.send_header(key, value)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _api_error(self, exc):
        payload = {"ok": False, "error": exc.message}
        if exc.fields:
            payload["fields"] = exc.fields
        self._json(exc.status, payload)

    def _admin_authorized(self, query):
        header = self.headers.get("X-Admin-Token")
        provided = header or (query.get("token") or [None])[0]
        if not self.admin_token:
            raise raheeq_api.ApiError(
                403,
                "قراءة الطلبات معطّلة. شغّل الخادم بمتغيّر RAHEEQ_ADMIN_TOKEN لتفعيلها.",
            )
        if not raheeq_api.token_matches(provided, self.admin_token):
            raise raheeq_api.ApiError(401, "رمز الإدارة غير صحيح")
        return True

    def _client_ip(self):
        if self.trust_proxy:
            forwarded = (self.headers.get("X-Forwarded-For") or "").split(",")[0].strip()
            if forwarded:
                return forwarded[:64]
        return (self.client_address or ("?",))[0]

    # ------------------------------------------------------------ رحيق
    @staticmethod
    def _is_yaseen_path(path):
        return path in ("/api/yaseen-config", "/api/yaseen-chat") or path.startswith("/api/yaseen-admin/")

    def _proxy_yaseen(self):
        """تمرير طلبات رحيق إلى خادمه المحلي؛ منطق البوت وإعداداته لا تُخدَّم كملفات أبدًا."""
        if not self.yaseen_port:
            self._json(503, {"ok": False, "error": "yaseen-unavailable"})
            return
        body = None
        if self.command == "POST":
            try:
                length = int(self.headers.get("Content-Length") or 0)
            except ValueError:
                length = -1
            if length < 0 or length > 96 * 1024:
                self._json(413, {"ok": False, "error": "too-large"})
                return
            body = self.rfile.read(length) if length else b""
        headers = {"X-Forwarded-For": self._client_ip()}
        for name in ("Content-Type", "Authorization"):
            if self.headers.get(name):
                headers[name] = self.headers.get(name)
        conn = http.client.HTTPConnection("127.0.0.1", self.yaseen_port, timeout=10)
        try:
            conn.request(self.command, self.path, body=body, headers=headers)
            resp = conn.getresponse()
            payload = resp.read()
            self.send_response(resp.status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(payload)))
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("X-Robots-Tag", "noindex")
            if resp.getheader("Retry-After"):
                self.send_header("Retry-After", resp.getheader("Retry-After"))
            self.end_headers()
            self.wfile.write(payload)
        except OSError:
            self._json(503, {"ok": False, "error": "yaseen-unavailable"})
        finally:
            conn.close()

    def _read_json_body(self):
        raw_length = self.headers.get("Content-Length")
        if raw_length is None:
            raise raheeq_api.ApiError(411, "الطلب يحتاج Content-Length")
        try:
            length = int(raw_length)
        except ValueError:
            raise raheeq_api.ApiError(400, "Content-Length غير صالح")
        if length <= 0:
            raise raheeq_api.ApiError(400, "جسم الطلب فارغ")
        if length > raheeq_api.MAX_BODY_BYTES:
            raise raheeq_api.ApiError(
                413,
                "حجم الطلب أكبر من {} ميجابايت".format(raheeq_api.MAX_BODY_BYTES // (1024 * 1024)),
            )
        chunks, remaining = [], length
        while remaining > 0:
            chunk = self.rfile.read(min(65536, remaining))
            if not chunk:
                break
            chunks.append(chunk)
            remaining -= len(chunk)
        raw = b"".join(chunks)
        try:
            return json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, ValueError):
            raise raheeq_api.ApiError(400, "جسم الطلب ليس JSON صالحًا")

    def _serve_document(self, order, key):
        mime, filename, blob = raheeq_api.read_document(order, key, self.data_dir)
        self.send_response(200)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(blob)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        safe_name = urllib.parse.quote(filename)
        self.send_header("Content-Disposition", "inline; filename*=UTF-8''" + safe_name)
        self.end_headers()
        self.wfile.write(blob)

    # ------------------------------------------------------------------ GET
    def do_GET(self):  # noqa: N802
        parsed = urllib.parse.urlsplit(self.path)
        path = parsed.path
        query = urllib.parse.parse_qs(parsed.query)

        if path.startswith("/data/") or path == "/data":
            self.send_error(404)          # لا نكشف ملفات المستندات المحفوظة
            return
        if path.startswith("/.git/") or path == "/.git":
            self.send_error(404)
            return
        if path == "/server" or path.startswith("/server/"):
            self.send_error(404)          # لا نكشف كود الخادم
            return

        if path in ("/package.json", "/package-lock.json", "/vercel.json") or path.startswith("/node_modules"):
            self.send_error(404)
            return
        if self._is_yaseen_path(path):
            self._proxy_yaseen()
            return

        if path.startswith("/api/"):
            try:
                if path == "/api/health":
                    self._json(200, raheeq_api.health(self.data_dir, bool(self.admin_token)))
                    return
                if path == "/api/registrations":
                    self._admin_authorized(query)
                    items = raheeq_api.list_registrations(self.data_dir)
                    self._json(200, {"ok": True, "count": len(items), "registrations": items})
                    return
                parts = [p for p in path.split("/") if p]
                if len(parts) == 3 and parts[:2] == ["api", "registrations"]:
                    self._admin_authorized(query)
                    record = raheeq_api.load_registration(parts[2], self.data_dir)
                    if not record:
                        raise raheeq_api.ApiError(404, "لا يوجد طلب بهذا الرقم")
                    self._json(200, {"ok": True, "registration": record})
                    return
                if len(parts) == 4 and parts[:2] == ["api", "registrations"]:
                    self._admin_authorized(query)
                    self._serve_document(parts[2], parts[3])
                    return
                raise raheeq_api.ApiError(404, "مسار API غير معروف")
            except raheeq_api.ApiError as exc:
                self._api_error(exc)
                return
            except Exception as exc:  # noqa: BLE001
                sys.stderr.write("  API GET error: %r\n" % (exc,))
                self._json(500, {"ok": False, "error": "خطأ داخلي في الخادم"})
                return

        super().do_GET()

    # ------------------------------------------------------------------ POST
    def do_POST(self):  # noqa: N802
        parsed = urllib.parse.urlsplit(self.path)
        if self._is_yaseen_path(parsed.path):
            self._proxy_yaseen()
            return
        if parsed.path != "/api/registrations":
            self._json(404, {"ok": False, "error": "مسار API غير معروف"})
            return
        if not self.limiter.allow(self._client_ip()):
            self._json(
                429,
                {"ok": False, "error": "عدد كبير من المحاولات، انتظر دقيقة ثم أعد المحاولة"},
                {"Retry-After": "60"},
            )
            return
        try:
            payload = self._read_json_body()
            result = raheeq_api.save_registration(payload, self.data_dir)
            self._json(201, result, {"Location": "/api/registrations/" + result["orderNumber"]})
        except raheeq_api.ApiError as exc:
            self._api_error(exc)
        except Exception as exc:  # noqa: BLE001
            sys.stderr.write("  API POST error: %r\n" % (exc,))
            self._json(500, {"ok": False, "error": "تعذّر حفظ الطلب على الخادم"})

    def do_OPTIONS(self):  # noqa: N802
        self.send_response(204)
        self.send_header("Allow", "GET, POST, OPTIONS")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def guess_type(self, path):  # noqa: D102
        ext = os.path.splitext(path)[1].lower()
        if ext in EXTRA_TYPES:
            return EXTRA_TYPES[ext]
        return super().guess_type(path)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        # السماح بتشغيل مسارات العمل (إن أُضيف WebGPU/Threads لاحقًا)
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header(
            "Permissions-Policy",
            "bluetooth=(self), microphone=(self), speaker-selection=(self), autoplay=(self)",
        )
        super().end_headers()

    def log_message(self, fmt, *args):  # سجلّ مختصر
        sys.stderr.write("  %s\n" % (fmt % args))


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


def start_yaseen(data_dir):
    """يشغّل خادم رحيق (Node) على منفذ محلي حر ويعيد رقم المنفذ، أو None إن لم يتوفر Node."""
    node = shutil.which("node")
    script = os.path.join(ROOT, "server", "yaseen-server.js")
    if not node or not os.path.exists(script):
        return None
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    env = dict(os.environ)
    env.setdefault("YASEEN_DATA_DIR", os.path.join(data_dir, "yaseen"))
    try:
        proc = subprocess.Popen([node, script, "--port", str(port), "--host", "127.0.0.1"], env=env, cwd=ROOT)
    except OSError:
        return None
    atexit.register(proc.terminate)
    # atexit لا يعمل مع SIGTERM افتراضيًا: نحوّله إلى خروج عادي حتى لا يبقى خادم رحيق يتيمًا
    with contextlib.suppress(ValueError, OSError):
        signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
    return port


def main() -> int:
    ap = argparse.ArgumentParser(description="Raheeq site + upload API server")
    ap.add_argument("--host", default="0.0.0.0")
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--no-browser", action="store_true")
    ap.add_argument("--data-dir", default=os.environ.get("RAHEEQ_DATA_DIR", DEFAULT_DATA_DIR),
                    help="مجلد حفظ الطلبات والمستندات (افتراضي: data/)")
    ap.add_argument("--admin-token", default=os.environ.get("RAHEEQ_ADMIN_TOKEN"),
                    help="رمز قراءة الطلبات (أو متغيّر RAHEEQ_ADMIN_TOKEN)")
    ap.add_argument("--no-yaseen", action="store_true", help="لا تشغّل مساعد التسجيل رحيق")
    ap.add_argument("--trust-proxy", action="store_true",
                    default=os.environ.get("RAHEEQ_TRUST_PROXY") == "1",
                    help="استخدم X-Forwarded-For لعنوان العميل (خلف وكيل عكسي موثوق فقط)")
    args = ap.parse_args()

    data_dir = os.path.abspath(args.data_dir)
    Handler.data_dir = data_dir
    Handler.admin_token = (args.admin_token or "").strip() or None
    Handler.trust_proxy = bool(args.trust_proxy)
    Handler.yaseen_port = None if args.no_yaseen else start_yaseen(data_dir)

    with Server((args.host, args.port), Handler) as httpd:
        url = f"http://localhost:{args.port}/"
        print(f"رحيق RAHEEQ — serving {ROOT}")
        print(f"  الموقع:  {url}")
        print(f"  API:     {url}api/health")
        print(f"  الطلبات: {data_dir}")
        if Handler.admin_token:
            print("  قراءة الطلبات: مفعّلة برمز إدارة (X-Admin-Token).")
        else:
            print("  قراءة الطلبات: معطّلة — شغّل بـ RAHEEQ_ADMIN_TOKEN=... لتفعيلها.")
        if Handler.yaseen_port:
            print("  رحيق:   مفعّل (منطق البوت على الخادم) — لوحة المدير: " + url + "admin-yaseen/")
        else:
            print("  رحيق:   غير مفعّل (يتطلب Node.js 18+).")
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
