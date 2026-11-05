import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import Button from '../Button'
import Icon from '../Icon'
import { useI18n } from '../../i18n/I18nContext'
import { useWorkspace } from './useWorkspace'

// "Find a patient" box for role home pages.
export default function QuickSearch() {
  const { tx } = useI18n()
  const { patientsBase, can } = useWorkspace()
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const submit = (event) => {
    event.preventDefault()
    navigate(q.trim() ? `${patientsBase}?q=${encodeURIComponent(q.trim())}` : patientsBase)
  }
  return (
    <section className="card card-pad">
      <h2 style={{ fontSize: '1.05rem', marginBottom: 12 }}>{tx('ابحث عن مريض', 'Find a patient')}</h2>
      <form className="quick-search" onSubmit={submit} role="search">
        <label className="sr-only" htmlFor="quick-q">{tx('بحث عن مريض', 'Search patients')}</label>
        <div className="input-wrap">
          <span className="input-start"><Icon name="search" size={20} /></span>
          <input id="quick-q" className="input has-start" value={q} onChange={(e) => setQ(e.target.value)}
            placeholder={tx('الاسم بأي تهجئة، الموبايل، رقم الملف أو الرقم القومي', 'Name in any spelling, mobile, file no. or national ID')} />
        </div>
        <Button type="submit" size="lg">{tx('بحث', 'Search')}</Button>
        {can('patients.create') && (
          <Link to={`${patientsBase}/new`} className="btn btn-gold btn-lg">
            <Icon name="userPlus" size={18} />
            {tx('مريض جديد', 'New patient')}
          </Link>
        )}
      </form>
    </section>
  )
}
