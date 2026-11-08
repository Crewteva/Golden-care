"""End-to-end check of part 5A (billing, payments, cashier shifts, approvals, refunds, packages).

    python tests/e2e/billing_e2e.py http://web:3000 <demo password>

Works on the demo data and leaves realistic records behind (issued invoices and receipts can't be deleted).
Signing in sets up 2-step for the demo accounts; to run it again, reset 2-step for those accounts first (never admin@)."""
import sys
from datetime import date, datetime, timedelta, timezone

sys.path.insert(0, __file__.rsplit("/", 1)[0])
from lib import C, check  # noqa: E402

C.BASE, C.DEMO = sys.argv[1], sys.argv[2]
rc, cash, mgr, acc, pt = C(), C(), C(), C(), C()
rc.login("reception@demo.goldencare.local")
cash.login("cashier@demo.goldencare.local")
mgr.login("owner@demo.goldencare.local")
acc.login("accountant@demo.goldencare.local")
pt.login("01001110001")
B, M = "/api/cashier/billing", "/api/management/billing"

_, cat = rc.req("GET", "/api/reception/settings/catalog")
svc = {x["code"]: x["id"] for x in cat["services"]}
_, docs = rc.req("GET", "/api/reception/settings/doctors")
D = {x["email"].split("@")[0]: x["id"] for x in docs}
mostafa = rc.req("GET", "/api/reception/patients?q=Mostafa Ibrahim")[1]["items"][0]["id"]


def visit(codes, doctor="dr.derm"):
    """Book a walk-in for Mostafa and mark them arrived: the cashier can bill from arrival on."""
    start = (datetime.now(timezone.utc) + timedelta(minutes=5)).replace(second=0, microsecond=0)
    s, a = rc.req("POST", "/api/reception/appointments", {"patient_id": mostafa, "doctor_id": D[doctor], "service_ids": [svc[c] for c in codes],
                                                          "source": "walk_in", "starts_at": start.isoformat(), "notes": None,
                                                          "overbook_reason": "Walk-in squeezed between patients"})
    assert s == 201, a
    rc.req("POST", f"/api/reception/appointments/{a['id']}/arrive")
    return a["id"]


# ---------------- shift ----------------
_, sh = cash.req("GET", f"{B}/shift")
if sh["shift"]:
    cash.req("POST", f"{B}/shift/close", {"counted_cash": sh["shift"]["expected_cash"]})
s, e = cash.req("POST", f"{B}/payments", {"patient_id": mostafa, "payments": [{"method": "cash", "amount": 100}]})
check("no payment without an open shift", s == 409 and e["error"]["code"] == "no_open_shift", e)
s, sh = cash.req("POST", f"{B}/shift/open", {"opening_float": 500})
check("cashier opens a shift with a float", s == 201 and sh["shift"]["status"] == "open", sh)
s, e = cash.req("POST", f"{B}/shift/open", {"opening_float": 500})
check("only one open shift per cashier", s == 409 and e["error"]["code"] == "shift_already_open", e)

# ---------------- invoice from a visit ----------------
appt = visit(["DRM-CONS", "DRM-PEEL"])
_, qd = cash.req("GET", f"{B}/queue")
check("arrived patient is in the cashier's queue as unbilled", any(x["id"] == appt and x["bill"] == "unbilled" for x in qd["items"]), qd["counts"])
s, inv = cash.req("POST", f"{B}/invoices", {"patient_id": mostafa, "appointment_id": appt})
I = f"{B}/invoices/{inv['invoice']['id']}"
sub0 = inv["invoice"]["subtotal"]
check("draft made from the appointment's services", s == 201 and inv["invoice"]["status"] == "draft" and len(inv["lines"]) == 2
      and sub0 == sum(l["unit_price"] * l["qty"] for l in inv["lines"]) > 0, inv["invoice"])
check("cashier doesn't see doctor shares", "doctor_share" not in inv["lines"][0] and not inv["can"]["shares"])
s, again = cash.req("POST", f"{B}/invoices", {"patient_id": mostafa, "appointment_id": appt})
check("billing the same visit again opens the same draft", again["invoice"]["id"] == inv["invoice"]["id"])
lines = [{"kind": l["kind"], "service_id": l["service_id"], "appointment_id": l["appointment_id"], "doctor_id": l["doctor_id"], "qty": l["qty"]}
         for l in inv["lines"]]
