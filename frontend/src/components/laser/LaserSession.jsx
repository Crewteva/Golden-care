import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import Button from '../Button'
import Icon from '../Icon'
import Modal from '../Modal'
import PageLoader from '../PageLoader'
import { SelectField, TextArea, TextField } from '../Fields'
import { Alert, Avatar, Badge, ErrorState } from '../ui'
import { useToast } from '../Toast'
import { useI18n } from '../../i18n/I18nContext'
import { errorText } from '../../lib/errors'
import { fmtDate, fmtDateTime } from '../../lib/format'
import { ageLabel, sexLabel, ALERT_KINDS } from '../patients/meta'
import { BODY_AREAS, CHECKLIST, SKIN_TYPES, useClinical } from '../clinical/meta'

const num = (v) => (v === '' || v === null || v === undefined ? null : Number(v))
const str = (v) => (v === null || v === undefined ? '' : String(v))

function formFrom(s, areas) {
  return {
    device_id: s.device_id ? String(s.device_id) : '', session_no: str(s.session_no), skin_type: s.skin_type || '', hair_color: s.hair_color || '',
    checklist: s.checklist || {}, checklist_override: s.checklist_override || '', counter_start: str(s.counter_start), counter_end: str(s.counter_end),
    test_pulses: str(s.test_pulses || 0), counter_note: s.counter_note || '', aftercare: s.aftercare || '', notes: s.notes || '',
    areas: areas.map((a) => ({ area: a.area, fluence: str(a.fluence), pulse_ms: str(a.pulse_ms), spot_mm: str(a.spot_mm), frequency_hz: str(a.frequency_hz), pulses: str(a.pulses), reaction: a.reaction || '' })),
  }
}

function bodyFrom(f) {
  return {
    device_id: f.device_id ? Number(f.device_id) : null, session_no: num(f.session_no), skin_type: f.skin_type || null, hair_color: f.hair_color,
    checklist: f.checklist, checklist_override: f.checklist_override, counter_start: num(f.counter_start), counter_end: num(f.counter_end),
    test_pulses: num(f.test_pulses) || 0, counter_note: f.counter_note, aftercare: f.aftercare, notes: f.notes,
    areas: f.areas.filter((a) => a.area.trim()).map((a) => ({
      area: a.area.trim(), fluence: num(a.fluence), pulse_ms: num(a.pulse_ms), spot_mm: num(a.spot_mm), frequency_hz: num(a.frequency_hz),
      pulses: num(a.pulses) || 0, reaction: a.reaction || null,
    })),
  }
}

// How the pulse counter adds up — shown live while the operator types.
function counterCheck(f, deviceCounter) {
  const start = num(f.counter_start)
  const end = num(f.counter_end)
  const recorded = f.areas.reduce((s, a) => s + (num(a.pulses) || 0), 0)
  const test = num(f.test_pulses) || 0
  const used = start !== null && end !== null ? end - start : null
  return { used, recorded, test, difference: used === null ? null : used - recorded - test, startGap: start === null || deviceCounter === null ? null : start - deviceCounter }
}

function Counter({ check, deviceCounter }) {
  const { tx, locale } = useI18n()
  const n = (v) => (v === null ? '—' : new Intl.NumberFormat(locale).format(v))
  const ok = check.difference === 0 && !check.startGap
  return (
    <div className={`counter-check ${check.used === null ? '' : ok ? 'ok' : 'bad'}`}>
      <div><small>{tx('عدّاد الجهاز استخدم', 'Device counted')}</small><strong className="num">{n(check.used)}</strong></div>
      <span aria-hidden="true">=</span>
      <div><small>{tx('نبضات المناطق', 'Area pulses')}</small><strong className="num">{n(check.recorded)}</strong></div>
      <span aria-hidden="true">+</span>
      <div><small>{tx('نبضات اختبار', 'Test pulses')}</small><strong className="num">{n(check.test)}</strong></div>
      <p>
        {check.used === null ? tx('أدخل قراءة العدّاد قبل وبعد الجلسة.', 'Enter the counter reading before and after the session.')
          : ok ? <><Icon name="checkCircle" size={15} /> {tx('كل نبضة محسوبة.', 'Every pulse is accounted for.')}</>
            : <><Icon name="alert" size={15} /> {check.difference ? tx(`فرق ${n(check.difference)} نبضة غير مسجّلة — اكتب السبب.`, `${n(check.difference)} pulse(s) not accounted for — write why.`) : null}
              {check.startGap ? ' ' + tx(`بداية العدّاد لا تطابق آخر قراءة للجهاز (${n(deviceCounter)}).`, `Start doesn't match the device's last reading (${n(deviceCounter)}).`) : null}</>}
      </p>
    </div>
  )
}

