# Golden Care OS — Demo & Test Guide

How to try every finished requirement on the demo: what it covers, where to find it, the accounts to use,
and test cases with the expected result. A new section is added here each time a requirement is finished.

**Demo address:** https://golden-care-clinic.apps.crewteva.com
Add `?lang=en` to any address to see it in English; the language switch is in the top bar.

### The 11 requirements and where they stand

| Req. | Requirement | Status | Guide section |
|---|---|---|---|
| 1 | Logins, permissions & security | ✅ Done | 1 |
| 2 | Patient records | ✅ Done | 2 |
| 3 | Reception & appointments | ✅ Appointments done · ⏳ complaints & requests desk · ⏳ message monitor (with req. 10) | 4 |
| 4 | Doctor's work (clinical) | ⏳ Next | — |
| 5 | Billing, payments & cashier | ⏳ | — |
| 6 | Accounting & finance (built together with 5) | ⏳ | — |
| 7 | Stock, purchasing & medical devices | ⏳ | — |
| 8 | HR & salaries | ⏳ | — |
| 9 | Public website & marketing | ⏳ | — |
| 10 | Patient portal & automatic messages | ⏳ (portal basics done in 2 and 3) | — |
| 11 | Management dashboard & settings | ✅ Clinic settings done · ⏳ executive dashboard (built last) | 3 |

**Build order:** 1 + 2 → settings (11) → 3 → 4 → 5 + 6 → 7 → 9 + 10 → 8 → dashboard (11).

**Needed from the clinic before some features go live:** WhatsApp Business account with approved templates ·
phone-call provider · SMS provider · Paymob account · Tax Authority e-invoice credentials · social insurance
rates and income-tax brackets · doctor tax rates · purchase approval limits and VAT rules · package refund
policy · loyalty rules · end-of-service rules · KPI criteria.

---

## Demo accounts

All demo people are invented. Every demo account uses the **same demo password**. It's printed once in the
backend log on first start (`Demo password: …`) or set with the `DEMO_PASSWORD` variable. Ask the developer
for it; it's deliberately kept out of this file.

Staff sign in with their **e-mail**; patients sign in with their **mobile number**.

| Role | Sign in with | Name | 2-step code? | Use it to test |
|---|---|---|---|---|
| System admin | `admin@demo.goldencare.local` | Karim Mansour | Yes | Staff accounts, roles & permissions, cover, reset requests, branches, activity log |
| Management | `director@demo.goldencare.local` | Mona Abdelrahman | Yes | Services & prices, doctors & schedules, rooms, leave, booking rules, calendar |
| Management | `owner@demo.goldencare.local` | Dr. Hesham El-Masry | Yes | Same as above (second manager) |
| Medical director | `meddir@demo.goldencare.local` | Dr. Tarek Fawzy | Yes | Patient files, result review, doctors' schedules & leave, calendar |
| Reception | `reception@demo.goldencare.local` | Nourhan Adel | No | Patient files, today's board, booking, calendar |
| Patient relations | `relations@demo.goldencare.local` | Yasmin Khaled | No | Booking & calendar, patient files (view) |
| Doctor — dermatology & laser | `dr.derm@demo.goldencare.local` | Dr. Rania Samir | No | My day, own patients' files, review results |
| Doctor — dental | `dr.dental@demo.goldencare.local` | Dr. Ahmed El-Sherif | No | My day, own patients, demo leave |
| Doctor — gynecology | `dr.obgyn@demo.goldencare.local` | Dr. Nermeen Fathy | No | My day, own patients |
| Nurse | `nurse@demo.goldencare.local` | Aya Mostafa | No | Today's appointments, patient files, alerts, uploads |
| Cashier | `cashier@demo.goldencare.local` | Mahmoud Ibrahim | No | Today's appointments, price list |
| Accountant / HR / Inventory / Marketing / Auditor | `accountant@…`, `hr@…`, `inventory@…`, `marketing@…`, `auditor@…` (all `@demo.goldencare.local`) | — | Accountant, HR, auditor: yes | Sign-in and home page only for now; the auditor sees the activity log |
| **Patient** | mobile **`01001110001`** | Omar Youssef | No | Patient portal: appointments, online booking, results, family |

Notes
- **2-step code:** on the first sign-in, roles marked "Yes" are asked to scan a QR code with an authenticator app
  (Google Authenticator, Microsoft Authenticator, 1Password…). After that they enter a 6-digit code at every sign-in.
  `admin@demo` already has 2-step set up on the developer's phone. Ask the developer before using it.
- Omar's account also manages his son **Youssef Omar Youssef** (8 years old), so the portal shows a family member.
- The other ~30 demo patients have files but no portal account. Reception can give one (see 2.6).
- The real first admin `admin@goldencare.local` isn't a demo account; don't use it for testing.

