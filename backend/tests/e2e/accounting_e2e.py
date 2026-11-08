"""End-to-end check of part 5B (accounting): automatic postings from billing, manual entries and reversals, expenses
with a receipt, transfers, card settlement, doctor payouts, month closing, the chart of accounts, reports and roles.

    python tests/e2e/accounting_e2e.py http://web:3000 <demo password>

Works on the demo data. It approves and pays one of last month's demo payouts, closes last month, reopens it and asks
for the close again, so the demo is left with a close waiting for management. Signing in sets up 2-step for the demo
accounts; to run it again, reset 2-step for those accounts first (never admin@)."""
import json
import sys
import urllib.error
import urllib.request
import uuid
from datetime import date, timedelta
from decimal import Decimal

sys.path.insert(0, __file__.rsplit("/", 1)[0])
from lib import C, check  # noqa: E402

C.BASE, C.DEMO = sys.argv[1], sys.argv[2]
acc, mgr, aud, cash, rc = C(), C(), C(), C(), C()
acc.login("accountant@demo.goldencare.local")
mgr.login("owner@demo.goldencare.local")
aud.login("auditor@demo.goldencare.local")
cash.login("cashier@demo.goldencare.local")
rc.login("reception@demo.goldencare.local")
A, M, AU, B = "/api/accountant/accounting", "/api/management/accounting", "/api/auditor/accounting", "/api/cashier/billing"
today = date.today()
this_month = today.replace(day=1)
last_month = (this_month - timedelta(days=1)).replace(day=1)
D = Decimal


def multipart(client, path, fields, file=None):
    boundary = uuid.uuid4().hex
    parts = []
    for k, v in fields.items():
        parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode())
    if file:
        name, data, mime = file
        parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{name}"\r\nContent-Type: {mime}\r\n\r\n'.encode()
                     + data + b"\r\n")
    body = b"".join(parts) + f"--{boundary}--\r\n".encode()
    r = urllib.request.Request(C.BASE + path, data=body, method="POST", headers={
        "Content-Type": f"multipart/form-data; boundary={boundary}", "X-Requested-With": "GoldenCare", "Cookie": client.cookie,
        "Accept": "application/json"})
    try:
        resp = urllib.request.urlopen(r)
        return resp.status, json.loads(resp.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"null")


def balanced():
    _, tb = acc.req("GET", f"{A}/reports/trial-balance")
    return D(str(tb["debit"])) == D(str(tb["credit"])), tb


def reconciled():
    _, ov = acc.req("GET", f"{A}/overview")
    return all(D(str(c["ledger"])) == D(str(c["records"])) for c in ov["checks"]), ov["checks"]


# ---------------- the books as seeded ----------------
s, ov = acc.req("GET", f"{A}/overview")
check("accountant opens the overview", s == 200 and ov["money"] and len(ov["months"]) == 6, ov)
ok, tb = balanced()
check("trial balance: debits equal credits", ok, (tb["debit"], tb["credit"]))
ok, checks = reconciled()
check("receivables and patient credit equal the billing records", ok, checks)
_, opts = acc.req("GET", f"{A}/options")
K = {a["system_key"]: a["id"] for a in opts["accounts"] if a["system_key"]}
CODE = {a["code"]: a["id"] for a in opts["accounts"]}
_, j = acc.req("GET", f"{A}/journal?group=billing")
check("billing is in the journal (invoices, receipts, shifts …)", j["total"] > 50 and {x["source_type"] for x in j["items"]} & {"invoice", "receipt"}, j["total"])

# ---------------- roles ----------------
s, _ = aud.req("GET", f"{AU}/reports/pnl")
check("auditor reads the reports", s == 200)
s, e = aud.req("POST", f"{AU}/journal", {"entry_date": str(today), "memo": "Auditor tries", "lines": []})
check("auditor can't post", s == 403, e)
s, e = mgr.req("POST", f"{M}/journal", {"entry_date": str(today), "memo": "Management tries to post",
                                         "lines": [{"account_id": K["bank"], "debit": 1}, {"account_id": K["capital"], "credit": 1}]})
