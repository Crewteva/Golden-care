import ActivityLog from '../../../components/ActivityLog'
import { PageHeader } from '../../../components/ui'
import { auditorApi } from '../../../api/patient'
import { useI18n } from '../../../i18n/I18nContext'

export default function AuditorActivity() {
  const { tx } = useI18n()
  return (
    <div className="page reveal">
      <PageHeader
        eyebrow={tx('المراجعة', 'Audit')}
        title={tx('سجل النشاط', 'Activity log')}
        description={tx('عرض للقراءة فقط لكل دخول وكل تغيير في الحسابات والصلاحيات.', 'Read-only view of every sign-in and every change to accounts and permissions.')}
      />
      <ActivityLog load={auditorApi.activity} />
    </div>
  )
}
