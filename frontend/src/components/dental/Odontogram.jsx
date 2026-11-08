import { useI18n } from '../../i18n/I18nContext'
import { CONDITIONS } from '../clinical/meta'

// FDI numbering, drawn from the dentist's point of view: the patient's right is on the left of the chart.
export const ARCHES = {
  permanent: [[18, 17, 16, 15, 14, 13, 12, 11], [21, 22, 23, 24, 25, 26, 27, 28], [48, 47, 46, 45, 44, 43, 42, 41], [31, 32, 33, 34, 35, 36, 37, 38]],
  primary: [[55, 54, 53, 52, 51], [61, 62, 63, 64, 65], [85, 84, 83, 82, 81], [71, 72, 73, 74, 75]],
}
const SURFACE_CONDITIONS = ['caries', 'filling', 'sealant', 'fracture', 'veneer']
const S = 34 // tooth box size
const A = S * 0.3 // inner square inset
const GAP = 7
const MID = 18 // extra space at the midline

export function toothLayout(t) {
  const q = Math.floor(t / 10)
  const n = t % 10
  const upper = [1, 2, 5, 6].includes(q)
  const patientRight = [1, 4, 5, 8].includes(q)
  return {
    upper,
    top: upper ? 'B' : 'L',
    bottom: upper ? 'L' : 'B',
    left: patientRight ? 'D' : 'M',
    right: patientRight ? 'M' : 'D',
    center: n <= 3 ? 'I' : 'O',
  }
}

// The current state of each tooth from its history: last condition per surface, plus whole-tooth findings.
export function toothStates(entries) {
  const states = {}
  const sorted = [...entries].filter((e) => !e.voided_at).sort((a, b) => new Date(a.recorded_at) - new Date(b.recorded_at) || a.id - b.id)
  for (const e of sorted) {
    const s = (states[e.tooth] ||= { surfaces: {}, flags: new Set(), entries: [] })
    s.entries.push(e)
    if (SURFACE_CONDITIONS.includes(e.condition) && e.surfaces.length) {
      for (const surface of e.surfaces) s.surfaces[surface === 'I' ? 'O' : surface] = e.condition
    } else if (['missing', 'extracted'].includes(e.condition)) {
      s.flags.add('missing')
      s.flags.delete('implant')
    } else if (e.condition === 'implant') {
      s.flags.add('implant')
      s.flags.delete('missing')
    } else {
      s.flags.add(e.condition)
    }
  }
  return states
}

function Tooth({ t, x, y, state, planned, selected, onSelect, lang }) {
  const lay = toothLayout(t)
  const color = (surface) => {
    const key = surface === 'I' ? 'O' : surface
    const c = state?.surfaces[key]
    return c ? CONDITIONS[c].color : '#FFFDF8'
  }
  const flags = state?.flags || new Set()
  const missing = flags.has('missing')
  const rootY = lay.upper ? y - 16 : y + S + 4
  const labelY = lay.upper ? y + S + 15 : y - 6
  const titleParts = [
    `${t}`,
    ...[...flags].map((f) => CONDITIONS[f === 'missing' ? 'missing' : f]?.[lang]),
    ...Object.entries(state?.surfaces || {}).map(([s, c]) => `${CONDITIONS[c][lang]} (${s})`),
    ...(planned?.length ? [lang === 'ar' ? 'عمل مخطط' : 'Planned work'] : []),
  ].filter(Boolean)
  return (
    <g className={`tooth ${selected ? 'selected' : ''} ${missing ? 'missing' : ''}`} role="button" tabIndex={0}
      aria-label={titleParts.join(' · ')} aria-pressed={selected}
      onClick={() => onSelect(t)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(t) } }}>
      <title>{titleParts.join(' · ')}</title>
      {/* root */}
      <rect x={x + S / 2 - 5} y={rootY} width={10} height={12} rx={4}
        fill={flags.has('implant') ? CONDITIONS.implant.color : flags.has('root_canal') ? CONDITIONS.root_canal.color : '#EFE6D3'}
        stroke="#CBBB98" strokeWidth="1" opacity={missing ? 0.3 : 1} />
      <g transform={`translate(${x} ${y})`} opacity={missing ? 0.35 : 1}>
        <polygon points={`0,0 ${S},0 ${S - A},${A} ${A},${A}`} fill={color(lay.top)} />
        <polygon points={`${A},${S - A} ${S - A},${S - A} ${S},${S} 0,${S}`} fill={color(lay.bottom)} />
        <polygon points={`0,0 ${A},${A} ${A},${S - A} 0,${S}`} fill={color(lay.left)} />
        <polygon points={`${S},0 ${S},${S} ${S - A},${S - A} ${S - A},${A}`} fill={color(lay.right)} />
        <rect x={A} y={A} width={S - 2 * A} height={S - 2 * A} fill={color('O')} />
        <g fill="none" stroke="#A89A78" strokeWidth="1">
          <rect x="0.5" y="0.5" width={S - 1} height={S - 1} rx="3" />
          <rect x={A} y={A} width={S - 2 * A} height={S - 2 * A} />
          <path d={`M0.5 0.5 L${A} ${A} M${S - 0.5} 0.5 L${S - A} ${A} M0.5 ${S - 0.5} L${A} ${S - A} M${S - 0.5} ${S - 0.5} L${S - A} ${S - A}`} />
        </g>
        {flags.has('crown') && <rect x="-2.5" y="-2.5" width={S + 5} height={S + 5} rx="6" fill="none" stroke={CONDITIONS.crown.color} strokeWidth="3" />}
        {flags.has('bridge') && <path d={`M-4 ${S / 2} H${S + 4}`} stroke={CONDITIONS.bridge.color} strokeWidth="3" />}
        {flags.has('veneer') && <path d={`M3 ${lay.upper ? 2 : S - 2} H${S - 3}`} stroke={CONDITIONS.veneer.color} strokeWidth="4" strokeLinecap="round" />}
        {flags.has('fracture') && <path d={`M${S * 0.3} 2 L${S * 0.55} ${S * 0.5} L${S * 0.4} ${S * 0.55} L${S * 0.7} ${S - 2}`} fill="none" stroke={CONDITIONS.fracture.color} strokeWidth="2" />}
        {flags.has('watch') && <circle cx={S - 4} cy={4} r="4" fill={CONDITIONS.watch.color} stroke="#fff" strokeWidth="1" />}
      </g>
      {missing && <path d={`M${x + 3} ${y + 3} L${x + S - 3} ${y + S - 3} M${x + S - 3} ${y + 3} L${x + 3} ${y + S - 3}`} stroke="#6E6A60" strokeWidth="2.5" strokeLinecap="round" />}
      {planned?.length > 0 && <rect x={x - 4} y={y - 4} width={S + 8} height={S + 8} rx="8" fill="none" stroke="#B7862F" strokeWidth="1.6" strokeDasharray="4 3" />}
      {selected && <rect x={x - 6} y={y - 6} width={S + 12} height={S + 12} rx="9" fill="none" stroke="#0B211E" strokeWidth="2.2" />}
      <text x={x + S / 2} y={labelY} textAnchor="middle" className="tooth-no">{t}</text>
    </g>
  )
}

