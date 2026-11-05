import { useState } from 'react'
import Button from '../../components/Button'
import Modal from '../../components/Modal'
import MfaSetup, { OtpField } from '../../components/MfaSetup'
import { PasswordField } from '../../components/Fields'
import { Alert, Avatar, Badge, PageHeader } from '../../components/ui'
import { useToast } from '../../components/Toast'
import { authApi } from '../../api/auth'
import { useAuth } from '../../auth/AuthContext'
import { roleName } from '../../auth/roles'
import { useI18n } from '../../i18n/I18nContext'
import { errorText, fieldErrors } from '../../lib/errors'
import { fmtDateTime, fmtPhone } from '../../lib/format'
import { passwordProblem } from '../../lib/password'

function PasswordCard() {
  const { me, setMe } = useAuth()
  const { t, tx, locale } = useI18n()
  const toast = useToast()
  const empty = { current: '', next: '', confirm: '' }
  const [form, setForm] = useState(empty)
  const [errors, setErrors] = useState({})
  const [busy, setBusy] = useState(false)
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))

  const submit = async (event) => {
    event.preventDefault()
    const e = {}
    if (!form.current) e.current_password = t('field.required')
    const problem = passwordProblem(form.next, me.user.kind)
    if (problem) e.new_password = t(`field.${problem}`)
    if (form.confirm !== form.next) e.confirm = t('field.mismatch')
    setErrors(e)
    if (Object.keys(e).length) return
    setBusy(true)
    try {
      setMe(await authApi.changePassword(form.current, form.next))
      setForm(empty)
      toast.success(tx('تم تغيير كلمة المرور وإنهاء جلساتك على الأجهزة الأخرى.', 'Password changed. Your other devices were signed out.'))
    } catch (err) {
      setErrors(fieldErrors(err, t))
      if (!err.fields || !Object.keys(err.fields).length) toast.error(errorText(err, t))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card">
      <div className="card-head">
        <div>
          <h2>{tx('كلمة المرور', 'Password')}</h2>
          {me.user.password_changed_at && (
            <p className="muted" style={{ fontSize: '.84rem' }}>
              {tx('آخر تغيير:', 'Last changed:')} <bdi className="num">{fmtDateTime(me.user.password_changed_at, locale)}</bdi>
            </p>
          )}
        </div>
      </div>
      <form className="card-body form" onSubmit={submit} noValidate>
        <PasswordField
          label={tx('كلمة المرور الحالية', 'Current password')}
          value={form.current}
          onChange={set('current')}
          error={errors.current_password}
          autoComplete="current-password"
        />
        <PasswordField
          label={tx('كلمة المرور الجديدة', 'New password')}
          value={form.next}
          onChange={set('next')}
          error={errors.new_password}
          autoComplete="new-password"
          strength={Boolean(form.next)}
          kind={me.user.kind}
        />
        <PasswordField
          label={tx('تأكيد كلمة المرور الجديدة', 'Confirm new password')}
          value={form.confirm}
          onChange={set('confirm')}
          error={errors.confirm}
          autoComplete="new-password"
        />
        <div>
          <Button type="submit" loading={busy} icon="key">
            {tx('تغيير كلمة المرور', 'Change password')}
          </Button>
        </div>
      </form>
    </section>
  )
}

