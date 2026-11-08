import { useId, useState } from 'react'
import Icon from './Icon'
import { useI18n } from '../i18n/I18nContext'
import { passwordChecks, passwordScore } from '../lib/password'

function Shell({ id, label, hint, error, optional, children, className = '' }) {
  const { t } = useI18n()
  return (
    <div className={`field ${className}`}>
      {label && (
        <label className="field-label" htmlFor={id}>
          {label}
          {optional && <span className="opt">({t('optional')})</span>}
        </label>
      )}
      {children}
      {hint && !error && (
        <p className="field-hint" id={`${id}-hint`}>
          {hint}
        </p>
      )}
      {error && (
        <p className="field-error" id={`${id}-error`} role="alert">
          <Icon name="alert" size={14} />
          <span>{error}</span>
        </p>
      )}
    </div>
  )
}

function describedBy(id, hint, error) {
  return [error && `${id}-error`, hint && !error && `${id}-hint`].filter(Boolean).join(' ') || undefined
}

export function TextField({ label, hint, error, optional, icon, className, inputClassName = '', id: given, ...props }) {
  const auto = useId()
  const id = given || auto
  return (
    <Shell id={id} label={label} hint={hint} error={error} optional={optional} className={className}>
      <div className="input-wrap">
        {icon && (
          <span className="input-start">
            <Icon name={icon} size={18} />
          </span>
        )}
        <input
          id={id}
          className={`input ${icon ? 'has-start' : ''} ${inputClassName}`}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={describedBy(id, hint, error)}
          {...props}
        />
      </div>
    </Shell>
  )
}

export function TextArea({ label, hint, error, optional, className, id: given, ...props }) {
  const auto = useId()
  const id = given || auto
  return (
    <Shell id={id} label={label} hint={hint} error={error} optional={optional} className={className}>
      <textarea
        id={id}
        className="textarea"
        dir="auto"
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={describedBy(id, hint, error)}
        {...props}
      />
    </Shell>
  )
}

export function SelectField({ label, hint, error, optional, options, placeholder, className, id: given, ...props }) {
  const auto = useId()
  const id = given || auto
  return (
    <Shell id={id} label={label} hint={hint} error={error} optional={optional} className={className}>
      <select
        id={id}
        className="select"
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={describedBy(id, hint, error)}
        {...props}
      >
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
      </select>
    </Shell>
  )
}

export function PasswordField({ label, hint, error, strength, kind = 'staff', className, id: given, value, ...props }) {
  const auto = useId()
  const id = given || auto
  const { t, tx } = useI18n()
  const [visible, setVisible] = useState(false)
  const checks = passwordChecks(value || '', kind)
  const score = passwordScore(value || '', kind)
  return (
    <Shell id={id} label={label} hint={strength ? undefined : hint} error={error} className={className}>
      <div className="input-wrap">
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          className="input has-end ltr"
          dir="ltr"
          value={value}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={describedBy(id, strength ? undefined : hint, error)}
          {...props}
        />
        <span className="input-end">
          <button
            type="button"
            className="btn btn-quiet btn-icon"
            onClick={() => setVisible((v) => !v)}
            aria-label={visible ? t('hide_password') : t('show_password')}
            aria-pressed={visible}
          >
            <Icon name={visible ? 'eyeOff' : 'eye'} size={18} />
          </button>
        </span>
      </div>
      {strength && (
        <div className="strength" data-score={score}>
          <div className="strength-bars" aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
          </div>
          <ul className="rules" aria-label={tx('شروط كلمة المرور', 'Password rules')}>
            <li className={checks.length ? 'ok' : ''}>
              <Icon name={checks.length ? 'checkCircle' : 'info'} size={14} />
              {tx(`${checks.min} أحرف على الأقل`, `At least ${checks.min} characters`)}
            </li>
            <li className={checks.mix ? 'ok' : ''}>
              <Icon name={checks.mix ? 'checkCircle' : 'info'} size={14} />
              {tx('حروف مع أرقام أو رموز', 'Letters plus numbers or symbols')}
            </li>
            <li className={value && checks.common ? 'ok' : ''}>
              <Icon name={value && checks.common ? 'checkCircle' : 'info'} size={14} />
              {tx('ليست كلمة مرور شائعة', 'Not a common password')}
            </li>
          </ul>
        </div>
      )}
    </Shell>
  )
}

export function Checkbox({ label, description, error, className = '', id: given, ...props }) {
  const auto = useId()
  const id = given || auto
  return (
    <div className={`field ${className}`}>
      <label className="check" htmlFor={id}>
        <input
          id={id}
          type="checkbox"
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          {...props}
        />
        <span>
          {label}
          {description && <small>{description}</small>}
        </span>
      </label>
      {error && (
        <p className="field-error" id={`${id}-error`} role="alert">
          <Icon name="alert" size={14} />
          <span>{error}</span>
        </p>
      )}
    </div>
  )
}

export function ChoiceGroup({ legend, name, value, onChange, options, error }) {
  const id = useId()
  return (
    <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }} aria-describedby={error ? `${id}-error` : undefined}>
      <legend className="field-label" style={{ marginBottom: 6 }}>
        {legend}
      </legend>
      <div className="choice-group">
        {options.map((o) => (
          <label className="choice" key={o.value}>
            <input type="radio" name={name} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} />
            <span>{o.label}</span>
          </label>
        ))}
      </div>
      {error && (
        <p className="field-error" id={`${id}-error`} role="alert">
          <Icon name="alert" size={14} />
          <span>{error}</span>
        </p>
      )}
    </fieldset>
  )
}
