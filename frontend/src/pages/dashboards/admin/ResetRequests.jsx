import { useState } from 'react'
import { Link } from 'react-router-dom'
import Button from '../../../components/Button'
import Modal from '../../../components/Modal'
import { Checkbox } from '../../../components/Fields'
import { Badge, EmptyState, ErrorState, PageHeader, SkeletonRows } from '../../../components/ui'
import { useToast } from '../../../components/Toast'
import { useAsync } from '../../../components/useAsync'
import { adminApi } from '../../../api/admin'
import { useI18n } from '../../../i18n/I18nContext'
import { errorText } from '../../../lib/errors'
import { fmtDateTime, fmtPhone, fmtRelative } from '../../../lib/format'
import { TempPasswordNotice } from './shared'

const TONES = { pending: 'gold', resolved: 'success', dismissed: 'neutral' }

export default function ResetRequests() {
  const { t, tx, pick, locale } = useI18n()
  const toast = useToast()
  const { data, error, loading, reload } = useAsync(() => adminApi.resets(), [])
  const [handling, setHandling] = useState(null)
  const [verified, setVerified] = useState(false)
  const [temp, setTemp] = useState(null)
  const [busy, setBusy] = useState(false)

  const close = () => {
    setHandling(null)
    setVerified(false)
    setTemp(null)
  }

  const resolve = async (row, action) => {
    setBusy(true)
    try {
      const result = await adminApi.resolveReset(row.id, action)
      if (action === 'reset') setTemp(result.temp_password)
      else {
        toast.success(tx('تم رفض الطلب.', 'Request dismissed.'))
        close()
      }
      reload()
    } catch (err) {
      toast.error(errorText(err, t))
    } finally {
      setBusy(false)
    }
  }

  const pending = (data || []).filter((r) => r.status === 'pending')
  const handled = (data || []).filter((r) => r.status !== 'pending')

  const Row = ({ r }) => (
    <tr>
      <td className="cell-main">
        {r.user_id ? (
          <>
            {r.user_kind === 'staff' ? (
              <Link to={`/dashboard/admin/users/${r.user_id}`} className="person-name">{pick(r, 'full_name')}</Link>
            ) : (
              <span className="person-name">{pick(r, 'full_name')}</span>
            )}
            <small className="muted" style={{ display: 'block' }}>
              {r.user_kind === 'staff' ? tx('موظف', 'Staff') : tx('مريض', 'Patient')} ·{' '}
              <bdi className="ltr">{r.email || fmtPhone(r.phone)}</bdi>
            </small>
          </>
        ) : (
          <span className="muted">{tx('لا يوجد حساب مطابق', 'No matching account')}</span>
        )}
      </td>
      <td data-label={tx('ما أدخله', 'They entered')} className="ltr mono">{r.identifier}</td>
      <td data-label={tx('الوقت', 'When')}>
        <bdi>{fmtRelative(r.created_at, locale)}</bdi>
        <small className="muted num" style={{ display: 'block' }}>{fmtDateTime(r.created_at, locale)} · {r.ip}</small>
      </td>
      <td data-label={t('status')}>
        <Badge tone={TONES[r.status]}>{t(`status.${r.status}`)}</Badge>
        {r.handled_by_name && <small className="muted" style={{ display: 'block' }}>{r.handled_by_name}</small>}
      </td>
      <td style={{ textAlign: 'end', whiteSpace: 'nowrap' }}>
        {r.status === 'pending' && (
          <div style={{ display: 'inline-flex', gap: 6 }}>
            {r.user_id && r.is_active && (
              <Button size="sm" icon="key" onClick={() => setHandling(r)}>{tx('إعادة التعيين', 'Reset')}</Button>
            )}
            <Button variant="quiet" size="sm" disabled={busy} onClick={() => resolve(r, 'dismiss')}>{tx('رفض', 'Dismiss')}</Button>
          </div>
        )}
      </td>
    </tr>
  )

  const Table = ({ rows }) => (
    <div className="table-wrap">
      <table className="table stack">
        <thead>
          <tr>
            <th>{tx('الحساب', 'Account')}</th>
            <th>{tx('ما أدخله', 'They entered')}</th>
            <th>{tx('الوقت', 'When')}</th>
            <th>{t('status')}</th>
            <th><span className="sr-only">{t('actions')}</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => <Row key={r.id} r={r} />)}
        </tbody>
      </table>
    </div>
  )

  return (
    <div className="page reveal">
      <PageHeader
        eyebrow={tx('الحسابات', 'Accounts')}
        title={tx('طلبات استعادة كلمة المرور', 'Password reset requests')}
        description={tx(
          'تصل هنا طلبات «نسيت كلمة المرور». تحقق من هوية الشخص (حضوريًا أو باتصال على رقمه المسجل) قبل إصدار كلمة مرور مؤقتة.',
          'Requests from “Forgot password” arrive here. Verify the person’s identity (in person or by calling their registered number) before issuing a temporary password.',
        )}
      />
      <section className="card">
        <div className="card-head">
          <h2>{tx('بانتظار المعالجة', 'Waiting')}</h2>
          <Badge tone={pending.length ? 'gold' : 'neutral'} plain>{pending.length}</Badge>
        </div>
        {error ? (
          <ErrorState error={error} onRetry={reload} />
        ) : loading && !data ? (
          <SkeletonRows rows={3} cols={4} />
        ) : !pending.length ? (
          <EmptyState icon="inbox" title={tx('لا توجد طلبات جديدة', 'No new requests')}>
            {tx('كل الطلبات تمت معالجتها.', 'Every request has been handled.')}
          </EmptyState>
        ) : (
          <Table rows={pending} />
        )}
      </section>
      {handled.length > 0 && (
        <section className="card">
          <div className="card-head">
            <h2>{tx('تمت معالجتها خلال ٣٠ يومًا', 'Handled in the last 30 days')}</h2>
          </div>
          <Table rows={handled} />
        </section>
      )}

      <Modal
        open={Boolean(handling)}
        onClose={close}
        busy={busy}
        title={temp ? tx('كلمة مرور مؤقتة جديدة', 'New temporary password') : tx('إعادة تعيين كلمة المرور', 'Reset password')}
        footer={
          temp ? (
            <Button onClick={close}>{tx('تم', 'Done')}</Button>
          ) : (
            <>
              <Button variant="ghost" onClick={close} disabled={busy}>{t('cancel')}</Button>
              <Button icon="key" loading={busy} disabled={!verified} onClick={() => resolve(handling, 'reset')}>
                {tx('إصدار كلمة مؤقتة', 'Issue temporary password')}
              </Button>
            </>
          )
        }
      >
        {handling &&
          (temp ? (
            <TempPasswordNotice password={temp} name={pick(handling, 'full_name')} identifier={handling.email || fmtPhone(handling.phone)} />
          ) : (
            <div className="form">
              <p>
                {tx('الحساب:', 'Account:')} <strong>{pick(handling, 'full_name')}</strong>{' '}
                <bdi className="ltr muted">{handling.email || fmtPhone(handling.phone)}</bdi>
              </p>
              <Checkbox
                checked={verified}
                onChange={(e) => setVerified(e.target.checked)}
                label={tx('تحققت من هوية صاحب الحساب', "I verified the account holder's identity")}
                description={tx('بالبطاقة حضوريًا أو باتصال على الرقم المسجّل في ملفه.', 'With ID in person, or by calling the number on file.')}
              />
            </div>
          ))}
      </Modal>
    </div>
  )
}
