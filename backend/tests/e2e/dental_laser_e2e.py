"""End-to-end check of part 4B (laser, tooth chart, treatment plans, lab cases) and the complaints desk.

    python tests/e2e/dental_laser_e2e.py http://web:3000 <demo password>

Works on the demo data and leaves realistic records behind (signed records can't be deleted)."""
import sys
from datetime import date, datetime, timedelta, timezone

sys.path.insert(0, __file__.rsplit("/", 1)[0])
from lib import C, check  # noqa: E402

C.BASE, C.DEMO = sys.argv[1], sys.argv[2]
rc, nurse, dentist, rel, pt = C(), C(), C(), C(), C()
rc.login("reception@demo.goldencare.local")
nurse.login("nurse@demo.goldencare.local")
dentist.login("dr.dental@demo.goldencare.local")
rel.login("relations@demo.goldencare.local")
pt.login("01001110001")

_, cat = rc.req("GET", "/api/reception/settings/catalog")
svc = {x["code"]: x["id"] for x in cat["services"]}
_, docs = rc.req("GET", "/api/reception/settings/doctors")
D = {x["email"].split("@")[0]: x["id"] for x in docs}
P = lambda name: rc.req("GET", f"/api/reception/patients?q={name}")[1]["items"][0]["id"]  # noqa: E731
omar, mostafa = P("Omar Youssef"), P("Mostafa Ibrahim")

# ---------------- laser ----------------
start = (datetime.now(timezone.utc) + timedelta(minutes=3)).replace(second=0, microsecond=0)
s, appt = rc.req("POST", "/api/reception/appointments", {"patient_id": omar, "doctor_id": D["dr.derm"], "service_ids": [svc["LSR-UARM"]],
                                                         "source": "phone", "starts_at": start.isoformat(), "notes": None,
                                                         "overbook_reason": "Laser touch-up between patients"})
check("laser appointment booked", s == 201, appt)
rc.req("POST", f"/api/reception/appointments/{appt['id']}/arrive")
s, today = nurse.req("GET", "/api/nurse/laser/today")
check("nurse sees today's laser appointment", s == 200 and any(a["id"] == appt["id"] for a in today["appointments"]), today)
s, sess = nurse.req("POST", f"/api/nurse/laser/start/{appt['id']}")
check("nurse starts the session record", s == 200, sess)
L = f"/api/nurse/laser/{sess['id']}"
_, d = nurse.req("GET", L)
check("session prefilled from last time (device, counter, areas, session no.)",
      d["session"]["device_id"] and d["session"]["counter_start"] is not None and d["session"]["session_no"] >= 4 and d["areas"], d["session"])
device_counter = next(x for x in d["devices"] if x["id"] == d["session"]["device_id"])["pulse_counter"]
base = {"device_id": d["session"]["device_id"], "session_no": d["session"]["session_no"], "skin_type": "III", "hair_color": "Dark brown",
        "counter_start": device_counter, "counter_end": device_counter + 130, "test_pulses": 0,
        "areas": [{"area": "Underarms", "fluence": 15, "pulse_ms": 3, "spot_mm": 15, "frequency_hz": 1, "pulses": 130}]}
ok_list = {k: False for k in d["checklist"]["items"]} | {"consent_signed": True, "patch_test": True}

nurse.req("PUT", L, {**base, "checklist": {"pregnant": False}})
s, e = nurse.req("POST", f"{L}/sign")
check("can't sign with the checklist unanswered", s == 422 and e["error"]["fields"].get("checklist") == "incomplete", e)
nurse.req("PUT", L, {**base, "checklist": {**ok_list, "consent_signed": False}})
s, e = nurse.req("POST", f"{L}/sign")
check("can't sign without signed consent", s == 422 and e["error"]["fields"].get("checklist") == "consent_required", e)
nurse.req("PUT", L, {**base, "checklist": {**ok_list, "recent_tan": True}})
s, e = nurse.req("POST", f"{L}/sign")
check("a stop answer needs a written reason", s == 422 and "checklist_override" in e["error"]["fields"], e)
nurse.req("PUT", L, {**base, "checklist": ok_list, "counter_end": device_counter + 140})
s, e = nurse.req("POST", f"{L}/sign")
check("counter difference refused without explanation", s == 409 and e["error"]["code"] == "counter_mismatch" and e["error"]["difference"] == 10, e)
nurse.req("PUT", L, {**base, "checklist": ok_list, "counter_end": device_counter + 140, "test_pulses": 10})
s, d = nurse.req("POST", f"{L}/sign")
check("signed once test pulses account for the difference", s == 200 and d["session"]["status"] == "signed", d)
_, devs = nurse.req("GET", "/api/nurse/laser/devices")
check("device counter moved forward", next(x for x in devs if x["id"] == base["device_id"])["pulse_counter"] == device_counter + 140)
s, e = nurse.req("PUT", L, base)
check("signed laser session can't be changed", s == 409, e)

