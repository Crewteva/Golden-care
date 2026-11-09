import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import Button from '../Button'
import Icon from '../Icon'
import Modal from '../Modal'
import { Checkbox, SelectField, TextArea, TextField } from '../Fields'
import { Alert, Badge, EmptyState, ErrorState, PageHeader, SkeletonRows } from '../ui'
import { useToast } from '../Toast'
import { useAsync } from '../useAsync'
import { useI18n } from '../../i18n/I18nContext'
import { errorText, fieldText } from '../../lib/errors'
import { cleanAmount, cleanQty, money, num, qty, useInventory } from './meta'

const TABS = [
  ['items', { ar: 'الأصناف', en: 'Items' }, 'box'],
  ['categories', { ar: 'الفئات', en: 'Categories' }, 'layers'],
  ['units', { ar: 'الوحدات', en: 'Units' }, 'calculator'],
  ['stores', { ar: 'المخازن', en: 'Stores' }, 'building'],
  ['suppliers', { ar: 'الموردون', en: 'Suppliers' }, 'truck'],
  ['device-types', { ar: 'أنواع الأجهزة', en: 'Device types' }, 'monitor'],
]
const ONE = {
  items: { ar: 'صنف', en: 'item' },
  categories: { ar: 'فئة', en: 'category' },
  units: { ar: 'وحدة', en: 'unit' },
  stores: { ar: 'مخزن', en: 'store' },
  suppliers: { ar: 'مورد', en: 'supplier' },
  'device-types': { ar: 'نوع جهاز', en: 'device type' },
}

export default function Setup() {
  const { tx, lang } = useI18n()
  const { api, canManage, canApprove } = useInventory()
  const [params, setParams] = useSearchParams()
  const tab = TABS.some(([k]) => k === params.get('tab')) ? params.get('tab') : 'items'
  const { data, error, loading, reload } = useAsync(() => api.list(tab), [tab, api])
  const [editing, setEditing] = useState(null)
  const [removing, setRemoving] = useState(null)
  return (
    <div className="page reveal">
      <PageHeader eyebrow={tx('المخازن والمشتريات', 'Stock & purchasing')} title={tx('القوائم والإعدادات', 'Lists & settings')}
        description={tx('ما لم يُستخدم يُحذف؛ ما استُخدم في حركة أو أمر أو جهاز يُوقف فقط ليبقى سجله مقروءًا.', "Anything never used is deleted; anything already used in a movement, order or device is switched off so its history stays readable.")} />
      <ApprovalLimit editable={canApprove} />
      <section className="card">
        <div className="toolbar">
          <div className="tabs setup-tabs" role="tablist" aria-label={tx('القائمة', 'List')}>
            {TABS.map(([k, label, icon]) => (
              <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setParams({ tab: k }, { replace: true })}><Icon name={icon} size={15} />{label[lang]}</button>
            ))}
          </div>
          {canManage && <div className="toolbar-end"><Button icon="plus" size="sm" onClick={() => setEditing({})}>{tx(`إضافة ${ONE[tab].ar}`, `Add ${ONE[tab].en}`)}</Button></div>}
        </div>
        {error ? <ErrorState error={error} onRetry={reload} /> : loading && !data ? <SkeletonRows rows={5} cols={4} /> : !data.length ? (
          <EmptyState icon="inbox" title={tx('القائمة فارغة', 'Nothing here yet')} action={canManage && <Button icon="plus" onClick={() => setEditing({})}>{tx('إضافة', 'Add')}</Button>} />
        ) : (
          <div className="table-wrap"><SetupTable kind={tab} rows={data} onEdit={canManage ? setEditing : null} onDelete={canManage ? setRemoving : null} /></div>
        )}
      </section>
      {editing && <SetupModal kind={tab} row={editing.id ? editing : null} onClose={() => setEditing(null)} onDone={() => { setEditing(null); reload() }} />}
      {removing && <DeleteModal kind={tab} row={removing} onClose={() => setRemoving(null)} onDone={() => { setRemoving(null); reload() }} />}
    </div>
  )
}

