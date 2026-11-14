#!/usr/bin/env python3
"""واجهة رفع طلبات التسجيل والمستندات في رحيق — مكتبة Python القياسية فقط.

- تستقبل الطلب كـ JSON مع صور المستندات كـ Data URL (base64) بعد ضغطها في المتصفح.
- تتحقق من الحقول ومن سلامة الصور فعليًا (Magic Bytes) لا من الامتداد أو نوع MIME فقط.
- تحفظ الصور كملفات على القرص داخل data/uploads/<رقم الطلب>/ وتكتب سجلًا JSON.
- تُخزَّن كلمة السر مشفّرة بـ PBKDF2-SHA256، ولا تُكتب أبدًا كما هي.
- كل قراءة للبيانات الشخصية تتطلب رمز إدارة (Admin Token).

لا اعتماديات خارجية: يعمل مع `python3 server/serve.py`.
"""
from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
import json
import os
import re
import secrets
import tempfile
import time
from collections import OrderedDict, deque
from typing import Any

# ---------------------------------------------------------------------------
# الإعدادات
# ---------------------------------------------------------------------------
API_VERSION = 1
MAX_BODY_BYTES = 12 * 1024 * 1024          # أقصى حجم جسم طلب (JSON + base64)
MAX_DOC_BYTES = 4 * 1024 * 1024            # أقصى حجم مستند مفكوك
MAX_TOTAL_DOC_BYTES = 7 * 1024 * 1024      # أقصى مجموع للمستندات في الطلب
MAX_REQUESTS_PER_MINUTE = 10               # لكل عنوان IP على مسار الرفع

ORDER_RE = re.compile(r"^RHQ-\d{3,10}$")
MOBILE_RE = re.compile(r"^\d{11}$")
NATIONAL_RE = re.compile(r"^\d{14}$")
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+$")

DOC_KEYS = ("birthCert", "photo", "parentCard", "reportCard")
REQUIRED_DOCS = ("birthCert", "photo", "parentCard")
DOC_LABELS = {
    "birthCert": "شهادة الميلاد",
    "photo": "الصورة الشخصية",
    "parentCard": "بطاقة ولي الأمر",
    "reportCard": "بيان النجاح",
}

# القائمتان المختلفتان للبرنامج
PROGRAM_TYPES = ("تأسيس", "منهج دراسي")
FOUNDATION_LEVELS = ("تأسيس للصغار", "تأسيس للكبار")
FOUNDATION_SUBJECTS = ("اللغة العربية", "اللغة الإنجليزية", "الرياضيات", "القراءة والكتابة")
CURRICULUM_GRADES = (
    "KG1", "KG2",
    "الصف الأول الابتدائي", "الصف الثاني الابتدائي", "الصف الثالث الابتدائي",
    "الصف الرابع الابتدائي", "الصف الخامس الابتدائي", "الصف السادس الابتدائي",
    "الصف الأول الإعدادي", "الصف الثاني الإعدادي", "الصف الثالث الإعدادي",
    "الصف الأول الثانوي", "الصف الثاني الثانوي", "3 ثانوي",
)
CLIENT_HASH_RE = re.compile(r"^sha256\$[0-9a-f]{32}\$[0-9a-f]{64}$")

# نوع MIME المسموح ← (الامتداد، البصمة الفعلية للبايتات)
ALLOWED_TYPES: dict[str, tuple[str, tuple[bytes, ...]]] = {
    "image/jpeg": (".jpg", (b"\xff\xd8\xff",)),
    "image/png": (".png", (b"\x89PNG\r\n\x1a\n",)),
    "image/gif": (".gif", (b"GIF87a", b"GIF89a")),
    "image/webp": (".webp", (b"RIFF",)),
    "application/pdf": (".pdf", (b"%PDF",)),
}

DATA_URL_RE = re.compile(r"^data:([a-z0-9.+/-]+);base64,([A-Za-z0-9+/=]+)$", re.IGNORECASE)
PBKDF2_ROUNDS = 120_000


