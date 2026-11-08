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
| 3 | Reception & appointments | ✅ Appointments · ✅ complaints & requests desk · ⏳ message monitor (with req. 10) | 4, 6 |
| 4 | Doctor's work (clinical) | ✅ Done (money links of plans and lab costs connect in req. 5–7) | 5, 6 |
| 5 | Billing, payments & cashier | ✅ Part A done (invoices, payments, shifts, packages, installments, approvals, refunds) · ⏳ Paymob online payment and Tax Authority e-receipts (need the clinic's accounts) | 7 |
| 6 | Accounting & finance (built together with 5) | ✅ Done (journal, expenses, cash & bank, doctor payouts, month close, reports) · ⏳ salaries post from HR (req. 8) | 8 |
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
| Management | `director@demo.goldencare.local` | Mona Abdelrahman | Yes | Services & prices, doctors & schedules, rooms, leave, booking rules, calendar, billing approvals & setup |
| Management | `owner@demo.goldencare.local` | Dr. Hesham El-Masry | Yes | Same as above (second manager) |
| Medical director | `meddir@demo.goldencare.local` | Dr. Tarek Fawzy | Yes | Patient files, result review, doctors' schedules & leave, calendar |
| Reception | `reception@demo.goldencare.local` | Nourhan Adel | No | Patient files, today's board, booking, calendar |
| Patient relations | `relations@demo.goldencare.local` | Yasmin Khaled | No | Booking & calendar, patient files (view) |
| Doctor — dermatology & laser | `dr.derm@demo.goldencare.local` | Dr. Rania Samir | No | My day, own patients' files, review results |
| Doctor — dental | `dr.dental@demo.goldencare.local` | Dr. Ahmed El-Sherif | No | My day, own patients, demo leave |
| Doctor — gynecology | `dr.obgyn@demo.goldencare.local` | Dr. Nermeen Fathy | No | My day, own patients |
| Nurse | `nurse@demo.goldencare.local` | Aya Mostafa | No | Today's appointments, patient files, alerts, uploads |
| Cashier | `cashier@demo.goldencare.local` | Mahmoud Ibrahim | No | Cashier desk, shifts, invoices, payments, refunds, price list |
| Accountant | `accountant@demo.goldencare.local` | Sherif Nabil | Yes | Accounting: journal, expenses, cash & bank, doctor payouts, month close, reports, chart of accounts; invoices, shifts & refunds (read-only) |
| Auditor | `auditor@demo.goldencare.local` | Amr Lotfy | Yes | Accounting and billing, read-only; the activity log |
| HR / Inventory / Marketing | `hr@…`, `inventory@…`, `marketing@…` (`@demo.goldencare.local`) | — | HR: yes | Sign-in and home page only for now |
| **Patient** | mobile **`01001110001`** | Omar Youssef | No | Patient portal: appointments, online booking, results, family, my bills |

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

## 5. Doctor's work, part A: visit record, vital signs, prescriptions (requirement 4)

**Covers:** vital signs taken by the nurse; the visit record (complaint, history, examination, diagnosis,
plan) that opens when the doctor calls the patient in; only the treating doctor can write or read it (plus
the medical director); the patient's alerts pinned at the top; diagnoses picked from a list (Arabic, English or
ICD-10 code) or typed; prescriptions picked from a drug list, with an allergy warning that needs a written
reason and extra rules for restricted medicines; a printable A5 prescription on the clinic letterhead;
signing locks the visit for good (corrections are dated addenda); the doctor releases a plain-language
summary + prescription to the patient; follow-ups the doctor asks for appear for reception to book.

