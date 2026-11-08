"""Helpers for the end-to-end scripts: a tiny API client that signs in (setting up 2-step when asked) and check()."""
import base64
import hashlib
import hmac
import json
import struct
import sys
import time
import urllib.error
import urllib.parse
import urllib.request


def totp(secret):
    key = base64.b32decode(secret + "=" * (-len(secret) % 8))
    h = hmac.new(key, struct.pack(">Q", int(time.time() // 30)), hashlib.sha1).digest()
    o = h[-1] & 15
    return "%06d" % ((struct.unpack(">I", h[o:o + 4])[0] & 0x7FFFFFFF) % 1000000)


class C:
    BASE = ""
    DEMO = ""

    def __init__(self):
        self.cookie = None

    def req(self, method, path, body=None):
        headers = {"Accept": "application/json"}
        data = None
        if method != "GET":
            headers.update({"Content-Type": "application/json", "X-Requested-With": "GoldenCare"})
            data = json.dumps(body or {}).encode()
        if self.cookie:
            headers["Cookie"] = self.cookie
        r = urllib.request.Request(self.BASE + urllib.parse.quote(path, safe="/?=&-_.:,+"), data=data, method=method, headers=headers)
        try:
            resp = urllib.request.urlopen(r)
            status = resp.status
        except urllib.error.HTTPError as e:
            resp, status = e, e.code
        cookie = resp.headers.get("Set-Cookie")
        if cookie and cookie.startswith("gc_session="):
            self.cookie = cookie.split(";")[0]
        text = resp.read()
        return status, (json.loads(text) if text else None)

    def login(self, who):
        status, me = self.req("POST", "/api/auth/login", {"identifier": who, "password": self.DEMO})
        assert status == 200, me
        if me["next_step"] == "mfa_setup":
            _, setup = self.req("POST", "/api/auth/mfa/setup")
            _, me = self.req("POST", "/api/auth/mfa/verify", {"code": totp(setup["secret"])})
        return me


_passed = 0


def check(label, cond, extra=""):
    global _passed
    print(("PASS " if cond else "FAIL ") + label + ("" if cond else f"  -> {str(extra)[:600]}"))
    _passed += bool(cond)
    if not cond:
        sys.exit(1)


check.passed = lambda: _passed