check("management can't post entries", s == 403, e)
s, e = mgr.req("POST", f"{M}/accounts", {"code": "5999", "name_ar": "تجربة", "name_en": "Test", "type": "expense"})
check("management can't change the chart", s == 403, e)
s, _ = rc.req("GET", "/api/reception/accounting/overview")
check("reception has no accounting", s == 404, s)

# ---------------- manual entries ----------------
E = f"{A}/journal"
s, e = acc.req("POST", E, {"entry_date": str(today), "memo": "Doesn't balance",
                           "lines": [{"account_id": K["bank"], "debit": 100}, {"account_id": K["capital"], "credit": 90}]})
check("unbalanced entry refused", s == 422 and e["error"]["code"] == "unbalanced", e)
s, e = acc.req("POST", E, {"entry_date": str(today), "memo": "Touching receivables",
                           "lines": [{"account_id": K["receivables"], "debit": 100}, {"account_id": K["capital"], "credit": 100}]})
check("patient balances can't be posted by hand", s == 422 and e["error"]["fields"].get("lines.0") == "controlled", e)
s, e = acc.req("POST", E, {"entry_date": str(today + timedelta(days=2)), "memo": "Future entry",
                           "lines": [{"account_id": K["bank"], "debit": 1}, {"account_id": K["capital"], "credit": 1}]})
check("no entries dated in the future", s == 422 and "entry_date" in e["error"]["fields"], e)
s, en = acc.req("POST", E, {"entry_date": str(today), "memo": "Owner adds working capital",
                            "lines": [{"account_id": K["bank"], "debit": "25000.00"}, {"account_id": K["capital"], "credit": "25000.00"}]})
check("balanced manual entry posted", s == 201 and en["ref"].startswith("JE-") and en["amount"] == 25000 and len(en["lines"]) == 2, en)
s, rv = acc.req("POST", f"{E}/{en['id']}/reverse", {"reason": "Entered twice by mistake"})
check("reversal posts the mirror entry", s == 201 and rv["reverses_id"] == en["id"]
      and rv["lines"][0]["credit"] == en["lines"][0]["debit"], rv)
s, e = acc.req("POST", f"{E}/{en['id']}/reverse", {"reason": "Again"})
check("an entry is reversed once", s == 409 and e["error"]["code"] == "already_reversed", e)
s, e = acc.req("POST", f"{E}/{j['items'][0]['id']}/reverse", {"reason": "Not mine to reverse"})
check("automatic entries can't be reversed by hand", s == 409 and e["error"]["code"] == "not_manual", e)

# ---------------- expenses ----------------
X = f"{A}/expenses"
pdf = b"%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n"
fields = {"spent_on": str(today), "account_id": CODE["5220"], "paid_from_id": K["bank"], "amount": "1850.00",
          "description": "Dressings and sterile drapes", "payee": "El-Nour Medical Supplies", "reference": "INV 4471"}
s, e = multipart(acc, X, {**fields, "paid_from_id": K["cash_drawer"]})
check("expenses aren't paid from the cashier's drawer", s == 422 and e["error"]["fields"].get("paid_from_id") == "not_allowed", e)
s, e = multipart(acc, X, {**fields, "account_id": K["doctor_fees"]})
check("automatic categories can't be picked", s == 422 and e["error"]["fields"].get("account_id") == "not_expense", e)
s, e = multipart(acc, X, fields, ("receipt.txt", b"hello", "text/plain"))
check("only PDF / JPG / PNG receipts", s == 422 and e["error"]["fields"].get("file") == "unsupported_type", e)
s, ex = multipart(acc, X, fields, ("receipt.pdf", pdf, "application/pdf"))
check("expense with its receipt posted", s == 201 and ex["ref"].startswith("EX-") and ex["file_name"] == "receipt.pdf", ex)
s, lst = acc.req("GET", f"{X}?q={ex['ref']}")
row = lst["items"][0]
check("expense listed with its journal entry", row["entry_id"] and row["status"] == "posted", row)
_, je = acc.req("GET", f"{E}/{row['entry_id']}")
check("expense entry: Dr supplies, Cr bank", {(l["code"], l["debit"] > 0) for l in je["lines"]} == {("5220", True), ("1120", False)}, je["lines"])
r = urllib.request.Request(C.BASE + f"{AU}/expenses/{ex['id']}/attachment", headers={"Cookie": aud.cookie})
check("auditor opens the receipt", urllib.request.urlopen(r).read().startswith(b"%PDF"))
s, v = acc.req("POST", f"{X}/{ex['id']}/void", {"reason": "Supplier sent a credit note"})
check("expense voided", s == 200 and v["status"] == "void", v)
_, j2 = acc.req("GET", f"{E}?q={ex['ref']}")
check("void posted a reversal", {x["source_type"] for x in j2["items"]} == {"expense", "expense_void"}, j2["items"])