# ---------------- tooth chart ----------------
s, e = dentist.req("POST", f"/api/doctor/dental/chart/{mostafa}", {"tooth": 19, "condition": "caries", "surfaces": ["O"]})
check("invalid tooth number refused", s == 422, e)
s, ch = dentist.req("POST", f"/api/doctor/dental/chart/{mostafa}", {"tooth": 16, "condition": "caries", "surfaces": ["O", "M"], "status": "existing"})
entry = [x for x in ch["entries"] if x["tooth"] == 16 and x["condition"] == "caries"][-1]
check("finding added to the chart", s == 201 and entry["surfaces"] == ["M", "O"], ch["entries"][-1:])
s, ch = dentist.req("POST", f"/api/doctor/dental/chart/{mostafa}/{entry['id']}/void", {"reason": "Wrong tooth, it was 17"})
check("entry voided, not deleted", s == 200 and any(x["id"] == entry["id"] and x["voided_at"] for x in ch["entries"]), ch)

# ---------------- treatment plan ----------------
s, plan = dentist.req("POST", "/api/doctor/dental/plans", {"patient_id": mostafa, "title": "Filling 16 and cleaning"})
check("plan created", s == 201, plan)
TP = f"/api/doctor/dental/plans/{plan['id']}"
s, p = dentist.req("POST", f"{TP}/items", {"service_id": svc["DNT-FILL"], "tooth": 16, "surfaces": ["O"], "phase": 1})
check("price taken from the price list", s == 201 and float(p["items"][0]["price"]) > 0 and p["items"][0]["condition"] == "filling", p["items"])
dentist.req("POST", f"{TP}/items", {"service_id": svc["DNT-SCAL"], "phase": 1})
dentist.req("PUT", TP, {"title": "Filling 16 and cleaning", "down_payment": 99999, "installments_count": 2})
s, e = dentist.req("POST", f"{TP}/quote", {"valid_days": 30})
check("down payment can't exceed the total", s == 422, e)
dentist.req("PUT", TP, {"title": "Filling 16 and cleaning", "down_payment": 500, "installments_count": 2, "patient_note": "Both in one visit."})
s, p = dentist.req("POST", f"{TP}/quote", {"valid_days": 30})
check("quotation issued", s == 200 and p["plan"]["state"] == "quoted" and len(p["schedule_preview"]) == 3, p["plan"])
s, e = dentist.req("POST", f"{TP}/items", {"service_id": svc["DNT-EXT"], "tooth": 18})
check("quoted plan's items are frozen", s == 409, e)
RP = f"/api/reception/dental/plans/{plan['id']}"
s, e = rc.req("POST", f"{RP}/accept", {"signed_paper": False})
check("reception must confirm the signed paper", s == 422, e)
s, p = rc.req("POST", f"{RP}/accept", {"signed_paper": True})
total = float(p["plan"]["quote_total"])
check("reception records acceptance; installments created",
      s == 200 and p["plan"]["status"] == "accepted" and len(p["installments"]) == 3
      and abs(sum(float(i["amount"]) for i in p["installments"]) - total) < 0.01, p["installments"])
filling = next(i for i in p["items"] if i["tooth"] == 16)
s, p = dentist.req("POST", f"{TP}/items/{filling['id']}/done", {})
check("item done → ready to bill", s == 200 and next(i for i in p["items"] if i["id"] == filling["id"])["billing_status"] == "to_bill", p["items"])
_, ch = dentist.req("GET", f"/api/doctor/dental/chart/{mostafa}")
check("done work appears on the chart", any(x["tooth"] == 16 and x["condition"] == "filling" and x["status"] == "done" for x in ch["entries"]))
scal = next(i for i in p["items"] if i["tooth"] is None)
s, p = dentist.req("POST", f"{TP}/items/{scal['id']}/done", {})
check("plan completes when every item is done", s == 200 and p["plan"]["status"] == "completed", p["plan"]["status"])

_, plans = rc.req("GET", "/api/reception/dental/plans?state=expired")
expired = next(x for x in plans if x["patient_name_en"] == "Amr Khaled Nasr")
s, e = rc.req("POST", f"/api/reception/dental/plans/{expired['id']}/accept", {"signed_paper": True})
check("expired quotation can't be accepted", s == 409 and e["error"]["code"] == "quote_expired", e)

