import ActivityLog from '../../../components/ActivityLog'
import { PageHeader } from '../../../components/ui'
import { adminApi } from '../../../api/admin'
import { useI18n } from '../../../i18n/I18nContext'

export default function Activity() {
  const { tx } = useI18n()
  return (
    <div className="page reveal">
      <PageHeader
        eyebrow={tx('المراجعة', 'Audit')}
        title={tx('سجل النشاط', 'Activity log')}
        description={tx(
          'كل دخول وكل تغيير في الحسابات مسجّل هنا مع الوقت والعنوان. لا يمكن لأحد تعديل هذا السجل أو حذفه، ولا حتى مدير النظام.',
          'Every sign-in and account change is recorded here with time and address. Nobody can edit or delete this log, not even the system admin.',
        )}
      />
      <ActivityLog load={adminApi.activity} />
    </div>
  )
}
