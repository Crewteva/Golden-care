import { Fragment, useState } from 'react'
import Icon from './Icon'
import Button from './Button'
import { Badge, EmptyState, ErrorState, Pagination, SkeletonRows } from './ui'
import { useAsync, useDebounced } from './useAsync'
import { useI18n } from '../i18n/I18nContext'
import { ACTIONS, CATEGORIES, actionMeta } from '../lib/activity'
import { roleName } from '../auth/roles'
import { fmtDateTime } from '../lib/format'

function DetailsList({ details }) {
  const entries = Object.entries(details || {})
  if (!entries.length) return null
  const show = (value) => {
    if (value === null || value === undefined) return '—'
    if (typeof value === 'object') return JSON.stringify(value)
    return String(value)
  }
  return (
    <div className="json-details ltr" dir="ltr">
      {entries.map(([key, value]) => (
        <div key={key}>
          <span>{key}</span>
          <span>{show(value)}</span>
        </div>
      ))}
    </div>
  )
}

// The activity log table with search, category and date filters. `load(query)` calls the role's own API.
export default function ActivityLog({ load }) {
  const { t, tx, lang, locale } = useI18n()
  const [q, setQ] = useState('')
  const [category, setCategory] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [page, setPage] = useState(1)
  const [openRow, setOpenRow] = useState(null)
  const search = useDebounced(q)

  const { data, error, loading, reload } = useAsync(
    () => load({ q: search, category, date_from: dateFrom, date_to: dateTo, page }),
    [search, category, dateFrom, dateTo, page],
  )
  const filtered = search || category || dateFrom || dateTo
  const reset = () => {
    setQ('')
    setCategory('')
    setDateFrom('')
    setDateTo('')
    setPage(1)
  }

  return (
    <section className="card">
      <div className="toolbar">
        <div className="search">
          <label className="sr-only" htmlFor="activity-q">
            {t('search')}
          </label>
          <div className="input-wrap">
            <span className="input-start">
              <Icon name="search" size={18} />
            </span>
            <input
              id="activity-q"
              className="input has-start"
              placeholder={tx('ابحث باسم الشخص أو الإجراء أو العنوان IP…', 'Search person, action or IP…')}
              value={q}
              onChange={(e) => {
                setQ(e.target.value)
                setPage(1)
              }}
            />
          </div>
        </div>
        <label className="sr-only" htmlFor="activity-cat">
          {tx('النوع', 'Category')}
        </label>
        <select
          id="activity-cat"
          className="select"
          value={category}
          onChange={(e) => {
            setCategory(e.target.value)
            setPage(1)
          }}
        >
          <option value="">{tx('كل الأنواع', 'All categories')}</option>
          {CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>
              {c[lang]}
            </option>
          ))}
        </select>
        <label className="sr-only" htmlFor="activity-from">
          {tx('من تاريخ', 'From date')}
        </label>
        <input
          id="activity-from"
          type="date"
          className="input"
          value={dateFrom}
          max={dateTo || undefined}
          onChange={(e) => {
            setDateFrom(e.target.value)
            setPage(1)
          }}
        />
        <label className="sr-only" htmlFor="activity-to">
          {tx('إلى تاريخ', 'To date')}
        </label>
        <input
          id="activity-to"
          type="date"
          className="input"
          value={dateTo}
          min={dateFrom || undefined}
          onChange={(e) => {
            setDateTo(e.target.value)
            setPage(1)
          }}
        />
        {filtered && (
          <Button variant="quiet" size="sm" icon="x" onClick={reset}>
            {t('clear_filters')}
          </Button>
        )}
      </div>

      {error ? (
        <ErrorState error={error} onRetry={reload} />
      ) : loading && !data ? (
        <SkeletonRows rows={8} cols={4} />
      ) : !data.items.length ? (
        <EmptyState icon="activity" title={tx('لا توجد أحداث مطابقة', 'No matching activity')}>
          {filtered ? tx('جرّب تغيير الفلاتر.', 'Try changing the filters.') : tx('ستظهر الأحداث هنا فور حدوثها.', 'Events will appear here as they happen.')}
        </EmptyState>
      ) : (
        <>
          <div className="table-wrap" style={{ opacity: loading ? 0.6 : 1, transition: 'opacity .2s' }}>
            <table className="table stack">
              <thead>
                <tr>
                  <th>{tx('الوقت', 'Time')}</th>
                  <th>{tx('الشخص', 'Person')}</th>
                  <th>{tx('الإجراء', 'Action')}</th>
                  <th>IP</th>
                  <th>
                    <span className="sr-only">{t('details')}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((row) => {
                  const meta = actionMeta(row.action)
                  const isOpen = openRow === row.id
                  const hasDetails = row.details && Object.keys(row.details).length > 0
                  return (
                    <Fragment key={row.id}>
                      <tr>
                        <td data-label={tx('الوقت', 'Time')} className="num" style={{ whiteSpace: 'nowrap' }}>
                          {fmtDateTime(row.at, locale)}
                        </td>
                        <td data-label={tx('الشخص', 'Person')}>
                          {row.actor_label || <span className="muted">{t('system')}</span>}
                          {row.actor_role && (
                            <small className="muted" style={{ display: 'block', fontSize: '.78rem' }}>
                              {roleName(row.actor_role, lang)}
                            </small>
                          )}
                        </td>
                        <td data-label={tx('الإجراء', 'Action')}>
                          <Badge tone={meta.tone === 'warn' ? 'warn' : meta.tone === 'good' ? 'success' : 'neutral'}>
                            {meta[lang]}
                          </Badge>
                          {!ACTIONS[row.action] && <small className="muted mono"> {row.action}</small>}
                        </td>
                        <td data-label="IP" className="mono muted">
                          <bdi className="ltr">{row.ip || '—'}</bdi>
                        </td>
                        <td style={{ textAlign: 'end' }}>
                          {hasDetails && (
                            <Button
                              variant="quiet"
                              size="sm"
                              iconEnd={isOpen ? 'sortUp' : 'chevronDown'}
                              aria-expanded={isOpen}
                              onClick={() => setOpenRow(isOpen ? null : row.id)}
                            >
                              {t('details')}
                            </Button>
                          )}
                        </td>
                      </tr>
                      {isOpen && (
                        <tr>
                          <td colSpan={5} style={{ paddingTop: 0 }}>
                            <DetailsList details={row.details} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
          <Pagination page={data.page} pageSize={data.page_size} total={data.total} onPage={setPage} />
        </>
      )}
    </section>
  )
}
