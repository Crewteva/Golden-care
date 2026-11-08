import RoleHome from '../../../components/RoleHome'
import BillingStats from '../../../components/billing/BillingStats'
import { PatientFinder } from '../../../components/billing/meta'
import { useI18n } from '../../../i18n/I18nContext'

export default function Home() {
  const { tx } = useI18n()
  return (
    <RoleHome>
      {(data) => (
        <>
          <section className="card card-body home-finder">
            <h2 className="card-title">{tx('حساب مريض', 'Patient account')}</h2>
            <PatientFinder />
          </section>
          <BillingStats data={data} />
        </>
      )}
    </RoleHome>
  )
}