**Where:**
- Nurse → **Vital signs** (today's arrived patients in queue order) · patient file → **Vital signs** tab
- Doctor → **My day** (*Call in* opens the visit) · **My visits** (drafts / not released / released) · patient file → **Visits** tab
- Medical director → **Visits** (every doctor) · **Drugs & diagnoses** (edit the lists)
- Reception / Patient relations → **Follow-ups due**
- Patient → **My visits** (summary + prescription, *Print prescription*)

**Demo data:** 29 signed visits from the past completed appointments (19 released), 59 drugs (5 restricted:
Tramal, Lyrica, Xanax, Acnotin, Clomid) and 42 diagnoses. All lists are a starter set to be replaced by the clinic.
Useful patients: **Nadia Samir Fahmy** (penicillin allergy, critical) · **Sara Mohamed Abdallah** (lidocaine allergy) ·
**Mahmoud Ali Hassan** (on warfarin) · **Omar Youssef** and his son **Youssef** (portal account).

### How to use
1. Reception books the patient and clicks **Arrived**.
2. Nurse → Vital signs → **Record** (blood pressure, pulse, temperature, SpO₂, weight, height…). Values outside the usual
   range show in red. A mistake is fixed by recording again (readings are never edited).
3. Doctor → My day → **Call next**: the visit opens. Write the note; it saves itself every second or so (“Draft saved”).
4. Diagnosis: type “abscess”, “تسوس” or “K04” and pick; or type your own text and choose *Add as free text*. The first is the main one.
5. Prescription: type a drug name → pick → dose / how often / how long are pre-filled; add instructions for the patient.
6. **Sign & finish visit** → confirm. The visit is locked and the appointment is finished.
7. Write the **summary for the patient** → **Release to the patient**. Then **Print prescription** if needed.

### Test cases

| # | Do this | Expected |
|---|---|---|
| 5.1 | Nurse → Vital signs → Record only the top number of the blood pressure | Refused: both numbers needed |
| 5.2 | Record 150/95, pulse 110 | Saved; BP and pulse shown in red on the visit |
| 5.3 | Doctor → My day → Call in a waiting patient | The visit page opens straight away, with alerts and the nurse's vitals |
| 5.4 | Click **Sign & finish visit** with an empty note | Refused: complaint/examination and a diagnosis are needed |
| 5.5 | For **Nadia Samir Fahmy**, add *Augmentin* to the prescription | Red allergy warning (Penicillin); the line isn't saved until a reason is written |
| 5.6 | For **Sara Mohamed Abdallah**, add *Pridocaine* | Allergy warning (Lidocaine) |
| 5.7 | Add *Tramal 50 mg* | “Restricted” — a reason is required; it's recorded in the activity log on signing |
| 5.8 | Sign the visit, then try to change anything | Everything is read-only; only **Add an addendum** is possible |
| 5.9 | Add an addendum | Shown under the visit with date and name; the original text is unchanged |
| 5.10 | **Release to the patient** with a summary of less than 10 characters | Button stays disabled |
| 5.11 | Release with a proper summary; sign in as the patient → My visits | The summary and prescription appear; complaint, examination, diagnosis and plan never do |
| 5.12 | **Print prescription** (doctor or patient) | A5 sheet: clinic letterhead, doctor, patient, allergies, drugs, signature line; the menus aren't printed |
| 5.13 | Doctor `dr.derm` opens a visit written by `dr.dental` (patient file → Visits) | Shows “Treating doctor only”; opening it is refused |
| 5.14 | Medical director → Visits → open any visit | Readable; can add an addendum but not edit; the opening is logged in the activity log |
| 5.15 | Nurse opens a patient file | **Vital signs** tab only — no Visits tab |
| 5.16 | In a visit, set **Follow-up: in 7 days** + a note; sign | The patient appears in reception's **Follow-ups due** with the note; booking with that doctor removes them |
| 5.17 | Reception → Follow-ups due → **Book follow-up** | Booking page opens with the patient chosen; the same doctor is pre-selected once you pick the service |
| 5.18 | Medical director → Drugs & diagnoses → add a drug with allergy word “sulfa” | Appears in the doctors' drug search; patients with a “sulfa” allergy get the warning |
| 5.19 | Delete a drug that was prescribed before | Refused (“in use”); switch it off instead |
| 5.20 | Doctor home | Counts of unsigned visits and visits not yet released |

**Accounts:** `nurse@`, `dr.dental@` / `dr.derm@` / `dr.obgyn@`, `meddir@` (2-step on first sign-in), `reception@`, patient `01001110001`.

---

## 6. Doctor's work, part B: laser, tooth chart, treatment plans, lab work + complaints desk (requirements 4 and 3)

**Covers:**
- **Laser sessions:** safety checklist before starting (stop questions need a written reason; signed consent is
  required), skin type, settings per body area, the device pulse counter before/after — every pulse must be
  accounted for — and signing locks the record and moves the device counter forward.
- **Tooth chart:** FDI numbering, adult and child teeth, conditions per surface, planned work outlined in gold;
  a history that is never edited (a wrong entry is voided with a reason).
- **Treatment plans:** items by tooth/surface priced from the price list, a quotation valid until a date (printable),
  patient acceptance (online or signed at the clinic), down payment + monthly installments, items marked done
  become "ready to bill" and go on the chart. Invoices and payments come with requirement 5.
- **Lab work:** ordered → sent → back → delivered, remakes with a reason, due dates and overdue flags, the lab cost
  (owed to the lab) and the doctor's share — connected to accounting in requirement 6.
- **Complaints & requests desk:** log, assign, response deadline by priority, comments, resolve, close;
  patients send theirs from the portal and see the answer.

**Where:**
- Doctor → **Laser sessions**, **Treatment plans**, **Lab work**; patient file → **Dental** and **Laser** tabs;
  in a visit, the side card **Records for this service** opens the laser record or the tooth chart
- Nurse → **Laser sessions**, **Lab work**, **Complaints & requests**
- Reception → **Dental plans** (record acceptance), **Lab work**, **Complaints & requests**
- Patient relations / Management → **Complaints & requests** (full desk), **Dental plans**
- Medical director → **Dental plans**, **Lab work**, **Clinical lists** (drugs, diagnoses, laser devices, dental labs)
- Management → Services & prices → a service's **Clinical record** (laser / dental) and what the chart shows when done
- Patient → **Treatment plans** (accept / decline / print), **Complaints & requests**

**Demo data:** 2 laser devices with session history (Omar Youssef: full-body course; Sara, Yasmine, Noura: face);
tooth charts for the dentist's patients; plans in every state — Ahmed Mahmoud El-Sayed (accepted, 3 of 4 done,
crown at the lab), Mostafa Ibrahim Shahin (quoted), Tarek Gamal El-Din (draft), **Youssef Omar Youssef (quoted —
Omar can accept it in the portal)**, Malak (completed), Amr Khaled Nasr (expired); 3 labs and lab cases in every
stage (one overdue, one remake); 6+ complaints including one past its deadline.