// The tooth chart. Click a tooth to see its history and record a finding.
export default function Odontogram({ entries, planned = [], set = 'permanent', selected, onSelect }) {
  const { lang } = useI18n()
  const states = toothStates(entries)
  const plannedBy = {}
  for (const p of planned) (plannedBy[p.tooth] ||= []).push(p)
  const [ur, ul, lr, ll] = ARCHES[set]
  const per = ur.length
  const width = per * 2 * (S + GAP) + MID + 20
  const rowUpper = 30
  const rowLower = rowUpper + S + 58
  const height = rowLower + S + 26
  const xOf = (i, left) => 10 + (left ? i : per + i) * (S + GAP) + (left ? 0 : MID)
  const draw = (row, y, left) => row.map((t, i) => (
    <Tooth key={t} t={t} x={xOf(i, left)} y={y} state={states[t]} planned={plannedBy[t]} selected={selected === t} onSelect={onSelect} lang={lang} />
  ))
  return (
    <div className="odontogram" dir="ltr">
      <svg viewBox={`0 0 ${width} ${height}`} role="group" aria-label={lang === 'ar' ? 'خريطة الأسنان' : 'Tooth chart'}>
        <line x1={width / 2} y1="6" x2={width / 2} y2={height - 6} stroke="#E4D9C3" strokeDasharray="3 4" />
        <line x1="6" y1={(rowUpper + S + rowLower) / 2} x2={width - 6} y2={(rowUpper + S + rowLower) / 2} stroke="#E4D9C3" strokeDasharray="3 4" />
        <text x="8" y="12" className="arch-label">{lang === 'ar' ? 'يمين المريض' : "Patient's right"}</text>
        <text x={width - 8} y="12" textAnchor="end" className="arch-label">{lang === 'ar' ? 'يسار المريض' : "Patient's left"}</text>
        {draw(ur, rowUpper, true)}
        {draw(ul, rowUpper, false)}
        {draw(lr, rowLower, true)}
        {draw(ll, rowLower, false)}
      </svg>
    </div>
  )
}

export function ChartLegend() {
  const { lang } = useI18n()
  return (
    <ul className="chart-legend">
      {['caries', 'filling', 'crown', 'root_canal', 'missing', 'implant', 'sealant', 'watch'].map((k) => (
        <li key={k}><i style={{ background: CONDITIONS[k].color }} />{CONDITIONS[k][lang]}</li>
      ))}
      <li><i className="planned" />{lang === 'ar' ? 'عمل مخطط' : 'Planned'}</li>
    </ul>
  )
}
