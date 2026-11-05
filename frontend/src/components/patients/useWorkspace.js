import { useMemo } from 'react'
import { useAuth } from '../../auth/AuthContext'
import { slugFor } from '../../auth/roles'
import { patientsApi } from '../../api/patients'

// The role you're working in decides which API (/api/<role>/patients) and which pages (/dashboard/<role>/patients) to use.
export function useWorkspace() {
  const { me, can } = useAuth()
  const slug = slugFor(me.active_role)
  return useMemo(
    () => ({
      slug,
      base: `/dashboard/${slug}`,
      patientsBase: `/dashboard/${slug}/patients`,
      api: patientsApi(slug),
      can,
      canUpload: (category, admin) =>
        can(admin ? 'patient_files.upload_admin' : 'patient_files.upload_clinical'),
    }),
    [slug, can],
  )
}