---

## 1. Logins & permissions

**Covers:** one sign-in page for everyone that sends each person to their own dashboard; patient
self-registration; 2-step verification; account lock after wrong passwords; forced password change; staff
with several roles choose which role to work as; the admin manages staff, roles, permissions, temporary
cover and branches; and an activity log that nobody can edit.

**Where:** the sign-in page `/login`; admin → Staff, Roles & permissions, Temporary cover, Reset requests,
Branches, Activity log; everyone → **My account** (bottom of the sidebar).

### How to use
- **Add a staff member** (admin): Staff → *Add staff member* → name, e-mail, role(s), branch → save. The system
  shows a **temporary password** once. The person signs in with it and must choose a new one.
- **Change what a role may do** (admin): Roles & permissions → pick a role → tick/untick permissions → save.
  You can also switch "2-step required" on or off for each role there.
- **Temporary cover** (admin): give one person another person's role for a set period (e.g. holiday). It ends automatically.
- **Forgot password:** on the sign-in page → *Forgot password*. The request goes to the admin's *Reset requests*,
  where the admin issues a temporary password.

### Test cases

| # | Do this | Expected |
|---|---|---|
| 1.1 | Sign in as `reception@demo.goldencare.local` | Lands on the Reception dashboard; the sidebar shows only reception pages |
| 1.2 | Sign in as `01001110001` (patient) | Lands on the patient portal |
| 1.3 | Sign in as `director@demo.goldencare.local` | Asked for a 6-digit code (or to set up 2-step on the first sign-in) before entering |
| 1.4 | Enter a wrong 2-step code 5 times | Session ends and you're back on the sign-in page |
| 1.5 | Enter a wrong password 5 times for any demo account | "Account locked" for 15 minutes; the admin can unlock it from Staff → the person → *Unlock* |
| 1.6 | Register as a new patient (sign-in page → *Create account*) with a mobile not used before, age 16+ | Account created and you're signed in to the portal |
| 1.7 | Register with a mobile that already has an account | Refused: "mobile already registered" |
| 1.8 | Register with a weak password (e.g. `12345678`) | Refused with the reason (too short / too common / needs letters and numbers) |
| 1.9 | As admin, create a staff member, sign in as them with the temporary password | Forced to choose a new password before anything else |
| 1.10 | As admin, give a user two roles; sign in as that user | Asked which role to work as; *Switch role* in the sidebar changes it later |
| 1.11 | As reception, type `/dashboard/admin` in the address bar | Not allowed; sent back to reception's dashboard |
| 1.12 | As admin, untick a permission for Reception (e.g. *Register new patients*); sign in as reception | The matching button or page disappears |
| 1.13 | As admin, open Activity log | Every sign-in, failed attempt, lock and account change is listed with who/when/IP |
| 1.14 | My account → *Sign out other devices* | Other sessions of that account end |

---

## 2. Patient records

**Covers:** one file per person shared by all branches (file number `GC-000123`); duplicate protection;
families and guardians (children without a mobile); medical alerts; private documents with doctor review
before the patient sees a result; patient portal access; full change history.

**Where:** Reception / Nurse / Doctor / Medical director / Patient relations → **Patient files**;
Doctor / Medical director → **Awaiting review**; Patient → **Results & documents**, **My family**, **My profile**.

### How to use
- **New patient** (reception): Patient files → *New patient*. The national ID is optional; when typed, it fills in
  birth date, sex and governorate. The form warns while you type if a similar file exists.
- **Child without a mobile:** register the child with a *family link* to the parent marked as guardian.
- **Documents:** open a file → Documents → *Upload* (PDF/JPG/PNG, up to 15 MB). A doctor reviews lab results and reports,
  then either keeps them internal or **releases** them to the patient with a plain-language note.
- **Portal access** (reception): open a file → Patient account → *Create patient account* → a temporary password is shown once
  for the patient (needs a mobile and age 16+).

### Test cases

