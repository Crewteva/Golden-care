import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import Button from '../Button'
import Icon from '../Icon'
import { Badge, EmptyState, ErrorState, PageHeader, SkeletonRows } from '../ui'
import { useToast } from '../Toast'
import { useAsync } from '../useAsync'
import { useI18n } from '../../i18n/I18nContext'
import { errorText } from '../../lib/errors'
import { clock } from '../../lib/clinicTime'
import { fmtDate } from '../../lib/format'
import { StatusBadge } from '../appointments/AppointmentDrawer'
import { serviceNames } from '../appointments/meta'
import { useClinical } from '../clinical/meta'

// Today's laser appointments and their session records; open or start a record in one click.
export default function LaserToday() {
  const { t, tx, pick, locale } = useI18n()
  const { laser, base, can } = useClinical()
  const toast = useToast()
  const navigate = useNavigate()
  const [busy, setBusy] = useState(null)
  const { data, error, loading, reload } = useAsync(() => laser.today(), [laser])

  const start = async (a) => {
    setBusy(a.id)
    try {
      const s = await laser.start(a.id)
      navigate(`${base}/laser/${s.id}`)
    } catch (err) {
      toast.error(errorText(err, t))
      setBusy(null)
    }
  }

  const sessionsOf = (id) => (data?.sessions || []).filter((s) => s.appointment_id === id)
  return (
    <div className="page reveal">
      <PageHeader eyebrow={tx('الليزر', 'Laser')} title={tx('جلسات الليزر اليوم', "Today's laser sessions")}
        description={tx('مواعيد خدمات الليزر اليوم. ابدأ سجل الجلسة بعد وصول المريض: قائمة الأمان، الإعدادات، وعدّاد الجهاز.',
          "Today's laser appointments. Start the session record once the patient has arrived: safety checklist, settings and the device counter.")} />
      {data?.devices?.length > 0 && (
        <div className="device-strip">
          {data.devices.map((d) => (
            <div key={d.id} className="device-pill">
              <Icon name="activity" size={16} />
              <span><strong>{d.name}</strong><small className="muted">{pick(d, 'room_name') || d.model}</small></span>
              <span className="num device-counter" title={tx('آخر قراءة للعدّاد', 'Last counter reading')}>{new Intl.NumberFormat(locale).format(d.pulse_counter)}</span>
            </div>
          ))}
        </div>
      )}
      <section className="card">
        {error ? <ErrorState error={error} onRetry={reload} /> : loading && !data ? <SkeletonRows rows={4} cols={4} /> : !data.appointments.length ? (
          <EmptyState icon="sparkle" title={tx('لا توجد مواعيد ليزر اليوم', 'No laser appointments today')}>
            {tx('السجلات السابقة موجودة في ملف كل مريض (تبويب الليزر).', "Past records are in each patient's file (Laser tab).")}
          </EmptyState>
        ) : (
          <ul className="nurse-list">
            {data.appointments.map((a) => {
              const sessions = sessionsOf(a.id)
              const draft = sessions.find((s) => s.status === 'draft')
              const ready = ['arrived', 'in_room', 'completed'].includes(a.status)
              return (
                <li key={a.id} style={{ '--c': a.doctor_color || 'var(--ink-600)' }}>
                  <span className="appt-time num">{a.queue_no ? <span className="queue-no">#{a.queue_no}</span> : null}{clock(a.starts_at, locale)}</span>
                  <div className="nurse-who">
                    <strong>{pick(a, 'patient_name')} {a.critical_alert && <Icon name="alert" size={15} style={{ color: 'var(--danger)' }} />}</strong>
                    <small>{serviceNames(a.services, pick)} · {pick(a, 'doctor_name')}</small>
                  </div>
                  <StatusBadge status={a.status} />
                  <span className="nurse-vitals">
                    {sessions.map((s) => (
                      <Link key={s.id} to={`${base}/laser/${s.id}`} className="mrn">{s.ref} {s.status === 'signed' ? '✓' : '…'}</Link>
                    ))}
                  </span>
                  {can('laser.record') && ready && (
                    draft ? <Link to={`${base}/laser/${draft.id}`} className="btn btn-gold btn-sm"><Icon name="pen" size={16} />{tx('متابعة السجل', 'Continue record')}</Link>
                      : <Button size="sm" variant={sessions.length ? 'ghost' : 'gold'} icon="plus" loading={busy === a.id} onClick={() => start(a)}>{tx('بدء سجل الجلسة', 'Start session record')}</Button>
                  )}
                  {!ready && <Badge tone="neutral">{tx('لم يصل بعد', 'Not arrived')}</Badge>}
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}

// Patient file → Laser: every session with its areas, settings and pulses.
export function PatientLaser({ patientId }) {
  const { tx, locale } = useI18n()
  const { laser, base } = useClinical()
  const { data, error, loading, reload } = useAsync(() => laser.forPatient(patientId), [patientId, laser])
  if (error) return <ErrorState error={error} onRetry={reload} />
  if (loading && !data) return <section className="card"><SkeletonRows rows={3} cols={4} /></section>
  if (!data.length) return <section className="card"><EmptyState icon="sparkle" title={tx('لا توجد جلسات ليزر', 'No laser sessions')} /></section>
  return (
    <section className="card">
      <div className="card-head"><h2>{tx('جلسات الليزر', 'Laser sessions')}</h2><span className="muted">{data.length}</span></div>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>{tx('الجلسة', 'Session')}</th><th>{tx('المناطق والإعدادات', 'Areas & settings')}</th><th>{tx('النبضات', 'Pulses')}</th><th>{tx('الجهاز', 'Device')}</th><th /></tr></thead>
          <tbody>
            {data.map((s) => (
              <tr key={s.id}>
                <td><strong>{tx(`رقم ${s.session_no || '—'}`, `No. ${s.session_no || '—'}`)}</strong><small className="muted" style={{ display: 'block' }}><bdi>{fmtDate(s.started_at, locale)}</bdi> · <span className="mrn">{s.ref}</span></small></td>
                <td>{s.areas.map((a) => <div key={a.id} className="laser-area-line"><span>{a.area}</span><span className="num muted" dir="ltr">{a.fluence ? `${Number(a.fluence)} J` : ''}{a.pulse_ms ? ` · ${Number(a.pulse_ms)} ms` : ''}</span></div>)}</td>
                <td className="num">{s.recorded_pulses}</td>
                <td>{s.device_name || '—'}{s.skin_type && <small className="muted" style={{ display: 'block' }}>{tx('بشرة', 'Skin')} {s.skin_type}</small>}</td>
                <td>{s.status === 'signed' ? <Badge tone="success">{tx('موقّعة', 'Signed')}</Badge> : <Badge tone="gold">{tx('مسودة', 'Draft')}</Badge>}
                  <Link to={`${base}/laser/${s.id}`} className="btn btn-quiet btn-sm">{tx('فتح', 'Open')}</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