function SignedView({ data }) {
  const { tx, lang, locale } = useI18n()
  const s = data.session
  const check = counterCheck(formFrom(s, data.areas), null)
  const answered = Object.entries(s.checklist || {})
  const stops = data.checklist.stop
  return (
    <>
      <section className="card">
        <div className="card-head"><h2>{tx('الإعدادات لكل منطقة', 'Settings per area')}</h2><Badge tone="neutral"><Icon name="lock" size={12} /> {tx('مقفلة', 'Locked')}</Badge></div>
        <div className="table-wrap">
          <table className="table laser-table">
            <thead><tr><th>{tx('المنطقة', 'Area')}</th><th>J/cm²</th><th>ms</th><th>mm</th><th>Hz</th><th>{tx('نبضات', 'Pulses')}</th><th>{tx('رد فعل الجلد', 'Skin reaction')}</th></tr></thead>
            <tbody>
              {data.areas.map((a) => (
                <tr key={a.id}><td><strong>{a.area}</strong></td><td className="num">{str(a.fluence) || '—'}</td><td className="num">{str(a.pulse_ms) || '—'}</td>
                  <td className="num">{str(a.spot_mm) || '—'}</td><td className="num">{str(a.frequency_hz) || '—'}</td><td className="num">{a.pulses}</td><td>{a.reaction || '—'}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="card">
        <div className="card-head"><h2>{tx('العدّاد', 'Pulse counter')}</h2><span className="muted">{s.device_name}</span></div>
        <div className="card-body form">
          <dl className="dl"><dt>{tx('قبل', 'Before')}</dt><dd className="num">{new Intl.NumberFormat(locale).format(s.counter_start)}</dd>
            <dt>{tx('بعد', 'After')}</dt><dd className="num">{new Intl.NumberFormat(locale).format(s.counter_end)}</dd></dl>
          <Counter check={{ ...check, startGap: 0 }} deviceCounter={null} />
          {s.counter_note && <Alert tone="warn" title={tx('توضيح الفرق:', 'Explanation:')}>{s.counter_note}</Alert>}
        </div>
      </section>
      <section className="card">
        <div className="card-head"><h2>{tx('قائمة الأمان', 'Safety checklist')}</h2></div>
        <div className="card-body">
          <ul className="check-read">
            {answered.map(([code, yes]) => (
              <li key={code} className={yes && stops.includes(code) ? 'stop' : ''}><span>{CHECKLIST[code]?.[lang] || code}</span><strong>{yes ? tx('نعم', 'Yes') : tx('لا', 'No')}</strong></li>
            ))}
          </ul>
          {s.checklist_override && <Alert tone="danger" title={tx('سبب الاستمرار:', 'Reason to go ahead:')}>{s.checklist_override}</Alert>}
        </div>
      </section>
      {(s.aftercare || s.notes) && (
        <section className="card"><div className="card-body"><dl className="dl">
          {s.aftercare && <><dt>{tx('تعليمات بعد الجلسة', 'Aftercare')}</dt><dd dir="auto">{s.aftercare}</dd></>}
          {s.notes && <><dt>{tx('ملاحظات', 'Notes')}</dt><dd dir="auto">{s.notes}</dd></>}
        </dl></div></section>
      )}
    </>
  )
}

// One laser session: safety checklist, settings per area and the device counter. Signing locks it.
export default function LaserSession() {
  const { id } = useParams()
  const { t, tx, lang, pick, locale } = useI18n()
  const { laser, base } = useClinical()
  const toast = useToast()
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [form, setForm] = useState(null)
  const [saved, setSaved] = useState(null)
  const [confirming, setConfirming] = useState(false)
  const [signing, setSigning] = useState(false)
  const [errors, setErrors] = useState({})
  const dirty = useRef(false)
  const timer = useRef(null)
  const latest = useRef(null)
  latest.current = form

  const load = useCallback((d) => { setData(d); setForm(formFrom(d.session, d.areas)); dirty.current = false }, [])
  useEffect(() => { laser.get(id).then(load).catch(setError) }, [id, laser, load])

  const flush = useCallback(async () => {
    clearTimeout(timer.current)
    if (!dirty.current || !latest.current) return true
    dirty.current = false
    try {
      await laser.save(id, bodyFrom(latest.current))
      setSaved(new Date().toISOString())
      return true
    } catch (err) {
      dirty.current = true
      toast.error(errorText(err, t))
      return false
    }
  }, [laser, id, t, toast])
  useEffect(() => () => clearTimeout(timer.current), [])

  const change = (patch) => {
    setForm((f) => ({ ...f, ...patch }))
    dirty.current = true
    clearTimeout(timer.current)
    timer.current = setTimeout(flush, 1000)
  }
  const setArea = (i, patch) => change({ areas: form.areas.map((a, j) => (j === i ? { ...a, ...patch } : a)) })

  const sign = async () => {
    setSigning(true)
    setErrors({})
    try {
      if (!(await flush())) return
      load(await laser.sign(id))
      setConfirming(false)
      toast.success(tx('وُقّعت الجلسة وقُفلت، وتحدّث عدّاد الجهاز.', 'Session signed and locked; the device counter is updated.'))
    } catch (err) {
      setErrors(err.fields || {})
      setConfirming(false)
      toast.error(errorText(err, t))
    } finally {
      setSigning(false)
    }
  }

  if (error) return <ErrorState error={error} onRetry={() => { setError(null); laser.get(id).then(load).catch(setError) }} />
  if (!data || !form) return <PageLoader />
  const s = data.session
  const draft = s.status === 'draft'
  const writable = data.can.write
  const device = data.devices.find((d) => String(d.id) === form.device_id)
  const check = counterCheck(form, device ? Number(device.pulse_counter) : null)
  const stopsYes = data.checklist.stop.filter((c) => form.checklist[c])
  const unanswered = data.checklist.items.filter((c) => form.checklist[c] === undefined)
  const critical = data.alerts.filter((a) => a.severity === 'critical')
  const needNote = check.used !== null && (check.difference !== 0 || Boolean(check.startGap))

  return (
    <div className="page reveal visit-page">
      <Link to={`${base}/laser`} className="back-link"><Icon name="arrowLeft" size={16} />{tx('جلسات الليزر', 'Laser sessions')}</Link>
      <header className="card card-pad visit-head">
        <Avatar name={pick(s, 'patient_name')} size="lg" />
        <div style={{ minWidth: 0 }}>
          <div className="eyebrow"><span className="mrn">{s.ref}</span> · {fmtDate(s.started_at, locale)}
            <Badge tone={draft ? 'gold' : 'success'}>{draft ? tx('مسودة — لم تُوقَّع', 'Draft — not signed') : tx('موقّعة ومقفلة', 'Signed & locked')}</Badge></div>
          <h1>{pick(s, 'patient_name')}</h1>
          <div className="file-facts">
            <span className="chip"><span className="mrn">{s.mrn}</span></span>
            <span className="chip">{ageLabel(s.date_of_birth, tx)} · {sexLabel(s.gender, tx)}</span>
            <span className="chip"><Icon name="sparkle" size={14} />{tx(`الجلسة رقم ${s.session_no || '—'}`, `Session ${s.session_no || '—'}`)}</span>
            <span className="chip"><Icon name="user" size={14} />{pick(s, 'operator_name')}</span>
          </div>
        </div>
        <div className="page-actions">
          {draft && writable && saved && <span className="save-state ok"><Icon name="check" size={14} /> {tx('حُفظت المسودة', 'Draft saved')}</span>}
          <Link to={`${base}/patients/${s.patient_id}?tab=laser`} className="btn btn-ghost"><Icon name="fileSearch" size={18} />{tx('ملف المريض', 'Patient file')}</Link>
        </div>
      </header>
      {critical.map((a) => <Alert key={a.id} tone="danger" icon="alert" title={`${ALERT_KINDS[a.kind]?.[lang] || a.kind}:`}><span dir="auto">{a.description}</span></Alert>)}

      <div className="visit-grid">
        <div className="visit-main">
          {!(draft && writable) ? <SignedView data={data} /> : (
            <>
              <section className="card">
                <div className="card-head"><h2><Icon name="shieldCheck" size={18} /> {tx('قائمة الأمان قبل الجلسة', 'Safety checklist before starting')}</h2>
                  {unanswered.length > 0 && <span className="muted" style={{ fontSize: '.8rem' }}>{tx(`${unanswered.length} سؤال بدون إجابة`, `${unanswered.length} unanswered`)}</span>}</div>
                <div className="card-body form">
                  {errors.checklist && <Alert tone="danger">{errors.checklist === 'consent_required' ? tx('لا يمكن بدء الجلسة بدون إقرار موقّع.', "The session can't go ahead without a signed consent.") : tx('أجب عن كل الأسئلة.', 'Answer every question.')}</Alert>}
                  <ul className="checklist">
                    {data.checklist.items.map((code) => {
                      const value = form.checklist[code]
                      const stop = data.checklist.stop.includes(code)
                      const must = data.checklist.must_be_yes.includes(code)
                      const bad = (stop && value === true) || (must && value === false)
                      return (
                        <li key={code} className={bad ? 'bad' : ''}>
                          <span>{CHECKLIST[code][lang]}{stop && <small className="muted"> · {tx('يوقف الجلسة', 'stop item')}</small>}{must && <small className="muted"> · {tx('مطلوب', 'required')}</small>}</span>
                          <div className="yesno" role="radiogroup" aria-label={CHECKLIST[code][lang]}>
                            <button type="button" role="radio" aria-checked={value === true} onClick={() => change({ checklist: { ...form.checklist, [code]: true } })}>{tx('نعم', 'Yes')}</button>
                            <button type="button" role="radio" aria-checked={value === false} onClick={() => change({ checklist: { ...form.checklist, [code]: false } })}>{tx('لا', 'No')}</button>
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                  {stopsYes.length > 0 && (
                    <TextArea label={tx('سبب الاستمرار رغم إجابة "نعم" (يُسجَّل)', 'Why the session goes ahead despite a "yes" (recorded)')} value={form.checklist_override}
                      onChange={(e) => change({ checklist_override: e.target.value })} rows={2} maxLength={500}
                      error={errors.checklist_override && tx('اكتب سببًا واضحًا (١٠ أحرف على الأقل).', 'Write a clear reason (10+ characters).')} />
                  )}
                </div>
              </section>

              <section className="card">
                <div className="card-head"><h2>{tx('الجلد والإعدادات', 'Skin & settings')}</h2></div>
                <div className="card-body form">
                  <div className="field">
                    <span className="field-label">{tx('نوع البشرة (فيتزباتريك)', 'Skin type (Fitzpatrick)')}</span>
                    <div className="skin-types">
                      {SKIN_TYPES.map((k, i) => (
                        <button key={k} type="button" aria-pressed={form.skin_type === k} onClick={() => change({ skin_type: k })} style={{ '--skin': ['#F6E2D3', '#EBC9AE', '#D9A882', '#B37B54', '#7E5236', '#4A2E1F'][i] }}>
                          <i aria-hidden="true" />{k}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="form-grid">
                    <TextField label={tx('لون الشعر', 'Hair colour')} optional value={form.hair_color} onChange={(e) => change({ hair_color: e.target.value })} placeholder={tx('مثال: بني غامق', 'e.g. dark brown')} />
                    <TextField label={tx('رقم الجلسة', 'Session number')} value={form.session_no} onChange={(e) => change({ session_no: e.target.value.replace(/\D/g, '') })} inputMode="numeric" />
                  </div>
                </div>
              </section>

              <section className="card">
                <div className="card-head"><h2>{tx('الإعدادات لكل منطقة', 'Settings per area')}</h2>
                  <Button size="sm" variant="ghost" icon="plus" onClick={() => change({ areas: [...form.areas, { area: '', fluence: '', pulse_ms: '', spot_mm: '', frequency_hz: '', pulses: '', reaction: '' }] })}>{tx('منطقة', 'Area')}</Button></div>
                <div className="card-body">
                  {errors.areas && <Alert tone="danger">{tx('أضف منطقة واحدة على الأقل.', 'Add at least one area.')}</Alert>}
                  <datalist id="laser-areas">{BODY_AREAS.map((a) => <option key={a} value={a} />)}</datalist>
                  <div className="area-rows">
                    {form.areas.map((a, i) => (
                      <div key={i} className="area-row">
                        <label className="area-name"><span>{tx('المنطقة', 'Area')}</span><input className="input input-sm" list="laser-areas" value={a.area} onChange={(e) => setArea(i, { area: e.target.value })} /></label>
                        {[['fluence', 'J/cm²'], ['pulse_ms', 'ms'], ['spot_mm', 'mm'], ['frequency_hz', 'Hz']].map(([k, unit]) => (
                          <label key={k}><span>{unit}</span><input className="input input-sm num" dir="ltr" inputMode="decimal" value={a[k]} onChange={(e) => setArea(i, { [k]: e.target.value.replace(',', '.') })} /></label>
                        ))}
                        <label className="pulses"><span>{tx('نبضات', 'Pulses')}</span><input className="input input-sm num" dir="ltr" inputMode="numeric" value={a.pulses} onChange={(e) => setArea(i, { pulses: e.target.value.replace(/\D/g, '') })} /></label>
                        <label className="area-reaction"><span>{tx('رد فعل الجلد', 'Skin reaction')}</span><input className="input input-sm" value={a.reaction} onChange={(e) => setArea(i, { reaction: e.target.value })} placeholder={tx('مثال: احمرار بسيط', 'e.g. mild redness')} /></label>
                        <button type="button" className="btn btn-quiet btn-icon btn-sm" aria-label={tx('حذف المنطقة', 'Remove area')} onClick={() => change({ areas: form.areas.filter((_, j) => j !== i) })}><Icon name="x" size={16} /></button>
                      </div>
                    ))}
                    {!form.areas.length && <p className="muted">{tx('لا توجد مناطق. أضف منطقة.', 'No areas yet. Add one.')}</p>}
                  </div>
                </div>
              </section>

              <section className="card">
                <div className="card-head"><h2>{tx('عدّاد النبضات', 'Pulse counter')}</h2></div>
                <div className="card-body form">
                  <div className="form-grid">
                    <SelectField label={tx('الجهاز', 'Device')} value={form.device_id} onChange={(e) => {
                      const d = data.devices.find((x) => String(x.id) === e.target.value)
                      change({ device_id: e.target.value, counter_start: d ? String(d.pulse_counter) : form.counter_start })
                    }} error={errors.device_id && t('field.required')} placeholder={tx('اختر…', 'Choose…')}
                      options={data.devices.map((d) => ({ value: String(d.id), label: `${d.name} — ${new Intl.NumberFormat(locale).format(d.pulse_counter)}` }))} />
                    <TextField label={tx('نبضات اختبار', 'Test pulses')} value={form.test_pulses} onChange={(e) => change({ test_pulses: e.target.value.replace(/\D/g, '') })} inputMode="numeric" dir="ltr" />
                    <TextField label={tx('العدّاد قبل الجلسة', 'Counter before')} value={form.counter_start} onChange={(e) => change({ counter_start: e.target.value.replace(/\D/g, '') })} inputMode="numeric" dir="ltr"
                      error={errors.counter_start && t('field.required')} hint={device ? tx(`آخر قراءة مسجّلة للجهاز: ${new Intl.NumberFormat(locale).format(device.pulse_counter)}`, `Device's last recorded reading: ${new Intl.NumberFormat(locale).format(device.pulse_counter)}`) : null} />
                    <TextField label={tx('العدّاد بعد الجلسة', 'Counter after')} value={form.counter_end} onChange={(e) => change({ counter_end: e.target.value.replace(/\D/g, '') })} inputMode="numeric" dir="ltr"
                      error={errors.counter_end && t('field.required')} />
                  </div>
                  <Counter check={check} deviceCounter={device ? Number(device.pulse_counter) : null} />
                  {needNote && <TextArea label={tx('توضيح الفرق في العدّاد', 'Explain the counter difference')} value={form.counter_note} onChange={(e) => change({ counter_note: e.target.value })} rows={2}
                    error={errors.counter_note && t('field.required')} placeholder={tx('مثال: ٥ نبضات لضبط الجهاز بعد تغيير الرأس', 'e.g. 5 pulses to calibrate after changing the handpiece')} />}
                </div>
              </section>

              <section className="card">
                <div className="card-body form">
                  <TextArea label={tx('تعليمات بعد الجلسة', 'Aftercare')} optional value={form.aftercare} onChange={(e) => change({ aftercare: e.target.value })} rows={2}
                    placeholder={tx('كمادات باردة، بدون شمس ٤٨ ساعة، واقي شمس يوميًا', 'Cold compresses, no sun for 48 hours, daily sunscreen')} />
                  <TextArea label={tx('ملاحظات', 'Notes')} optional value={form.notes} onChange={(e) => change({ notes: e.target.value })} rows={2} />
                </div>
              </section>
            </>
          )}
        </div>

        <aside className="visit-side">
          <section className="card">
            <div className="card-head"><h2>{tx('الجلسات السابقة', 'Previous sessions')}</h2><span className="muted">{data.history.length}</span></div>
            <div className="card-body">
              {!data.history.length ? <p className="muted">{tx('هذه أول جلسة مسجّلة.', 'This is the first recorded session.')}</p> : (
                <ul className="laser-history">
                  {data.history.map((h) => (
                    <li key={h.id}>
                      <div className="row-between"><strong>{tx(`جلسة ${h.session_no || '—'}`, `Session ${h.session_no || '—'}`)}</strong><small className="muted">{fmtDate(h.signed_at, locale)}</small></div>
                      <small className="muted">{h.skin_type && `${tx('بشرة', 'Skin')} ${h.skin_type} · `}{h.device_name}</small>
                      <ul>{h.areas.map((a) => <li key={a.id}><span>{a.area}</span><span className="num" dir="ltr">{str(a.fluence)} J · {str(a.pulse_ms)} ms · {a.pulses}</span></li>)}</ul>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
          {draft && writable && (
            <section className="card sign-card">
              <div className="card-body form">
                <h2>{tx('إنهاء الجلسة', 'Finish the session')}</h2>
                <p className="muted">{tx('التوقيع يقفل السجل نهائيًا ويحدّث عدّاد الجهاز إلى قراءة "بعد الجلسة".', "Signing locks the record for good and moves the device counter to the 'after' reading.")}</p>
                <Button size="lg" icon="pen" block onClick={() => setConfirming(true)}>{tx('توقيع الجلسة', 'Sign the session')}</Button>
              </div>
            </section>
          )}
          {!draft && (
            <section className="card card-pad signed-stamp">
              <Icon name="shieldCheck" size={22} />
              <div><strong>{tx('وُقّعت', 'Signed')} · <bdi>{fmtDateTime(s.signed_at, locale)}</bdi></strong><small className="muted">{pick(s, 'operator_name')}</small></div>
            </section>
          )}
        </aside>
      </div>

      {confirming && (
        <Modal open onClose={() => setConfirming(false)} busy={signing} title={tx('توقيع جلسة الليزر؟', 'Sign this laser session?')}
          footer={<><Button variant="ghost" onClick={() => setConfirming(false)} disabled={signing}>{t('cancel')}</Button><Button icon="pen" loading={signing} onClick={sign}>{tx('توقيع وإقفال', 'Sign & lock')}</Button></>}>
          <div className="form">
            <dl className="dl">
              <dt>{tx('المناطق', 'Areas')}</dt><dd>{form.areas.filter((a) => a.area).map((a) => a.area).join('، ') || '—'}</dd>
              <dt>{tx('النبضات', 'Pulses')}</dt><dd className="num">{check.recorded} {check.test ? `+ ${check.test}` : ''}</dd>
              <dt>{tx('الجهاز', 'Device')}</dt><dd>{device?.name || '—'}</dd>
            </dl>
            {unanswered.length > 0 && <Alert tone="danger">{tx('لم تُجب كل أسئلة الأمان.', 'Not every safety question is answered.')}</Alert>}
            {needNote && !form.counter_note.trim() && <Alert tone="danger">{tx('العدّاد لا يطابق النبضات المسجّلة: اكتب التوضيح.', "The counter doesn't match the recorded pulses: write the explanation.")}</Alert>}
          </div>
        </Modal>
      )}
    </div>
  )
}
