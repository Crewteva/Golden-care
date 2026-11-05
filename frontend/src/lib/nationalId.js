// Egyptian national ID: C YYMMDD GG SSS G X (mirrors backend/app/core/national_id.py).
const GOVERNORATES = {
  '01': ['القاهرة', 'Cairo'], '02': ['الإسكندرية', 'Alexandria'], '03': ['بورسعيد', 'Port Said'], '04': ['السويس', 'Suez'],
  11: ['دمياط', 'Damietta'], 12: ['الدقهلية', 'Dakahlia'], 13: ['الشرقية', 'Sharqia'], 14: ['القليوبية', 'Qalyubia'],
  15: ['كفر الشيخ', 'Kafr El Sheikh'], 16: ['الغربية', 'Gharbia'], 17: ['المنوفية', 'Monufia'], 18: ['البحيرة', 'Beheira'],
  19: ['الإسماعيلية', 'Ismailia'], 21: ['الجيزة', 'Giza'], 22: ['بني سويف', 'Beni Suef'], 23: ['الفيوم', 'Fayoum'],
  24: ['المنيا', 'Minya'], 25: ['أسيوط', 'Assiut'], 26: ['سوهاج', 'Sohag'], 27: ['قنا', 'Qena'], 28: ['أسوان', 'Aswan'],
  29: ['الأقصر', 'Luxor'], 31: ['البحر الأحمر', 'Red Sea'], 32: ['الوادي الجديد', 'New Valley'], 33: ['مطروح', 'Matrouh'],
  34: ['شمال سيناء', 'North Sinai'], 35: ['جنوب سيناء', 'South Sinai'], 88: ['خارج مصر', 'Born abroad'],
}

export function nidDigits(value) {
  return (value || '')
    .replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d))
    .replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d))
    .replace(/\D/g, '')
}

export function parseNationalId(value) {
  const d = nidDigits(value)
  if (d.length !== 14 || !'23'.includes(d[0])) return null
  const year = (d[0] === '2' ? 1900 : 2000) + Number(d.slice(1, 3))
  const month = Number(d.slice(3, 5))
  const day = Number(d.slice(5, 7))
  const born = new Date(Date.UTC(year, month - 1, day))
  if (born.getUTCMonth() !== month - 1 || born.getUTCDate() !== day || born > new Date()) return null
  const gov = GOVERNORATES[d.slice(7, 9)] || GOVERNORATES[Number(d.slice(7, 9))]
  if (!gov) return null
  return {
    digits: d,
    date_of_birth: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    gender: Number(d[12]) % 2 ? 'male' : 'female',
    governorate: gov,
  }
}
