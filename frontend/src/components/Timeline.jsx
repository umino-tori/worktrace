import { useMemo } from 'react'

// プロジェクト名から色を決定的に割り当てる
const PALETTE = [
  { bg: 'bg-indigo-500', light: 'bg-indigo-100', text: 'text-indigo-700', bar: '#6366f1' },
  { bg: 'bg-emerald-500', light: 'bg-emerald-100', text: 'text-emerald-700', bar: '#10b981' },
  { bg: 'bg-amber-500', light: 'bg-amber-100', text: 'text-amber-700', bar: '#f59e0b' },
  { bg: 'bg-rose-500', light: 'bg-rose-100', text: 'text-rose-700', bar: '#f43f5e' },
  { bg: 'bg-violet-500', light: 'bg-violet-100', text: 'text-violet-700', bar: '#8b5cf6' },
  { bg: 'bg-cyan-500', light: 'bg-cyan-100', text: 'text-cyan-700', bar: '#06b6d4' },
  { bg: 'bg-orange-500', light: 'bg-orange-100', text: 'text-orange-700', bar: '#f97316' },
  { bg: 'bg-pink-500', light: 'bg-pink-100', text: 'text-pink-700', bar: '#ec4899' },
]

function hashProject(name) {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffffffff
  return PALETTE[Math.abs(h) % PALETTE.length]
}

function timeToMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

function formatDuration(minutes) {
  if (minutes < 60) return `${minutes}分`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m === 0 ? `${h}時間` : `${h}時間${m}分`
}

const HOUR_MARKS = [0, 6, 9, 12, 15, 18, 21, 24]

export default function Timeline({ entries, onDelete }) {
  // 総作業時間
  const totalMinutes = useMemo(
    () => entries.reduce((sum, e) => sum + e.duration_minutes, 0),
    [entries]
  )

  // 隙間時間の計算
  const gaps = useMemo(() => {
    if (entries.length === 0) return []
    const sorted = [...entries].sort((a, b) => timeToMinutes(a.start_time) - timeToMinutes(b.start_time))
    const result = []
    for (let i = 0; i < sorted.length - 1; i++) {
      const endMin = timeToMinutes(sorted[i].end_time)
      const nextStart = timeToMinutes(sorted[i + 1].start_time)
      if (nextStart > endMin) {
        result.push({ start: sorted[i].end_time, end: sorted[i + 1].start_time, minutes: nextStart - endMin })
      }
    }
    return result
  }, [entries])

  if (entries.length === 0) {
    return (
      <div className="text-center py-12 text-slate-400">
        <div className="text-4xl mb-3">🕐</div>
        <p className="font-medium">この日の記録はありません</p>
        <p className="text-sm mt-1">上のフォームから作業を記録してください</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* サマリー */}
      <div className="flex items-center gap-4 text-sm">
        <div className="bg-indigo-50 text-indigo-700 rounded-lg px-3 py-1.5 font-semibold">
          合計 {formatDuration(totalMinutes)}
        </div>
        {gaps.length > 0 && (
          <div className="text-slate-400">
            隙間 {gaps.length} 箇所 ({formatDuration(gaps.reduce((s, g) => s + g.minutes, 0))})
          </div>
        )}
      </div>

      {/* 24時間ビジュアルバー */}
      <div>
        <div className="relative h-10 bg-slate-100 rounded-xl overflow-hidden">
          {entries.map(e => {
            const left = (timeToMinutes(e.start_time) / 1440) * 100
            const width = (e.duration_minutes / 1440) * 100
            const color = hashProject(e.project)
            return (
              <div
                key={e.id}
                className="absolute top-0 h-full transition-all"
                style={{
                  left: `${left}%`,
                  width: `${Math.max(width, 0.3)}%`,
                  backgroundColor: color.bar,
                  opacity: 0.85,
                }}
                title={`${e.project} (${e.start_time}–${e.end_time})`}
              />
            )
          })}
          {/* 隙間 */}
          {gaps.map((g, i) => {
            const left = (timeToMinutes(g.start) / 1440) * 100
            const width = (g.minutes / 1440) * 100
            return (
              <div
                key={i}
                className="absolute top-0 h-full border-x border-dashed border-slate-300"
                style={{ left: `${left}%`, width: `${width}%`, backgroundColor: 'rgba(148,163,184,0.15)' }}
              />
            )
          })}
        </div>
        {/* 時間軸 */}
        <div className="relative h-5 mt-1">
          {HOUR_MARKS.map(h => (
            <span
              key={h}
              className="absolute text-xs text-slate-400 -translate-x-1/2"
              style={{ left: `${(h / 24) * 100}%` }}
            >
              {String(h).padStart(2, '0')}
            </span>
          ))}
        </div>
      </div>

      {/* エントリリスト */}
      <div className="space-y-2">
        {[...entries]
          .sort((a, b) => timeToMinutes(a.start_time) - timeToMinutes(b.start_time))
          .map(entry => {
            const color = hashProject(entry.project)
            return (
              <div
                key={entry.id}
                className="flex items-center gap-3 p-3 rounded-xl border border-slate-100 hover:border-slate-200 hover:shadow-sm transition-all group"
              >
                {/* カラーバー */}
                <div className={`w-1 h-10 rounded-full flex-shrink-0 ${color.bg}`} />

                {/* 時間 */}
                <div className="w-28 flex-shrink-0">
                  <span className="font-mono text-sm font-semibold text-slate-700">
                    {entry.start_time}
                  </span>
                  <span className="text-slate-400 mx-1 text-xs">–</span>
                  <span className="font-mono text-sm font-semibold text-slate-700">
                    {entry.end_time}
                  </span>
                </div>

                {/* 期間 */}
                <div className="w-16 flex-shrink-0 text-xs text-slate-400 font-medium">
                  {formatDuration(entry.duration_minutes)}
                </div>

                {/* プロジェクト */}
                <div className={`px-2.5 py-1 rounded-lg text-xs font-semibold ${color.light} ${color.text} flex-shrink-0`}>
                  {entry.project}
                </div>

                {/* 作業種別 */}
                <div className="text-sm text-slate-600 flex-1">
                  {entry.task_type}
                </div>

                {/* 削除ボタン */}
                <button
                  onClick={() => onDelete(entry.id)}
                  className="btn-danger opacity-0 group-hover:opacity-100 flex-shrink-0"
                >
                  削除
                </button>
              </div>
            )
          })}

        {/* 隙間時間表示 */}
        {gaps.map((g, i) => (
          <div
            key={`gap-${i}`}
            className="flex items-center gap-3 p-3 rounded-xl border border-dashed border-slate-200"
          >
            <div className="w-1 h-6 rounded-full bg-slate-200 flex-shrink-0" />
            <div className="w-28 flex-shrink-0 font-mono text-sm text-slate-400">
              {g.start} – {g.end}
            </div>
            <div className="w-16 flex-shrink-0 text-xs text-slate-400">
              {formatDuration(g.minutes)}
            </div>
            <div className="text-xs text-slate-400 italic">未記録</div>
          </div>
        ))}
      </div>
    </div>
  )
}
