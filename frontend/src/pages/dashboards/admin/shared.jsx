import Button from '../../../components/Button'
import Icon from '../../../components/Icon'
import { STAFF_ROLES, roleName } from '../../../auth/roles'
import { useI18n } from '../../../i18n/I18nContext'

// Edits a person's list of (role, branch) pairs. branch_id null = all branches.
export function RoleAssignments({ value, onChange, branches, error, disabled }) {
  const { t, tx, lang, pick } = useI18n()
  const update = (index, patch) => onChange(value.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  const remove = (index) => onChange(value.filter((_, i) => i !== index))
  const add = () => onChange([...value, { role: '', branch_id: branches[0]?.id ?? null }])

  return (
    <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
      <legend className="field-label" style={{ marginBottom: 8 }}>
        {tx('الأدوار والفروع', 'Roles & branches')}
      </legend>
      <div style={{ display: 'grid', gap: 10 }}>
        {value.map((row, index) => (
          <div key={index} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.2fr) minmax(0,1fr) auto', gap: 8 }}>
            <label className="sr-only" htmlFor={`role-${index}`}>
              {tx('الدور', 'Role')}
            </label>
            <select
              id={`role-${index}`}
              className="select"
              value={row.role}
              onChange={(e) => update(index, { role: e.target.value })}
              aria-invalid={error && !row.role ? 'true' : undefined}
              disabled={disabled}
            >
              <option value="">{tx('اختر الدور…', 'Choose role…')}</option>
              {STAFF_ROLES.map((code) => (
                <option key={code} value={code}>
                  {roleName(code, lang)}
                </option>
              ))}
            </select>
            <label className="sr-only" htmlFor={`branch-${index}`}>
              {tx('الفرع', 'Branch')}
            </label>
            <select
              id={`branch-${index}`}
              className="select"
              value={row.branch_id ?? ''}
              onChange={(e) => update(index, { branch_id: e.target.value ? Number(e.target.value) : null })}
              disabled={disabled}
            >
              <option value="">{t('all_branches')}</option>
              {branches
                .filter((b) => b.is_active)
                .map((b) => (
                  <option key={b.id} value={b.id}>
                    {pick(b)}
                  </option>
                ))}
            </select>
            <Button
              variant="quiet"
              className="btn-icon"
              onClick={() => remove(index)}
              disabled={disabled || value.length === 1}
              aria-label={tx('إزالة هذا الدور', 'Remove this role')}
            >
              <Icon name="x" size={18} />
            </Button>
          </div>
        ))}
      </div>
      {error && (
        <p className="field-error" role="alert">
          <Icon name="alert" size={14} />
          <span>{error}</span>
        </p>
      )}
      <div>
        <Button variant="quiet" size="sm" icon="plus" onClick={add} disabled={disabled || value.length >= 10}>
          {tx('إضافة دور آخر', 'Add another role')}
        </Button>
      </div>
    </fieldset>
  )
}

export { default as TempPasswordNotice } from '../../../components/TempPasswordNotice'

export function validateAssignments(rows, tx) {
  if (!rows.length || rows.some((r) => !r.role)) return tx('اختر دورًا لكل سطر.', 'Choose a role on every line.')
  const keys = rows.map((r) => `${r.role}:${r.branch_id ?? ''}`)
  if (new Set(keys).size !== keys.length) return tx('هناك دور مكرر لنفس الفرع.', 'The same role is listed twice for one branch.')
  return null
}