# ---------------- transfers ----------------
T = f"{A}/transfers"
s, e = acc.req("POST", T, {"moved_on": str(today), "from_id": K["petty_cash"], "to_id": K["bank"], "amount": 999999})
check("can't move more than the account holds", s == 409 and e["error"]["code"] == "insufficient_balance", e)
s, e = acc.req("POST", T, {"moved_on": str(today), "from_id": K["card_clearing"], "to_id": K["bank"], "amount": 10})
check("card money reaches the bank through a settlement", s == 422 and e["error"]["fields"].get("from_id") == "not_allowed", e)
s, tr = acc.req("POST", T, {"moved_on": str(today), "from_id": K["bank"], "to_id": K["petty_cash"], "amount": 3000, "reference": "CHQ 100245"})
check("petty cash topped up from the bank", s == 201 and tr["ref"].startswith("TR-"), tr)

# ---------------- billing → journal → settlement ----------------
_, cat = rc.req("GET", "/api/reception/settings/catalog")
svc = {x["code"]: x["id"] for x in cat["services"]}
_, docs = rc.req("GET", "/api/reception/settings/doctors")
dr = {x["email"].split("@")[0]: x["id"] for x in docs}
patient = rc.req("GET", "/api/reception/patients?q=Mostafa Ibrahim")[1]["items"][0]["id"]
_, sh = cash.req("GET", f"{B}/shift")
if not sh["shift"]:
    cash.req("POST", f"{B}/shift/open", {"opening_float": 500})
_, inv = cash.req("POST", f"{B}/invoices", {"patient_id": patient})
I = f"{B}/invoices/{inv['invoice']['id']}"
cash.req("PUT", I, {"lines": [{"kind": "service", "service_id": svc["DRM-CONS"], "doctor_id": dr["dr.derm"], "qty": 1}], "discount_amount": 0})
_, d = cash.req("POST", f"{I}/issue", {})
total = d["invoice"]["total"]
s, rcp = cash.req("POST", f"{B}/payments", {"patient_id": patient, "invoice_id": inv["invoice"]["id"],
                                           "payments": [{"method": "card", "amount": total, "reference": "POS-E2E-1"}]})
check("cashier bills and takes a card payment", s == 201, rcp)
_, j3 = acc.req("GET", f"{E}?q={d['invoice']['ref']}")
types = {x["source_type"] for x in j3["items"]}
check("invoice and receipt posted on the next read", {"invoice", "receipt"} <= types, j3["items"])
inv_entry = next(x for x in j3["items"] if x["source_type"] == "invoice")
_, je = acc.req("GET", f"{E}/{inv_entry['id']}")
fee_line = next((l for l in je["lines"] if l["code"] == "5100"), None)
check("invoice entry carries the doctor's share and the service", fee_line and fee_line["doctor_id"] == dr["dr.derm"]
      and any(l["code"] == "4100" and l["service_id"] == svc["DRM-CONS"] for l in je["lines"]), je["lines"])
_, un = acc.req("GET", f"{A}/settlements/unsettled")
mine = [x for x in un["items"] if x["receipt_ref"] == rcp["ref"]]
check("the card payment waits to be settled", len(mine) == 1, un["totals"])
s, st = acc.req("POST", f"{A}/settlements", {"method": "card", "moved_on": str(today), "to_id": K["bank"], "payment_ids": [mine[0]["id"]],
                                             "fee": "2.50", "reference": "POS batch E2E"})
check("card settlement into the bank with the fee", s == 201 and st["kind"] == "settlement" and st["fee"] == 2.5, st)
s, e = acc.req("POST", f"{A}/settlements", {"method": "card", "moved_on": str(today), "to_id": K["bank"], "payment_ids": [mine[0]["id"]]})
check("a payment is settled once", s == 409 and e["error"]["code"] == "already_settled", e)
_, sh = cash.req("GET", f"{B}/shift")
cash.req("POST", f"{B}/shift/close", {"counted_cash": sh["shift"]["expected_cash"]})

