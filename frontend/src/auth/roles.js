// Every role: its dashboard address, icon and names. Codes match the backend `roles` table.
export const ROLES = {
  admin: { icon: 'shield', ar: 'مدير النظام', en: 'System admin' },
  owner: { icon: 'pie', ar: 'المالك', en: 'Owner' },
  director: { icon: 'trending', ar: 'المدير العام', en: 'General manager' },
  medical_director: { icon: 'award', ar: 'المدير الطبي', en: 'Medical director' },
  reception: { icon: 'bell', ar: 'الاستقبال', en: 'Reception' },
  patient_relations: { icon: 'headphones', ar: 'علاقات المرضى', en: 'Patient relations' },
  doctor: { icon: 'stethoscope', ar: 'طبيب', en: 'Doctor' },
  nurse: { icon: 'plusSquare', ar: 'التمريض', en: 'Nursing' },
  cashier: { icon: 'cash', ar: 'الخزينة', en: 'Cashier' },
  accountant: { icon: 'calculator', ar: 'المحاسبة', en: 'Accountant' },
  hr: { icon: 'briefcase', ar: 'الموارد البشرية', en: 'Human resources' },
  inventory: { icon: 'package', ar: 'المخازن', en: 'Inventory' },
  marketing: { icon: 'megaphone', ar: 'التسويق', en: 'Marketing' },
  auditor: { icon: 'fileSearch', ar: 'المراجعة', en: 'Auditor' },
  patient: { icon: 'heart', ar: 'مريض', en: 'Patient' },
}

export const STAFF_ROLES = Object.keys(ROLES).filter((code) => code !== 'patient')

export const slugFor = (role) => role.replace(/_/g, '-')

export const roleName = (role, lang) => (ROLES[role] ? ROLES[role][lang] : role)

// Where the signed-in person should be right now.
export function pathFor(me) {
  if (!me) return '/login'
  switch (me.next_step) {
    case 'mfa_setup':
    case 'mfa_verify':
      return '/two-factor'
    case 'change_password':
      return '/change-password'
    case 'choose_role':
      return '/choose-role'
    case 'no_role':
      return '/no-access'
    default:
      return `/dashboard/${slugFor(me.active_role)}`
  }
}
