import { useState } from 'react'
import Button from '../Button'
import Icon from '../Icon'
import Modal from '../Modal'
import { Checkbox, ChoiceGroup, SelectField, TextArea, TextField } from '../Fields'
import { Alert, Badge, EmptyState, ErrorState, PageHeader, SkeletonRows } from '../ui'
import { useToast } from '../Toast'
import { useAsync } from '../useAsync'
import { useI18n } from '../../i18n/I18nContext'
import { errorText, fieldErrors } from '../../lib/errors'
import { fmtDate } from '../../lib/format'
import { dayKey } from '../../lib/clinicTime'
import { ConfirmDelete } from '../settings/shared'
import { cleanAmount, money, num, useBilling } from './meta'

// ---------- packages ----------

function PackageModal({ pkg, services, onClose, onSaved }) {
  const { t, tx, lang, locale } = useI18n()
  const { api } = useBilling()
  const toast = useToast()
  const [form, setForm] = useState({
    service_id: pkg?.service_id ? String(pkg.service_id) : '', name_ar: pkg?.name_ar || '', name_en: pkg?.name_en || '',
    sessions: String(pkg?.sessions ?? 6), price: pkg ? String(num(pkg.price)) : '', valid_days: pkg?.valid_days ? String(pkg.valid_days) : '365',
    notes: pkg?.notes || '', is_active: pkg?.is_active ?? true, sort_order: String(pkg?.sort_order ?? 0),
  })
  const [errors, setErrors] = useState({})
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : k === 'price' ? cleanAmount(e.target.value) : e.target.value })
  const service = services.find((s) => String(s.id) === form.service_id)
  const single = service?.price != null ? num(service.price) : null
  const full = single != null ? single * (Number(form.sessions) || 0) : null
  const saving = full && num(form.price) ? Math.round((1 - num(form.price) / full) * 100) : null

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setErrors({})
    try {
      await api.savePackage(pkg?.id, {
        ...form, service_id: Number(form.service_id) || 0, sessions: Number(form.sessions) || 0, price: num(form.price),
        valid_days: form.valid_days ? Number(form.valid_days) : null, notes: form.notes.trim() || null, sort_order: Number(form.sort_order) || 0,
      })
      toast.success(tx('تم حفظ الباقة.', 'Package saved.'))
      onSaved()
      onClose()
    } catch (err) {
      setErrors({ ...fieldErrors(err, t), form: Object.keys(err.fields || {}).length ? null : errorText(err, t) })
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal open onClose={onClose} busy={busy} wide title={pkg ? tx('تعديل الباقة', 'Edit package') : tx('باقة جديدة', 'New package')}
      description={pkg?.sold > 0 ? tx('التعديل يسري على المبيعات القادمة فقط؛ ما اشتراه المرضى لا يتغير.', 'Changes apply to future sales only; what patients already bought stays as it was.') : null}
      footer={<><Button variant="ghost" onClick={onClose} disabled={busy}>{t('cancel')}</Button><Button type="submit" form="pkg-form" icon="check" loading={busy}>{t('save')}</Button></>}>
      <form id="pkg-form" className="form" onSubmit={submit} noValidate>
        {errors.form && <Alert tone="danger">{errors.form}</Alert>}
        <SelectField label={tx('الخدمة', 'Service')} value={form.service_id} onChange={set('service_id')} error={errors.service_id} placeholder={tx('اختر الخدمة', 'Choose the service')}
          options={services.map((s) => ({ value: String(s.id), label: `${s[`name_${lang}`]}${s.price != null ? ` — ${money(s.price, locale)}` : ''}` }))} data-autofocus />
        <div className="form-grid">
          <TextField label={tx('الاسم بالعربية', 'Name in Arabic')} value={form.name_ar} onChange={set('name_ar')} dir="rtl" error={errors.name_ar} />
          <TextField label={tx('الاسم بالإنجليزية', 'Name in English')} value={form.name_en} onChange={set('name_en')} dir="ltr" error={errors.name_en} />
        </div>
        <div className="form-grid three">
          <TextField label={tx('عدد الجلسات', 'Sessions')} type="number" min={1} max={100} value={form.sessions} onChange={set('sessions')} inputClassName="num" error={errors.sessions} />
          <TextField label={tx('سعر الباقة (ج.م)', 'Package price (EGP)')} value={form.price} onChange={set('price')} inputMode="decimal" dir="ltr" inputClassName="num" error={errors.price}
            hint={saving != null && saving > 0 ? tx(`توفير ${saving}٪ عن ${money(full, locale)}`, `${saving}% off ${money(full, locale)}`) : null} />
          <TextField label={tx('الصلاحية (يوم)', 'Valid for (days)')} optional type="number" min={7} max={1825} value={form.valid_days} onChange={set('valid_days')} inputClassName="num" error={errors.valid_days}
            hint={tx('فارغ = بلا انتهاء', 'Empty = never expires')} />
        </div>
        <TextArea label={tx('ملاحظات', 'Notes')} optional rows={2} value={form.notes} onChange={set('notes')} />
        <div className="form-grid">
          <Checkbox label={tx('متاحة للبيع', 'Available for sale')} description={tx('أوقفها لإخفائها من الفواتير دون حذفها.', 'Turn it off to hide it from invoices without deleting it.')} checked={form.is_active} onChange={set('is_active')} />
          <TextField label={tx('الترتيب', 'Order')} type="number" min={0} max={999} value={form.sort_order} onChange={set('sort_order')} inputClassName="num" />
        </div>
      </form>
    </Modal>
  )
}

