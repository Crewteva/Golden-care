import { useState } from 'react'
import { Link } from 'react-router-dom'
import Icon from '../Icon'
import { EmptyState, ErrorState, SkeletonRows } from '../ui'
import { useAsync } from '../useAsync'
import { useI18n } from '../../i18n/I18nContext'
import { clock, dayKey, dayLabel } from '../../lib/clinicTime'
import { fmtMoney } from '../settings/shared'
import AppointmentDrawer, { StatusBadge } from './AppointmentDrawer'
import { serviceNames, useAppointments } from './meta'

// "Appointments" tab of the patient file: upcoming first, then the past.
export default function PatientAppointments({ patientId }) {
  const { tx, pick, locale } = useI18n()
  const { api, base, can } = useAppointments()
  const { data, error, loading, reload } = useAsync(() => api.forPatient(patientId), [patientId, api])
  const [open, setOpen] = useState(null)
  const now = new Date()
  const upcoming = (data || []).filter((a) => new Date(a.ends_at) >= now && !['cancelled', 'no_show', 'completed'].includes(a.status)).reverse()
  const past = (data || []).filter((a) => !upcoming.includes(a))

  const Table = ({ rows }) => (
    <div className="table-wrap">
      <table className="table stack">
        <thead><tr><th>{tx('الموعد', 'When')}</th><th>{tx('الطبيب والخدمة', 'Doctor & service')}</th><th>{tx('السعر', 'Price')}</th><th>{tx('الحالة', 'Status')}</th></tr></thead>
        <tbody>
          {rows.map((a) => (
            <tr key={a.id} className="row-link" onClick={() => setOpen(a.id)}>
              <td className="cell-main num" style={{ whiteSpace: 'nowrap' }}>
                <strong style={{ fontWeight: 500 }}>{dayLabel(dayKey(a.starts_at), locale, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</strong>
                <small className="muted" style={{ display: 'block' }}>{clock(a.starts_at, locale)} – {clock(a.ends_at, locale)}</small>
              </td>
              <td data-label={tx('الطبيب', 'Doctor')}>{pick(a, 'doctor_name')}<small className="muted" style={{ display: 'block' }}>{serviceNames(a.services, pick)}</small></td>
              <td data-label={tx('السعر', 'Price')} className="num">{fmtMoney(a.estimated_price, locale)}</td>
              <td data-label={tx('الحالة', 'Status')}><StatusBadge status={a.status} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )

  return (
    <section className="card">
      <div className="card-head">
        <h2>{tx('المواعيد', 'Appointments')}</h2>
        {can('appointments.book') && (
          <Link to={`${base}/book?patient=${patientId}`} className="btn btn-sm btn-primary"><Icon name="plus" size={16} />{tx('حجز موعد', 'Book appointment')}</Link>
        )}
      </div>
      {error ? <ErrorState error={error} onRetry={reload} /> : loading && !data ? <SkeletonRows rows={3} cols={4} /> : !data.length ? (
        <EmptyState icon="calendar" title={tx('لا توجد مواعيد بعد', 'No appointments yet')} />
      ) : (
        <>
          {upcoming.length > 0 && <><h3 className="sub-head">{tx('القادمة', 'Upcoming')}</h3><Table rows={upcoming} /></>}
          {past.length > 0 && <><h3 className="sub-head">{tx('السابقة', 'Past')}</h3><Table rows={past} /></>}
        </>
      )}
      {open && <AppointmentDrawer id={open} onClose={() => setOpen(null)} onChanged={reload} />}
    </section>
  )
}
