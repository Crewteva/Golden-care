import RoleHome from '../../../components/RoleHome'
import HomeStats from '../../../components/patients/HomeStats'
import QuickSearch from '../../../components/patients/QuickSearch'
import BillingStats from '../../../components/billing/BillingStats'

// Still to come in this workspace (from the project to-do list).
const UPCOMING = [
  { icon: 'smartphone', ar: 'تذكير المرضى بالواتساب', en: 'WhatsApp reminders', note: { ar: 'تأكيد وتذكير تلقائي', en: 'Automatic confirmation and reminders' } },
]

export default function Home() {
  return (
    <RoleHome upcoming={UPCOMING}>
      {(data) => (
        <>
          <QuickSearch />
          <HomeStats data={data} />
          <BillingStats data={data} />
        </>
      )}
    </RoleHome>
  )
}