s, e = cash.req("PUT", I, {"lines": lines, "discount_amount": 100})
check("a discount needs a reason", s == 422 and "discount_reason" in e["error"]["fields"], e)
extra = {"kind": "service", "service_id": svc["DRM-FU"], "qty": 2, "doctor_id": D["dr.derm"]}
s, e = cash.req("PUT", I, {"lines": lines + [extra], "discount_amount": 99999, "discount_reason": "x test"})
check("discount can't be more than the subtotal", s == 422 and "discount_amount" in e["error"]["fields"], e)
s, d = cash.req("PUT", I, {"lines": lines + [extra], "discount_amount": 150, "discount_reason": "Regular patient"})
total1 = d["invoice"]["total"]
check("extra line priced by the server, discount within the limit", s == 200 and d["invoice"]["subtotal"] > sub0
      and total1 == d["invoice"]["subtotal"] - 150, d["invoice"])
s, d = cash.req("POST", f"{I}/issue", {})
check("issued straight away (under the 10% limit)", s == 200 and d["status"] == "issued" and d["invoice"]["ref"].startswith("INV-"), d)
s, e = cash.req("PUT", I, {"lines": lines, "discount_amount": 0})
check("issued invoice is locked", s == 409 and e["error"]["code"] == "record_locked", e)

# ---------------- payments ----------------
P = {"patient_id": mostafa, "invoice_id": inv["invoice"]["id"]}
s, e = cash.req("POST", f"{B}/payments", {**P, "payments": [{"method": "card", "amount": 400}]})
check("card payment needs the terminal reference", s == 422, e)
s, rcp = cash.req("POST", f"{B}/payments", {**P, "payments": [{"method": "cash", "amount": 1000}, {"method": "card", "amount": 400, "reference": "POS-77812"}]})
check("split payment: cash + card on one receipt", s == 201 and rcp["ref"].startswith("RC-") and rcp["applied"] == 1400, rcp)
_, d = cash.req("GET", I)
left = total1 - 1400
check("invoice partly paid", d["invoice"]["paid_total"] == 1400 and d["invoice"]["balance"] == left, d["invoice"])
s, rcp = cash.req("POST", f"{B}/payments", {**P, "payments": [{"method": "instapay", "amount": left + 300, "reference": "IP-99120"}]})
check("paying more than due: the rest goes to credit", s == 201 and rcp["applied"] == left and rcp["to_credit"] == 300, rcp)
s, e = cash.req("POST", f"{B}/payments", {**P, "payments": [{"method": "cash", "amount": 10}]})
check("can't pay a paid invoice", s == 409 and e["error"]["code"] == "invoice_paid", e)
_, acct = cash.req("GET", f"{B}/patient/{mostafa}")
credit = float(acct["credit_balance"])
check("credit shows on the patient account", credit >= 300, acct["credit_balance"])

# ---------------- package sold in installments, then used ----------------
_, opts = cash.req("GET", f"{B}/options")
pkg = next(p for p in opts["packages"] if p["service_id"] == svc["DRM-FU"])
s, pinv = cash.req("POST", f"{B}/invoices", {"patient_id": mostafa})
PI = f"{B}/invoices/{pinv['invoice']['id']}"
cash.req("PUT", PI, {"lines": [{"kind": "package_sale", "package_id": pkg["id"]}]})
s, e = cash.req("POST", f"{PI}/issue", {"installments": 15, "down_payment": 250})
check("installments over the clinic's maximum refused", s == 422 and e["error"]["fields"].get("installments") == "too_many", e)
s, d = cash.req("POST", f"{PI}/issue", {"installments": 2, "down_payment": 250, "first_due_on": (date.today() + timedelta(days=30)).isoformat()})
check("package sold: down payment + 2 monthly installments", s == 200 and len(d["installments"]) == 3 and d["installments"][0]["amount"] == 250, d)
s, rcp = cash.req("POST", f"{B}/payments", {"patient_id": mostafa, "invoice_id": pinv["invoice"]["id"], "payments": [{"method": "credit", "amount": 250}]})
check("down payment taken from credit", s == 201, rcp)
_, d = cash.req("GET", PI)
check("down payment marked paid, the rest still due", [i["state"] for i in d["installments"]] == ["paid", "due", "due"], d["installments"])
_, acct = cash.req("GET", f"{B}/patient/{mostafa}")
mine = next(p for p in acct["packages"] if p["package_id"] == pkg["id"] and p["state"] == "active")
check("package on the patient's account with all sessions left", mine["remaining"] == pkg["sessions"], mine)

