import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import Button from '../Button'
import Icon from '../Icon'
import { Avatar, Badge, EmptyState, ErrorState, PageHeader, Pagination, SkeletonRows, SortTh } from '../ui'
import { useAsync, useDebounced } from '../useAsync'
import { useI18n } from '../../i18n/I18nContext'
import { fmtPhone, fmtRelative } from '../../lib/format'
import { ALERT_KINDS, ageLabel, sexLabel } from './meta'
import { useWorkspace } from './useWorkspace'

const AGES = {
  '': [null, null],
  child: [0, 11],
  teen: [12, 17],
  adult: [18, 39],
  middle: [40, 64],
  senior: [65, null],
}

// Searchable list of patient files, used by every role that works with patients.
export default function PatientDirectory() {
  const { t, tx, lang, pick, locale } = useI18n()
  const { api, patientsBase, can } = useWorkspace()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [q, setQ] = useState(params.get('q') || '')
  const [gender, setGender] = useState('')
  const [age, setAge] = useState('')
  const [source, setSource] = useState('')
  const [alertsOnly, setAlertsOnly] = useState(false)
  const [sort, setSort] = useState('created')
  const [direction, setDirection] = useState('desc')
  const [page, setPage] = useState(1)
  const search = useDebounced(q)
  const [ageMin, ageMax] = AGES[age]

  const list = useAsync(
    () => api.search({ q: search, gender, age_min: ageMin, age_max: ageMax, source, has_alerts: alertsOnly || undefined,
      sort, direction, page, page_size: 20 }),
    [search, gender, age, source, alertsOnly, sort, direction, page, api],
  )
  const filtered = search || gender || age || source || alertsOnly
  const reset = () => {
    setQ(''); setGender(''); setAge(''); setSource(''); setAlertsOnly(false); setPage(1)
  }
  const onSort = (column) => {
    if (column === sort) setDirection((d) => (d === 'asc' ? 'desc' : 'asc'))
    else {
      setSort(column)
      setDirection(column === 'created' ? 'desc' : 'asc')
    }
    setPage(1)
  }
  const nameSort = lang === 'ar' ? 'name_ar' : 'name_en'
  const sel = (setter) => (e) => { setter(e.target.value); setPage(1) }

  return (
    <div className="page reveal">
      <PageHeader
        eyebrow={tx('المرضى', 'Patients')}
        title={tx('ملفات المرضى', 'Patient files')}
        description={tx('ملف واحد لكل مريض في كل الفروع. ابحث بالاسم بأي تهجئة، أو الموبايل بأي صيغة، أو رقم الملف، أو الرقم القومي.',
          'One file per patient across all branches. Search by name in any spelling, mobile in any format, file number or national ID.')}
        actions={can('patients.create') && (
          <Link to={`${patientsBase}/new`} className="btn btn-gold"><Icon name="userPlus" size={18} />{tx('مريض جديد', 'New patient')}</Link>
        )}
      />

      <section className="card">
        <div className="toolbar">
          <div className="search">
            <label className="sr-only" htmlFor="patients-q">{t('search')}</label>
            <div className="input-wrap">
              <span className="input-start"><Icon name="search" size={18} /></span>
              <input id="patients-q" className="input has-start" value={q} autoFocus
                placeholder={tx('اسم، موبايل، رقم ملف، رقم قومي…', 'Name, mobile, file no., national ID…')}
                onChange={(e) => { setQ(e.target.value); setPage(1) }} />
            </div>
          </div>
          <label className="sr-only" htmlFor="patients-gender">{tx('النوع', 'Sex')}</label>
          <select id="patients-gender" className="select" value={gender} onChange={sel(setGender)}>
            <option value="">{tx('الكل (النوع)', 'Any sex')}</option>
            <option value="female">{tx('إناث', 'Female')}</option>
            <option value="male">{tx('ذكور', 'Male')}</option>
          </select>
          <label className="sr-only" htmlFor="patients-age">{tx('العمر', 'Age')}</label>
          <select id="patients-age" className="select" value={age} onChange={sel(setAge)}>
            <option value="">{tx('كل الأعمار', 'Any age')}</option>
            <option value="child">{tx('أطفال (أقل من ١٢)', 'Children (under 12)')}</option>
            <option value="teen">{tx('١٢–١٧', '12–17')}</option>
            <option value="adult">{tx('١٨–٣٩', '18–39')}</option>
            <option value="middle">{tx('٤٠–٦٤', '40–64')}</option>
            <option value="senior">{tx('٦٥ فأكثر', '65+')}</option>
          </select>
          <label className="sr-only" htmlFor="patients-source">{tx('طريقة التسجيل', 'Registered by')}</label>
          <select id="patients-source" className="select" value={source} onChange={sel(setSource)}>
            <option value="">{tx('كل طرق التسجيل', 'Any registration')}</option>
            <option value="reception">{tx('بالاستقبال', 'At reception')}</option>
            <option value="self">{tx('أونلاين', 'Online')}</option>
          </select>
          <label className="check" style={{ alignItems: 'center' }}>
            <input type="checkbox" checked={alertsOnly} onChange={(e) => { setAlertsOnly(e.target.checked); setPage(1) }} />
            <span>{tx('لديه تنبيهات طبية', 'Has medical alerts')}</span>
          </label>
          {filtered && <Button variant="quiet" size="sm" icon="x" onClick={reset}>{t('clear_filters')}</Button>}
        </div>

        {list.error ? (
          <ErrorState error={list.error} onRetry={list.reload} />
        ) : list.loading && !list.data ? (
          <SkeletonRows rows={8} cols={5} />
        ) : !list.data.items.length ? (
          <EmptyState icon="users" title={filtered ? tx('لا يوجد مريض مطابق', 'No matching patient') : tx('لا توجد ملفات بعد', 'No patient files yet')}
            action={can('patients.create') ? <Link className="btn btn-ghost" to={`${patientsBase}/new${search ? '' : ''}`}>{tx('فتح ملف جديد', 'Open a new file')}</Link> : null}>
            {filtered ? tx('تأكد من الرقم أو جرّب جزءًا من الاسم.', 'Check the number or try part of the name.') : null}
          </EmptyState>
        ) : (
          <>
            <div className="table-wrap" style={{ opacity: list.loading ? 0.6 : 1, transition: 'opacity .2s' }}>
              <table className="table stack">
                <thead>
                  <tr>
                    <SortTh label={tx('المريض', 'Patient')} column={nameSort} sort={sort} direction={direction} onSort={onSort} />
                    <SortTh label={tx('العمر', 'Age')} column="age" sort={sort} direction={direction === 'asc' ? 'desc' : 'asc'} onSort={onSort} />
                    <th>{tx('الموبايل', 'Mobile')}</th>
                    <th>{tx('تنبيهات طبية', 'Medical alerts')}</th>
                    <SortTh label={tx('فُتح الملف', 'File opened')} column="created" sort={sort} direction={direction} onSort={onSort} />
                  </tr>
                </thead>
                <tbody>
                  {list.data.items.map((p) => {
                    const critical = p.alerts.filter((a) => a.severity === 'critical')
                    return (
                      <tr key={p.id} className="row-link" onClick={() => navigate(`${patientsBase}/${p.id}`)}>
                        <td className="cell-main">
                          <div className="person">
                            <Avatar name={pick(p, 'full_name')} />
                            <div style={{ minWidth: 0 }}>
                              <Link to={`${patientsBase}/${p.id}`} className="person-name" onClick={(e) => e.stopPropagation()}>{pick(p, 'full_name')}</Link>
                              <small><span className="mrn">{p.mrn}</span>{lang === 'ar' && p.full_name_en ? ` · ${p.full_name_en}` : ''}</small>
                            </div>
                          </div>
                        </td>
                        <td data-label={tx('العمر', 'Age')} style={{ whiteSpace: 'nowrap' }}>
                          {ageLabel(p.date_of_birth, tx)} <span className="muted">· {sexLabel(p.gender, tx)}</span>
                        </td>
                        <td data-label={tx('الموبايل', 'Mobile')} className="ltr" style={{ textAlign: 'start', whiteSpace: 'nowrap' }}>
                          {p.phone ? fmtPhone(p.phone) : <span className="muted">{tx('عبر ولي الأمر', 'via guardian')}</span>}
                        </td>
                        <td data-label={tx('تنبيهات', 'Alerts')}>
                          {!p.alerts.length ? <span className="muted">—</span> : (
                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                              {critical.length > 0 && <Badge tone="danger">{critical.map((a) => ALERT_KINDS[a.kind][lang]).join('، ')}</Badge>}
                              {p.alerts.length > critical.length && <Badge tone="warn">{tx(`${p.alerts.length - critical.length} تنبيه`, `${p.alerts.length - critical.length} alert(s)`)}</Badge>}
                            </div>
                          )}
                        </td>
                        <td data-label={tx('فُتح الملف', 'Opened')} className="muted" style={{ whiteSpace: 'nowrap' }}>
                          <bdi>{fmtRelative(p.created_at, locale)}</bdi>
                          <small style={{ display: 'block' }}>
                            {p.registered_via === 'self' ? tx('أونلاين', 'Online') : tx('بالاستقبال', 'At reception')}
                            {p.has_portal && <> · <Icon name="smartphone" size={12} /> {tx('له حساب', 'has account')}</>}
                          </small>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <Pagination page={list.data.page} pageSize={list.data.page_size} total={list.data.total} onPage={setPage} />
          </>
        )}
      </section>
    </div>
  )
}
