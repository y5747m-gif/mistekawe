#!/usr/bin/env python3
"""اختبارات واجهة رفع الطلبات في رحيق (server/api.py + server/serve.py).

التشغيل:
    python3 tests/python/test_api.py
    python3 -m unittest discover -s tests/python -v

لا اعتماديات خارجية: unittest القياسي فقط.
"""
from __future__ import annotations

import base64
import http.client
import json
import os
import shutil
import sys
import tempfile
import threading
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, "server"))

import api as raheeq_api  # noqa: E402
import serve as raheeq_serve  # noqa: E402

PNG_1PX = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AAAwAB/AL+2wAAAABJRU5ErkJggg=="
)
PDF_MIN = b"%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n"


def data_url(mime: str, blob: bytes) -> str:
    return "data:{};base64,{}".format(mime, base64.b64encode(blob).decode("ascii"))


def good_payload(**overrides):
    payload = {
        "orderNumber": "RHQ-1234",
        "createdAt": "2026-02-01T10:00:00Z",
        "parentName": "محمد أحمد علي حسن",
        "nationalId": "12345678901234",
        "relation": "الأب",
        "mobile": "01000000000",
        "whatsapp": "01000000000",
        "email": "waly@raheeq.edu",
        "password": "secret1",
        "studentName": "عمر محمد أحمد علي",
        "dob": "2015-05-10",
        "gender": "ذكر",
        "grade": "KG1",
        "prevSchool": "",
        "address": "القاهرة مدينة نصر",
        "healthNotes": "",
        "docs": {
            "birthCert": {"name": "birth.png", "dataUrl": data_url("image/png", PNG_1PX)},
            "photo": {"name": "photo.png", "dataUrl": data_url("image/png", PNG_1PX)},
            "parentCard": {"name": "card.png", "dataUrl": data_url("image/png", PNG_1PX)},
        },
    }
    payload.update(overrides)
    return payload


class TempDirMixin(unittest.TestCase):
    def setUp(self):  # noqa: D102
        self.tmp = tempfile.mkdtemp(prefix="raheeq-test-")

    def tearDown(self):  # noqa: D102
        shutil.rmtree(self.tmp, ignore_errors=True)


class DataUrlTests(unittest.TestCase):
    def test_accepts_real_png_and_returns_bytes(self):
        mime, blob = raheeq_api.parse_data_url(data_url("image/png", PNG_1PX))
        self.assertEqual(mime, "image/png")
        self.assertEqual(blob, PNG_1PX)

    def test_accepts_pdf(self):
        mime, blob = raheeq_api.parse_data_url(data_url("application/pdf", PDF_MIN))
        self.assertEqual(mime, "application/pdf")
        self.assertEqual(blob, PDF_MIN)

    def test_rejects_svg_and_html(self):
        for mime in ("image/svg+xml", "text/html"):
            with self.assertRaises(raheeq_api.ApiError) as ctx:
                raheeq_api.parse_data_url(data_url(mime, b"<svg/>"))
            self.assertEqual(ctx.exception.status, 400)

    def test_rejects_mismatched_magic_bytes(self):
        """ملف يدّعي أنه PNG لكن محتواه PDF يجب أن يُرفض."""
        with self.assertRaises(raheeq_api.ApiError) as ctx:
            raheeq_api.parse_data_url(data_url("image/png", b"<html>hello</html>"))
        self.assertIn("لا يطابق", ctx.exception.message)

    def test_rejects_broken_base64_and_empty(self):
        with self.assertRaises(raheeq_api.ApiError):
            raheeq_api.parse_data_url("data:image/png;base64,@@@not-base64@@@")
        with self.assertRaises(raheeq_api.ApiError):
            raheeq_api.parse_data_url("data:image/png;base64,")
        with self.assertRaises(raheeq_api.ApiError):
            raheeq_api.parse_data_url("photo.jpg")  # اسم ملف وليس محتوى

    def test_rejects_oversized_document(self):
        old = raheeq_api.MAX_DOC_BYTES
        raheeq_api.MAX_DOC_BYTES = 32
        try:
            big = PNG_1PX + b"\x00" * 64
            with self.assertRaises(raheeq_api.ApiError) as ctx:
                raheeq_api.parse_data_url(data_url("image/png", big))
            self.assertEqual(ctx.exception.status, 413)
        finally:
            raheeq_api.MAX_DOC_BYTES = old