appt2 = visit(["DRM-FU"])
s, inv2 = cash.req("POST", f"{B}/invoices", {"patient_id": mostafa, "appointment_id": appt2})
check("next visit uses a package session automatically (0 EGP)", inv2["lines"][0]["kind"] == "package_use" and inv2["invoice"]["total"] == 0,
      inv2["lines"])
s, d = cash.req("POST", f"{B}/invoices/{inv2['invoice']['id']}/issue", {})
check("package session invoice issued", s == 200 and d["status"] == "issued", d)
s, e = mgr.req("POST", f"{M}/invoices/{pinv['invoice']['id']}/void", {"reason": "Patient changed their mind"})
check("can't void a package sale once a session was used", s == 409 and e["error"]["code"] == "package_in_use", e)

# ---------------- approvals: big discount, void, refund ----------------
appt3 = visit(["DRM-CONS"])
_, inv3 = cash.req("POST", f"{B}/invoices", {"patient_id": mostafa, "appointment_id": appt3})
I3 = f"{B}/invoices/{inv3['invoice']['id']}"
l3 = [{"kind": l["kind"], "service_id": l["service_id"], "appointment_id": l["appointment_id"], "doctor_id": l["doctor_id"]} for l in inv3["lines"]]
cash.req("PUT", I3, {"lines": l3, "discount_amount": round(inv3["invoice"]["subtotal"] * 0.3), "discount_reason": "Staff family member"})
s, d = cash.req("POST", f"{I3}/issue", {})
check("30% discount waits for a manager", d["status"] == "pending_approval" and d["invoice"]["ref"] is None, d.get("status"))
s, e = cash.req("POST", f"{I3}/issue", {})
check("can't issue while waiting", s == 409, e)
_, ap = mgr.req("GET", f"{M}/approvals")
req = next(a for a in ap["items"] if a["invoice_id"] == inv3["invoice"]["id"])
s, e = mgr.req("POST", f"{M}/approvals/{req['id']}/decide", {"approve": False})
check("rejecting needs a note", s == 422, e)
mgr.req("POST", f"{M}/approvals/{req['id']}/decide", {"approve": True, "note": "OK this once"})
_, d = mgr.req("GET", f"{M}/invoices/{inv3['invoice']['id']}")
check("approved: invoice issued, issued by the cashier, approved by the manager",
      d["invoice"]["status"] == "issued" and d["invoice"]["discount_approved_by"] and d["invoice"]["issued_by"] != d["invoice"]["discount_approved_by"], d["invoice"])
check("manager sees the doctor share", "doctor_share" in d["lines"][0] and float(d["lines"][0]["doctor_share"]) > 0, d["lines"][0])
paid3 = d["invoice"]["total"]
cash.req("POST", f"{B}/payments", {"patient_id": mostafa, "invoice_id": inv3["invoice"]["id"], "payments": [{"method": "cash", "amount": paid3}]})

s, d = cash.req("POST", f"{I3}/void", {"reason": "Billed the wrong patient"})
check("cashier's void becomes a request", s == 200 and d["status"] == "pending_approval" and d["invoice"]["status"] == "issued", d.get("status"))
s, e = cash.req("POST", f"{I3}/void", {"reason": "Billed the wrong patient"})
check("asked once only", s == 409 and e["error"]["code"] == "already_requested", e)
_, ap = mgr.req("GET", f"{M}/approvals")
req = next(a for a in ap["items"] if a["invoice_id"] == inv3["invoice"]["id"] and a["kind"] == "void")
mgr.req("POST", f"{M}/approvals/{req['id']}/decide", {"approve": True})
_, d = mgr.req("GET", f"{M}/invoices/{inv3['invoice']['id']}")
_, acct = cash.req("GET", f"{B}/patient/{mostafa}")
check("void approved: invoice void, what was paid moved to credit", d["invoice"]["status"] == "void"
      and any(c["reason"] == "void" and c["amount"] == paid3 for c in acct["credit"]), d["invoice"]["status"])

