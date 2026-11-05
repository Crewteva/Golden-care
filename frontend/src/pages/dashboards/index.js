// One dashboard per role. Each folder exports { role, pages }, and App.jsx turns them into routes.
import admin from './admin'
import management from './management'
import medical_director from './medical_director'
import reception from './reception'
import patient_relations from './patient_relations'
import doctor from './doctor'
import nurse from './nurse'
import cashier from './cashier'
import accountant from './accountant'
import hr from './hr'
import inventory from './inventory'
import marketing from './marketing'
import auditor from './auditor'
import patient from './patient'

export const DASHBOARDS = [
  admin,
  management,
  medical_director,
  reception,
  patient_relations,
  doctor,
  nurse,
  cashier,
  accountant,
  hr,
  inventory,
  marketing,
  auditor,
  patient,
]
