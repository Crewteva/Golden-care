"""End-to-end check of the doctor's visit (requirement 4A) against a running system with demo data.

    python tests/e2e/visits_e2e.py http://web:3000 <demo password>

Books a squeeze-in for Nadia Samir Fahmy (penicillin allergy) with the dentist today, takes her vitals, writes,
signs and releases the visit, and checks who may see what. The visit it creates stays (signed visits can't be
deleted), so its content is realistic. The medical director's demo account gets 2-step verification set up by
the script; reset it afterwards (admin → Staff → Reset 2-step) so people can sign in with their own phone."""
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, __file__.rsplit("/", 1)[0])
from lib import C, check  # noqa: E402

BASE, DEMO = sys.argv[1], sys.argv[2]
C.BASE, C.DEMO = BASE, DEMO

rc, nurse, doc, derm, md, pt = C(), C(), C(), C(), C(), C()
rc.login("reception@demo.goldencare.local")
nurse.login("nurse@demo.goldencare.local")
doc.login("dr.dental@demo.goldencare.local")
derm.login("dr.derm@demo.goldencare.local")
md.login("meddir@demo.goldencare.local")
pt.login("01001110001")

_, cat = rc.req("GET", "/api/reception/settings/catalog")
svc = {x["code"]: x["id"] for x in cat["services"]}
_, docs = rc.req("GET", "/api/reception/settings/doctors")
D = {x["email"].split("@")[0]: x["id"] for x in docs}
_, found = rc.req("GET", "/api/reception/patients?q=Nadia Samir")
nadia = found["items"][0]["id"]

# reception squeezes Nadia in with the dentist now, and checks her in
start = (datetime.now(timezone.utc) + timedelta(minutes=2)).replace(second=0, microsecond=0)
s, appt = rc.req("POST", "/api/reception/appointments", {
    "patient_id": nadia, "doctor_id": D["dr.dental"], "service_ids": [svc["DNT-CONS"]], "source": "walk_in",
    "starts_at": start.isoformat(), "overbook_reason": "Severe toothache, seen between patients", "notes": None})
check("reception books a squeeze-in", s == 201, appt)
s, appt = rc.req("POST", f"/api/reception/appointments/{appt['id']}/arrive")
check("patient checked in", s == 200 and appt["status"] == "arrived", appt)
AID = appt["id"]

# nurse: vitals
s, bad = nurse.req("POST", "/api/nurse/visits/vitals", {"appointment_id": AID, "bp_systolic": 130})
check("vitals: blood pressure needs both numbers", s == 422, bad)
s, empty = nurse.req("POST", "/api/nurse/visits/vitals", {"appointment_id": AID})
check("vitals: at least one value", s == 422 and empty["error"]["code"] == "vitals_empty", empty)
s, v = nurse.req("POST", "/api/nurse/visits/vitals", {"appointment_id": AID, "bp_systolic": 148, "bp_diastolic": 92, "pulse": 88,
                                                     "temperature": 37.1, "spo2": 98, "weight_kg": 71.5, "height_cm": 162})
check("nurse records vitals", s == 201 and v["bp_systolic"] == 148, v)
s, today = nurse.req("GET", "/api/nurse/visits/vitals/today")
check("nurse sees today's vitals", any(x["appointment_id"] == AID for x in today), today)

# doctor calls her in → the visit opens as a draft
s, called = doc.req("POST", f"/api/doctor/appointments/{AID}/call")
check("doctor calls in; visit opens", s == 200 and called["visit_id"] and called["visit_status"] == "draft", called)
VID = called["visit_id"]
V = f"/api/doctor/visits/{VID}"
s, visit = doc.req("GET", V)
check("visit shows alerts and vitals", s == 200 and any("Penicillin" in a["description"] for a in visit["alerts"])
      and visit["vitals"][0]["bp_systolic"] == 148 and visit["can"]["write"], visit)

# access: other doctor, nurse
s, e = derm.req("GET", f"/api/doctor/visits/{VID}")
check("another doctor can't open the visit", s == 403 and e["error"]["code"] == "not_your_visit", e)
s, e = nurse.req("GET", f"/api/nurse/visits/{VID}")
check("nurse can't read the visit note", s == 403, e)

# sign without content
s, e = doc.req("POST", f"{V}/sign")
check("can't sign an empty visit", s == 422 and e["error"]["code"] == "visit_incomplete" and "diagnoses" in e["error"]["fields"], e)

# diagnosis search + note
_, dx = doc.req("GET", "/api/doctor/visits/lists/diagnoses?q=abscess")
abscess = next(d for d in dx if d["name_en"] == "Periapical abscess")
s, _ = doc.req("PUT", V, {
    "complaint": "Throbbing pain lower left for 3 days, worse at night", "history": "Hypertension on amlodipine.",
    "examination": "Deep caries 36 with buccal swelling, tender to percussion. BP 148/92 noted.",
    "diagnoses": [{"diagnosis_id": abscess["id"], "text": "tooth 36"}], "plan": "Drain via access cavity today, antibiotic, root canal 36 next week.",
    "follow_up_days": 5, "follow_up_note": "Start root canal 36", "patient_summary": None})
