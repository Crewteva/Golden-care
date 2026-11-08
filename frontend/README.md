# Golden Care OS — Frontend (React · Vite)

Arabic-first (right-to-left) with a full English version. Built with Vite and served by nginx,
which also forwards `/api` to the backend (`nginx.conf`).

## Layout

```
src/
  main.jsx, App.jsx    entry point and all page routes
  api/                 functions that call the backend (auth, admin, patients, patient portal, settings, appointments, visits, billing)
  auth/                signed-in user (AuthContext), page guards, roles & where each one goes
  components/          shared UI: buttons, fields, modal, toasts, activity log, role home
    patients/          the patient file used by several roles: directory, file page, form, duplicate panel,
                       alerts, family, documents (upload / review / release), review queue
    settings/          clinic setup: specialties, services & prices, doctors & schedules, rooms, leave, booking rules
    appointments/      today's board, calendar (day timeline / week counts), booking with free-time picker,
                       appointment drawer (arrive, call in, finish, reschedule, cancel), doctor's day
    visits/            the visit workspace (note, diagnosis picker, prescription editor, sign, release, addenda),
                       vital signs, printable prescription (A5), visits list, nurse's vitals list,
                       reception's follow-ups, drug & diagnosis lists
    laser/             laser session record and today's laser list
    dental/            tooth chart (SVG odontogram), dental tab, treatment plan page, quotation (print), lab cases
    complaints/        the complaints & requests desk
    clinical/          shared labels and hooks for laser, dental and complaints; devices & labs lists
    billing/           cashier desk, invoice page (lines, discount, issue, installments, void), payment modal
                       (split methods), patient account, shifts and shift reports, refunds, approvals, invoices
                       list, installments due, setup (packages, doctor shares, billing rules), invoice and 80 mm
                       receipt prints; meta.jsx holds shared labels, money formatting and the patient finder
  layouts/             AuthLayout (sign-in screens), DashboardLayout (sidebar + top bar)
  i18n/                language switch and shared Arabic/English text
  lib/                 formatting, clinic time (always Cairo time), error messages, password rules, activity labels
  styles/              design tokens and layouts
  pages/
    auth/              Login, Register (patients), ForgotPassword, TwoFactor, ChangePassword, ChooseRole
    account/           "My account" (every role)
    dashboards/<role>/ one folder per role; index.jsx lists its pages and sidebar entries
```

## Adding a page to a role's dashboard

1. Create the page in `src/pages/dashboards/<role>/`.
2. Add it to that folder's `index.jsx`: `{ path, icon, label: { ar, en }, element, permission? }`.
3. Call the role's API from a file in `src/api/`.

The sidebar and the route are created from that entry automatically. Use `?lang=en` on any link to
open it in English.

## Develop

```bash
npm install
npm run dev     # http://localhost:5173, /api is proxied to http://localhost:8000
npm run build
```