### Test cases

| # | Do this | Expected |
|---|---|---|
| 6.1 | Nurse → Laser sessions → **Start session record** for an arrived laser patient | Opens prefilled from last time: device, counter, areas and settings, session number |
| 6.2 | Click **Sign the session** with questions unanswered | Refused: answer every question |
| 6.3 | Answer "No" to *signed consent* | Can't be signed without consent |
| 6.4 | Answer "Yes" to *sun tan in the last 2 weeks* | Asks for a written reason (10+ characters) before signing |
| 6.5 | Counter before 1,000 / after 1,140, area pulses 130, test pulses 0 | Red: "10 pulses not accounted for — write why"; signing needs the explanation |
| 6.6 | Put 10 test pulses | Green: every pulse accounted for; signing works and the device counter moves to 1,140 |
| 6.7 | Open the signed session | Read-only; previous sessions shown on the side |
| 6.8 | Dentist → Ahmed's file → **Dental** tab → click tooth 47 → add *Caries* on O | Appears red on the chart and in the tooth's history |
| 6.9 | Void that entry with a reason | Struck through in the history, kept forever |
| 6.10 | **New plan** → add *Composite filling* on 16 + *Scaling* | Price filled from the price list (can't be typed) |
| 6.11 | Set down payment higher than the total → **Issue quotation** | Refused |
| 6.12 | Issue the quotation, then try to add an item | Not allowed; **Revise** sends it back to draft |
| 6.13 | **Print quotation** | Letterhead, items by tooth, total, payment plan, valid-until date, signature lines |
| 6.14 | Reception → Dental plans → open the quotation → **Patient accepts** without ticking "signed the printed quotation" | Button stays disabled until ticked; then installments are created |
| 6.15 | Patient `01001110001` → Treatment plans → **Accept the plan** for Youssef | Accepted online; the dentist sees "Patient accepted online" |
| 6.16 | Try to accept Amr's expired quotation | Refused: quotation expired |
| 6.17 | Dentist → accepted plan → **Done** on an item | "Ready to bill" + it appears on the tooth chart; when all items are done the plan is *Completed* |
| 6.18 | On a crown item → **To lab** | New lab case linked to the plan item |
| 6.19 | Lab work → open a case → **Back from lab** → **Needs a remake** without a reason | Reason required; remake count goes up |
| 6.20 | Lab work → **Overdue** tab | The retainer for Ziad (due 2 days ago) |
| 6.21 | Reception → Complaints → **Log a complaint or request** for a patient | Created with a deadline from the priority |
| 6.22 | Reception tries to assign it | Not possible (only patient relations / management) |
| 6.23 | Patient relations assigns it to reception and comments | Moves to *In progress*; reception sees it under "Assigned to me" |
| 6.24 | Reception → **Resolve** without writing what was done | Required; then *Resolved* (only patient relations can close) |
| 6.25 | Patient → Complaints & requests → send a request | Appears in patient relations' **Unassigned** list; the patient sees the answer once resolved |
| 6.26 | Medical director → Clinical lists → **Laser devices** → lower a device's counter | Refused: a counter can't go backwards |

**Accounts:** `nurse@`, `dr.dental@`, `dr.derm@`, `reception@`, `relations@`, `meddir@`, `director@`, patient `01001110001`.

---

## 7. Billing, payments & cashier — part A (requirement 5)

**Covers:**
- **Cashier desk:** everyone who arrived today, with what's left to bill or collect; finished treatment-plan items
  "ready to bill"; a search for any patient's account.
- **Invoices:** made from a visit in one click (its services, the doctor and price-list prices filled in), or from
  scratch. A line can be a service, a **package sale**, a **package session** (0 EGP, uses one session) or a
  **treatment plan item**. Prices come from the server and can't be typed. VAT per service. A discount needs a
  reason; above the clinic's limit (10% in the demo) it waits for a manager. Once issued, an invoice is locked and
  numbered (`INV-…`); a mistake is fixed by **voiding** it (manager approval, with a reason).
- **Payments:** cash, card, InstaPay, mobile wallet or the patient's credit, several on one receipt (`RC-…`).
  Card, InstaPay and wallet need the reference number. Paying more than is due puts the rest on the patient's
  **credit**. 80 mm receipt and invoice prints.
- **Installments:** a down payment + monthly installments when issuing; reception sees **Installments due**.
- **Patient account:** what the patient owes, their credit and its history, packages with sessions left, invoices
  and receipts.
- **Cashier shifts:** a payment can only be taken in an open shift. Open with the cash float; closing asks for the
  counted cash against expected = float + cash in − cash refunds. A difference needs a reason and is recorded;
  a closed shift can't be changed.
- **Refunds:** from the patient's credit only. The cashier requests, a manager approves, then the cashier pays out.
- **Approvals (management):** big discounts, voids, refunds; rejecting needs a note. Every decision is in the activity log.
- **Setup (management):** **Packages** (add / edit / delete; a package that was already sold can't be deleted,
  only switched off), **Doctor shares** (percent or fixed amount, per doctor or per service, optionally after the
  service's direct cost), **Billing rules** (discount limit, most installments, note printed on receipts). VAT and
  direct cost are set per service in Services & prices.
- **Who sees what:** doctor shares are shown to management only, never to the cashier or the patient. The
  accountant and auditor can read invoices, shifts and refunds but can't change anything.
- **Patient portal → My bills:** their invoices, installments, receipts and packages, with prints.

**Not connected yet:** **Paymob online payment** and **Tax Authority e-receipts** aren't built. Invoices only
carry an e-receipt status field for later; both need the clinic's Paymob account and Tax Authority credentials.
Accounting (journal entries, profit & loss, doctor payouts) is in section 8.

**Where:**
- Cashier → **Cashier desk**, **My shift**, **Invoices**, **Refunds**, **Shift reports**; a patient's name opens their account
- Reception → **Installments due**, **Invoices**
- Management → **Approvals**, **Invoices**, **Shifts & cash**, **Refunds**; setup: **Packages**, **Doctor shares**,
  **Billing rules**; Services & prices → a service's **VAT (%)** and **Direct cost**
- Accountant / Auditor → **Invoices**, **Shifts & cash**, **Refunds**
- Patient → **My bills**

**Demo data:** 5 packages (placeholders for the demo), doctor shares (Dr. Rania 40%, Dr. Ahmed 35% + a fixed
100 EGP per dental consultation, Dr. Nermeen 45%), the last days' invoices and receipts paid by different methods,
one closed shift per day (one 50 EGP short, with a reason), a split cash + card payment, an overpayment left as
credit, **Omar Youssef** with a package sold in installments, and waiting for a manager: a 20% discount and a
refund. Teeth whitening has 14% VAT. No shift is open, so testing starts by opening one.

### How to use
- **Start the day** (cashier): My shift → enter the cash in the drawer → *Open shift*.
- **Bill a visit:** Cashier desk → a patient who arrived → *Invoice* → check the lines (add a service, package or
  plan item; change quantity or doctor) → optional discount with a reason → *Issue invoice*.
- **Take a payment:** on the invoice → *Collect* → one or more methods → save. Print the receipt from the
  confirmation or from the payments list.
- **Sell a package in installments:** new invoice → *Package sale* → choose it → *Issue invoice* → *In installments*
  → down payment and number of months.
- **End the day:** My shift → *Close shift* → count the cash → if it doesn't match, write why → close. The shift
  report can be printed.
- **Approve** (management): Approvals → *Approve* or *Reject* (with a note).

### Test cases

| # | Do this | Expected |
|---|---|---|
| 7.1 | Cashier → collect a payment before opening a shift | Refused: "Open your shift first" |
| 7.2 | My shift → open with 1,000 EGP | Shift open; only one open shift per cashier |
| 7.3 | Reception marks a patient *Arrived* → Cashier desk | The patient appears as "to bill" |
| 7.4 | *Invoice* on that patient | A draft with the visit's services, the doctor and price-list prices; billing the same visit again opens the same draft |
| 7.5 | Add a discount without a reason | Refused: reason required |
| 7.6 | Discount of 5% with a reason → *Issue invoice* | Issued straight away with an `INV-` number |
| 7.7 | Discount of 30% → *Issue invoice* | "Waiting for a manager"; no number yet |
| 7.8 | Management → Approvals → reject it without a note | Refused: a note is needed. Approving issues the invoice (issued by the cashier, approved by the manager) |
| 7.9 | Try to edit an issued invoice | Locked; only *Ask to void* is possible |
| 7.10 | Pay by card without the terminal reference | Refused: reference required |
| 7.11 | Pay part in cash and part by card | One receipt `RC-…` with both methods; the invoice becomes *Partly paid* |
| 7.12 | Pay 300 EGP more than what's left | The invoice is *Paid*; 300 EGP goes to the patient's credit (Patient account → credit history) |
| 7.13 | Pay with **From credit** | Taken from the credit; the credit balance goes down |
| 7.14 | Sell a package → *Issue invoice* → *In installments* | The number of installments only goes up to the clinic's maximum (12, from Billing rules); the server refuses more |
| 7.15 | Sell a package with a down payment + 2 installments | A schedule of 3 lines on the invoice; Reception → Installments due shows the monthly ones |
| 7.16 | The same patient's next visit for that service → *Invoice* | The line is a **Package session** at 0 EGP; sessions left goes down by one |
| 7.17 | Management → void the package sale after a session was used | Refused: the package is in use |
| 7.18 | Cashier → *Ask to void* on a paid invoice (with a reason) → manager approves | Invoice *Void* (stamped on the print); what was paid moves to the patient's credit |
| 7.19 | Request a refund bigger than the patient's credit | Refused |
| 7.20 | Request a refund → *Pay out* before approval | Refused; after the manager approves, *Pay out* works and the credit goes down |
| 7.21 | Close the shift counting 20 EGP less than expected, with no reason | Refused: a reason is needed; with one it closes and the report shows −20 |
| 7.22 | Open a closed shift's report → *Print* | Float, cash in by method, refunds, expected, counted, difference and reason |
| 7.23 | Print an invoice and a receipt | Invoice with letterhead and installment schedule; an 80 mm receipt |
| 7.24 | Management → Packages → add, edit and delete a package nobody bought | All three work; deleting a sold package is refused ("switch it off instead") |
| 7.25 | Cashier tries to change packages or doctor shares | Not possible (no such pages; the server refuses too) |
| 7.26 | Open the same invoice as the cashier and as management | Only management sees each line's doctor share |
| 7.27 | Accountant → Invoices → *Unpaid*, sort by balance | Sorted list with totals; no create or collect buttons |
| 7.28 | Management → Billing rules → discount limit 20% → cashier gives 15% | Issued without approval |
| 7.29 | Patient `01001110001` → My bills | Invoices, the package with sessions left, installments and receipts (printable); no doctor shares |
| 7.30 | Management → Services & prices → a service → VAT 14% → invoice it | VAT shown on the line and in the totals |

**Accounts:** `cashier@`, `reception@`, `director@` or `owner@` (2-step on first sign-in), `accountant@`,
`auditor@`, patient `01001110001`.

---

## 8. Accounting & finance — part B (requirement 6)

**Covers:**
- **Chart of accounts:** a starter list (cash drawers, petty cash, bank, card / InstaPay / wallet money to settle,
  patient receivables and credit, unused package sessions, doctors and labs payable, VAT, capital, income and expense
  accounts). The accountant adds, renames and switches off accounts. The accounts that billing posts to are marked
  *system*: they can be renamed but never switched off.
- **Automatic journal:** every invoice, receipt, void, refund, closed shift (cash over / short), package session and
  lab case posts its own double entry. Nobody types it, and what billing did before accounting existed was posted
  once (backfill). Each invoice line keeps its service, doctor, specialty and branch, so income can be analysed.
- **Manual entries** (`JE-…`) for adjustments, accruals and opening balances. Debits must equal credits; patient
  accounts (receivables, credit, packages) can only be moved by billing. A mistake is fixed by **reversing** the
  entry, once, never by editing it.
- **Expenses** (`EX-…`) by category, paid from the bank or petty cash (never from a cashier's drawer), with an optional
  receipt photo / PDF. A wrong expense is voided, which posts the reversal.
- **Cash & bank:** the balance of every money account; transfers (`TR-…`), e.g. petty cash top-up from the bank or
  depositing the drawer's cash; you can't move more than an account holds.
- **Card & InstaPay settlement:** pick the card / InstaPay / wallet payments the provider paid, enter what reached
  the bank and the fee. The fee goes to *Bank & card fees*. A payment is settled only once.
- **Doctor payouts** (monthly): shares from the issued invoices − the lab work the doctor carries = net. The
  accountant prepares a statement (`DP-…`), management approves or rejects it (with a note), then the accountant
  records the payment. One payout per doctor per month, and only for a month that has ended. Lab bills are paid from
  the same page (*Labs* tab).
- **Month close:** a checklist (open shifts, payments not settled, payouts not prepared…). The accountant asks for
  the close, management approves, and the month is **locked**: nothing can be posted, expensed or voided with a date
  inside it. Management can reopen the most recent closed month, with a reason.
- **Reports** (all printable and exportable to CSV): Profit & loss, income by service / doctor / specialty / branch,
  daily cash, trial balance, account ledger, receivables aging, patient credit, VAT. The financial year starts in
  January.
- **Who does what:** the accountant posts (entries, expenses, transfers, settlements, payouts, close requests) and
  manages the chart; management approves payouts and month closes and reads every report; the auditor reads
  everything and changes nothing. Other roles have no accounting pages.

**Not connected yet:** salaries post from HR (requirement 8); the *Salaries* account is ready for it. Paymob and
Tax Authority e-receipts are still not built (see section 7).

**Where:**
- Accountant → **Accounting** (overview), **Journal**, **Expenses**, **Cash & bank** (*Settlements* tab),
  **Doctor payouts** (*Labs* tab), **Month close**, **Financial reports**, **Chart of accounts**; shortcuts on Home
- Management → **Accounting**, **Doctor payouts** (approve / reject), **Month close** (approve / reopen),
  **Financial reports**; the overview shows what waits for them
- Auditor → **Accounting**, **Journal**, **Expenses**, **Financial reports** (the other pages open from links, read-only)
- An entry's reference opens the invoice, receipt, shift, expense or payout it came from

**Demo data:** all of the demo billing is in the journal, plus a few invoices spread over last month; an opening
balance of 400,000 EGP capital in the bank; a 6,000 EGP petty cash fund; expenses (rent 28,000, electricity,
internet, supplies, maintenance, marketing flyers) from the bank and petty cash; the drawers' cash deposited at the
bank; a card terminal settlement with a 2.25% fee; a part payment to a dental lab; **last month's doctor payouts
prepared** (waiting for management); and **last month's close requested** (waiting for management). Every amount is
invented. Running the automated tests changes this state (payouts approved, a month closed and reopened…).

### How to use
- **Post an expense** (accountant): Expenses → *New expense* → category, amount, date, paid from (bank or petty cash),
  payee, receipt number, receipt file → *Save*.
- **Manual entry:** Journal → *Manual entry* → date, memo → lines (account, debit or credit) → the footer shows the
  difference until it balances → *Post entry*. To undo it, open the entry → *Reverse*.
- **Move money:** Cash & bank → *Move money* → from, to, amount, reference → *Record transfer*.
- **Card money arrived in the bank:** Cash & bank → *Settlements* → choose the method → tick the payments → enter the
  fee and the bank reference → *Record settlement*.
- **Pay the doctors** (after the month ends): Doctor payouts → choose the month → *Prepare* per doctor → *Send for
  approval* → management → *Review & approve* → the accountant → *Pay* (choose the account it's paid from).
  *Print statement* gives a sheet with signature lines for the doctor.
- **Close a month:** Month close → check the list → *Request close* → management → *Review close* → *Approve & close*
  (or *Reject* with a note).
- **Reports:** Financial reports → pick the report and the dates → *Print* or *Export CSV*.

### Test cases

| # | Do this | Expected |
|---|---|---|
| 8.1 | Accountant → Accounting | Money in each account, this month vs last (income, expenses, profit), what's owed both ways, what waits for action |
| 8.2 | Financial reports → **Trial balance**; then the overview's **Books vs. records** card | Total debits = total credits; receivables and patient credit show *Matches* (they equal billing's own records) |
| 8.3 | Journal | Invoices, receipts and shifts are already there with an *Automatic* tag; opening one shows its lines and a link to the invoice |
| 8.4 | Journal → *Manual entry* with debit 1,000 and credit 900 | *Post entry* stays disabled; the server refuses it as unbalanced |
| 8.5 | Manual entry on the *Patient receivables* account | Refused: patient accounts are moved by billing only |
| 8.6 | Manual entry dated tomorrow | Refused: no entries dated in the future |
| 8.7 | Post a balanced manual entry, then *Reverse* it twice | The first reversal posts the mirror entry; the second is refused (already reversed) |
| 8.8 | Open an automatic entry (from an invoice) | No *Reverse* button; fixing it goes through billing (void) |
| 8.9 | New expense paid from *Cash drawers* | Not offered; the server refuses it too (use petty cash or the bank) |
| 8.10 | New expense with a `.docx` receipt | Refused: PDF / JPG / PNG only |
| 8.11 | New expense *Supplies* 1,200 EGP from the bank with a PDF receipt | `EX-…` posted: debit Supplies & consumables, credit Bank; the receipt opens from the list |
| 8.12 | *Void* that expense with a reason | Status *Void*; a reversal entry appears in the journal |
| 8.13 | Cash & bank → *Move money* → more than petty cash holds | Refused: not enough in the account |
| 8.14 | Cashier takes a card payment → accountant → Cash & bank → *Settlements* | The payment is listed as waiting; *Record settlement* with a 2.5 EGP fee → the bank goes up, *Bank & card fees* takes the fee |
| 8.15 | Try to settle the same payment again | Refused: already settled |
| 8.16 | Doctor payouts → last month → open `DP-000001` | Statement: shares by service − lab work = net; *Print statement* gives an A4 sheet with signature lines |
| 8.17 | Prepare a second payout for the same doctor and month | Refused: one payout per doctor and month |
| 8.18 | Prepare a payout for **this** month | Refused: the month hasn't ended |
| 8.19 | Accountant → a prepared payout that isn't approved yet | No *Pay* button; the server refuses payment too (needs management's approval) |
| 8.20 | Management → *Review & approve* → *Reject* without a note | *Reject* stays disabled; with a note it's rejected and the accountant can prepare it again |
| 8.21 | Management approves → accountant → *Pay* | *Paid*; Doctors payable goes down by the shares |
| 8.22 | Month close → last month | *Waiting for management*, with the checklist and who asked |
| 8.23 | The current month | No *Request close* (the month hasn't ended); the server refuses it too |
| 8.24 | Management → *Review close* → *Approve & close*; then the accountant posts an entry or an expense dated in it | Closed 🔒; both are refused (month closed) |
| 8.25 | Management → *Reopen* | A reason is required; then it's open again (only the latest closed month) |
| 8.26 | Chart of accounts → add an expense account with a code already used | Refused: code taken; a new code works and it's offered in New expense |
| 8.27 | Switch off *Bank* | Refused (system account); renaming it works |
| 8.28 | Financial reports → **Profit & loss** | Income − expenses = profit, by account, for the dates chosen |
| 8.29 | **Income by** service / doctor / specialty / branch | Totals match the P&L's service + package income |
| 8.30 | **Account ledger** → Bank | Opening, every movement with a running balance, closing = the bank balance on Cash & bank |
| 8.31 | **Daily cash**, **Aging**, **Patient credit**, **VAT** → *Print* and *Export CSV* | A clean A4 print without the menus; the CSV opens in Excel with Arabic intact |
| 8.32 | Auditor → any accounting page | Everything readable; no post, approve or edit buttons; the server refuses changes |
| 8.33 | Management → Journal or Chart of accounts by URL | Read-only; posting and editing the chart are refused |
| 8.34 | Reception → `/dashboard/reception/accounting` | No accounting pages |

**Accounts:** `accountant@` (posts), `director@` or `owner@` (approve), `auditor@` (read-only), `cashier@` for 8.14 —
all with 2-step on first sign-in except the cashier.

---