class ValidationTests(unittest.TestCase):
    def test_valid_payload_normalizes(self):
        record = raheeq_api.validate_registration(good_payload())
        self.assertEqual(record["mobile"], "01000000000")
        self.assertTrue(record["passwordHash"].startswith("pbkdf2_sha256$"))
        self.assertNotIn("password", record)
        self.assertEqual(set(record["docs"]), {"birthCert", "photo", "parentCard"})
        self.assertEqual(record["docs"]["photo"]["bytes"], PNG_1PX)

    def test_arabic_digits_are_normalized(self):
        record = raheeq_api.validate_registration(
            good_payload(mobile="٠١٠٠٠٠٠٠٠٠٠", nationalId="١٢٣٤٥٦٧٨٩٠١٢٣٤")
        )
        self.assertEqual(record["mobile"], "01000000000")
        self.assertEqual(record["nationalId"], "12345678901234")

    def test_missing_required_fields(self):
        with self.assertRaises(raheeq_api.ApiError) as ctx:
            raheeq_api.validate_registration(good_payload(mobile="010", email="bad"))
        self.assertEqual(ctx.exception.status, 400)
        self.assertIn("mobile", ctx.exception.fields)
        self.assertIn("email", ctx.exception.fields)

    def test_missing_required_document(self):
        payload = good_payload()
        del payload["docs"]["photo"]
        with self.assertRaises(raheeq_api.ApiError) as ctx:
            raheeq_api.validate_registration(payload)
        self.assertIn("photo", ctx.exception.fields)

    def test_rejects_report_card_with_fake_content(self):
        payload = good_payload()
        payload["docs"]["reportCard"] = {"name": "x.png", "dataUrl": data_url("image/png", b"not-an-image")}
        with self.assertRaises(raheeq_api.ApiError) as ctx:
            raheeq_api.validate_registration(payload)
        self.assertIn("reportCard", ctx.exception.fields)

    def test_password_hashing_roundtrip(self):
        stored = raheeq_api.hash_password("secret1")
        self.assertNotIn("secret1", stored)
        self.assertTrue(raheeq_api.verify_password("secret1", stored))
        self.assertFalse(raheeq_api.verify_password("wrong", stored))


class StorageTests(TempDirMixin):
    def test_saves_files_and_metadata(self):
        result = raheeq_api.save_registration(good_payload(), self.tmp)
        self.assertTrue(result["ok"])
        order = result["orderNumber"]
        self.assertRegex(order, r"^RHQ-\d{4}$")

        photo_path = os.path.join(self.tmp, "uploads", order, "photo.png")
        self.assertTrue(os.path.isfile(photo_path))
        with open(photo_path, "rb") as handle:
            self.assertEqual(handle.read(), PNG_1PX)

        record_path = os.path.join(self.tmp, "registrations", order + ".json")
        with open(record_path, encoding="utf-8") as handle:
            stored = json.load(handle)
        self.assertNotIn("password", stored)
        self.assertNotIn("secret1", json.dumps(stored, ensure_ascii=False))
        self.assertTrue(stored["passwordHash"].startswith("pbkdf2_sha256$"))
        self.assertEqual(stored["docs"]["photo"]["mime"], "image/png")
        # لا تُحفظ بيانات dataUrl ضخمة داخل السجل
        self.assertNotIn("dataUrl", json.dumps(stored))

        listed = raheeq_api.list_registrations(self.tmp)
        self.assertEqual(len(listed), 1)
        self.assertEqual(listed[0]["orderNumber"], order)

    def test_same_mobile_updates_same_order(self):
        first = raheeq_api.save_registration(good_payload(), self.tmp)
        second = raheeq_api.save_registration(
            good_payload(orderNumber="RHQ-9999", studentName="سارة محمد أحمد علي"), self.tmp
        )
        self.assertEqual(first["orderNumber"], second["orderNumber"])
        self.assertTrue(second["replaced"])
        self.assertEqual(len(raheeq_api.list_registrations(self.tmp)), 1)
        record = raheeq_api.load_registration(first["orderNumber"], self.tmp)
        self.assertEqual(record["studentName"], "سارة محمد أحمد علي")

    def test_reads_document_bytes(self):
        result = raheeq_api.save_registration(good_payload(), self.tmp)
        mime, filename, blob = raheeq_api.read_document(result["orderNumber"], "birthCert", self.tmp)
        self.assertEqual(mime, "image/png")
        self.assertEqual(filename, "birthCert.png")
        self.assertEqual(blob, PNG_1PX)

    def test_rejects_bad_order_and_key(self):
        result = raheeq_api.save_registration(good_payload(), self.tmp)
        with self.assertRaises(raheeq_api.ApiError):
            raheeq_api.read_document("../../etc/passwd", "photo", self.tmp)
        with self.assertRaises(raheeq_api.ApiError):
            raheeq_api.read_document(result["orderNumber"], "../index", self.tmp)
        with self.assertRaises(raheeq_api.ApiError):
            raheeq_api.read_document(result["orderNumber"], "reportCard", self.tmp)

    def test_unknown_order_returns_none(self):
        self.assertIsNone(raheeq_api.load_registration("RHQ-0001", self.tmp))


