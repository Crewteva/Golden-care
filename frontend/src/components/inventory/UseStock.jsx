import { useState } from 'react'
import { Link } from 'react-router-dom'
import Button from '../Button'
import Icon from '../Icon'
import { EmptyState, ErrorState, PageHeader, SkeletonRows } from '../ui'
import { useAsync } from '../useAsync'
import { useI18n } from '../../i18n/I18nContext'
import { fmtDateTime } from '../../lib/format'
import { IssueModal } from './StockModals'
import { ReportFaultModal } from './Faults'
import { useInventory } from './meta'

// Nurses and doctors: take consumables out of the store for a room or a patient's visit, and report broken devices.
export default function UseStock() {
  const { tx, pick, locale } = useI18n()
  const { api, base, canReport } = useInventory()
  const { data, error, loading, reload } = useAsync(() => api.issues({ mine: true, kind: 'use' }), [api])
  const devices = useAsync(() => (canReport ? api.devices() : Promise.resolve([])), [api, canReport])
  const [modal, setModal] = useState(null)
  return (
    <div className="page reveal">
      <PageHeader eyebrow={tx('المستهلكات', 'Consumables')} title={tx('صرف مستهلكات', 'Use stock')}
        description={tx('سجّل ما تأخذه من المخزن لغرفة أو لزيارة مريض. يُصرف الأقرب انتهاءً أولًا ولا يُصرف أكثر من المتاح.', "Record what you take from the store for a room or a patient's visit. The first to expire goes out first, and you can't take more than there is.")}
        actions={canReport && <Link to={`${base}/faults`} className="btn btn-ghost"><Icon name="alert" size={16} />{tx('أعطال الأجهزة', 'Device faults')}</Link>} />
      <div className="use-actions">
        <button type="button" className="use-tile" onClick={() => setModal('use')}>
          <span className="ut-icon"><Icon name="box" size={26} /></span>
          <strong>{tx('صرف من المخزن', 'Take from stock')}</strong>
          <small>{tx('لغرفة، أو لزيارة مريض اليوم، أو استخدام عام', "For a room, today's patient visit, or general use")}</small>
        </button>
        {canReport && (
          <button type="button" className="use-tile t-danger" onClick={() => setModal('fault')} disabled={!devices.data}>
            <span className="ut-icon"><Icon name="alert" size={26} /></span>
            <strong>{tx('جهاز لا يعمل؟', 'Device not working?')}</strong>
            <small>{tx('أبلغ عن العطل ليصل لمسؤول المخازن فورًا', 'Report it so the inventory team sees it straight away')}</small>
          </button>
        )}
      </div>
      <section className="card">
        <div className="card-head"><h2>{tx('آخر ما صرفته', 'What you took recently')}</h2></div>
        {error ? <ErrorState error={error} onRetry={reload} /> : loading && !data ? <SkeletonRows rows={4} cols={4} /> : !data.length ? (
          <EmptyState icon="box" title={tx('لم تصرف شيئًا بعد', "You haven't taken anything yet")} />
        ) : (
          <div className="table-wrap">
            <table className="table acc-table">
              <thead><tr><th>{tx('الصرف', 'Use')}</th><th>{tx('الوقت', 'When')}</th><th>{tx('لـ', 'For')}</th><th>{tx('الأصناف', 'Items')}</th></tr></thead>
              <tbody>
                {data.map((x) => (
                  <tr key={x.id}>
                    <td className="mrn">{x.ref}</td>
                    <td><bdi>{fmtDateTime(x.created_at, locale)}</bdi></td>
                    <td className="cell-wrap">{x.patient_en ? <>{pick(x, 'patient')}<small className="muted" style={{ display: 'block' }}>{pick(x, 'room')}</small></> : pick(x, 'room') || tx('استخدام عام', 'General use')}</td>
                    <td className="cell-wrap">{pick(x, 'items')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {modal === 'use' && <IssueModal kind="use" onClose={() => setModal(null)} onDone={() => { setModal(null); reload() }} />}
      {modal === 'fault' && devices.data && <ReportFaultModal devices={devices.data.filter((d) => d.is_active)} onClose={() => setModal(null)} onDone={() => { setModal(null); devices.reload() }} />}
    </div>
  )
}