# ---------------- doctor payouts ----------------
P = f"{A}/payouts"
_, po = acc.req("GET", f"{P}?month={last_month}")
prepared = [x for x in po["items"] if x["status"] == "prepared"]
check("last month's payouts are prepared", len(prepared) >= 2 and po["due"], po)
first, second = prepared[0], prepared[1]
_, stmt = acc.req("GET", f"{P}/statement?doctor_id={first['doctor_id']}&month={last_month}")
check("statement: shares − lab work = net", D(str(stmt["shares"])) - D(str(stmt["lab_deduction"])) == D(str(stmt["net"])) == D(str(first["net"])), stmt)
s, e = acc.req("POST", P, {"doctor_id": first["doctor_id"], "month": str(last_month)})
check("one payout per doctor and month", s == 409 and e["error"]["code"] == "payout_exists", e)
s, e = acc.req("POST", P, {"doctor_id": first["doctor_id"], "month": str(this_month)})
check("this month can't be paid out yet", s == 409 and e["error"]["code"] == "month_not_ended", e)
s, e = acc.req("POST", f"{P}/{first['id']}/decide", {"approve": True})
check("the accountant doesn't approve payouts", s == 403, e)
s, e = acc.req("POST", f"{P}/{first['id']}/pay", {"paid_on": str(today), "paid_from_id": K["bank"]})
check("not paid before approval", s == 409 and e["error"]["code"] == "payout_not_approved", e)
s, e = mgr.req("POST", f"{M}/payouts/{second['id']}/decide", {"approve": False})
check("rejecting needs a note", s == 422, e)
s, r2 = mgr.req("POST", f"{M}/payouts/{second['id']}/decide", {"approve": False, "note": "Check the voided invoice first"})
check("management rejects one", s == 200 and r2["status"] == "rejected", r2)
s, again = acc.req("POST", P, {"doctor_id": second["doctor_id"], "month": str(last_month), "note": "Checked again"})
check("a rejected payout can be prepared again", s == 201 and again["status"] == "prepared", again)
s, a1 = mgr.req("POST", f"{M}/payouts/{first['id']}/decide", {"approve": True, "note": "OK"})
check("management approves one", s == 200 and a1["status"] == "approved", a1)
_, before = acc.req("GET", f"{A}/reports/ledger?account_id={K['doctors_payable']}&date_from={last_month}")
s, paid = acc.req("POST", f"{P}/{first['id']}/pay", {"paid_on": str(today), "paid_from_id": K["bank"], "reference": "Transfer 9001"})
check("approved payout paid from the bank", s == 200 and paid["status"] == "paid", paid)
_, after = acc.req("GET", f"{A}/reports/ledger?account_id={K['doctors_payable']}&date_from={last_month}")
check("doctors payable goes down by the shares", round(D(str(before["closing"])) - D(str(after["closing"])), 2) == D(str(first["shares"])),
      (before["closing"], after["closing"], first["shares"]))

# ---------------- month closing ----------------
PR = f"{A}/periods"
_, per = acc.req("GET", PR)
lm = next(m for m in per["months"] if m["month"] == str(last_month))
check("last month waits for management", lm["status"] == "close_requested", lm)
s, e = acc.req("POST", f"{PR}/{this_month}/request", {})
check("the current month can't be closed", s == 409 and e["error"]["code"] == "month_not_ended", e)
s, e = acc.req("POST", f"{PR}/{last_month}/decide", {"approve": True})
check("the accountant can't approve the close", s == 403, e)
s, c = mgr.req("POST", f"{M}/periods/{last_month}/decide", {"approve": True, "note": "Reviewed P&L and payouts"})
check("management closes last month", s == 200 and c["status"] == "closed", c)
s, e = acc.req("POST", E, {"entry_date": str(last_month + timedelta(days=10)), "memo": "Late accrual",
                           "lines": [{"account_id": CODE["5200"], "debit": 100}, {"account_id": K["bank"], "credit": 100}]})