class ApiError(Exception):
    """خطأ قابل للإرجاع إلى العميل مع رمز حالة HTTP."""

    def __init__(self, status: int, message: str, fields: dict[str, str] | None = None):
        super().__init__(message)
        self.status = status
        self.message = message
        self.fields = fields or {}


# ---------------------------------------------------------------------------
# أدوات مساعدة
# ---------------------------------------------------------------------------
def _normalize_digits(value: Any) -> str:
    """يحوّل الأرقام العربية/الفارسية إلى لاتينية ويحذف ما ليس رقمًا."""
    table = str.maketrans("٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹", "01234567890123456789")
    return "".join(ch for ch in str(value or "").translate(table) if ch.isdigit())


def _text(value: Any, limit: int) -> str:
    if not isinstance(value, str):
        return ""
    return value.replace("\x00", "").strip()[:limit]


def _words(value: str) -> int:
    return len([w for w in re.split(r"\s+", value.strip()) if w])


def hash_password(password: str) -> str:
    """PBKDF2-SHA256 مع ملح عشوائي — بدون أي كلمة سر نصية في التخزين."""
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PBKDF2_ROUNDS)
    return "pbkdf2_sha256${}${}${}".format(
        PBKDF2_ROUNDS,
        base64.b64encode(salt).decode("ascii"),
        base64.b64encode(digest).decode("ascii"),
    )


def verify_password(password: str, stored: str) -> bool:
    try:
        algo, rounds, salt_b64, hash_b64 = stored.split("$", 3)
        if algo != "pbkdf2_sha256":
            return False
        digest = hashlib.pbkdf2_hmac(
            "sha256", password.encode("utf-8"), base64.b64decode(salt_b64), int(rounds)
        )
        return hmac.compare_digest(digest, base64.b64decode(hash_b64))
    except (ValueError, TypeError, binascii.Error):
        return False