export function PackagesSetup() {
  const { t, tx, lang, locale } = useI18n()
  const { api, can } = useBilling()
  const toast = useToast()
  const { data, error, loading, reload } = useAsync(() => Promise.all([api.packages(), api.options()]), [api])
  const [editing, setEditing] = useState(null)
  const [deleting, setDeleting] = useState(null)
  const manage = can('settings.billing')
  const [list, opts] = data || [[], null]
  const toggle = async (k) => {
    try {
      await api.savePackage(k.id, { ...k, price: num(k.price), is_active: !k.is_active })
      toast.success(k.is_active ? tx('أُوقفت الباقة.', 'Package archived.') : tx('أُعيدت الباقة للبيع.', 'Package back on sale.'))
      reload()
    } catch (err) {
      toast.error(errorText(err, t))
    }
  }
  return (
    <div className="page reveal">
      <PageHeader eyebrow={tx('إعدادات الحسابات', 'Billing setup')} title={tx('الباقات', 'Packages')}
        description={tx('عدد جلسات من خدمة بسعر مخفّض. تُباع كبند في الفاتورة وتُستخدم جلساتها في الزيارات التالية.', 'A number of sessions of one service at a reduced price. Sold as an invoice line; its sessions are used on later visits.')}
        actions={manage && <Button icon="plus" onClick={() => setEditing({})}>{tx('باقة جديدة', 'New package')}</Button>} />
      <section className="card">
        {error ? <ErrorState error={error} onRetry={reload} /> : loading && !data ? <SkeletonRows rows={4} cols={5} /> : !list.length ? (
          <EmptyState icon="package" title={tx('لا توجد باقات', 'No packages yet')} action={manage && <Button icon="plus" onClick={() => setEditing({})}>{tx('باقة جديدة', 'New package')}</Button>}>
            {tx('أنشئ أول باقة لتظهر في الفواتير.', 'Create the first package so it shows on invoices.')}
          </EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="table stack">
              <thead><tr><th>{tx('الباقة', 'Package')}</th><th className="num">{tx('الجلسات', 'Sessions')}</th><th className="num">{tx('السعر', 'Price')}</th><th>{tx('الصلاحية', 'Validity')}</th><th className="num">{tx('المبيعات', 'Sold')}</th><th>{tx('الحالة', 'State')}</th>{manage && <th><span className="sr-only">{tx('إجراءات', 'Actions')}</span></th>}</tr></thead>
              <tbody>
                {list.map((k) => {
                  const full = k.single_price != null ? num(k.single_price) * k.sessions : null
                  const off = full ? Math.round((1 - num(k.price) / full) * 100) : null
                  return (
                    <tr key={k.id} className={k.is_active ? '' : 'row-muted'}>
                      <td className="cell-main"><strong>{k[`name_${lang}`]}</strong><small className="muted" style={{ display: 'block' }}><span className="mono">{k.service_code}</span> · {k[`service_name_${lang}`]}</small></td>
                      <td className="num" data-label={tx('الجلسات', 'Sessions')}>{k.sessions}</td>
                      <td className="num" data-label={tx('السعر', 'Price')}><strong>{money(k.price, locale)}</strong>{off > 0 && <small className="ok-text" style={{ display: 'block' }}>{tx(`توفير ${off}٪`, `${off}% off`)}</small>}</td>
                      <td data-label={tx('الصلاحية', 'Validity')}>{k.valid_days ? tx(`${k.valid_days} يوم`, `${k.valid_days} days`) : tx('بلا انتهاء', 'No expiry')}</td>
                      <td className="num" data-label={tx('المبيعات', 'Sold')}>{k.sold}{k.active_sold > 0 && <small className="muted" style={{ display: 'block' }}>{tx(`${k.active_sold} سارية`, `${k.active_sold} active`)}</small>}</td>
                      <td data-label={tx('الحالة', 'State')}>{k.is_active ? <Badge tone="success">{tx('متاحة', 'On sale')}</Badge> : <Badge>{tx('مؤرشفة', 'Archived')}</Badge>}</td>
                      {manage && (
                        <td className="row-actions">
                          <Button variant="quiet" size="sm" className="btn-icon" aria-label={tx('تعديل', 'Edit')} onClick={() => setEditing(k)}><Icon name="edit" size={16} /></Button>
                          <Button variant="quiet" size="sm" className="btn-icon" aria-label={k.is_active ? tx('أرشفة', 'Archive') : tx('إعادة للبيع', 'Put back on sale')} title={k.is_active ? tx('أرشفة', 'Archive') : tx('إعادة للبيع', 'Put back on sale')} onClick={() => toggle(k)}><Icon name="power" size={16} /></Button>
                          {k.sold === 0 && <Button variant="quiet" size="sm" className="btn-icon" aria-label={tx('حذف', 'Delete')} onClick={() => setDeleting(k)}><Icon name="x" size={16} /></Button>}
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {manage && <p className="muted foot-note"><Icon name="info" size={14} /> {tx('الباقة التي بيعت لا تُحذف؛ أرشفها لإيقاف بيعها.', "A package that has been sold can't be deleted; archive it to stop selling it.")}</p>}
      {editing && opts && <PackageModal pkg={editing.id ? editing : null} services={opts.services} onClose={() => setEditing(null)} onSaved={reload} />}
      <ConfirmDelete open={Boolean(deleting)} onClose={() => setDeleting(null)} title={tx('حذف الباقة؟', 'Delete this package?')}
        onConfirm={async () => { await api.deletePackage(deleting.id); reload() }}>
        {deleting && deleting[`name_${lang}`]}
      </ConfirmDelete>
    </div>
  )
}

// ---------- doctor shares ----------

function ShareModal({ rule, doctors, services, onClose, onSaved }) {
  const { t, tx, lang } = useI18n()
  const { api } = useBilling()
  const toast = useToast()
  const [form, setForm] = useState({
    doctor_id: rule?.doctor_id || '', service_id: rule?.service_id ? String(rule.service_id) : '', kind: rule?.kind || 'percent',
    value: rule ? String(num(rule.value)) : '', deduct_cost: rule?.deduct_cost ?? true, starts_on: rule?.starts_on || dayKey(),
  })
  const [errors, setErrors] = useState({})
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : k === 'value' ? cleanAmount(e.target.value) : e.target.value })
  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setErrors({})
    try {
      await api.saveShare(rule?.id, { ...form, service_id: form.service_id ? Number(form.service_id) : null, value: num(form.value), doctor_id: form.doctor_id || null })
      toast.success(tx('تم حفظ القاعدة.', 'Rule saved.'))
      onSaved()
      onClose()
    } catch (err) {
      setErrors({ ...fieldErrors(err, t), form: Object.keys(err.fields || {}).length ? null : errorText(err, t) })
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal open onClose={onClose} busy={busy} wide title={rule ? tx('تعديل قاعدة الحصة', 'Edit share rule') : tx('قاعدة حصة جديدة', 'New share rule')}
      description={tx('تُحسب حصة الطبيب عند إصدار الفاتورة وتُحفظ معها؛ تغيير القاعدة لا يغيّر الفواتير السابقة.', "The doctor's share is worked out when the invoice is issued and saved with it; changing a rule doesn't change past invoices.")}
      footer={<><Button variant="ghost" onClick={onClose} disabled={busy}>{t('cancel')}</Button><Button type="submit" form="share-form" icon="check" loading={busy}>{t('save')}</Button></>}>
      <form id="share-form" className="form" onSubmit={submit} noValidate>
        {errors.form && <Alert tone="danger">{errors.form}</Alert>}
        <div className="form-grid">
          <SelectField label={tx('الطبيب', 'Doctor')} value={form.doctor_id} onChange={set('doctor_id')} error={errors.doctor_id} placeholder={tx('اختر الطبيب', 'Choose the doctor')}
            options={doctors.map((d) => ({ value: d.id, label: d[`full_name_${lang}`] }))} data-autofocus />
          <SelectField label={tx('الخدمة', 'Service')} value={form.service_id} onChange={set('service_id')} error={errors.service_id}
            options={[{ value: '', label: tx('كل خدمات الطبيب', "All the doctor's services") }, ...services.map((s) => ({ value: String(s.id), label: s[`name_${lang}`] }))]} />
        </div>
        <ChoiceGroup legend={tx('النوع', 'Type')} name="share-kind" value={form.kind} onChange={(v) => setForm({ ...form, kind: v })}
          options={[{ value: 'percent', label: tx('نسبة من صافي البند', 'Percentage of the line (net)') }, { value: 'fixed', label: tx('مبلغ ثابت لكل وحدة', 'Fixed amount per unit') }]} />
        <div className="form-grid">
          <TextField label={form.kind === 'percent' ? tx('النسبة (%)', 'Percentage (%)') : tx('المبلغ (ج.م)', 'Amount (EGP)')} value={form.value} onChange={set('value')} inputMode="decimal" dir="ltr" inputClassName="num" error={errors.value} />
          <TextField label={tx('تسري من', 'Starts on')} type="date" value={form.starts_on} onChange={set('starts_on')} error={errors.starts_on} />
        </div>
        {form.kind === 'percent' && <Checkbox label={tx('تُخصم التكلفة المباشرة أولًا', 'Take off the direct cost first')} description={tx('النسبة تُحسب بعد خصم تكلفة الخدمة (المستهلكات).', "The percentage is worked out after the service's direct cost (consumables).")} checked={form.deduct_cost} onChange={set('deduct_cost')} />}
      </form>
    </Modal>
  )
}

export function SharesSetup() {
  const { tx, lang, locale } = useI18n()
  const { api } = useBilling()
  const { data, error, loading, reload } = useAsync(() => Promise.all([api.shares(), api.options()]), [api])
  const [editing, setEditing] = useState(null)
  const [deleting, setDeleting] = useState(null)
  const [shares, opts] = data || [null, null]
  return (
    <div className="page reveal">
      <PageHeader eyebrow={tx('إعدادات الحسابات', 'Billing setup')} title={tx('حصص الأطباء', 'Doctor shares')}
        description={tx('قاعدة لخدمة معيّنة تسبق قاعدة "كل الخدمات" لنفس الطبيب. القاعدة الأحدث تاريخًا تحل محل الأقدم.', "A rule for one service wins over the doctor's all-services rule. A newer start date replaces the older rule.")}
        actions={<Button icon="plus" onClick={() => setEditing({})} disabled={!data}>{tx('قاعدة جديدة', 'New rule')}</Button>} />
      <section className="card">
        {error ? <ErrorState error={error} onRetry={reload} /> : loading && !data ? <SkeletonRows rows={5} cols={5} /> : !shares.rules.length ? (
          <EmptyState icon="pie" title={tx('لا توجد قواعد', 'No rules yet')}>{tx('بدون قاعدة تكون حصة الطبيب صفرًا.', "Without a rule the doctor's share is zero.")}</EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="table stack">
              <thead><tr><th>{tx('الطبيب', 'Doctor')}</th><th>{tx('الخدمة', 'Service')}</th><th>{tx('الحصة', 'Share')}</th><th>{tx('تسري من', 'From')}</th><th><span className="sr-only">{tx('إجراءات', 'Actions')}</span></th></tr></thead>
              <tbody>
                {shares.rules.map((r) => (
                  <tr key={r.id} className={r.in_force ? '' : 'row-muted'}>
                    <td className="cell-main"><strong>{r[`doctor_name_${lang}`]}</strong></td>
                    <td data-label={tx('الخدمة', 'Service')}>{r.service_id ? r[`service_name_${lang}`] : <em className="muted">{tx('كل الخدمات', 'All services')}</em>}</td>
                    <td data-label={tx('الحصة', 'Share')}><strong className="num">{r.kind === 'percent' ? `${num(r.value)}%` : money(r.value, locale)}</strong>
                      <small className="muted" style={{ display: 'block' }}>{r.kind === 'percent' ? (r.deduct_cost ? tx('بعد خصم التكلفة', 'after direct cost') : tx('من الصافي', 'of the net')) : tx('لكل وحدة', 'per unit')}</small></td>
                    <td data-label={tx('تسري من', 'From')}><bdi>{fmtDate(r.starts_on, locale)}</bdi> {r.in_force ? <Badge tone="success">{tx('سارية', 'In force')}</Badge> : r.starts_on > dayKey() ? <Badge tone="info">{tx('قادمة', 'Upcoming')}</Badge> : <Badge>{tx('سابقة', 'Replaced')}</Badge>}</td>
                    <td className="row-actions">
                      <Button variant="quiet" size="sm" className="btn-icon" aria-label={tx('تعديل', 'Edit')} onClick={() => setEditing(r)}><Icon name="edit" size={16} /></Button>
                      <Button variant="quiet" size="sm" className="btn-icon" aria-label={tx('حذف', 'Delete')} onClick={() => setDeleting(r)}><Icon name="x" size={16} /></Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {editing && data && <ShareModal rule={editing.id ? editing : null} doctors={shares.doctors} services={opts.services} onClose={() => setEditing(null)} onSaved={reload} />}
      <ConfirmDelete open={Boolean(deleting)} onClose={() => setDeleting(null)} title={tx('حذف القاعدة؟', 'Delete this rule?')}
        onConfirm={async () => { await api.deleteShare(deleting.id); reload() }}>
        {deleting && `${deleting[`doctor_name_${lang}`]} — ${deleting.service_id ? deleting[`service_name_${lang}`] : tx('كل الخدمات', 'All services')}`}
      </ConfirmDelete>
    </div>
  )
}

// ---------- rules ----------

export function RulesSetup() {
  const { t, tx } = useI18n()
  const { api, can } = useBilling()
  const toast = useToast()
  const { data, error, reload, setData } = useAsync(() => api.rules(), [api])
  const [form, setForm] = useState(null)
  const [errors, setErrors] = useState({})
  const [busy, setBusy] = useState(false)
  if (error) return <ErrorState error={error} onRetry={reload} />
  const f = form || (data && { ...data, max_discount_pct: String(data.max_discount_pct), max_installments: String(data.max_installments) })
  const set = (k) => (e) => setForm({ ...f, [k]: e.target.value })
  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setErrors({})
    try {
      const res = await api.saveRules({ ...f, max_discount_pct: Number(f.max_discount_pct) || 0, max_installments: Number(f.max_installments) || 0 })
      setData(res)
      setForm(null)
      toast.success(tx('تم حفظ القواعد.', 'Rules saved.'))
    } catch (err) {
      setErrors({ ...fieldErrors(err, t), form: errorText(err, t) })
    } finally {
      setBusy(false)
    }
  }
  const manage = can('settings.billing')
  return (
    <div className="page reveal">
      <PageHeader eyebrow={tx('إعدادات الحسابات', 'Billing setup')} title={tx('قواعد الفوترة', 'Billing rules')}
        description={tx('حدود الخصم والتقسيط والملاحظة المطبوعة على الإيصال.', 'Discount and installment limits and the note printed on receipts.')} />
      <section className="card" style={{ maxWidth: 720 }}>
        {!f ? <SkeletonRows rows={3} cols={2} /> : (
          <form className="card-body form" onSubmit={submit} noValidate>
            {errors.form && !Object.keys(errors).some((k) => k !== 'form') && <Alert tone="danger">{errors.form}</Alert>}
            <div className="form-grid">
              <TextField label={tx('أقصى خصم بدون اعتماد (%)', 'Max discount without approval (%)')} type="number" min={0} max={100} value={f.max_discount_pct} onChange={set('max_discount_pct')} inputClassName="num" disabled={!manage}
                error={errors.max_discount_pct} hint={tx('ما فوقه يذهب للإدارة. الإدارة لا تحتاج اعتمادًا.', 'Anything above goes to management. Management needs no approval.')} />
              <TextField label={tx('أقصى عدد أقساط', 'Max installments')} type="number" min={0} max={24} value={f.max_installments} onChange={set('max_installments')} inputClassName="num" disabled={!manage}
                error={errors.max_installments} hint={tx('0 = لا تقسيط.', '0 = no installments.')} />
            </div>
            <div className="form-grid">
              <TextArea label={tx('ملاحظة الإيصال بالعربية', 'Receipt note in Arabic')} optional rows={2} dir="rtl" maxLength={200} value={f.receipt_note_ar} onChange={set('receipt_note_ar')} disabled={!manage} />
              <TextArea label={tx('ملاحظة الإيصال بالإنجليزية', 'Receipt note in English')} optional rows={2} dir="ltr" maxLength={200} value={f.receipt_note_en} onChange={set('receipt_note_en')} disabled={!manage} />
            </div>
            {manage && <Button type="submit" icon="check" loading={busy} disabled={!form} style={{ justifySelf: 'start' }}>{t('save')}</Button>}
          </form>
        )}
      </section>
    </div>
  )
}