check("nothing is posted in a closed month", s == 409 and e["error"]["code"] == "period_closed", e)
s, e = multipart(acc, X, {**fields, "spent_on": str(last_month + timedelta(days=3))})
check("no expenses dated in a closed month", s == 409 and e["error"]["code"] == "period_closed", e)
s, e = mgr.req("POST", f"{M}/periods/{last_month}/reopen", {"reason": "x"})
check("reopening needs a reason", s == 422, e)
s, ro = mgr.req("POST", f"{M}/periods/{last_month}/reopen", {"reason": "Lab invoice for October arrived late"})
check("management reopens the last closed month", s == 200 and ro["status"] == "open", ro)
s, rq = acc.req("POST", f"{PR}/{last_month}/request", {"note": "Lab invoice entered"})
check("accountant asks for the close again", s == 200 and rq["status"] == "close_requested", rq)

# ---------------- chart of accounts ----------------
AC = f"{A}/accounts"
code = str(5270 + (int(uuid.uuid4().hex[:4], 16) % 20))
s, na = acc.req("POST", AC, {"code": code, "name_ar": "نظافة", "name_en": "Cleaning", "type": "expense"})
if s == 422 and na["error"]["fields"].get("code") == "taken":
    s, na = 201, next(a for a in acc.req("GET", AC)[1] if a["code"] == code)
check("accountant adds an expense category", s == 201 and na["code"] == code, na)
s, e = acc.req("POST", AC, {"code": "1120", "name_ar": "بنك", "name_en": "Bank 2", "type": "asset"})
check("account codes are unique", s == 422 and e["error"]["fields"].get("code") == "taken", e)
bank = next(a for a in acc.req("GET", AC)[1] if a["id"] == K["bank"])
s, e = acc.req("PUT", f"{AC}/{K['bank']}", {**{k: bank[k] for k in ("code", "name_ar", "name_en", "type", "is_money", "description")}, "is_active": False})
check("system accounts can't be switched off", s == 409 and e["error"]["code"] == "system_account", e)
s, rn = acc.req("PUT", f"{AC}/{K['bank']}", {**{k: bank[k] for k in ("code", "name_ar", "type", "is_money", "description")},
                                            "name_en": "Bank — Banque Misr", "is_active": True})
check("…but can be renamed", s == 200 and rn["name_en"] == "Bank — Banque Misr", rn)
acc.req("PUT", f"{AC}/{K['bank']}", {**{k: bank[k] for k in ("code", "name_ar", "name_en", "type", "is_money", "description")}, "is_active": True})

# ---------------- reports ----------------
for name, query in (("pnl", f"date_from={last_month}"), ("trial-balance", ""), ("ledger", f"account_id={K['bank']}&date_from={last_month}"),
                    ("daily-cash", ""), ("income", "by=doctor"), ("income", "by=specialty"), ("income", "by=branch"), ("aging", ""),
                    ("credit", ""), ("vat", "")):
    s, rp = mgr.req("GET", f"{M}/reports/{name}?{query}")
    check(f"report {name} {query}".strip(), s == 200, rp)
_, pnl = acc.req("GET", f"{A}/reports/pnl?date_from={last_month}")
check("P&L adds up", D(str(pnl["total_income"])) - D(str(pnl["total_expenses"])) == D(str(pnl["net"])), pnl)
_, led = acc.req("GET", f"{A}/reports/ledger?account_id={K['bank']}&date_from={last_month - timedelta(days=40)}")
bank_bal = next(a for a in acc.req("GET", AC)[1] if a["id"] == K["bank"])["balance"]
check("bank ledger closes at the account balance", D(str(led["closing"])) == D(str(bank_bal)), (led["closing"], bank_bal))
_, inc = acc.req("GET", f"{A}/reports/income?by=service&date_from={last_month}")
check("income by service = service + package income in the P&L",
      D(str(inc["total"]["income"])) == sum(D(str(r["amount"])) for r in pnl["income"] if r["code"] in ("4100", "4200")), (inc["total"], pnl["income"]))
ok, tb = balanced()
check("still balanced after everything", ok, (tb["debit"], tb["credit"]))
ok, checks = reconciled()
check("still reconciled with billing", ok, checks)

print(f"\n{check.passed()} checks passed")
