import { Link } from 'react-router-dom'
import Icon from '../Icon'
import { useI18n } from '../../i18n/I18nContext'
import { clock } from '../../lib/clinicTime'
import { fmtNumber } from '../../lib/format'
import { money, num, useBilling } from './meta'

// Billing figures on a role's home page; each card only shows when the role can open the page it links to.
export default function BillingStats({ data }) {
  const { tx, locale } = useI18n()
  const { bill, can } = useBilling()
  const b = data?.billing
  if (!b) return null
  const n = (v) => fmtNumber(v, locale)
  const collect = can('billing.collect')
  const approve = can('billing.approve')
  return (
    <div className="stats">
      {collect && (
        <Link to={`${bill}/shift`} className={`stat ${b.shift ? 'feature' : 'attention'}`}>
          <div className="stat-label"><Icon name="cash" size={17} />{tx('ورديتي', 'My shift')}</div>
          {b.shift ? (
            <>
              <div className="stat-value num">{money(b.shift.totals?.collected ?? 0, locale)}</div>
              <div className="stat-foot">{tx(`مفتوحة منذ ${clock(b.shift.opened_at, locale)} · نقدية متوقعة ${money(b.shift.expected_cash, locale)}`, `Open since ${clock(b.shift.opened_at, locale)} · expected cash ${money(b.shift.expected_cash, locale)}`)}</div>
            </>
          ) : (
            <>
              <div className="stat-value">{tx('مغلقة', 'Closed')}</div>
              <div className="stat-foot">{tx('افتح ورديتك قبل التحصيل', 'Open your shift before collecting')}</div>
            </>
          )}
        </Link>
      )}
      {collect && (
        <Link to={bill} className={`stat ${b.unbilled_today ? 'attention' : ''}`}>
          <div className="stat-label"><Icon name="clipboard" size={17} />{tx('زيارات لم تُفوتر اليوم', 'Visits not billed today')}</div>
          <div className="stat-value num">{n(b.unbilled_today)}</div>
          <div className="stat-foot">{tx(`فواتير اليوم ${money(b.invoiced_today, locale)}`, `Invoiced today ${money(b.invoiced_today, locale)}`)}</div>
        </Link>
      )}
      {!collect && (
        <Link to={`${bill}/invoices`} className="stat feature">
          <div className="stat-label"><Icon name="cash" size={17} />{tx('المحصّل اليوم', 'Collected today')}</div>
          <div className="stat-value num">{money(b.collected_today, locale)}</div>
          <div className="stat-foot">{tx(`فواتير اليوم ${money(b.invoiced_today, locale)}`, `Invoiced today ${money(b.invoiced_today, locale)}`)}</div>
        </Link>
      )}
      <Link to={`${bill}/invoices`} className="stat">
        <div className="stat-label"><Icon name="trending" size={17} />{tx('مستحق على المرضى', 'Owed by patients')}</div>
        <div className="stat-value num">{money(b.outstanding, locale)}</div>
        <div className="stat-foot">{tx('كل الفواتير الصادرة غير المسددة', 'All issued invoices not fully paid')}</div>
      </Link>
      {approve && (
        <Link to={`${bill}/approvals`} className={`stat ${b.pending_approvals ? 'attention' : ''}`}>
          <div className="stat-label"><Icon name="shieldCheck" size={17} />{tx('بانتظار اعتمادك', 'Waiting for your approval')}</div>
          <div className="stat-value num">{n(b.pending_approvals)}</div>
          <div className="stat-foot">{tx('خصومات، إلغاءات، مرتجعات', 'Discounts, voids, refunds')}</div>
        </Link>
      )}
      {(collect || (approve && num(b.refunds_to_pay) > 0)) && (
        <Link to={`${bill}/refunds`} className={`stat ${b.refunds_to_pay && collect ? 'attention' : ''}`}>
          <div className="stat-label"><Icon name="refresh" size={17} />{tx('مرتجعات جاهزة للصرف', 'Refunds ready to pay')}</div>
          <div className="stat-value num">{n(b.refunds_to_pay)}</div>
          <div className="stat-foot">{tx('اعتمدتها الإدارة', 'Approved by management')}</div>
        </Link>
      )}
    </div>
  )
}
