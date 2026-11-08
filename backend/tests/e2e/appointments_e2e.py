"""End-to-end check of appointments against a running system with demo data.

    python tests/e2e/appointments_e2e.py http://web:3000 <demo password>

Uses the demo accounts; cleans up the appointments it creates (they are cancelled, never deleted).
Management's demo account gets 2-step verification set up by the script; reset it afterwards if needed."""
import base64
import hashlib
import hmac
import json
import struct
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, timedelta

BASE, DEMO = sys.argv[1], sys.argv[2]
ok = 0


def totp(secret):
    key = base64.b32decode(secret + "=" * (-len(secret) % 8))
    h = hmac.new(key, struct.pack(">Q", int(time.time() // 30)), hashlib.sha1).digest()
    o = h[-1] & 15
    return "%06d" % ((struct.unpack(">I", h[o:o + 4])[0] & 0x7FFFFFFF) % 1000000)


class C:
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
        r = urllib.request.Request(BASE + urllib.parse.quote(path, safe="/?=&-_.:,+"), data=data, method=method, headers=headers)
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
        status, me = self.req("POST", "/api/auth/login", {"identifier": who, "password": DEMO})
        assert status == 200, me
        if me["next_step"] == "mfa_setup":
            _, setup = self.req("POST", "/api/auth/mfa/setup")
            _, me = self.req("POST", "/api/auth/mfa/verify", {"code": totp(setup["secret"])})
        return me


def check(label, cond, extra=""):
    global ok
    print(("PASS " if cond else "FAIL ") + label + ("" if cond else f"  -> {str(extra)[:600]}"))
    ok += bool(cond)
    if not cond:
        sys.exit(1)


rc = C()
rc.login("reception@demo.goldencare.local")
R = "/api/reception/appointments"
_, rules = rc.req("GET", f"{R}/rules")
check("booking rules", rules["slot_step_min"] == 15 and rules["portal_cancel_hours"] == 12, rules)
today = date.fromisoformat(rules["today"])
_, cat = rc.req("GET", "/api/reception/settings/catalog")
svc = {x["code"]: x["id"] for x in cat["services"]}
cons, btx, dchk = svc["DRM-CONS"], svc["DRM-BTX"], svc["DNT-CONS"]
_, docs = rc.req("GET", "/api/reception/settings/doctors")
D = {x["email"].split("@")[0]: x["id"] for x in docs}
_, pts = rc.req("GET", "/api/reception/patients?page_size=100")
P = {x["full_name_en"]: x["id"] for x in pts["items"] if x["full_name_en"]}

# leftovers from an interrupted earlier run
for offset in range(0, 9):
    _, day_ = rc.req("GET", f"{R}/day?on={today + timedelta(days=offset)}")
    for a in day_["appointments"]:
        if a["notes"] in ("E2E test", "First botox") and a["status"] in ("requested", "booked", "confirmed"):
            rc.req("POST", f"{R}/{a['id']}/cancel", {"reason": "Test cleanup", "by": "clinic"})

status, d = rc.req("GET", f"{R}/day")
check("today board: doctors + appointments", status == 200 and d["doctors"], status)
_, b = rc.req("GET", f"{R}/doctors?service_ids={cons},{btx}")
check("doctors offering consultation + botox", [x["id"] for x in b] == [D["dr.derm"]], b)
sl, derm_day = None, None
for i in range(1, 21):
    day_ = today + timedelta(days=i)
    _, found = rc.req("GET", f"{R}/slots?service_ids={cons},{btx}&on={day_}")
    if found and len(found[0]["slots"]) >= 3:
        sl, derm_day = found, day_
        break
check("free slots for 2 services (50 min)", sl and sl[0]["duration_min"] == 50 and sl[0]["slots"], sl)
slot = sl[0]["slots"][len(sl[0]["slots"]) // 2]
body = {"patient_id": P["Karim Ashraf Ramadan"], "service_ids": [cons, btx], "doctor_id": D["dr.derm"],
        "starts_at": slot["start"], "source": "phone", "notes": "E2E test"}
results = []


def book_once():
    c = C()
    c.cookie = rc.cookie
    results.append(c.req("POST", R, body))


threads = [threading.Thread(target=book_once) for _ in range(2)]
[t.start() for t in threads]
[t.join() for t in threads]
check("two simultaneous bookings: one wins, one refused", sorted(r[0] for r in results) == [201, 409], results)
appt = next(r[1] for r in results if r[0] == 201)
check("booked with 2 services, doctor's price and a room", len(appt["services"]) == 2 and float(appt["estimated_price"]) == 600 + 3500
      and appt["room_id"], appt)
status, b = rc.req("POST", R, {**body, "patient_id": P["Reham Adel Mansour"]})
check("same doctor, same time refused", status == 409 and b["error"]["code"] in ("slot_taken", "room_taken"), b)
status, b = rc.req("POST", R, {**body, "service_ids": [dchk]})
check("doctor who doesn't offer the service refused", status == 409 and b["error"]["code"] == "doctor_does_not_offer", b)
late = {"patient_id": P["Reham Adel Mansour"], "service_ids": [cons], "doctor_id": D["dr.derm"], "local_date": str(derm_day),
        "local_time": "23:30", "notes": "E2E test"}
status, b = rc.req("POST", R, late)
check("outside working hours refused", status == 409 and b["error"]["code"] == "outside_hours", b)
status, b = rc.req("POST", R, {**late, "overbook_reason": "Urgent post-op check"})
check("squeeze-in with a reason allowed", status == 201 and b["overbooked"], b)
squeeze = b["id"]
leave = next(x for x in docs if x["email"].startswith("dr.dental"))["leave"][0]
status, b = rc.req("POST", R, {"patient_id": P["Amr Khaled Nasr"], "service_ids": [dchk], "doctor_id": D["dr.dental"],
                               "local_date": leave["starts_on"], "local_time": "16:00", "overbook_reason": "test leave"})
check("booking on a doctor's leave refused", status == 409 and b["error"]["code"] == "doctor_on_leave", b)

_, sl2 = rc.req("GET", f"{R}/slots?service_ids={cons},{btx}&on={derm_day}&doctor_id={D['dr.derm']}&exclude={appt['id']}")
new_slot = sl2[0]["slots"][0]
_, b = rc.req("POST", f"{R}/{appt['id']}/confirm")
check("confirm", b["status"] == "confirmed", b)
_, b = rc.req("POST", f"{R}/{appt['id']}/reschedule", {"starts_at": new_slot["start"]})
check("reschedule: new time, back to booked", b["starts_at"] == new_slot["start"] and b["status"] == "booked", b)
check("history kept", [e["action"] for e in b["events"]] == ["booked", "confirmed", "rescheduled"], b["events"])
status, b = rc.req("POST", f"{R}/{appt['id']}/arrive")
check("arrival only on the day", status == 409 and b["error"]["code"] == "not_today", b)
status, b = rc.req("POST", f"{R}/{appt['id']}/no-show")
check("no-show only after the start time", status == 409 and b["error"]["code"] == "not_started_yet", b)
_, b = rc.req("POST", f"{R}/{squeeze}/cancel", {"reason": "Booked by mistake", "by": "clinic"})
check("cancel with a reason", b["status"] == "cancelled" and b["cancel_reason"] == "Booked by mistake", b)

_, d = rc.req("GET", f"{R}/day")
waiting = [a for a in d["appointments"] if a["doctor_id"] == D["dr.dental"] and a["status"] in ("booked", "confirmed")]
if len(waiting) >= 2 and not any(a["status"] == "in_room" and a["doctor_id"] == D["dr.dental"] for a in d["appointments"]):
    a1, a2 = waiting[0], waiting[1]
    _, b = rc.req("POST", f"{R}/{a1['id']}/arrive")
    check("arrival gives a queue number", b["status"] == "arrived" and b["queue_no"] >= 1, b)
    q1 = b["queue_no"]
    _, b = rc.req("POST", f"{R}/{a2['id']}/arrive")
    check("next arrival gets the next number", b["queue_no"] == q1 + 1, b)
    dr = C()
    dr.login("dr.dental@demo.goldencare.local")
    DR = "/api/doctor/appointments"
    _, b = dr.req("GET", f"{DR}/day")
    check("doctor sees only their own day", all(x["doctor_id"] == D["dr.dental"] for x in b["appointments"]) and len(b["doctors"]) == 1)
    _, b = dr.req("POST", f"{DR}/{a1['id']}/call")
    check("doctor calls the patient in", b["status"] == "in_room", b)
    status, b = dr.req("POST", f"{DR}/{a2['id']}/call")
    check("one patient at a time", status == 409 and b["error"]["code"] == "already_with_patient", b)
    _, b = dr.req("POST", f"{DR}/{a1['id']}/finish")
    check("finish the visit", b["status"] == "completed", b)
    status, b = dr.req("GET", f"{DR}/{appt['id']}")
    check("doctor can't open another doctor's appointment", status == 403, b)
    status, b = dr.req("GET", f"/api/doctor/patients/{a1['patient_id']}")
    check("doctor opens their own patient's file", status == 200, b)
    stamp = int(time.time()) % 10000000
    status, fresh = rc.req("POST", "/api/reception/patients", {"full_name_ar": f"مريض اختبار صلاحيات {stamp}", "date_of_birth": "1991-01-01",
                                                              "gender": "male", "phone": f"0120{stamp:07d}",
                                                              "duplicate_reason": "Automated access test"})
    check("test patient created", status == 201, fresh)
    status, b = dr.req("GET", f"/api/doctor/patients/{fresh['id']}")
    check("doctor can't open a file of a patient who isn't theirs", status == 403 and b["error"]["code"] == "not_your_patient", b)
    _, b = dr.req("GET", "/api/doctor/patients?page_size=100")
    check("doctor's patient list shows own patients only", fresh["id"] not in [x["id"] for x in b["items"]], b["total"])
    status, b = dr.req("POST", DR, body)
    check("doctor can't book", status == 403, b)
else:
    print("SKIP same-day arrival/doctor checks (not enough waiting dental appointments today)")

nurse = C()
nurse.login("nurse@demo.goldencare.local")
status, b = nurse.req("GET", "/api/nurse/appointments/day")
check("nurse sees today", status == 200, b)
status, b = nurse.req("POST", f"/api/nurse/appointments/{appt['id']}/cancel", {"reason": "test", "by": "clinic"})
check("nurse can't cancel", status == 403, b)

pt = C()
pt.login("01001110001")
status, mine = pt.req("GET", "/api/patient/appointments")
check("patient sees own and child's appointments", status == 200 and mine["items"], mine)
_, opt = pt.req("GET", "/api/patient/booking/options")
check("booking options: services and people", len(opt["services"]) >= 15 and len(opt["people"]) == 2, opt)
_, ps = pt.req("GET", f"/api/patient/booking/slots?service_id={cons}&on={derm_day}")
check("online free slots", ps and ps[0]["slots"], ps)
mg = C()
mg.login("director@demo.goldencare.local")
_, rules0 = mg.req("GET", "/api/management/settings/booking-rules")
upcoming = [x for x in mine["items"] if x["patient_id"] == P["Omar Youssef"] and x["status"] in ("requested", "booked", "confirmed")
            and x["starts_at"] > mine["now"]]
if len(upcoming) >= rules0["portal_max_upcoming"]:
    status, b = pt.req("POST", "/api/patient/appointments", {"patient_id": P["Omar Youssef"], "service_id": cons,
                                                             "doctor_id": D["dr.derm"], "starts_at": ps[0]["slots"][-1]["start"]})
    check("online booking limit (max upcoming visits) enforced", status == 409 and b["error"]["code"] == "too_many_upcoming", b)
mg.req("PUT", "/api/management/settings/booking-rules", {**rules0, "portal_max_upcoming": 20})
status, b = pt.req("POST", "/api/patient/appointments", {"patient_id": P["Omar Youssef"], "service_id": cons,
                                                         "doctor_id": D["dr.derm"], "starts_at": ps[0]["slots"][-1]["start"]})
check("patient books online", status == 201, b)
mine_id = b["id"]
row = next(x for x in b["items"] if x["id"] == mine_id)
check("online booking is booked and can be cancelled", row["status"] == "booked" and row["can_cancel"], row)
_, b = pt.req("POST", f"/api/patient/appointments/{mine_id}/cancel", {})
check("patient cancels online", next(x for x in b["items"] if x["id"] == mine_id)["status"] == "cancelled", b)
_, same_day = pt.req("GET", f"/api/patient/booking/slots?service_id={dchk}&on={today}")
if same_day and same_day[0]["slots"]:
    status, b = pt.req("POST", "/api/patient/appointments", {"patient_id": P["Omar Youssef"], "service_id": dchk,
                                                             "doctor_id": D["dr.dental"], "starts_at": same_day[0]["slots"][0]["start"]})
    check("patient books a same-day visit", status == 201, b)
    soon = b["id"]
    status, b = pt.req("POST", f"/api/patient/appointments/{soon}/cancel", {})
    check("online cancel within 12 hours refused", status == 409 and b["error"]["code"] == "too_late_to_cancel", b)
    rc.req("POST", f"{R}/{soon}/cancel", {"reason": "Test cleanup", "by": "clinic"})
status, b = pt.req("POST", "/api/patient/appointments", {"patient_id": P["Karim Ashraf Ramadan"], "service_id": cons,
                                                         "doctor_id": D["dr.derm"], "starts_at": ps[0]["slots"][0]["start"]})
check("can't book for someone else's file", status == 403, b)

_, b = mg.req("PUT", "/api/management/settings/booking-rules", {**rules0, "portal_max_upcoming": 20, "portal_needs_confirmation": True})
check("Management changes booking rules", b["portal_needs_confirmation"] is True, b)
_, b = pt.req("POST", "/api/patient/appointments", {"patient_id": P["Omar Youssef"], "service_id": cons, "doctor_id": D["dr.derm"],
                                                    "starts_at": ps[0]["slots"][1]["start"]})
request_id = b["id"]
check("with confirmation on, an online booking is a request",
      next(x for x in b["items"] if x["id"] == request_id)["status"] == "requested", b)
_, b = rc.req("POST", f"{R}/{request_id}/confirm")
check("reception confirms the request", b["status"] == "confirmed", b)
rc.req("POST", f"{R}/{request_id}/cancel", {"reason": "Test cleanup", "by": "clinic"})
mg.req("PUT", "/api/management/settings/booking-rules", rules0)
status, b = rc.req("PUT", "/api/reception/settings/booking-rules", rules0)
check("reception can't change booking rules", status == 403, b)
rc.req("POST", f"{R}/{appt['id']}/cancel", {"reason": "Test cleanup", "by": "clinic"})
print(f"\n{ok} checks passed")