| # | Do this | Expected |
|---|---|---|
| 2.1 | Reception: search "nadia" or part of a mobile number | Finds Nadia Samir Fahmy; Arabic and English names both searchable |
| 2.2 | Open **Nadia Samir Fahmy** | Red critical alert banner: Penicillin allergy |
| 2.3 | New patient with the same national ID as an existing patient | Refused: national ID already used, with a link to the existing file |
| 2.4 | New patient with a mobile already used by someone else (not family) | Refused: "mobile in use" |
| 2.5 | New patient with the same name + birth date as an existing patient | Warning with the possible matches; can only continue by writing a reason |
| 2.6 | Open a patient without portal access (e.g. Sara Mohamed Abdallah) → *Create patient account* | Temporary password shown; the patient signs in with mobile + that password and must change it |
| 2.7 | Edit a patient's name, birth date, sex or national ID | A reason for the change is required; the file's *History* shows old → new value |
| 2.8 | Register a child with no mobile and no guardian link | Refused: needs a mobile or a guardian |
| 2.9 | Upload a `.docx` or a file larger than 15 MB | Refused (only PDF/JPG/PNG up to 15 MB) |
| 2.10 | Doctor `dr.derm`: **Awaiting review** | Lists pending results (e.g. Omar's dermatology report) |
| 2.11 | Release a result with a note | Patient Omar sees it under *Results & documents* with the note; unreleased ones stay hidden |
| 2.12 | Patient Omar → Results & documents | Sees his released CBC and his son's Vitamin D result, and his signed consent; **not** the pending report |
| 2.13 | Register online as a patient using the mobile + birth date of a file reception opened (no account yet) | The new account is linked to that existing file (no duplicate) |
| 2.14 | Doctor `dr.derm` → Patient files → open a patient who never booked with her | Not allowed: "not your patient" (see 4.12) |

---

## 3. Clinic settings

**Covers:** specialties, services (duration, room type), prices with start dates and optional per-doctor
prices, room types and rooms, doctor profiles and the services each doctor offers, weekly working hours,
doctor leave, public holidays, and a week view of who works when. Everything can be added, edited and
deleted, since the real lists aren't known yet.

**Where:** Management → Services & prices, Doctors & schedules, Week view, Rooms, Leave & holidays, Booking rules;
Medical director → Specialties & services, Doctors & schedules, Leave & holidays; Admin → Rooms;
Cashier → Price list (read-only); Reception / Nurse → Doctor schedules (read-only).

**Demo data:** 4 specialties (Dermatology & cosmetics, Laser, Dental, Obstetrics & gynecology), 21 services,
6 rooms, 3 doctors:

| Doctor | Works | Room |
|---|---|---|
| Dr. Rania Samir (dermatology & laser) | Sat, Mon, Wed 4–9 pm · Tue 12–5 pm | Clinic 1 · Laser room on Tue |
| Dr. Ahmed El-Sherif (dental) | Sun, Tue, Thu 3–10 pm · Sat 11 am–3 pm | Dental chair 1 (has demo leave for a conference) |
| Dr. Nermeen Fathy (gynecology) | Sun, Wed 5–9 pm | Clinic 2 (ultrasound) |

### How to use
- **Register a new doctor:** (1) the admin creates the staff account with role *Doctor* (see section 1);
  (2) Management → Doctors & schedules → open the doctor → set specialty and title, tick the services they offer,
  *Add hours* (day, from–to, room); (3) optional: their own price for a service under Services & prices.
- **Change a price:** Services & prices → a service's prices → *Add a price* with a start date. Today's price stays until then
  ("next price" is shown). Add a doctor to make it that doctor's own price.
- **Leave:** Leave & holidays → *Add leave* (doctor, from–to, reason). That doctor can't be booked on those days.

### Test cases

| # | Do this | Expected |
|---|---|---|
| 3.1 | Management → Services & prices | 21 services grouped by specialty with price and duration; Dermatology consultation shows a "next price" from next month |
| 3.2 | Add a new specialty and a service under it | Appears in the list, in booking and on the cashier's price list |
| 3.3 | Delete a service that has appointments | Refused with "in use" (the history stays correct); deactivating works |
| 3.4 | Dermatology consultation for Dr. Rania | 600 EGP (her own price) instead of the standard 500 EGP |
| 3.5 | Add weekly hours that overlap the same doctor's existing hours | Refused: "overlaps an existing schedule" |
| 3.6 | Give a second doctor the same room at the same time | Refused: "room busy" |
| 3.7 | Add leave with an end date before the start | Refused |
| 3.8 | Add leave for a doctor, then try booking them that day | No free times shown; booking refused "doctor on leave" |
| 3.9 | Week view | Every doctor's hours per day of the week, starting Saturday |
| 3.10 | Reception → Doctor schedules | Read-only, with no add/edit buttons |
| 3.11 | Cashier → Price list | Read-only prices |

---

## 4. Appointments

**Covers:** booking one or several services per visit for any doctor, with only truly free times offered;
double-booking made impossible (even when two receptionists click at the same moment); squeeze-ins with a
reason; today's board per doctor with check-in and queue numbers; the doctor's day (call in → finish);
reschedule, cancel and no-show with full history; calendar by day and week; patient online booking and
cancellation; booking rules set by Management.

**Where:**
- Reception / Patient relations → **Today's appointments**, **Book appointment**, **Calendar**
- Doctor → **My day** · Nurse / Cashier → **Today's appointments** (view) · Medical director / Management → **Calendar**
- Management → **Booking rules**
- Patient file (staff) → **Appointments** tab and *Book appointment* button
- Patient → **My appointments**, *Book a visit*; the next visit is shown on the portal home

**Demo data:** about 115 appointments from 4 days ago to 9 days ahead, in every state (completed, no-show,
cancelled, waiting, confirmed, booked, online requests) plus one squeeze-in today for Dr. Rania.

**Current booking rules (Management can change them):**

| Rule | Value |
|---|---|
| Free times are offered every | 15 minutes |
| A patient counts as late after | 15 minutes |
| Patients can book online | Yes, up to 30 days ahead |
| Online bookings need reception to confirm | No |
| Patients can cancel online up to | 12 hours before |
| Most upcoming visits one patient can have | 3 |

### How to use
- **Book** (reception): Book appointment → find the patient → pick the doctor → tick one or more services
  (time and price add up) → pick the day → pick a free time → save. Reference looks like `AP-000123`.
- **Squeeze-in:** on the booking page tick *Squeeze in outside the free times* → pick doctor, day, time and a reason (5+ characters).
  Only roles with the squeeze-in permission see it (reception by default).
- **Visit day:** reception clicks **Arrived** → the patient gets a queue number → the doctor clicks **Call in** →
  **Finish**. Click any appointment to open its panel: confirm, reschedule, cancel (with reason), mark no-show, notes, history.
- **Patient:** My appointments → *Book a visit* → who it's for (self or child) → service → day → time.

### Test cases

| # | Do this | Expected |
|---|---|---|
| 4.1 | Reception → Today's appointments | One column per working doctor; counts for all / not arrived / in clinic / done / cancelled |
| 4.2 | Click **Arrived** on a waiting patient | Toast with queue number (#1, #2… per doctor per day); card moves to "Arrived" |
| 4.3 | Try **Arrived** on an appointment on another day | Refused: arrival is for today only |
| 4.4 | A patient 15+ minutes past their time and not arrived | Red "Late N min" tag |
| 4.5 | Book Dermatology consultation + Chemical peel together | One visit of 65 minutes; price is the sum of both services |
| 4.6 | Book a time that is already taken (open two browser windows, book the same slot in both) | The second one is refused: "time just taken" |
| 4.7 | Try to book Dr. Ahmed on a leave day, a holiday, or outside his hours | No free times shown; "on leave / holiday / outside hours" |
| 4.8 | Squeeze-in with a 2-letter reason | Refused: reason too short |
| 4.9 | Squeeze-in with a proper reason | Booked and shown with a "Squeeze-in" tag |
| 4.10 | As relations@ (no squeeze-in permission) | The squeeze-in option isn't shown |
| 4.11 | Reschedule an appointment, then open its **History** | Shows booked → rescheduled (old time → new time, by whom) |
| 4.12 | Doctor `dr.dental` → My day → Patient files | Sees only patients who have appointments with him; opening another patient's file is refused |
| 4.13 | Doctor → **Call in** a patient while another is already in the room | Refused: "already with a patient" |
| 4.14 | **No-show** on a future appointment | Refused: "hasn't started yet" |
| 4.15 | Cancel an appointment | Reason required; it leaves the board count and the time becomes free again |
| 4.16 | Calendar → Day | Timeline per doctor with working hours shaded and a "now" line; click a block to open it |
| 4.17 | Calendar → Week | Visit counts per doctor per day; click a day to open it |
| 4.18 | Patient `01001110001` → *Book a visit* → for Youssef (son) | Only real free times shown; the booking appears under My appointments and on reception's board with an "Online" tag |
| 4.19 | Patient books past the limit of upcoming visits | Refused: "you already have the maximum number of upcoming visits" |
| 4.20 | Patient cancels a visit more than 12 hours away | Cancelled |
| 4.21 | Patient tries to cancel a visit less than 12 hours away | Refused: "too late to cancel online, call the clinic" |
| 4.22 | Management → Booking rules → tick *Online bookings need confirmation by reception*; patient books | Shows as "Requested"; reception sees "N online requests to confirm" and confirms it from the panel |
| 4.23 | Management → Booking rules → untick *Let patients book from their accounts* | Patient's *Book a visit* says "Online booking is off right now. Please call the clinic." |
| 4.24 | Doctor → My day | Own patients in queue order with Call in / Finish; no access to other doctors' visits |

**Tip:** after testing 4.22 and 4.23, put the booking rules back to the values in the table above.

---