function MfaCard() {
  const { me, setMe } = useAuth()
  const { t, tx } = useI18n()
  const toast = useToast()
  const [setupOpen, setSetupOpen] = useState(false)
  const [offOpen, setOffOpen] = useState(false)
  const [off, setOff] = useState({ password: '', code: '' })
  const [offErrors, setOffErrors] = useState({})
  const [busy, setBusy] = useState(false)
  const requiredByRole = me.roles.some((r) => r.requires_mfa)

  const turnOff = async (event) => {
    event.preventDefault()
    setBusy(true)
    setOffErrors({})
    try {
      setMe(await authApi.mfaDisable(off.password, off.code))
      setOffOpen(false)
      setOff({ password: '', code: '' })
      toast.success(tx('تم إيقاف التحقق بخطوتين.', '2-step verification is off.'))
    } catch (err) {
      const fields = fieldErrors(err, t)
      setOffErrors(Object.keys(fields).length ? fields : { form: errorText(err, t) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card">
      <div className="card-head">
        <h2>{tx('التحقق بخطوتين', '2-step verification')}</h2>
        {me.user.mfa_enabled ? (
          <Badge tone="success">{tx('مفعّل', 'On')}</Badge>
        ) : (
          <Badge tone="neutral">{tx('غير مفعّل', 'Off')}</Badge>
        )}
      </div>
      <div className="card-body" style={{ display: 'grid', gap: 14 }}>
        <p className="muted">
          {tx(
            'عند تسجيل الدخول نطلب رمزًا من تطبيق المصادقة على هاتفك، فلا يكفي معرفة كلمة المرور وحدها للدخول إلى حسابك.',
            'At sign-in we ask for a code from the authenticator app on your phone, so a password alone is not enough to get into your account.',
          )}
        </p>
        {requiredByRole && me.user.mfa_enabled && (
          <Alert tone="info">{tx('دورك يتطلب التحقق بخطوتين، لذلك لا يمكن إيقافه.', 'Your role requires 2-step verification, so it stays on.')}</Alert>
        )}
        <div>
          {!me.user.mfa_enabled ? (
            <Button icon="smartphone" onClick={() => setSetupOpen(true)}>
              {tx('تفعيل التحقق بخطوتين', 'Turn on 2-step verification')}
            </Button>
          ) : (
            !requiredByRole && (
              <Button variant="danger-ghost" icon="power" onClick={() => setOffOpen(true)}>
                {tx('إيقاف التحقق بخطوتين', 'Turn off 2-step verification')}
              </Button>
            )
          )}
        </div>
      </div>

      <Modal open={setupOpen} onClose={() => setSetupOpen(false)} title={tx('تفعيل التحقق بخطوتين', 'Turn on 2-step verification')}>
        {setupOpen && (
          <MfaSetup
            onDone={(next) => {
              setSetupOpen(false)
              if (next) {
                setMe(next)
                toast.success(tx('تم تفعيل التحقق بخطوتين.', '2-step verification is on.'))
              }
            }}
          />
        )}
      </Modal>

      <Modal
        open={offOpen}
        onClose={() => setOffOpen(false)}
        busy={busy}
        title={tx('إيقاف التحقق بخطوتين', 'Turn off 2-step verification')}
        description={tx('أكّد بكلمة المرور ورمز من التطبيق.', 'Confirm with your password and a code from the app.')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOffOpen(false)} disabled={busy}>
              {t('cancel')}
            </Button>
            <Button variant="danger" type="submit" form="mfa-off" loading={busy}>
              {tx('إيقاف', 'Turn off')}
            </Button>
          </>
        }
      >
        <form id="mfa-off" className="form" onSubmit={turnOff} noValidate>
          {offErrors.form && <Alert tone="danger">{offErrors.form}</Alert>}
          <PasswordField
            label={tx('كلمة المرور', 'Password')}
            value={off.password}
            onChange={(e) => setOff((o) => ({ ...o, password: e.target.value }))}
            error={offErrors.password}
            autoComplete="current-password"
          />
          <OtpField value={off.code} onChange={(code) => setOff((o) => ({ ...o, code }))} error={offErrors.code} />
        </form>
      </Modal>
    </section>
  )
}

export default function Account() {
  const { me, setMe } = useAuth()
  const { t, tx, lang, setLang, pick, locale } = useI18n()
  const toast = useToast()
  const [busy, setBusy] = useState(false)

  const signOutOthers = async () => {
    setBusy(true)
    try {
      const { signed_out } = await authApi.logoutOthers()
      toast.success(tx(`تم إنهاء ${signed_out} جلسة على أجهزة أخرى.`, `Signed out ${signed_out} other session(s).`))
    } catch (err) {
      toast.error(errorText(err, t))
    } finally {
      setBusy(false)
    }
  }

  const saveLang = async (value) => {
    setLang(value)
    try {
      setMe(await authApi.preferences(value))
    } catch {
      /* the interface already switched; the saved preference can be retried later */
    }
  }

  const name = pick(me.user, 'full_name')
  return (
    <div className="page reveal">
      <PageHeader eyebrow={t('my_account')} title={tx('حسابي والأمان', 'My account & security')} />

      <section className="card card-pad">
        <div className="person" style={{ gap: 18, flexWrap: 'wrap' }}>
          <Avatar name={name} size="lg" />
          <div style={{ minWidth: 0 }}>
            <h2 style={{ fontSize: '1.3rem' }}>{name}</h2>
            <p className="muted ltr" style={{ textAlign: 'start' }}>
              {me.user.email}
              {me.user.email && me.user.phone && ' · '}
              {fmtPhone(me.user.phone)}
            </p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
              {me.roles.map((r) => (
                <span key={`${r.role}:${r.branch_id}`} className="chip">
                  {roleName(r.role, lang)}
                  <small>· {r.branch_id ? pick(r, 'branch_name') : t('all_branches')}</small>
                  {r.delegated && <small>({tx('مؤقت', 'temporary')})</small>}
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>

      <div className="grid-2">
        <PasswordCard />
        <div className="page" style={{ gap: 20, alignContent: 'start' }}>
          <MfaCard />
          <section className="card">
            <div className="card-head">
              <h2>{tx('الأجهزة واللغة', 'Devices & language')}</h2>
            </div>
            <div className="card-body action-list">
              <div className="action-row">
                <div>
                  <strong>{tx('آخر دخول سابق', 'Previous sign-in')}</strong>
                  <small className="num">
                    {me.user.previous_login_at
                      ? `${fmtDateTime(me.user.previous_login_at, locale)} · ${me.user.previous_login_ip || ''}`
                      : t('never')}
                  </small>
                </div>
              </div>
              <div className="action-row">
                <div>
                  <strong>{tx('تسجيل الخروج من الأجهزة الأخرى', 'Sign out other devices')}</strong>
                  <small>{tx('إن نسيت حسابك مفتوحًا على جهاز آخر.', 'If you left your account open somewhere else.')}</small>
                </div>
                <Button variant="ghost" size="sm" icon="monitor" loading={busy} onClick={signOutOthers}>
                  {tx('إنهاء الجلسات', 'Sign out others')}
                </Button>
              </div>
              <div className="action-row">
                <div>
                  <strong>{tx('لغة الواجهة المفضلة', 'Preferred language')}</strong>
                  <small>{tx('تُحفظ في حسابك.', 'Saved to your account.')}</small>
                </div>
                <div className="lang-toggle" role="group" aria-label={t('language')}>
                  <button type="button" aria-pressed={lang === 'ar'} onClick={() => saveLang('ar')}>
                    عربي
                  </button>
                  <button type="button" aria-pressed={lang === 'en'} onClick={() => saveLang('en')}>
                    English
                  </button>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