check("doctor saves the note", s == 200)

# prescription: allergy and restricted checks
_, drugs = doc.req("GET", f"/api/doctor/visits/lists/drugs?q=&patient_id={nadia}")
by = {d["name"]: d for d in drugs}
_, more = doc.req("GET", f"/api/doctor/visits/lists/drugs?q=augmentin&patient_id={nadia}")
aug = more[0]
check("drug search flags the penicillin allergy", aug["allergy_alert"] and "Penicillin" in aug["allergy_alert"], aug)
item = lambda d, **kw: {"drug_id": d["id"], "dose": d["default_dose"] or "1", "frequency": d["default_frequency"] or "daily",
                        "duration": d["default_duration"] or "5 days", **kw}
s, e = doc.req("PUT", f"{V}/rx", {"items": [item(aug)]})
check("allergy conflict refused without a reason", s == 409 and e["error"]["code"] == "allergy_conflict", e)
_, tr = doc.req("GET", "/api/doctor/visits/lists/drugs?q=tramal")
s, e = doc.req("PUT", f"{V}/rx", {"items": [item(tr[0])]})
check("restricted drug refused without a reason", s == 409 and e["error"]["code"] == "restricted_reason_required", e)
_, zi = doc.req("GET", "/api/doctor/visits/lists/drugs?q=zithromax")
_, ca = doc.req("GET", "/api/doctor/visits/lists/drugs?q=cataflam")
s, r = doc.req("PUT", f"{V}/rx", {"items": [item(zi[0], instructions="قبل الأكل بساعة"), item(ca[0], instructions="بعد الأكل عند الألم")]})
check("prescription saved (azithromycin instead of penicillin)", s == 200 and len(r["rx"]) == 2, r)

# sign → locked, appointment finished
s, signed = doc.req("POST", f"{V}/sign")
check("visit signed", s == 200 and signed["visit"]["status"] == "signed" and signed["appointment"]["status"] == "completed", signed)
s, e = doc.req("PUT", V, {"complaint": "changed", "diagnoses": []})
check("signed visit can't be edited", s == 409 and e["error"]["code"] == "visit_locked", e)
s, e = doc.req("PUT", f"{V}/rx", {"items": []})
check("signed prescription can't be changed", s == 409, e)

# addendum, release
s, d = doc.req("POST", f"{V}/addenda", {"body": "Patient called: swelling less this evening. Continue the same plan."})
check("addendum added under the signed visit", s == 201 and len(d["addenda"]) == 1, d)
s, e = doc.req("POST", f"{V}/release", {"patient_summary": "short"})
check("release needs a real summary", s == 422, e)
s, d = doc.req("POST", f"{V}/release", {"patient_summary": "عندك خراج في الضرس. خذي المضاد الحيوي ٣ أيام والمسكن عند الألم، وسنبدأ علاج العصب بعد ٥ أيام."})
check("doctor releases the summary", s == 200 and d["visit"]["released_at"], d)
s, e = doc.req("POST", f"{V}/release", {"patient_summary": "again and again"})
check("can't release twice", s == 409, e)

# medical director reads it; the reading is logged
s, d = md.req("GET", f"/api/medical-director/visits/{VID}")
check("medical director reads every visit", s == 200 and not d["can"]["write"] and d["can"]["addendum"], d)
s, lst = md.req("GET", "/api/medical-director/visits?state=released")
check("medical director's visit list", s == 200 and lst["total"] >= 1, lst)

# reception: follow-up appears, with no medical content
s, fu = rc.req("GET", "/api/reception/visits/follow-ups")
mine = [f for f in fu if f["visit_id"] == VID]
check("follow-up shows for reception", s == 200 and mine and "examination" not in mine[0] and "complaint" not in mine[0], fu)
s, e = rc.req("GET", f"/api/reception/visits/{VID}")
check("reception can't read visits", s == 403, e)

# patient portal: Omar sees his released visits, never the notes, never Nadia's
s, pv = pt.req("GET", "/api/patient/visits")
check("patient sees released visits only", s == 200 and pv and all(v["patient_summary"] for v in pv)
      and not any("complaint" in v or "examination" in v or "plan" in v for v in pv), pv[:1])
check("patient doesn't see another patient's visit", all(v["id"] != VID for v in pv))
s, e = pt.req("GET", f"/api/patient/visits/{VID}")
check("patient can't open another patient's visit", s == 404, e)
s, one = pt.req("GET", f"/api/patient/visits/{pv[0]['id']}")
check("patient prescription for printing", s == 200 and "rx" in one and "allergies" in one, one)

# the doctor's own list
s, ml = doc.req("GET", "/api/doctor/visits?mine=true")
check("doctor's visit list is theirs only", s == 200 and all(v["doctor_id"] == D["dr.dental"] for v in ml["items"]), ml["counts"])

print(f"\nALL {check.passed()} CHECKS PASSED")
