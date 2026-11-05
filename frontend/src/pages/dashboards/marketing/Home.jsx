import RoleHome from '../../../components/RoleHome'

// What this workspace will hold, from the project to-do list. Replace with real pages as they're built.
const UPCOMING = [
  { icon: 'globe', ar: 'محتوى الموقع', en: "Website content", note: { ar: 'مسودة ← مراجعة طبية ← نشر', en: "Draft → medical review → publish" } },
  { icon: 'megaphone', ar: 'صفحات الحملات', en: "Campaign landing pages", note: { ar: 'مع اختبار نسختين', en: "With A/B testing" } },
  { icon: 'trending', ar: 'قمع التسويق', en: "Marketing funnel", note: { ar: 'زيارة ← طلب ← حجز ← حضور', en: "Visit → request → booking → attended" } },
  { icon: 'heart', ar: 'آراء المرضى', en: "Patient testimonials", note: { ar: 'بموافقة المريض فقط', en: "Only with consent" } },
]

export default function Home() {
  return <RoleHome upcoming={UPCOMING} />
}
