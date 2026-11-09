import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import Button from '../Button'
import Icon from '../Icon'
import Modal from '../Modal'
import { SelectField, TextArea, TextField } from '../Fields'
import { Alert, EmptyState, ErrorState, PageHeader, SkeletonRows } from '../ui'
import { useToast } from '../Toast'
import { useAsync } from '../useAsync'
import { useI18n } from '../../i18n/I18nContext'
import { errorText, fieldText } from '../../lib/errors'
import { fmtDateTime } from '../../lib/format'
import { BackLink, COUNT_STATE, State, cleanQty, money, num, qty, useInventory } from './meta'

export default function Counts() {
  const { tx, pick, locale } = useI18n()
  const { api, base, canManage } = useInventory()
  const [starting, setStarting] = useState(false)
  const { data, error, loading, reload } = useAsync(() => api.counts(), [api])
  return (
    <div className="page reveal">
      <PageHeader eyebrow={tx('المخازن والمشتريات', 'Stock & purchasing')} title={tx('الجرد', 'Stock counts')}
        description={tx('جرد أعمى: يُعدّ المخزن دون رؤية الكميات المتوقعة. بعد التسليم تظهر الفروق، ولا تُرحَّل إلا باعتماد الإدارة.', "Blind counts: the store is counted without seeing the expected quantities. Differences show after submitting and only post once management approves.")}
        actions={canManage && <Button icon="plus" onClick={() => setStarting(true)}>{tx('بدء جرد', 'Start a count')}</Button>} />
      <section className="card">
        {error ? <ErrorState error={error} onRetry={reload} /> : loading && !data ? <SkeletonRows rows={4} cols={6} /> : !data.length ? (
          <EmptyState icon="clipboard" title={tx('لا يوجد جرد بعد', 'No counts yet')} action={canManage && <Button icon="plus" onClick={() => setStarting(true)}>{tx('بدء جرد', 'Start a count')}</Button>}>
            {tx('ابدأ جردًا لمخزن، أدخل ما تعده فعليًا، ثم سلّمه لاعتماد الإدارة.', 'Start a count for a store, enter what you actually find, then submit it for management to approve.')}
          </EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="table acc-table">
              <thead><tr><th>{tx('الجرد', 'Count')}</th><th>{tx('المخزن', 'Store')}</th><th>{tx('بدأه', 'Started by')}</th><th>{tx('التقدم', 'Progress')}</th><th className="num">{tx('قيمة الفروق', 'Difference value')}</th><th>{tx('الحالة', 'Status')}</th></tr></thead>
              <tbody>
                {data.map((c) => (
                  <tr key={c.id}>
                    <td><Link to={`${base}/counts/${c.id}`} className="mrn">{c.ref}</Link></td>
                    <td>{pick(c, 'store')}</td>
                    <td>{pick(c, 'started_by')}<small className="muted" style={{ display: 'block' }}><bdi>{fmtDateTime(c.started_at, locale)}</bdi></small></td>
                    <td><Progress done={c.counted_lines} total={c.lines} /></td>
                    <td className={`num ${num(c.difference_value) < 0 ? 'neg' : ''}`}>{c.status === 'counting' ? '—' : money(c.difference_value, locale)}</td>
                    <td><State state={c.status} map={COUNT_STATE} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {starting && <StartModal onClose={() => setStarting(false)} />}
    </div>
  )
}

function Progress({ done, total }) {
  const { tx, locale } = useI18n()
  const pct = total ? Math.round((done / total) * 100) : 0
  return (
    <span className="inv-progress" title={`${pct}%`}>
      <i style={{ '--w': `${pct}%` }} aria-hidden="true" />
      <small>{tx(`${qty(done, locale)} من ${qty(total, locale)}`, `${qty(done, locale)} of ${qty(total, locale)}`)}</small>
    </span>
  )
}

function StartModal({ onClose }) {
  const { t, tx, pick } = useI18n()
  const { api, base } = useInventory()
  const navigate = useNavigate()
  const options = useAsync(() => api.options(), [api])
  const stores = (options.data?.stores || []).filter((s) => s.is_active)
  const [store, setStore] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const chosen = store || String(stores[0]?.id || '')
  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      const row = await api.startCount({ store_id: Number(chosen), note: note.trim() || null })
      navigate(`${base}/counts/${row.id}`)
    } catch (err) {
      setError(err)
      setBusy(false)
    }
  }
  return (
    <Modal open onClose={onClose} busy={busy} title={tx('بدء جرد', 'Start a count')}
      description={tx('تُضاف كل الأصناف النشطة وما له رصيد في المخزن. لن تظهر الكميات المتوقعة أثناء العد.', "Every active item, and anything with stock in the store, is listed. Expected quantities stay hidden while counting.")}
      footer={<><Button variant="ghost" onClick={onClose} disabled={busy}>{t('cancel')}</Button><Button icon="clipboard" loading={busy} disabled={!chosen} onClick={submit}>{tx('ابدأ', 'Start')}</Button></>}>
      <div className="form">
        {error && !error.fields?.store_id && <Alert tone="danger">{errorText(error, t)}</Alert>}
        <SelectField label={tx('المخزن', 'Store')} value={chosen} onChange={(e) => setStore(e.target.value)} options={stores.map((s) => ({ value: String(s.id), label: pick(s) }))} error={fieldText('store_id', error?.fields?.store_id, t)} data-autofocus />
        <TextField label={tx('ملاحظة', 'Note')} optional value={note} onChange={(e) => setNote(e.target.value)} placeholder={tx('مثال: جرد نهاية الشهر', 'e.g. month-end count')} />
      </div>
    </Modal>
  )
}

export function CountPage() {
  const { id } = useParams()
  const { t, tx, pick, locale } = useI18n()
  const { api, base, canManage, canApprove } = useInventory()
  const toast = useToast()
  const { data, error, loading, reload } = useAsync(() => api.count(id), [id, api])
  const [values, setValues] = useState({})
  const [filter, setFilter] = useState('')
  const [busy, setBusy] = useState('')
  const [saveError, setSaveError] = useState(null)
  const [deciding, setDeciding] = useState(null)
  useEffect(() => {
    if (data) setValues(Object.fromEntries(data.lines.map((l) => [l.item_id, l.counted === null ? '' : String(num(l.counted))])))
  }, [data])
  const shown = useMemo(() => {
    if (!data) return []
    const f = filter.trim().toLowerCase()
    return f ? data.lines.filter((l) => `${l.name_ar} ${l.name_en}`.toLowerCase().includes(f)) : data.lines
  }, [data, filter])
  const back = <BackLink to={`${base}/counts`}>{tx('الجرد', 'Stock counts')}</BackLink>
  if (error) return <div className="page">{back}<section className="card"><ErrorState error={error} onRetry={reload} /></section></div>
  if (loading && !data) return <div className="page">{back}<section className="card"><SkeletonRows rows={8} cols={4} /></section></div>
  const c = data.count
  const counting = c.status === 'counting'
  const editable = counting && canManage
  const filled = Object.values(values).filter((v) => v !== '').length
  const save = async (submit) => {
    setBusy(submit ? 'submit' : 'save')
    setSaveError(null)
    try {
      await api.saveCount(id, { submit, lines: data.lines.map((l) => ({ item_id: l.item_id, counted: values[l.item_id] === '' ? null : values[l.item_id] })) })
      toast.success(submit ? tx('سُلّم الجرد لاعتماد الإدارة.', 'Count submitted for management approval.') : tx('حُفظ ما أدخلته.', 'Your counts were saved.'))
      reload()
    } catch (err) {
      setSaveError(err)
    } finally {
      setBusy('')
    }
  }
  const diffs = data.lines.filter((l) => num(l.difference) !== 0)
  return (
    <div className="page reveal">
      <PageHeader back={back} eyebrow={tx('جرد', 'Stock count')} title={<>{pick(c, 'store')} <span className="mrn title-ref">{c.ref}</span></>}
        description={<><State state={c.status} map={COUNT_STATE} /> · {tx('بدأه', 'Started by')} {pick(c, 'started_by')} · <bdi>{fmtDateTime(c.started_at, locale)}</bdi>{c.note && <> · {c.note}</>}</>}
        actions={<>
          {editable && <Button variant="ghost" icon="check" loading={busy === 'save'} disabled={!!busy} onClick={() => save(false)}>{tx('حفظ', 'Save')}</Button>}
          {editable && <Button icon="shieldCheck" loading={busy === 'submit'} disabled={!!busy || filled < data.lines.length} onClick={() => save(true)}>{tx('تسليم للاعتماد', 'Submit for approval')}</Button>}
          {c.status === 'submitted' && canApprove && <>
            <Button variant="ghost" icon="x" onClick={() => setDeciding('reject')}>{tx('رفض', 'Reject')}</Button>
            <Button icon="shieldCheck" onClick={() => setDeciding('approve')}>{tx('اعتماد الفروق', 'Approve differences')}</Button>
          </>}
        </>} />

      {counting && (
        <div className="count-banner">
          <Icon name="eyeOff" size={20} />
          <div><strong>{tx('جرد أعمى', 'Blind count')}</strong><span>{tx('عُدّ ما تجده فعلًا على الرف وأدخله. الكميات المتوقعة مخفية حتى التسليم.', "Count what's actually on the shelf and enter it. Expected quantities stay hidden until you submit.")}</span></div>
          <Progress done={filled} total={data.lines.length} />
        </div>
      )}
      {saveError && <Alert tone="danger">{errorText(saveError, t)}</Alert>}
      {!counting && !data.blind && (
        <div className="stats inv-stats">
          <div className="stat"><div className="stat-label">{tx('أصناف بها فرق', 'Items with a difference')}</div><div className="stat-value num">{qty(diffs.length, locale)}</div></div>
          <div className="stat"><div className="stat-label">{tx('قيمة الفروق', 'Difference value')}</div><div className={`stat-value num ${num(c.difference_value) < 0 ? 'neg' : ''}`}>{money(c.difference_value, locale)}</div>
            <div className="stat-foot">{c.status === 'approved' ? tx('رُحّلت لخسائر المخزون', 'Posted to stock losses') : c.status === 'rejected' ? tx('لم يُرحَّل شيء', 'Nothing was posted') : tx('تُرحَّل عند الاعتماد', 'Posts on approval')}</div></div>
          {c.submitted_by_en && <div className="stat"><div className="stat-label">{tx('سلّمه', 'Submitted by')}</div><div className="stat-value small">{pick(c, 'submitted_by')}</div><div className="stat-foot"><bdi>{fmtDateTime(c.submitted_at, locale)}</bdi></div></div>}
          {c.decided_by_en && <div className="stat"><div className="stat-label">{c.status === 'approved' ? tx('اعتمده', 'Approved by') : tx('رفضه', 'Rejected by')}</div><div className="stat-value small">{pick(c, 'decided_by')}</div><div className="stat-foot">{c.decision_note || <bdi>{fmtDateTime(c.decided_at, locale)}</bdi>}</div></div>}
        </div>
      )}

      <section className="card">
        <div className="toolbar filters">
          <TextField label={tx('بحث في الأصناف', 'Find an item')} icon="search" value={filter} onChange={(e) => setFilter(e.target.value)} />
        </div>
        {!shown.length ? <EmptyState icon="search" title={tx('لا أصناف مطابقة', 'No matching items')} /> : (
          <div className="table-wrap">
            <table className="table acc-table count-table">
              <thead><tr><th>{tx('الصنف', 'Item')}</th><th>{tx('الوحدة', 'Unit')}</th>
                {!data.blind && <th className="num">{tx('المتوقع', 'Expected')}</th>}
                <th className="num">{tx('المعدود', 'Counted')}</th>
                {!data.blind && <><th className="num">{tx('الفرق', 'Difference')}</th><th className="num">{tx('القيمة', 'Value')}</th></>}</tr></thead>
              <tbody>
                {shown.map((l) => (
                  <tr key={l.item_id} className={!data.blind && num(l.difference) !== 0 ? 'row-diff' : ''}>
                    <td className="cell-wrap"><strong>{pick(l)}</strong><small className="muted" style={{ display: 'block' }}>{pick(l, 'category')}</small></td>
                    <td>{pick(l, 'unit')}</td>
                    {!data.blind && <td className="num">{qty(l.expected, locale)}</td>}
                    <td className="num">
                      {editable ? (
                        <input className="input input-sm count-input" inputMode="decimal" dir="ltr" value={values[l.item_id] ?? ''} placeholder="—"
                          aria-label={tx(`المعدود من ${pick(l)}`, `Counted ${pick(l)}`)} onChange={(e) => setValues((v) => ({ ...v, [l.item_id]: cleanQty(e.target.value) }))} />
                      ) : l.counted === null ? '—' : <strong>{qty(l.counted, locale)}</strong>}
                    </td>
                    {!data.blind && <>
                      <td className={`num ${num(l.difference) < 0 ? 'neg' : num(l.difference) > 0 ? 'pos' : 'muted'}`}><bdi dir="ltr">{num(l.difference) > 0 ? '+' : ''}{qty(l.difference, locale)}</bdi></td>
                      <td className={`num ${num(l.difference_value) < 0 ? 'neg' : ''}`}>{num(l.difference_value) ? money(l.difference_value, locale) : '—'}</td>
                    </>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {deciding && <DecideModal count={c} approve={deciding === 'approve'} onClose={() => setDeciding(null)} onDone={() => { setDeciding(null); reload() }} />}
    </div>
  )
}

function DecideModal({ count, approve, onClose, onDone }) {
  const { t, tx, locale } = useI18n()
  const { api } = useInventory()
  const toast = useToast()
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      await api.decideCount(count.id, { approve, note: note.trim() || null })
      toast.success(approve ? tx('اعتُمدت الفروق وعُدّل المخزون.', 'Differences approved and stock adjusted.') : tx('رُفض الجرد.', 'Count rejected.'))
      onDone()
    } catch (err) {
      setError(err)
      setBusy(false)
    }
  }
  return (
    <Modal open onClose={onClose} busy={busy} title={approve ? tx('اعتماد فروق الجرد', 'Approve count differences') : tx('رفض الجرد', 'Reject the count')}
      description={<><span className="mrn">{count.ref}</span> · {money(count.difference_value, locale)}</>}
      footer={<><Button variant="ghost" onClick={onClose} disabled={busy}>{t('cancel')}</Button>
        <Button icon={approve ? 'shieldCheck' : 'x'} loading={busy} disabled={!approve && note.trim().length < 5} onClick={submit}>{approve ? tx('اعتماد', 'Approve') : tx('رفض', 'Reject')}</Button></>}>
      <div className="form">
        {error && !error.fields?.note && <Alert tone="danger">{errorText(error, t)}</Alert>}
        <p>{approve
          ? tx('يُعدَّل المخزون ليطابق المعدود: العجز يُخصم من الأقرب انتهاءً والزيادة تُضاف لأحدث تشغيلة، وتُرحَّل القيمة لخسائر المخزون.', 'Stock is set to what was counted: a shortage leaves the first-to-expire lot, a surplus joins the newest lot, and the value posts to stock losses.')
          : tx('لن يتغير شيء في المخزون. اكتب السبب ليعيد أمين المخزن الجرد.', 'Nothing changes in stock. Give the reason so the store keeper can count again.')}</p>
        <TextArea label={approve ? tx('ملاحظة', 'Note') : tx('السبب', 'Reason')} optional={approve} rows={2} value={note} onChange={(e) => setNote(e.target.value)} data-autofocus error={fieldText('note', error?.fields?.note, t)} />
      </div>
    </Modal>
  )
}