# patient portal: Omar accepts his son's plan
s, mine = pt.req("GET", "/api/patient/plans")
son = next((x for x in mine if x["patient_name_en"] == "Youssef Omar Youssef" and x["state"] == "quoted"), None)
check("parent sees the child's quotation in the portal (no internal notes)", s == 200 and son and "notes" not in son, mine)
s, mine = pt.req("POST", f"/api/patient/plans/{son['id']}/accept")
check("parent accepts online", s == 200 and next(x for x in mine if x["id"] == son["id"])["status"] == "accepted")

# ---------------- lab cases ----------------
_, labs = dentist.req("GET", "/api/doctor/dental/labs")
s, c = dentist.req("POST", "/api/doctor/dental/lab-cases", {"patient_id": mostafa, "lab_id": labs[0]["id"], "work_type": "emax_crown", "teeth": "11",
                                                          "shade": "A1", "lab_cost": 2100, "doctor_share_pct": 20})
check("lab case ordered", s == 201 and c["case"]["status"] == "ordered" and float(c["case"]["doctor_share"]) == 420, c)
LC = f"/api/reception/dental/lab-cases/{c['case']['id']}"
s, e = rc.req("POST", f"{LC}/move", {"to": "delivered"})
check("can't jump from ordered to delivered", s == 409, e)
s, e = rc.req("POST", f"{LC}/move", {"to": "sent"})
check("sending needs a due date", s == 422, e)
rc.req("POST", f"{LC}/move", {"to": "sent", "due_on": str(date.today() + timedelta(days=5))})
rc.req("POST", f"{LC}/move", {"to": "returned"})
s, e = rc.req("POST", f"{LC}/move", {"to": "remake"})
check("remake needs a reason", s == 422, e)
s, c2 = rc.req("POST", f"{LC}/move", {"to": "remake", "note": "Shade too light"})
check("remake recorded", s == 200 and c2["case"]["remake_count"] == 1, c2["case"])
rc.req("POST", f"{LC}/move", {"to": "sent", "note": "Re-sent with photo"})
rc.req("POST", f"{LC}/move", {"to": "returned"})
s, c3 = rc.req("POST", f"{LC}/move", {"to": "delivered"})
check("delivered, full history kept", s == 200 and c3["case"]["status"] == "delivered" and len(c3["events"]) == 7, c3["events"])

# ---------------- complaints ----------------
s, tk = rc.req("POST", "/api/reception/complaints", {"kind": "complaint", "channel": "in_person", "category": "waiting", "priority": "high",
                                                    "patient_id": mostafa, "subject": "Long wait at reception", "details": "Waited 30 minutes to pay."})
check("reception logs a complaint", s == 201 and tk["ticket"]["status"] == "open", tk)
TK = tk["ticket"]["id"]
_, staff = rel.req("GET", "/api/patient-relations/complaints/staff")
reception_id = next(x["id"] for x in staff if x["full_name_en"] == "Nourhan Adel")
s, e = rc.req("PATCH", f"/api/reception/complaints/{TK}", {"assigned_to": reception_id})
check("reception can't assign", s == 403, e)
s, t2 = rel.req("PATCH", f"/api/patient-relations/complaints/{TK}", {"assigned_to": reception_id, "comment": "Please call him back today."})
check("relations assigns and comments (moves to in progress)", s == 200 and t2["ticket"]["assigned_to"] == reception_id and t2["ticket"]["status"] == "in_progress", t2["ticket"])
s, e = rc.req("PATCH", f"/api/reception/complaints/{TK}", {"status": "resolved"})
check("resolving needs a resolution", s == 422, e)
s, t3 = rc.req("PATCH", f"/api/reception/complaints/{TK}", {"status": "resolved", "resolution": "Apologised; a second cashier now opens at peak hours."})
check("assignee resolves", s == 200 and t3["ticket"]["status"] == "resolved", t3["ticket"])
s, e = rc.req("PATCH", f"/api/reception/complaints/{TK}", {"status": "closed"})
check("only patient relations closes", s == 403, e)

s, mine = pt.req("POST", "/api/patient/requests", {"kind": "request", "category": "booking", "subject": "Evening laser slots",
                                                  "details": "Can I book laser after 8 pm?"})
check("patient sends a request from the portal", s == 201 and mine[0]["status"] == "open", mine[:1])
_, lst = rel.req("GET", "/api/patient-relations/complaints?state=unassigned")
check("it arrives in patient relations' unassigned list", any(x["subject"] == "Evening laser slots" for x in lst["items"]))
_, lst = rc.req("GET", "/api/reception/complaints")
check("reception only sees what they logged or own", all(x["created_by"] == lst["items"][0]["created_by"] or x["assigned_to"] for x in lst["items"]))

print(f"\nALL {check.passed()} CHECKS PASSED")
