import { Link } from 'react-router-dom'
import Button from '../Button'
import Icon from '../Icon'
import { Avatar, Badge } from '../ui'
import { useI18n } from '../../i18n/I18nContext'
import { fmtDate, fmtPhone } from '../../lib/format'
import { ageLabel } from './meta'

const REASONS = {
  national_id: { ar: 'نفس الرقم القومي', en: 'Same national ID', tone: 'danger' },
  phone: { ar: 'نفس الموبايل', en: 'Same mobile', tone: 'warn' },
  name_dob: { ar: 'اسم مشابه ونفس تاريخ الميلاد', en: 'Similar name, same birth date', tone: 'warn' },
  similar_name: { ar: 'اسم مشابه جدًا', en: 'Very similar name', tone: 'neutral' },
}

// "Possible existing files" shown while reception types a new patient.
export default function DuplicatePanel({ candidates, checking, linkedId, onLink, patientsBase }) {
  const { tx, lang, pick, locale } = useI18n()
  return (
    <section className="card">
      <div className="card-head">
        <div>
          <h2>{tx('ملفات قد تكون لنفس الشخص', 'Possible existing files')}</h2>
          <p className="muted" style={{ fontSize: '.82rem' }}>
            {tx('نبحث أثناء الكتابة بالاسم والميلاد والموبايل والرقم القومي.', 'Checked as you type: name, birth date, mobile, national ID.')}
          </p>
        </div>
        {checking && <span className="spinner" aria-label={tx('جارٍ البحث', 'Checking')} />}
      </div>
      <div className="card-body" style={{ display: 'grid', gap: 10 }} aria-live="polite">
        {!candidates.length ? (
          <p className="field-ok" style={{ fontSize: '.88rem' }}>
            <Icon name="checkCircle" size={16} />
            {tx('لا توجد ملفات مشابهة حتى الآن.', 'No similar files so far.')}
          </p>
        ) : (
          candidates.map((c) => {
            const strong = c.reasons.includes('national_id')
            const linked = c.id === linkedId
            return (
              <div key={c.id} className={`dup-card ${linked ? 'linked' : strong ? 'strong' : 'soft'}`}>
                <div className="who">
                  <Avatar name={pick(c, 'full_name')} />
                  <div style={{ minWidth: 0 }}>
                    <strong>{pick(c, 'full_name')}</strong>
                    <div className="facts">
                      <span className="mrn">{c.mrn}</span>
                      <span>{fmtDate(c.date_of_birth, locale)} · {ageLabel(c.date_of_birth, tx)}</span>
                      {c.phone && <bdi className="ltr">{fmtPhone(c.phone)}</bdi>}
                    </div>
                  </div>
                </div>
                <div className="reason-chips">
                  {c.reasons.map((r) => (
                    <Badge key={r} tone={REASONS[r].tone}>{REASONS[r][lang]}</Badge>
                  ))}
                  {linked && <Badge tone="success">{tx('مرتبط كفرد من العائلة', 'Linked as family')}</Badge>}
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <Link to={`${patientsBase}/${c.id}`} className="btn btn-primary btn-sm">
                    <Icon name="fileSearch" size={16} />
                    {tx('هذا هو المريض: افتح ملفه', "It's this patient: open file")}
                  </Link>
                  {!strong && !linked && onLink && (
                    <Button variant="ghost" size="sm" icon="users" onClick={() => onLink(c)}>
                      {tx('شخص آخر من نفس العائلة', 'Different person, same family')}
                    </Button>
                  )}
                </div>
              </div>
            )
          })
        )}
      </div>
    </section>
  )
}