def parse_data_url(value: Any) -> tuple[str, bytes]:
    """يفك Data URL ويتحقق أن البايتات هي فعلًا صورة/PDF بالبصمة الحقيقية."""
    if not isinstance(value, str):
        raise ApiError(400, "بيانات المستند غير صالحة")
    match = DATA_URL_RE.match(value.strip())
    if not match:
        raise ApiError(400, "المستند يجب أن يكون صورة أو PDF مُرمّزة بصيغة base64")
    mime = match.group(1).lower()
    payload = match.group(2)
    if mime not in ALLOWED_TYPES:
        raise ApiError(400, "صيغة المستند غير مدعومة — المسموح: JPG / PNG / WEBP / GIF / PDF")
    if len(payload) > (MAX_DOC_BYTES * 4 // 3) + 16:
        raise ApiError(413, "حجم المستند أكبر من الحد المسموح (4 ميجابايت)")
    try:
        blob = base64.b64decode(payload, validate=True)
    except (binascii.Error, ValueError):
        raise ApiError(400, "ترميز base64 غير صالح في المستند")
    if not blob:
        raise ApiError(400, "المستند فارغ")
    if len(blob) > MAX_DOC_BYTES:
        raise ApiError(413, "حجم المستند أكبر من الحد المسموح (4 ميجابايت)")
    _, signatures = ALLOWED_TYPES[mime]
    if not any(blob.startswith(sig) for sig in signatures):
        raise ApiError(400, "محتوى المستند لا يطابق نوعه — الملف قد يكون تالفًا أو متنكرًا")
    if mime == "image/webp" and blob[8:12] != b"WEBP":
        raise ApiError(400, "محتوى WEBP غير صالح")
    return mime, blob


def _extension(mime: str) -> str:
    return ALLOWED_TYPES[mime][0]


def _atomic_write(path: str, data: bytes, mode: int = 0o600) -> None:
    directory = os.path.dirname(path)
    os.makedirs(directory, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=directory, prefix=".tmp-", suffix=".part")
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(tmp, mode)
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def _mask_mobile(mobile: str) -> str:
    return mobile[:2] + "•" * 6 + mobile[-3:] if len(mobile) == 11 else ""


# ---------------------------------------------------------------------------
# التحقق من الطلب
# ---------------------------------------------------------------------------
def validate_registration(payload: Any) -> dict[str, Any]:
    """يتحقق من الحقول الأساسية ويعيد نسخة منظّفة (بدون تعديل الأصل)."""
    if not isinstance(payload, dict):
        raise ApiError(400, "جسم الطلب يجب أن يكون JSON")

    fields: dict[str, str] = {}
    parent_name = _text(payload.get("parentName"), 120)
    if _words(parent_name) < 4:
        fields["parentName"] = "اكتب اسم ولي الأمر رباعيًا"
    national_id = _normalize_digits(payload.get("nationalId"))
    if not NATIONAL_RE.match(national_id):
        fields["nationalId"] = "الرقم القومي يجب أن يكون 14 رقمًا"
    mobile = _normalize_digits(payload.get("mobile"))
    if not MOBILE_RE.match(mobile):
        fields["mobile"] = "رقم الموبايل يجب أن يكون 11 رقمًا"
    email = _text(payload.get("email"), 160)
    if not EMAIL_RE.match(email):
        fields["email"] = "البريد الإلكتروني غير صالح"
    # كلمة السر: hash العميل (sha256$salt$hex) أو النص القديم — لا نخزن أيًا منهما كما هو
    secret = payload.get("passwordHash")
    if secret is not None and not (isinstance(secret, str) and CLIENT_HASH_RE.match(secret)):
        secret = None
    if secret is None:
        secret = payload.get("password")
    if not isinstance(secret, str) or len(secret) < 6 or len(secret) > 200:
        fields["password"] = "كلمة السر يجب أن تكون 6 أحرف على الأقل"
    student_name = _text(payload.get("studentName"), 120)
    if _words(student_name) < 4:
        fields["studentName"] = "اكتب اسم الطالب رباعيًا"
    address = _text(payload.get("address"), 400)
    if len(address) < 5:
        fields["address"] = "أدخل العنوان"
    dob = _text(payload.get("dob"), 10)
    if dob and not re.match(r"^\d{4}-\d{2}-\d{2}$", dob):
        fields["dob"] = "تاريخ الميلاد غير صالح"

    # ---- قائمتان مختلفتان: تأسيس (قائمة المواد) أو منهج دراسي (قائمة السنة الدراسية) ----
    program_type = _text(payload.get("programType"), 20)
    grade = _text(payload.get("grade"), 40)
    foundation_level = _text(payload.get("foundationLevel"), 40)
    subjects_in = payload.get("foundationSubjects")
    subjects_in = subjects_in if isinstance(subjects_in, list) else []

    if program_type not in PROGRAM_TYPES:
        # استنتاج تلقائي من grade القديم (عملاء قدامى قبل تقسيم القوائم)
        if grade in FOUNDATION_LEVELS:
            program_type = "تأسيس"
            foundation_level = grade
            grade = ""
        elif grade in CURRICULUM_GRADES:
            program_type = "منهج دراسي"

    if program_type not in PROGRAM_TYPES:
        fields["programType"] = "اختر نوع البرنامج: تأسيس أو منهج دراسي"
    elif program_type == "تأسيس":
        # قائمة مواد التأسيس: مادة أو أكثر إلزامية من القائمة البيضاء
        if not foundation_level and grade in FOUNDATION_LEVELS:
            foundation_level = grade
        if foundation_level and foundation_level not in FOUNDATION_LEVELS:
            fields["foundationLevel"] = "مستوى التأسيس غير صالح"
        grade = ""  # السنة الدراسية لا تنطبق على التأسيس
        subjects = [x for x in subjects_in if isinstance(x, str) and x in FOUNDATION_SUBJECTS][:4]
        if not subjects:
            fields["foundationSubjects"] = "اختر مادة أو أكثر من قائمة مواد التأسيس"
    else:  # منهج دراسي
        foundation_level = ""
        subjects = []
        if grade not in CURRICULUM_GRADES:
            fields["grade"] = "اختر السنة الدراسية من القائمة"

    docs_in = payload.get("docs")
    if not isinstance(docs_in, dict):
        raise ApiError(400, "المستندات مطلوبة", {"docs": "أرفق شهادة الميلاد والصورة الشخصية وبطاقة ولي الأمر"})

    docs: dict[str, dict[str, Any]] = {}
    total = 0
    for key in DOC_KEYS:
        raw = docs_in.get(key)
        if raw in (None, "", {}):
            if key in REQUIRED_DOCS:
                fields[key] = "هذا المستند مطلوب: " + DOC_LABELS[key]
            continue
        if not isinstance(raw, dict):
            fields[key] = "بيانات المستند غير صالحة"
            continue
        data_url = raw.get("dataUrl")
        if not data_url:
            fields[key] = "لم يتم إرسال محتوى المستند (dataUrl مفقود)"
            continue
        try:
            mime, blob = parse_data_url(data_url)
        except ApiError as exc:
            fields[key] = exc.message
            continue
        total += len(blob)
        if total > MAX_TOTAL_DOC_BYTES:
            raise ApiError(413, "مجموع أحجام المستندات أكبر من الحد المسموح (7 ميجابايت)")
        docs[key] = {
            "name": _text(raw.get("name"), 180) or (DOC_LABELS[key] + _extension(mime)),
            "mime": mime,
            "bytes": blob,
            "width": int(raw.get("width") or 0) if str(raw.get("width") or "0").isdigit() else 0,
            "height": int(raw.get("height") or 0) if str(raw.get("height") or "0").isdigit() else 0,
        }

    if fields:
        raise ApiError(400, "بيانات غير مكتملة أو غير صالحة", fields)

    order = _text(payload.get("orderNumber"), 20).upper()
    if order and not ORDER_RE.match(order):
        order = ""

    return {
        "orderNumber": order,
        "parentName": parent_name,
        "nationalId": national_id,
        "relation": _text(payload.get("relation"), 40) or "ولي أمر",
        "mobile": mobile,
        "whatsapp": _normalize_digits(payload.get("whatsapp")) or mobile,
        "email": email,
        "passwordHash": hash_password(secret if isinstance(secret, str) else ""),
        "studentName": student_name,
        "dob": dob,
        "gender": _text(payload.get("gender"), 20),
        "programType": program_type,
        "grade": grade,
        "foundationLevel": foundation_level,
        "foundationSubjects": subjects,
        "prevSchool": _text(payload.get("prevSchool"), 160),
        "address": address,
        "healthNotes": _text(payload.get("healthNotes"), 800),
        "clientCreatedAt": _text(payload.get("createdAt"), 40),
        "docs": docs,
    }


# ---------------------------------------------------------------------------
# التخزين
# ---------------------------------------------------------------------------
def layout(data_dir: str) -> dict[str, str]:
    return {
        "root": data_dir,
        "registrations": os.path.join(data_dir, "registrations"),
        "uploads": os.path.join(data_dir, "uploads"),
        "index": os.path.join(data_dir, "registrations", "index.json"),
    }


def _read_json(path: str, default: Any) -> Any:
    try:
        with open(path, "r", encoding="utf-8") as handle:
            return json.load(handle)
    except (OSError, ValueError):
        return default


def _load_index(paths: dict[str, str]) -> list[dict[str, Any]]:
    data = _read_json(paths["index"], [])
    return data if isinstance(data, list) else []


def _write_index(paths: dict[str, str], entries: list[dict[str, Any]]) -> None:
    _atomic_write(
        paths["index"],
        json.dumps(entries, ensure_ascii=False, indent=2).encode("utf-8"),
        mode=0o600,
    )


def _next_order(entries: list[dict[str, Any]]) -> str:
    used = {entry.get("orderNumber") for entry in entries}
    for _ in range(200):
        candidate = "RHQ-{}".format(1000 + secrets.randbelow(9000))
        if candidate not in used:
            return candidate
    return "RHQ-{}".format(int(time.time()) % 100000)


def save_registration(payload: Any, data_dir: str) -> dict[str, Any]:
    """يتحقق ويحفظ الطلب والصور. يعيد ملخصًا آمنًا للعميل."""
    record = validate_registration(payload)
    paths = layout(data_dir)
    os.makedirs(paths["registrations"], exist_ok=True)
    os.makedirs(paths["uploads"], exist_ok=True)

    entries = _load_index(paths)
    mobile = record["mobile"]
    existing = next((e for e in entries if e.get("mobile") == mobile), None)
    order = (existing or {}).get("orderNumber") or record["orderNumber"] or _next_order(entries)
    if not ORDER_RE.match(order):
        order = _next_order(entries)

    created_at = (existing or {}).get("createdAt") or record["clientCreatedAt"] or _now()
    if not re.match(r"^\d{4}-\d{2}-\d{2}T", created_at):
        created_at = _now()
    saved_at = _now()

    order_dir = os.path.join(paths["uploads"], order)
    os.makedirs(order_dir, exist_ok=True, mode=0o700)

    files_summary: dict[str, Any] = {}
    doc_meta: dict[str, Any] = {}
    for key in DOC_KEYS:
        doc = record["docs"].get(key)
        if not doc:
            continue
        ext = _extension(doc["mime"])
        filename = key + ext
        path = os.path.join(order_dir, filename)
        _atomic_write(path, doc["bytes"])
        rel = "uploads/{}/{}".format(order, filename)
        files_summary[key] = {"size": len(doc["bytes"]), "mime": doc["mime"], "file": filename}
        doc_meta[key] = {
            "name": doc["name"],
            "mime": doc["mime"],
            "size": len(doc["bytes"]),
            "width": doc["width"],
            "height": doc["height"],
            "path": rel,
        }

    stored = {
        "apiVersion": API_VERSION,
        "orderNumber": order,
        "createdAt": created_at,
        "savedAt": saved_at,
        "parentName": record["parentName"],
        "nationalId": record["nationalId"],
        "relation": record["relation"],
        "mobile": record["mobile"],
        "whatsapp": record["whatsapp"],
        "email": record["email"],
        "passwordHash": record["passwordHash"],
        "studentName": record["studentName"],
        "dob": record["dob"],
        "gender": record["gender"],
        "programType": record["programType"],
        "grade": record["grade"],
        "foundationLevel": record.get("foundationLevel", ""),
        "foundationSubjects": record.get("foundationSubjects", []),
        "prevSchool": record["prevSchool"],
        "address": record["address"],
        "healthNotes": record["healthNotes"],
        "docs": doc_meta,
    }
    record_path = os.path.join(paths["registrations"], order + ".json")
    _atomic_write(
        record_path,
        json.dumps(stored, ensure_ascii=False, indent=2).encode("utf-8"),
    )

    summary = {
        "orderNumber": order,
        "createdAt": created_at,
        "updatedAt": saved_at,
        "studentName": record["studentName"],
        "grade": record["grade"],
        "parentName": record["parentName"],
        "mobile": record["mobile"],
        "docs": sorted(doc_meta.keys()),
    }
    entries = [e for e in entries if e.get("orderNumber") != order]
    entries.append(summary)
    entries.sort(key=lambda e: e.get("createdAt") or "", reverse=True)
    _write_index(paths, entries)

    return {
        "ok": True,
        "orderNumber": order,
        "savedAt": saved_at,
        "createdAt": created_at,
        "files": files_summary,
        "storage": "server",
        "replaced": bool(existing),
    }


def _now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def list_registrations(data_dir: str) -> list[dict[str, Any]]:
    entries = _load_index(layout(data_dir))
    safe = []
    for entry in entries:
        safe.append(
            {
                "orderNumber": entry.get("orderNumber"),
                "createdAt": entry.get("createdAt"),
                "updatedAt": entry.get("updatedAt"),
                "studentName": entry.get("studentName"),
                "programType": entry.get("programType"),
                "grade": entry.get("grade"),
                "parentName": entry.get("parentName"),
                "mobile": entry.get("mobile"),
                "docs": entry.get("docs") or [],
            }
        )
    return safe


def load_registration(order: str, data_dir: str) -> dict[str, Any] | None:
    if not ORDER_RE.match(order or ""):
        raise ApiError(400, "رقم طلب غير صالح")
    path = os.path.join(layout(data_dir)["registrations"], order + ".json")
    data = _read_json(path, None)
    if not isinstance(data, dict):
        return None
    # لا نُرجع هاش كلمة السر أبدًا
    data.pop("passwordHash", None)
    return data


def read_document(order: str, key: str, data_dir: str) -> tuple[str, str, bytes]:
    if not ORDER_RE.match(order or ""):
        raise ApiError(400, "رقم طلب غير صالح")
    if key not in DOC_KEYS:
        raise ApiError(400, "مستند غير معروف")
    record = load_registration(order, data_dir)
    if not record:
        raise ApiError(404, "لا يوجد طلب بهذا الرقم")
    meta = (record.get("docs") or {}).get(key)
    if not meta:
        raise ApiError(404, "هذا المستند غير مرفوع في الطلب")
    path = os.path.join(layout(data_dir)["root"], meta.get("path", ""))
    path = os.path.realpath(path)
    root = os.path.realpath(layout(data_dir)["root"])
    if not path.startswith(root + os.sep) or not os.path.isfile(path):
        raise ApiError(404, "ملف المستند غير موجود")
    with open(path, "rb") as handle:
        blob = handle.read()
    filename = os.path.basename(meta.get("path") or "document")
    return meta.get("mime") or "application/octet-stream", filename, blob


def health(data_dir: str, admin_enabled: bool) -> dict[str, Any]:
    writable = True
    try:
        os.makedirs(layout(data_dir)["root"], exist_ok=True)
        probe = os.path.join(layout(data_dir)["root"], ".write-probe")
        with open(probe, "wb") as handle:
            handle.write(b"ok")
        os.unlink(probe)
    except OSError:
        writable = False
    return {
        "ok": True,
        "service": "raheeq-api",
        "version": API_VERSION,
        "storage": "file",
        "writable": writable,
        "maxBodyBytes": MAX_BODY_BYTES,
        "maxDocBytes": MAX_DOC_BYTES,
        "docs": list(DOC_KEYS),
        "requiredDocs": list(REQUIRED_DOCS),
        "adminReadEnabled": bool(admin_enabled),
    }


# ---------------------------------------------------------------------------
# حدّ معدل الطلبات
# ---------------------------------------------------------------------------
class RateLimiter:
    """حد بسيط في الذاكرة لمنع الإغراق (غير موزّع، يكفي لخادم واحد)."""

    def __init__(self, limit: int = MAX_REQUESTS_PER_MINUTE, window: float = 60.0):
        self.limit = limit
        self.window = window
        self._hits: dict[str, deque[float]] = {}
        self._lock = __import__("threading").Lock()

    def allow(self, key: str) -> bool:
        now = time.monotonic()
        with self._lock:
            bucket = self._hits.setdefault(key, deque())
            while bucket and now - bucket[0] > self.window:
                bucket.popleft()
            if len(bucket) >= self.limit:
                return False
            bucket.append(now)
            if len(self._hits) > 5000:  # تنظيف دوري بسيط
                for stale in [k for k, v in self._hits.items() if not v]:
                    self._hits.pop(stale, None)
            return True


def token_matches(provided: str | None, expected: str | None) -> bool:
    if not expected:
        return False
    if not provided:
        return False
    return hmac.compare_digest(str(provided), str(expected))


__all__ = [
    "ApiError",
    "DOC_KEYS",
    "DOC_LABELS",
    "MAX_BODY_BYTES",
    "ORDER_RE",
    "RateLimiter",
    "health",
    "layout",
    "list_registrations",
    "load_registration",
    "parse_data_url",
    "read_document",
    "save_registration",
    "token_matches",
    "validate_registration",
    "verify_password",
]