bal = float(acct["credit_balance"])
s, e = cash.req("POST", f"{B}/refunds", {"patient_id": mostafa, "amount": bal + 1, "method": "cash", "reason": "Patient asked for it"})
check("refund can't exceed the credit", s == 422, e)
s, rf = cash.req("POST", f"{B}/refunds", {"patient_id": mostafa, "amount": 300, "method": "cash", "reason": "Patient asked for the overpayment"})
check("refund requested", s == 201 and rf["status"] == "requested", rf)
s, e = cash.req("POST", f"{B}/refunds/{rf['id']}/pay", {})
check("can't pay before approval", s == 409 and e["error"]["code"] == "refund_not_approved", e)
_, ap = mgr.req("GET", f"{M}/approvals")
req = next(a for a in ap["items"] if a["refund_id"] == rf["id"])
mgr.req("POST", f"{M}/approvals/{req['id']}/decide", {"approve": True})
s, _ = cash.req("POST", f"{B}/refunds/{rf['id']}/pay", {})
_, acct = cash.req("GET", f"{B}/patient/{mostafa}")
check("refund paid in cash, credit reduced", s == 200 and abs(float(acct["credit_balance"]) - (bal - 300)) < 0.01, acct["credit_balance"])

# ---------------- setup (management) ----------------
s, e = cash.req("POST", f"{B}/setup/packages", {"service_id": svc["DRM-CONS"], "name_ar": "تجربة", "name_en": "Test", "sessions": 2, "price": 900})
check("cashier can't change packages", s == 403, e)
s, np = mgr.req("POST", f"{M}/setup/packages", {"service_id": svc["DRM-CONS"], "name_ar": "استشارتان", "name_en": "Two consultations",
                                                "sessions": 2, "price": 950, "valid_days": 60})
check("manager adds a package", s == 201 and np["id"], np)
s, np = mgr.req("PUT", f"{M}/setup/packages/{np['id']}", {"service_id": svc["DRM-CONS"], "name_ar": "استشارتان", "name_en": "Two consultations",
                                                          "sessions": 2, "price": 990, "valid_days": 90})
check("manager edits it", s == 200 and np["price"] == 990, np)
s, _ = mgr.req("DELETE", f"{M}/setup/packages/{np['id']}")
check("unsold package deleted", s == 200)
s, e = mgr.req("DELETE", f"{M}/setup/packages/{pkg['id']}")
check("sold package can't be deleted (archive instead)", s == 409 and e["error"]["code"] == "in_use", e)
s, sr = mgr.req("GET", f"{M}/setup/shares")
check("share rules listed", s == 200 and len(sr["rules"]) >= 3, sr)

# ---------------- other roles ----------------
s, ls = acc.req("GET", "/api/accountant/billing/invoices?unpaid=true&sort=balance")
check("accountant reads invoices with sums", s == 200 and "sums" in ls, ls)
s, e = acc.req("POST", "/api/accountant/billing/invoices", {"patient_id": mostafa})
check("accountant can't make invoices", s == 403, e)
s, portal = pt.req("GET", "/api/patient/billing")
check("patient sees their invoices, installments and package", s == 200 and portal["invoices"] and portal["packages"]
      and "price_paid" not in portal["packages"][0] and "doctor_share" not in portal["invoices"][0]["lines"][0], list(portal))

# ---------------- close the shift ----------------
_, sh = cash.req("GET", f"{B}/shift")
exp = float(sh["shift"]["expected_cash"])
check("expected cash = float + cash in − cash refunds", abs(exp - (500 + 1000 + paid3 - 300)) < 0.01, sh["shift"])
s, e = cash.req("POST", f"{B}/shift/close", {"counted_cash": exp - 20})
check("a difference needs a reason", s == 422 and "difference_reason" in e["error"]["fields"], e)
s, closed = cash.req("POST", f"{B}/shift/close", {"counted_cash": exp - 20, "difference_reason": "Gave change from my own wallet"})
check("shift closed with the difference recorded", s == 200 and closed["shift"]["status"] == "closed" and closed["shift"]["difference"] == -20,
      closed.get("shift"))
print(f"\n{check.passed()} checks passed")