class HttpApiTests(TempDirMixin):
    """تشغيل خادم حقيقي على منفذ عشوائي واختبار المسارات عبر HTTP."""

    @classmethod
    def setUpClass(cls):
        cls._old_data = raheeq_serve.Handler.data_dir
        cls._old_token = raheeq_serve.Handler.admin_token
        cls._old_limiter = raheeq_serve.Handler.limiter

    @classmethod
    def tearDownClass(cls):
        raheeq_serve.Handler.data_dir = cls._old_data
        raheeq_serve.Handler.admin_token = cls._old_token
        raheeq_serve.Handler.limiter = cls._old_limiter

    def setUp(self):  # noqa: D102
        super().setUp()
        self.start_server(admin_token="test-token")

    def start_server(self, admin_token="test-token", data_dir=None, limiter=None):
        raheeq_serve.Handler.data_dir = data_dir or self.tmp
        raheeq_serve.Handler.admin_token = admin_token
        raheeq_serve.Handler.limiter = limiter or raheeq_api.RateLimiter()
        self.httpd = raheeq_serve.Server(("127.0.0.1", 0), raheeq_serve.Handler)
        self.port = self.httpd.server_address[1]
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):  # noqa: D102
        self.httpd.shutdown()
        self.httpd.server_close()
        self.thread.join(timeout=3)
        super().tearDown()

    def request(self, method, path, body=None, headers=None):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        payload = None
        hdrs = dict(headers or {})
        if body is not None:
            payload = body if isinstance(body, bytes) else json.dumps(body).encode("utf-8")
            hdrs.setdefault("Content-Type", "application/json")
        conn.request(method, path, body=payload, headers=hdrs)
        response = conn.getresponse()
        raw = response.read()
        conn.close()
        return response.status, raw, dict(response.getheaders())

    def test_health(self):
        status, raw, _ = self.request("GET", "/api/health")
        self.assertEqual(status, 200)
        body = json.loads(raw)
        self.assertTrue(body["ok"])
        self.assertEqual(body["service"], "raheeq-api")
        self.assertTrue(body["writable"])

    def test_upload_flow_end_to_end(self):
        status, raw, headers = self.request("POST", "/api/registrations", good_payload())
        self.assertEqual(status, 201, raw[:200])
        body = json.loads(raw)
        self.assertTrue(body["ok"])
        order = body["orderNumber"]
        self.assertEqual(headers.get("Location"), "/api/registrations/" + order)

        # الملفات فعليًا على القرص
        path = os.path.join(self.tmp, "uploads", order, "photo.png")
        self.assertTrue(os.path.isfile(path))

        # القائمة تتطلب رمز إدارة
        self.assertEqual(self.request("GET", "/api/registrations")[0], 401)
        self.assertEqual(self.request("GET", "/api/registrations", headers={"X-Admin-Token": "wrong"})[0], 401)
        status, raw, _ = self.request("GET", "/api/registrations", headers={"X-Admin-Token": "test-token"})
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(raw)["count"], 1)

        # تفاصيل الطلب بدون هاش كلمة السر
        status, raw, _ = self.request(
            "GET", "/api/registrations/" + order, headers={"X-Admin-Token": "test-token"}
        )
        self.assertEqual(status, 200)
        record = json.loads(raw)["registration"]
        self.assertNotIn("passwordHash", record)
        self.assertEqual(record["docs"]["photo"]["mime"], "image/png")

        # الملف نفسه يُخدم بالبايتات الصحيحة
        status, raw, headers = self.request(
            "GET", "/api/registrations/{}/photo".format(order), headers={"X-Admin-Token": "test-token"}
        )
        self.assertEqual(status, 200)
        self.assertEqual(raw, PNG_1PX)
        self.assertEqual(headers.get("Content-Type"), "image/png")

        # الملفات الشخصية غير مكشوفة كملفات ثابتة
        self.assertEqual(self.request("GET", "/data/uploads/{}/photo.png".format(order))[0], 404)
        self.assertEqual(self.request("GET", "/data/registrations/index.json")[0], 404)

    def test_yaseen_backend_is_never_served_as_static_files(self):
        # قواعد ياسين وإعداداته تعمل على الخادم فقط ولا تُخدَّم كملفات
        for path in ("/api/_yaseen/yaseen-system.js", "/api/_yaseen/store.js", "/api/yaseen.js",
                     "/server/yaseen-server.js", "/data/yaseen/store.enc", "/package.json"):
            self.assertEqual(self.request("GET", path)[0], 404, path)
        # بدون خادم ياسين (Node) تُرفض المسارات ولا تظهر الشخصية للزائر
        self.assertEqual(self.request("GET", "/api/yaseen-config")[0], 503)
        self.assertEqual(self.request("POST", "/api/yaseen-chat", {"message": "x"})[0], 503)
        self.assertEqual(self.request("GET", "/api/yaseen-admin/config")[0], 503)
        # صفحة المدير موجودة لكنها غير مرتبطة من أي صفحة
        self.assertEqual(self.request("GET", "/admin-yaseen/")[0], 200)

    def test_admin_reads_disabled_without_token(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        self.thread.join(timeout=3)
        self.start_server(admin_token=None)
        status, raw, _ = self.request("GET", "/api/registrations")
        self.assertEqual(status, 403)
        self.assertIn("RAHEEQ_ADMIN_TOKEN", json.loads(raw)["error"])

    def test_invalid_payload_returns_field_errors(self):
        status, raw, _ = self.request(
            "POST", "/api/registrations", good_payload(mobile="010", email="بدون-بريد")
        )
        self.assertEqual(status, 400)
        body = json.loads(raw)
        self.assertFalse(body["ok"])
        self.assertIn("mobile", body["fields"])
        self.assertFalse(os.path.exists(os.path.join(self.tmp, "registrations")) and
                         os.listdir(os.path.join(self.tmp, "registrations")) not in ([], ["index.json"]))

    def test_svg_upload_rejected_over_http(self):
        payload = good_payload()
        payload["docs"]["photo"] = {"name": "x.svg", "dataUrl": data_url("image/svg+xml", b"<svg/>")}
        status, raw, _ = self.request("POST", "/api/registrations", payload)
        self.assertEqual(status, 400)
        self.assertIn("photo", json.loads(raw)["fields"])

    def test_body_limit(self):
        old = raheeq_api.MAX_BODY_BYTES
        raheeq_api.MAX_BODY_BYTES = 512
        try:
            status, raw, _ = self.request("POST", "/api/registrations", good_payload())
            self.assertEqual(status, 413)
            self.assertIn("أكبر", json.loads(raw)["error"])
        finally:
            raheeq_api.MAX_BODY_BYTES = old

    def test_rate_limit(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        self.thread.join(timeout=3)
        self.start_server(limiter=raheeq_api.RateLimiter(limit=2))
        codes = [self.request("POST", "/api/registrations", good_payload())[0] for _ in range(3)]
        self.assertEqual(codes[:2], [201, 201])
        self.assertEqual(codes[2], 429)

    def test_unknown_api_route(self):
        self.assertEqual(self.request("GET", "/api/nope")[0], 404)
        self.assertEqual(self.request("POST", "/api/nope", {})[0], 404)

    def test_static_site_still_served(self):
        status, raw, _ = self.request("GET", "/index.html")
        self.assertEqual(status, 200)
        self.assertIn(b"raheeq", raw.lower())


if __name__ == "__main__":
    unittest.main(verbosity=2)
