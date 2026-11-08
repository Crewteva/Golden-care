import { Link, useParams } from 'react-router-dom'
import Button from '../Button'
import Icon from '../Icon'
import PageLoader from '../PageLoader'
import { LogoMark } from '../Logo'
import { ErrorState } from '../ui'
import { useAsync } from '../useAsync'
import { useI18n } from '../../i18n/I18nContext'
import { fmtDate, fmtDateTime, fmtPhone } from '../../lib/format'
import { ageLabel, sexLabel } from '../patients/meta'
import { FORMS, useVisits } from './meta'

// The prescription on the clinic letterhead (A5). Shows the drugs and the patient's allergies; never the medical note.
export function RxSheet({ visit, rx, allergies = [], branch }) {
  const { tx, lang, pick, locale } = useI18n()
  return (
    <article className="rx-sheet" aria-label={tx('روشتة', 'Prescription')}>
      <header className="rx-letterhead">
        <LogoMark size={46} />
        <div className="rx-clinic">
          <strong>{tx('عيادات جولدن كير', 'Golden Care Clinics')}</strong>
          <span>{branch ? pick(branch, 'name') : tx('مدينة الشروق', 'Madinat El Shorouk')}</span>
          {branch && (pick(branch, 'address') || branch.phone) && (
            <small>{pick(branch, 'address')}{branch.phone && <> · <bdi className="ltr">{fmtPhone(branch.phone)}</bdi></>}</small>
          )}
        </div>
        <div className="rx-doctor">
          <strong>{pick(visit, 'doctor_name')}</strong>
          {pick(visit, 'doctor_title') && <span>{pick(visit, 'doctor_title')}</span>}
          {pick(visit, 'specialty_name') && <small>{pick(visit, 'specialty_name')}</small>}
        </div>
      </header>

      <dl className="rx-patient">
        <div><dt>{tx('المريض', 'Patient')}</dt><dd>{pick(visit, 'patient_name')}</dd></div>
        <div><dt>{tx('السن / النوع', 'Age / sex')}</dt><dd>{ageLabel(visit.date_of_birth, tx)} · {sexLabel(visit.gender, tx)}</dd></div>
        <div><dt>{tx('رقم الملف', 'File no.')}</dt><dd className="mrn">{visit.mrn}</dd></div>
        <div><dt>{tx('التاريخ', 'Date')}</dt><dd><bdi>{fmtDate(visit.signed_at || visit.started_at, locale)}</bdi></dd></div>
      </dl>
      {allergies.length > 0 && (
        <p className="rx-allergies"><Icon name="alert" size={14} /> <strong>{tx('حساسية:', 'Allergies:')}</strong> {allergies.join(' · ')}</p>
      )}

      <div className="rx-body">
        <span className="rx-symbol" aria-hidden="true">℞</span>
        {!rx.length ? <p className="muted">{tx('لا توجد أدوية.', 'No drugs.')}</p> : (
          <ol>
            {rx.map((r, i) => (
              <li key={i}>
                <div className="rx-line-head" dir="ltr"><strong>{r.drug_name}</strong> <span>{FORMS[r.form]?.en || ''}{r.strength && !r.drug_name.includes(r.strength) ? ` · ${r.strength}` : ''}</span></div>
                <div className="rx-line-sig" dir="ltr">{r.dose} — {r.frequency} — {r.duration}</div>
                {r.instructions && <div className="rx-line-note">{r.instructions}</div>}
              </li>
            ))}
          </ol>
        )}
      </div>

      <footer className="rx-foot">
        <div>
          <span className="rx-sign-line" />
          <small>{tx('توقيع الطبيب', "Doctor's signature")}</small>
        </div>
        <div className="rx-meta">
          <small className="mrn">{visit.ref}</small>
          {visit.signed_at && <small>{tx('وُقّعت إلكترونيًا', 'Signed electronically')} <bdi>{fmtDateTime(visit.signed_at, locale)}</bdi></small>}
          <small>{lang === 'ar' ? 'نرعاك لحياة أفضل' : 'Caring for a better life'}</small>
        </div>
      </footer>
    </article>
  )
}

export function PrintBar({ back, label }) {
  const { tx } = useI18n()
  return (
    <div className="print-bar no-print">
      <Link to={back} className="back-link"><Icon name="arrowLeft" size={16} />{label}</Link>
      <Button icon="printer" onClick={() => window.print()}>{tx('طباعة', 'Print')}</Button>
    </div>
  )
}

// Staff page: /dashboard/<role>/visits/:id/print
export default function RxPrint() {
  const { id } = useParams()
  const { tx } = useI18n()
  const { api, base } = useVisits()
  const { data, error, reload } = useAsync(() => api.get(id), [id, api])
  if (error) return <ErrorState error={error} onRetry={reload} />
  if (!data) return <PageLoader />
  const allergies = data.alerts.filter((a) => a.kind === 'allergy').map((a) => a.description)
  return (
    <div className="page print-page">
      <PrintBar back={`${base}/visits/${id}`} label={tx('الرجوع للزيارة', 'Back to the visit')} />
      {data.visit.status !== 'signed' ? (
        <ErrorState error={{ code: 'visit_not_signed' }} />
      ) : (
        <RxSheet visit={data.visit} rx={data.rx} allergies={allergies} branch={data.branch} />
      )}
    </div>
  )
}
