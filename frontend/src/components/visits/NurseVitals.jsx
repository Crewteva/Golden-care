import { useEffect, useState } from 'react'
import Button from '../Button'
import Icon from '../Icon'
import { EmptyState, ErrorState, PageHeader, SkeletonRows } from '../ui'
import { useAsync } from '../useAsync'
import { useI18n } from '../../i18n/I18nContext'
import { clock, dayKey } from '../../lib/clinicTime'
import { ageLabel, sexLabel } from '../patients/meta'
import { StatusBadge } from '../appointments/AppointmentDrawer'
import { serviceNames, useAppointments } from '../appointments/meta'
import { VitalsModal } from './Vitals'
import { VITALS, useVisits, vitalFlag, vitalValue } from './meta'

// The nurse's list for today: patients who have arrived, in queue order, and whether their vitals are taken.
export default function NurseVitals() {
  const { tx, pick, locale, lang } = useI18n()
  const { api } = useVisits()
  const { api: apptApi } = useAppointments()
  const appts = useAsync(() => apptApi.day({ on: dayKey() }), [apptApi])
  const vitals = useAsync(() => api.vitalsToday(), [api])
  const [filter, setFilter] = useState('todo')
  const [open, setOpen] = useState(null)

  useEffect(() => {
    const timer = setInterval(() => { appts.reload(); vitals.reload() }, 45000)
    return () => clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const byAppt = {}
  for (const v of vitals.data || []) if (!byAppt[v.appointment_id]) byAppt[v.appointment_id] = v
  const here = (appts.data?.appointments || []).filter((a) => ['arrived', 'in_room', 'completed'].includes(a.status))
    .sort((a, b) => (a.status === 'completed') - (b.status === 'completed') || (a.queue_no || 99) - (b.queue_no || 99))
  const todo = here.filter((a) => !byAppt[a.id] && a.status !== 'completed')
  const list = filter === 'todo' ? todo : here
  const error = appts.error || vitals.error

  return (
    <div className="page reveal">
      <PageHeader eyebrow={tx('التمريض', 'Nursing')} title={tx('العلامات الحيوية اليوم', "Today's vital signs")}
        description={tx('المرضى الذين وصلوا بترتيب الدور. سجّل القياسات قبل دخولهم للطبيب.', 'Patients who have arrived, in queue order. Record their measurements before they go in.')} />
      <section className="card">
        <div className="toolbar">
          <div className="tabs" role="tablist">
            <button type="button" role="tab" aria-selected={filter === 'todo'} onClick={() => setFilter('todo')}>{tx('بانتظار القياس', 'Waiting for vitals')} <span className="muted num">({todo.length})</span></button>
            <button type="button" role="tab" aria-selected={filter === 'all'} onClick={() => setFilter('all')}>{tx('كل من وصل اليوم', 'Everyone who arrived today')} <span className="muted num">({here.length})</span></button>
          </div>
        </div>
        {error ? <ErrorState error={error} onRetry={() => { appts.reload(); vitals.reload() }} /> : (appts.loading && !appts.data) ? <SkeletonRows rows={5} cols={4} /> : !list.length ? (
          <EmptyState icon="thermometer" title={filter === 'todo' ? tx('لا أحد بانتظار القياس', 'Nobody waiting for vitals') : tx('لم يصل أحد بعد اليوم', 'Nobody has arrived yet today')}>
            {tx('يظهر المريض هنا عندما يسجّل الاستقبال وصوله.', 'Patients appear here when reception checks them in.')}
          </EmptyState>
        ) : (
          <ul className="nurse-list">
            {list.map((a) => {
              const v = byAppt[a.id]
              return (
                <li key={a.id} style={{ '--c': a.doctor_color || 'var(--ink-600)' }}>
                  <span className="appt-time num">{a.queue_no ? <span className="queue-no">#{a.queue_no}</span> : null}{clock(a.starts_at, locale)}</span>
                  <div className="nurse-who">
                    <strong>{pick(a, 'patient_name')} {a.critical_alert && <Icon name="alert" size={15} style={{ color: 'var(--danger)' }} title={tx('تنبيه طبي خطير', 'Critical medical alert')} />}</strong>
                    <small>{ageLabel(a.date_of_birth, tx)} · {sexLabel(a.gender, tx)} · {pick(a, 'doctor_name')} · {serviceNames(a.services, pick)}</small>
                  </div>
                  <StatusBadge status={a.status} />
                  {v ? (
                    <span className="nurse-vitals">
                      {VITALS.slice(0, 4).map((m) => vitalValue(v, m.key) && (
                        <span key={m.key} className={vitalFlag(v, m.key) ? 'flag' : ''}><small>{m[lang]}</small> <b className="num">{vitalValue(v, m.key)}</b></span>
                      ))}
                    </span>
                  ) : <span className="muted nurse-vitals">{tx('لم تُقس بعد', 'Not taken yet')}</span>}
                  <Button size="sm" variant={v ? 'ghost' : 'gold'} icon="thermometer" onClick={() => setOpen(a)}>{v ? tx('قياس جديد', 'Re-take') : tx('تسجيل', 'Record')}</Button>
                </li>
              )
            })}
          </ul>
        )}
      </section>
      {open && <VitalsModal appointmentId={open.id} patientName={pick(open, 'patient_name')} onClose={() => setOpen(null)} onSaved={vitals.reload} />}
    </div>
  )
}
