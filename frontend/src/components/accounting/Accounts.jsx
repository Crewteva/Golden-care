import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import Button from '../Button'
import Icon from '../Icon'
import Modal from '../Modal'
import { Checkbox, SelectField, TextField } from '../Fields'
import { Alert, Badge, ErrorState, PageHeader, SkeletonRows } from '../ui'
import { useToast } from '../Toast'
import { useAsync, useDebounced } from '../useAsync'
import { useI18n } from '../../i18n/I18nContext'
import { errorText, fieldText } from '../../lib/errors'
import { ACCOUNT_TYPE, TYPE_ORDER, money, num, useAccounting } from './meta'

// Chart of accounts. The accountant can add accounts and rename any of them; accounts the system posts to keep their type.
export default function Accounts() {
  const { tx, pick, lang, locale } = useI18n()
  const { api, base, canSetup } = useAccounting()
  const [editing, setEditing] = useState(null)
  const [q, setQ] = useState('')
  const [hideEmpty, setHideEmpty] = useState(false)
  const query = useDebounced(q.trim().toLowerCase(), 150)
  const { data, error, loading, reload } = useAsync(() => api.accounts(), [api])

  const groups = useMemo(() => {
    const list = (data || []).filter((a) => (!query || `${a.code} ${a.name_ar} ${a.name_en}`.toLowerCase().includes(query)) && (!hideEmpty || num(a.lines) > 0))
    return TYPE_ORDER.map((type) => {
      const rows = list.filter((a) => a.type === type)
      return { type, rows, total: rows.reduce((s, a) => s + num(a.balance), 0) }
    }).filter((g) => g.rows.length)
  }, [data, query, hideEmpty])

  return (
    <div className="page reveal">
      <PageHeader eyebrow={tx('الحسابات العامة', 'Accounting')} title={tx('دليل الحسابات', 'Chart of accounts')}
        description={tx('الحسابات المميزة بقفل يستخدمها النظام في القيود التلقائية: يمكن تغيير اسمها ورقمها لكن ليس نوعها.', 'Accounts marked with a lock are used by the automatic entries: you can rename and renumber them, but not change their type.')}
        actions={canSetup && <Button icon="plus" onClick={() => setEditing({})}>{tx('حساب جديد', 'New account')}</Button>} />
      <section className="card">
        <div className="toolbar">
          <div className="filters">
            <TextField label={tx('بحث', 'Search')} icon="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={tx('الرقم أو الاسم', 'Code or name')} />
          </div>
          <Checkbox label={tx('إخفاء الحسابات بلا حركة', 'Hide accounts with no movement')} checked={hideEmpty} onChange={(e) => setHideEmpty(e.target.checked)} />
        </div>
        {error ? <ErrorState error={error} onRetry={reload} /> : loading && !data ? <SkeletonRows rows={8} cols={4} /> : (
          <div className="table-wrap">
            <table className="table coa-table">
              <thead><tr><th>{tx('الرقم', 'Code')}</th><th>{tx('الحساب', 'Account')}</th><th className="num">{tx('الحركات', 'Lines')}</th><th className="num">{tx('الرصيد', 'Balance')}</th><th><span className="sr-only">{tx('إجراء', 'Action')}</span></th></tr></thead>
              {groups.map((g) => (
                <tbody key={g.type}>
                  <tr className="coa-group"><th colSpan={3} scope="rowgroup"><span className={`type-dot t-${g.type}`} />{ACCOUNT_TYPE[g.type][lang]}</th><td className="num">{money(g.total, locale)}</td><td /></tr>
                  {g.rows.map((a) => (
                    <tr key={a.id} className={a.is_active ? '' : 'row-muted'}>
                      <td className="mrn">{a.code}</td>
                      <td>
                        <span className="coa-name">
                          {pick(a)}
                          {a.system_key && <Icon name="lock" size={13} title={tx('حساب نظام', 'System account')} />}
                          {a.is_money && <Badge tone="gold" plain>{tx('نقدية', 'Money')}</Badge>}
                          {!a.is_active && <Badge tone="neutral">{tx('موقوف', 'Inactive')}</Badge>}
                        </span>
                        {a.description && <small className="muted" style={{ display: 'block' }}>{a.description}</small>}
                      </td>
                      <td className="num">{num(a.lines) || '—'}</td>
                      <td className={`num ${num(a.balance) < 0 ? 'neg' : ''}`}>{num(a.lines) ? money(a.balance, locale) : '—'}</td>
                      <td className="row-actions">
                        {num(a.lines) > 0 && <Link to={`${base}/reports?r=ledger&account=${a.id}`} className="btn btn-quiet btn-sm"><Icon name="layers" size={15} />{tx('الحركة', 'Ledger')}</Link>}
                        {canSetup && <Button size="sm" variant="quiet" icon="edit" onClick={() => setEditing(a)} aria-label={`${tx('تعديل', 'Edit')} ${pick(a)}`}>{tx('تعديل', 'Edit')}</Button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              ))}
            </table>
            {!groups.length && <p className="muted report-empty">{tx('لا توجد حسابات مطابقة.', 'No matching accounts.')}</p>}
          </div>
        )}
      </section>
      {editing && <AccountModal account={editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); reload() }} />}
    </div>
  )
}

function AccountModal({ account, onClose, onDone }) {
  const { t, tx, lang } = useI18n()
  const { api } = useAccounting()
  const toast = useToast()
  const isNew = !account.id
  const locked = !!account.system_key
  const used = num(account.lines) > 0
  const [f, setF] = useState({
    code: account.code || '', name_ar: account.name_ar || '', name_en: account.name_en || '', type: account.type || 'expense',
    is_money: !!account.is_money, is_active: account.is_active ?? true, description: account.description || '',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const fe = error?.fields || {}
  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await api.saveAccount(account.id, { ...f, is_money: f.type === 'asset' && f.is_money, description: f.description.trim() || null })
      toast.success(isNew ? tx('أُضيف الحساب.', 'Account added.') : tx('حُفظ الحساب.', 'Account saved.'))
      onDone()
    } catch (err) {
      setError(err)
      setBusy(false)
    }
  }
  return (
    <Modal open onClose={onClose} busy={busy} title={isNew ? tx('حساب جديد', 'New account') : tx('تعديل حساب', 'Edit account')}
      footer={<><Button variant="ghost" onClick={onClose} disabled={busy}>{t('cancel')}</Button>
        <Button type="submit" form="account-form" icon="check" loading={busy}>{t('save')}</Button></>}>
      <form id="account-form" className="form" onSubmit={submit} noValidate>
        {error && !Object.keys(fe).length && <Alert tone="danger">{errorText(error, t)}</Alert>}
        {locked && <Alert tone="info">{tx('حساب يستخدمه النظام: النوع والحالة ثابتان.', 'Used by the system: its type and status are fixed.')}</Alert>}
        {!locked && used && <Alert tone="info">{tx('للحساب حركات: الرقم والنوع ثابتان، ويمكن إيقافه بدل حذفه.', 'This account has movements: its code and type are fixed. You can deactivate it instead.')}</Alert>}
        <div className="form-grid">
          <TextField label={tx('رقم الحساب', 'Code')} value={f.code} dir="ltr" inputMode="numeric" maxLength={6} data-autofocus disabled={!locked && used}
            hint={tx('٣ إلى ٦ أرقام', '3 to 6 digits')} onChange={(e) => setF({ ...f, code: e.target.value.replace(/\D/g, '') })} error={fieldText('code', fe.code, t)} />
          <SelectField label={tx('النوع', 'Type')} value={f.type} disabled={locked || used} onChange={(e) => setF({ ...f, type: e.target.value })}
            options={TYPE_ORDER.map((x) => ({ value: x, label: ACCOUNT_TYPE[x].one[lang] }))} error={fieldText('type', fe.type, t)} />
          <TextField label={tx('الاسم بالعربية', 'Name in Arabic')} value={f.name_ar} dir="rtl" onChange={(e) => setF({ ...f, name_ar: e.target.value })} error={fieldText('name_ar', fe.name_ar, t)} />
          <TextField label={tx('الاسم بالإنجليزية', 'Name in English')} value={f.name_en} dir="ltr" onChange={(e) => setF({ ...f, name_en: e.target.value })} error={fieldText('name_en', fe.name_en, t)} />
        </div>
        <TextField label={tx('وصف', 'Description')} value={f.description} optional maxLength={200} onChange={(e) => setF({ ...f, description: e.target.value })} />
        {f.type === 'asset' && (
          <Checkbox label={tx('حساب نقدية (خزينة أو بنك)', 'Money account (cash or bank)')} description={tx('يظهر في التحويلات ويُدفع منه.', 'Shows up in transfers and can pay bills.')}
            checked={f.is_money} disabled={locked} onChange={(e) => setF({ ...f, is_money: e.target.checked })} />
        )}
        {!isNew && <Checkbox label={tx('الحساب نشط', 'Active')} description={tx('الحساب الموقوف يبقى في التقارير لكن لا يُستخدم في قيود جديدة.', 'An inactive account stays in reports but takes no new entries.')}
          checked={f.is_active} disabled={locked} onChange={(e) => setF({ ...f, is_active: e.target.checked })} />}
      </form>
    </Modal>
  )
}
