import { useState } from 'react'
import Button from '../Button'
import Icon from '../Icon'
import Modal from '../Modal'
import { SelectField, TextField } from '../Fields'
import { Alert, Badge } from '../ui'
import { useToast } from '../Toast'
import { useAsync } from '../useAsync'
import { useI18n } from '../../i18n/I18nContext'
import { errorText, fieldErrors } from '../../lib/errors'
import { fmtDate } from '../../lib/format'
import { ConfirmDelete, fmtMoney, isoDate, useSettings } from './shared'

const blank = () => ({ id: null, doctor_id: '', amount: '', starts_on: isoDate(new Date()), note: '' })

// Price history of one service: the standard price and any doctor-specific prices, each from a start date.
export default function PricesModal({ service, doctors, onClose, onChanged }) {
  const { t, tx, pick, locale } = useI18n()
  const { api, can } = useSettings()
  const toast = useToast()
  const { data, error, reload, setData } = useAsync(() => api.prices.list(service.id), [service.id])
  const [form, setForm] = useState(null)
  const [errors, setErrors] = useState({})
  const [busy, setBusy] = useState(false)
  const [deleting, setDeleting] = useState(null)
  const editable = can('settings.prices')
  const today = isoDate(new Date())

  const save = async (event) => {
    event.preventDefault()
    const e = {}
    if (form.amount === '' || Number(form.amount) < 0) e.amount = t('field.required')
    if (!form.starts_on) e.starts_on = t('field.required')
    setErrors(e)
    if (Object.keys(e).length) return
    setBusy(true)
    try {
      const body = { doctor_id: form.doctor_id || null, amount: Number(form.amount), starts_on: form.starts_on, note: form.note || null }
      setData(form.id ? await api.prices.edit(service.id, form.id, body) : await api.prices.add(service.id, body))
      toast.success(tx('تم حفظ السعر.', 'Price saved.'))
      setForm(null)
      onChanged()
    } catch (err) {
      const fields = fieldErrors(err, t)
      if (err.fields?.starts_on === 'taken') fields.starts_on = tx('يوجد سعر يبدأ في نفس اليوم. عدّله بدلًا من إضافة جديد.', 'A price already starts on this day. Edit it instead.')
      setErrors(fields)
      if (!Object.keys(fields).length) toast.error(errorText(err, t))
    } finally {
      setBusy(false)
    }
  }

  const rows = data?.prices || []
  const groups = [
    { key: 'std', title: tx('السعر الأساسي', 'Standard price'), rows: rows.filter((r) => !r.doctor_id) },
    ...[...new Set(rows.filter((r) => r.doctor_id).map((r) => r.doctor_id))].map((id) => {
      const first = rows.find((r) => r.doctor_id === id)
      return { key: id, title: tx(`سعر ${pick(first, 'doctor_name')}`, `${pick(first, 'doctor_name')}'s price`), rows: rows.filter((r) => r.doctor_id === id) }
    }),
  ]
  const status = (r) => {
    if (r.in_force) return <Badge tone="success">{tx('السعر الحالي', 'Current')}</Badge>
    if (r.starts_on > today) return <Badge tone="info">{tx('يبدأ لاحقًا', 'Scheduled')}</Badge>
    return <Badge tone="neutral" plain>{tx('سابق', 'Past')}</Badge>
  }

  return (
    <Modal open wide onClose={onClose} busy={busy} title={pick(service)}
      description={`${service.code} · ${tx('الأسعار تبدأ من تاريخ محدد؛ السعر المطبق هو آخر سعر بدأ قبل يوم الخدمة.', 'Prices start on a date; the one that applies is the latest that started on or before the service day.')}`}
      footer={<Button onClick={onClose}>{t('close')}</Button>}>
      <div className="form">
        {error && <Alert tone="danger">{errorText(error, t)}</Alert>}
        {groups.map((g) => (
          <section key={g.key} className="card">
            <div className="card-head"><h3>{g.title}</h3></div>
            {!g.rows.length ? (
              <p className="muted card-body" style={{ fontSize: '.9rem' }}>{tx('لا يوجد سعر بعد.', 'No price yet.')}</p>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>{tx('يبدأ من', 'Starts on')}</th><th>{tx('السعر', 'Price')}</th><th>{tx('ملاحظة', 'Note')}</th><th>{t('status')}</th><th /></tr></thead>
                  <tbody>
                    {g.rows.map((r) => (
                      <tr key={r.id}>
                        <td className="num">{fmtDate(r.starts_on, locale)}</td>
                        <td className="num" style={{ fontWeight: 600 }}>{fmtMoney(r.amount, locale)}</td>
                        <td className="muted">{r.note || '—'}</td>
                        <td>{status(r)}</td>
                        <td style={{ textAlign: 'end', whiteSpace: 'nowrap' }}>
                          {editable && (
                            <>
                              <Button variant="quiet" size="sm" className="btn-icon" aria-label={t('edit')}
                                onClick={() => { setErrors({}); setForm({ id: r.id, doctor_id: r.doctor_id || '', amount: String(r.amount), starts_on: r.starts_on, note: r.note || '' }) }}>
                                <Icon name="edit" size={16} />
                              </Button>
                              <Button variant="quiet" size="sm" className="btn-icon" aria-label={tx('حذف', 'Delete')} onClick={() => setDeleting(r)}>
                                <Icon name="x" size={16} />
                              </Button>
                            </>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        ))}

        {editable && !form && (
          <Button variant="ghost" icon="plus" onClick={() => { setErrors({}); setForm(blank()) }} style={{ justifySelf: 'start' }}>
            {tx('إضافة سعر', 'Add a price')}
          </Button>
        )}
        {editable && form && (
          <form className="card card-pad form" onSubmit={save} noValidate>
            <h3 style={{ fontSize: '1rem' }}>{form.id ? tx('تعديل السعر', 'Edit price') : tx('سعر جديد', 'New price')}</h3>
            <div className="form-grid">
              <SelectField label={tx('ينطبق على', 'Applies to')} value={form.doctor_id} onChange={(e) => setForm({ ...form, doctor_id: e.target.value })}
                options={[{ value: '', label: tx('كل الأطباء (السعر الأساسي)', 'All doctors (standard price)') },
                  ...doctors.map((d) => ({ value: d.id, label: tx(`${pick(d, 'full_name')} فقط`, `Only ${pick(d, 'full_name')}`) }))]} />
              <TextField label={tx('السعر (جنيه)', 'Price (EGP)')} type="number" min="0" step="0.01" inputMode="decimal" dir="ltr"
                value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} error={errors.amount} data-autofocus />
              <TextField label={tx('يبدأ من', 'Starts on')} type="date" value={form.starts_on} onChange={(e) => setForm({ ...form, starts_on: e.target.value })}
                error={errors.starts_on} hint={tx('اختر تاريخًا قادمًا لجدولة تغيير السعر.', 'Pick a future date to schedule a price change.')} />
              <TextField label={tx('ملاحظة', 'Note')} optional value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })}
                placeholder={tx('مثال: قائمة أسعار ٢٠٢٧', 'e.g. 2027 price list')} />
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <Button type="submit" loading={busy}>{t('save')}</Button>
              <Button variant="ghost" onClick={() => setForm(null)} disabled={busy}>{t('cancel')}</Button>
            </div>
          </form>
        )}
      </div>
      <ConfirmDelete open={Boolean(deleting)} onClose={() => setDeleting(null)} title={tx('حذف السعر', 'Delete price')}
        onConfirm={async () => { setData(await api.prices.remove(service.id, deleting.id)); onChanged(); reload() }}>
        {deleting && `${fmtMoney(deleting.amount, locale)} · ${fmtDate(deleting.starts_on, locale)}`}
      </ConfirmDelete>
    </Modal>
  )
}