function SetupTable({ kind, rows, onEdit, onDelete }) {
  const { tx, pick, locale } = useI18n()
  const name = (r) => r.name || pick(r)
  const cols = {
    items: [[tx('الفئة', 'Category'), (r) => pick(r, 'category') || '—'], [tx('الوحدة', 'Unit'), (r) => pick(r, 'unit')],
      [tx('الحد الأدنى', 'Minimum'), (r) => qty(r.min_qty, locale), 'num'], [tx('الصلاحية', 'Expiry'), (r) => (r.tracks_expiry ? tx('تُتابع', 'Tracked') : '—')]],
    categories: [[tx('الأصناف', 'Items'), (r) => r.items, 'num']],
    units: [[tx('الأصناف', 'Items'), (r) => r.items, 'num']],
    stores: [[tx('الفرع', 'Branch'), (r) => pick(r, 'branch')]],
    suppliers: [[tx('التواصل', 'Contact'), (r) => [r.contact_name, r.phone].filter(Boolean).join(' · ') || '—'], [tx('مدة السداد', 'Terms'), (r) => tx(`${r.payment_terms_days} يوم`, `${r.payment_terms_days} days`)]],
    'device-types': [[tx('ليزر', 'Laser'), (r) => (r.is_laser ? <Badge tone="gold">{tx('ليزر', 'Laser')}</Badge> : '—')], [tx('الأجهزة', 'Devices'), (r) => r.devices, 'num']],
  }[kind]
  return (
    <table className="table acc-table">
      <thead><tr><th>{tx('الاسم', 'Name')}</th>{cols.map(([h, , c]) => <th key={h} className={c}>{h}</th>)}<th>{tx('الحالة', 'Status')}</th>{onEdit && <th><span className="sr-only">{tx('إجراءات', 'Actions')}</span></th>}</tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} className={r.is_active ? '' : 'row-off'}>
            <td className="cell-wrap"><strong>{name(r)}</strong>{r.name_ar && r.name_en && <small className="muted" style={{ display: 'block' }}>{locale.startsWith('ar') ? r.name_en : r.name_ar}</small>}</td>
            {cols.map(([h, fn, c]) => <td key={h} className={c}>{fn(r)}</td>)}
            <td>{r.is_active ? <Badge tone="success">{tx('نشط', 'Active')}</Badge> : <Badge>{tx('موقوف', 'Off')}</Badge>}</td>
            {onEdit && (
              <td className="row-actions">
                <button type="button" className="btn btn-quiet btn-icon" onClick={() => onEdit(r)} aria-label={tx(`تعديل ${name(r)}`, `Edit ${name(r)}`)}><Icon name="edit" size={16} /></button>
                <button type="button" className="btn btn-quiet btn-icon" onClick={() => onDelete(r)} aria-label={tx(`حذف ${name(r)}`, `Delete ${name(r)}`)}><Icon name="x" size={16} /></button>
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

const EMPTY = {
  items: { name_ar: '', name_en: '', category_id: '', unit_id: '', min_qty: '', tracks_expiry: true, notes: '', is_active: true },
  categories: { name_ar: '', name_en: '', is_active: true },
  units: { name_ar: '', name_en: '', is_active: true },
  stores: { branch_id: '', name_ar: '', name_en: '', is_active: true },
  suppliers: { name: '', contact_name: '', phone: '', email: '', address: '', payment_terms_days: '30', notes: '', is_active: true },
  'device-types': { name_ar: '', name_en: '', is_laser: false, is_active: true },
}

export function SetupModal({ kind, row, onClose, onDone }) {
  const { t, tx, pick, lang } = useI18n()
  const { api } = useInventory()
  const toast = useToast()
  const options = useAsync(() => (['items', 'stores'].includes(kind) ? api.options() : Promise.resolve(null)), [kind, api])
  const [f, setF] = useState(() => {
    const base = EMPTY[kind]
    if (!row) return base
    return Object.fromEntries(Object.keys(base).map((k) => [k, typeof base[k] === 'boolean' ? !!row[k] : row[k] === null || row[k] === undefined ? '' : String(k === 'min_qty' ? num(row[k]) : row[k])]))
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const fe = error?.fields || {}
  const set = (k, clean) => (e) => setF((s) => ({ ...s, [k]: clean ? clean(e.target.value) : e.target.value }))
  const setB = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.checked }))
  const submit = async () => {
    setBusy(true)
    setError(null)
    const body = { ...f }
    Object.keys(body).forEach((k) => { if (typeof body[k] === 'string') body[k] = body[k].trim() })
    if (kind === 'items') Object.assign(body, { category_id: Number(body.category_id) || null, unit_id: Number(body.unit_id) || null, min_qty: body.min_qty || '0', notes: body.notes || null })
    if (kind === 'stores') body.branch_id = Number(body.branch_id) || null
    if (kind === 'suppliers') Object.assign(body, { payment_terms_days: Number(body.payment_terms_days || 0), email: body.email || null, notes: body.notes || null })
    try {
      await api.saveRow(kind, row?.id, body)
      toast.success(row ? tx('حُفظت التعديلات.', 'Changes saved.') : tx('أُضيف.', 'Added.'))
      onDone()
    } catch (err) {
      setError(err)
      setBusy(false)
    }
  }
  const o = options.data
  const ready = kind === 'suppliers' ? f.name.trim() : f.name_ar.trim() && f.name_en.trim() && (kind !== 'items' || f.unit_id) && (kind !== 'stores' || f.branch_id)
  const known = Object.keys(fe).some((k) => k in f)
  return (
    <Modal open wide={kind === 'items' || kind === 'suppliers'} onClose={onClose} busy={busy}
      title={row ? tx(`تعديل ${ONE[kind].ar}`, `Edit ${ONE[kind].en}`) : tx(`إضافة ${ONE[kind].ar}`, `Add ${ONE[kind].en}`)}
      footer={<><Button variant="ghost" onClick={onClose} disabled={busy}>{t('cancel')}</Button><Button icon="check" loading={busy} disabled={!ready} onClick={submit}>{t('save')}</Button></>}>
      <div className="form">
        {error && !known && <Alert tone="danger">{errorText(error, t)}</Alert>}
        {kind === 'suppliers' ? (
          <>
            <TextField label={tx('اسم المورد', 'Supplier name')} dir="auto" value={f.name} onChange={set('name')} data-autofocus error={fieldText('name', fe.name, t)} />
            <div className="form-grid">
              <TextField label={tx('مسؤول التواصل', 'Contact person')} optional dir="auto" value={f.contact_name} onChange={set('contact_name')} />
              <TextField label={tx('الهاتف', 'Phone')} optional dir="ltr" inputMode="tel" value={f.phone} onChange={set('phone')} error={fieldText('phone', fe.phone, t)} />
              <TextField label={tx('البريد الإلكتروني', 'Email')} optional dir="ltr" type="email" value={f.email} onChange={set('email')} error={fieldText('email', fe.email, t)} />
              <TextField label={tx('مدة السداد (يوم)', 'Payment terms (days)')} inputMode="numeric" dir="ltr" value={f.payment_terms_days} onChange={set('payment_terms_days', (v) => v.replace(/\D/g, '').slice(0, 3))}
                hint={tx('الفاتورة تستحق بعد هذه المدة من تاريخها', 'Bills fall due this many days after their date')} error={fieldText('payment_terms_days', fe.payment_terms_days, t)} />
            </div>
            <TextField label={tx('العنوان', 'Address')} optional dir="auto" value={f.address} onChange={set('address')} />
            <TextArea label={tx('ملاحظات', 'Notes')} optional rows={2} value={f.notes} onChange={set('notes')} />
          </>
        ) : (
          <div className="form-grid">
            <TextField label={tx('الاسم بالعربية', 'Name in Arabic')} dir="rtl" lang="ar" value={f.name_ar} onChange={set('name_ar')} data-autofocus={lang === 'ar' || undefined} error={fieldText('name_ar', fe.name_ar, t)} />
            <TextField label={tx('الاسم بالإنجليزية', 'Name in English')} dir="ltr" lang="en" value={f.name_en} onChange={set('name_en')} data-autofocus={lang === 'en' || undefined} error={fieldText('name_en', fe.name_en, t)} />
            {kind === 'items' && o && <>
              <SelectField label={tx('الفئة', 'Category')} optional value={f.category_id} onChange={set('category_id')} placeholder={tx('بلا فئة', 'No category')}
                options={o.categories.filter((c) => c.is_active || String(c.id) === f.category_id).map((c) => ({ value: String(c.id), label: pick(c) }))} error={fieldText('category_id', fe.category_id, t)} />
              <SelectField label={tx('وحدة الصرف', 'Unit')} value={f.unit_id} onChange={set('unit_id')} placeholder={tx('اختر الوحدة', 'Choose a unit')}
                options={o.units.filter((u) => u.is_active || String(u.id) === f.unit_id).map((u) => ({ value: String(u.id), label: pick(u) }))} error={fieldText('unit_id', fe.unit_id, t)} />
              <TextField label={tx('الحد الأدنى', 'Minimum stock')} inputMode="decimal" dir="ltr" value={f.min_qty} onChange={set('min_qty', cleanQty)} placeholder="0"
                hint={tx('ينبّه عند النزول عنه (لكل المخازن معًا)', 'Alerts when stock falls below it (all stores together)')} error={fieldText('min_qty', fe.min_qty, t)} />
              <Checkbox className="span-1 check-pad" label={tx('له تاريخ صلاحية', 'Has an expiry date')} description={tx('تُطلب الصلاحية عند الاستلام ويُصرف الأقرب انتهاءً أولًا', 'Expiry is required on delivery; the first to expire goes out first')} checked={f.tracks_expiry} onChange={setB('tracks_expiry')} />
              <TextArea className="span-2" label={tx('ملاحظات', 'Notes')} optional rows={2} value={f.notes} onChange={set('notes')} />
            </>}
            {kind === 'stores' && o && (
              <SelectField className="span-2" label={tx('الفرع', 'Branch')} value={f.branch_id} onChange={set('branch_id')} placeholder={tx('اختر الفرع', 'Choose a branch')}
                hint={tx('مخزن واحد لكل فرع', 'One store per branch')} options={o.branches.map((b) => ({ value: String(b.id), label: pick(b) }))} error={fieldText('branch_id', fe.branch_id, t)} />
            )}
            {kind === 'device-types' && (
              <Checkbox className="span-2" label={tx('جهاز ليزر', 'Laser device')} description={tx('يظهر في اختيار الجهاز بجلسات الليزر', 'Offered as a device in laser sessions')} checked={f.is_laser} onChange={setB('is_laser')} />
            )}
          </div>
        )}
        {row && <Checkbox label={tx('نشط', 'Active')} description={tx('الموقوف لا يظهر في الاختيارات الجديدة، ويبقى في السجلات', "Switched-off entries aren't offered for new records but stay in the history")} checked={f.is_active} onChange={setB('is_active')} />}
      </div>
    </Modal>
  )
}

function DeleteModal({ kind, row, onClose, onDone }) {
  const { t, tx, pick } = useI18n()
  const { api } = useInventory()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const name = row.name || pick(row)
  const submit = async () => {
    setBusy(true)
    try {
      const res = await api.deleteRow(kind, row.id)
      toast.success(res.switched_off ? tx(`«${name}» مستخدم في سجلات سابقة، فأُوقف بدل حذفه.`, `“${name}” is already used in records, so it was switched off instead.`) : tx(`حُذف «${name}».`, `“${name}” deleted.`))
      onDone()
    } catch (err) {
      setError(err)
      setBusy(false)
    }
  }
  return (
    <Modal open onClose={onClose} busy={busy} title={tx(`حذف «${name}»؟`, `Delete “${name}”?`)}
      footer={<><Button variant="ghost" onClick={onClose} disabled={busy}>{t('cancel')}</Button><Button icon="x" loading={busy} onClick={submit}>{tx('حذف', 'Delete')}</Button></>}>
      {error && <Alert tone="danger">{errorText(error, t)}</Alert>}
      <p>{tx('إن لم يُستخدم في أي سجل يُحذف نهائيًا. وإن استُخدم يُوقف فقط ويبقى في السجلات القديمة.', "If it was never used in any record it's deleted for good. If it was, it's switched off and stays in the old records.")}</p>
    </Modal>
  )
}

function ApprovalLimit({ editable }) {
  const { t, tx, locale } = useI18n()
  const { api } = useInventory()
  const toast = useToast()
  const { data, reload } = useAsync(() => api.options(), [api])
  const [value, setValue] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  if (!data) return null
  const limit = num(data.approval_limit)
  const save = async () => {
    setBusy(true)
    setError(null)
    try {
      await api.saveLimit({ approval_limit: value || '0' })
      toast.success(tx('حُفظ حد الاعتماد.', 'Approval limit saved.'))
      setValue(null)
      reload()
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="card limit-card">
      <Icon name="shieldCheck" size={22} />
      <div className="limit-text">
        <strong>{tx('حد اعتماد أوامر الشراء', 'Purchase order approval limit')}</strong>
        <span className="muted">{limit > 0 ? tx(`الأوامر أعلى من ${money(limit, locale)} تحتاج اعتماد الإدارة.`, `Orders above ${money(limit, locale)} need management approval.`) : tx('صفر: كل الأوامر تحتاج اعتماد الإدارة.', 'Zero: every order needs management approval.')}</span>
      </div>
      {editable && (value === null
        ? <Button variant="ghost" size="sm" icon="edit" onClick={() => setValue(String(limit))}>{tx('تغيير', 'Change')}</Button>
        : (
          <div className="limit-edit">
            <TextField label={tx('الحد (ج.م)', 'Limit (EGP)')} inputMode="decimal" dir="ltr" value={value} onChange={(e) => setValue(cleanAmount(e.target.value))} error={error ? fieldText('approval_limit', error.fields?.approval_limit, t) || errorText(error, t) : undefined} />
            <Button size="sm" icon="check" loading={busy} onClick={save}>{t('save')}</Button>
            <Button size="sm" variant="quiet" onClick={() => setValue(null)} disabled={busy}>{t('cancel')}</Button>
          </div>
        ))}
    </section>
  )
}
