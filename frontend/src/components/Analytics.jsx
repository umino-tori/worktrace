import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
} from 'recharts'

const PROJECT_COLORS = [
  '#6366f1', '#10b981', '#f59e0b', '#f43f5e',
  '#8b5cf6', '#06b6d4', '#f97316', '#ec4899',
]

const TASK_COLORS = {
  '設計': '#6366f1',
  '実装': '#10b981',
  'MTG': '#f43f5e',
  'レビュー': '#f59e0b',
  'テスト': '#8b5cf6',
  '調査': '#06b6d4',
  '雑務': '#94a3b8',
}

function getTaskColor(name, index) {
  return TASK_COLORS[name] ?? PROJECT_COLORS[index % PROJECT_COLORS.length]
}

function minutesToHHMM(minutes) {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m}分`
  return m === 0 ? `${h}時間` : `${h}時間${m}分`
}

const CustomTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null
  const { name, value } = payload[0].payload
  return (
    <div className="bg-white border border-slate-200 rounded-xl px-3 py-2 shadow-lg text-sm">
      <p className="font-semibold text-slate-700">{name}</p>
      <p className="text-slate-500">{minutesToHHMM(value)}</p>
    </div>
  )
}

const renderCustomLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, percent }) => {
  if (percent < 0.05) return null
  const RADIAN = Math.PI / 180
  const radius = innerRadius + (outerRadius - innerRadius) * 0.5
  const x = cx + radius * Math.cos(-midAngle * RADIAN)
  const y = cy + radius * Math.sin(-midAngle * RADIAN)
  return (
    <text x={x} y={y} fill="white" textAnchor="middle" dominantBaseline="central" fontSize={12} fontWeight={600}>
      {`${(percent * 100).toFixed(0)}%`}
    </text>
  )
}

export default function Analytics({ data }) {
  if (!data) {
    return (
      <div className="text-center py-10 text-slate-400 text-sm">
        データを読み込み中…
      </div>
    )
  }

  if (data.entry_count === 0) {
    return (
      <div className="text-center py-10 text-slate-400">
        <div className="text-3xl mb-2">📊</div>
        <p className="text-sm">この期間のデータがありません</p>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      {/* サマリーカード */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-indigo-50 rounded-xl p-4 text-center">
          <p className="text-2xl font-bold text-indigo-600">{data.total_hours}h</p>
          <p className="text-xs text-indigo-400 mt-1 font-medium">合計作業時間</p>
        </div>
        <div className="bg-emerald-50 rounded-xl p-4 text-center">
          <p className="text-2xl font-bold text-emerald-600">{data.entry_count}</p>
          <p className="text-xs text-emerald-400 mt-1 font-medium">記録件数</p>
        </div>
        <div className="bg-amber-50 rounded-xl p-4 text-center">
          <p className="text-2xl font-bold text-amber-600">
            {data.entry_count > 0 ? Math.round(data.total_minutes / data.entry_count) : 0}分
          </p>
          <p className="text-xs text-amber-400 mt-1 font-medium">平均所要時間</p>
        </div>
      </div>

      {/* チャート 2列 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* プロジェクト別 ドーナツチャート */}
        <div>
          <h3 className="text-sm font-semibold text-slate-600 mb-3">プロジェクト別内訳</h3>
          {data.project_breakdown.length > 0 ? (
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie
                  data={data.project_breakdown}
                  cx="50%"
                  cy="50%"
                  innerRadius={55}
                  outerRadius={90}
                  dataKey="value"
                  labelLine={false}
                  label={renderCustomLabel}
                >
                  {data.project_breakdown.map((_, i) => (
                    <Cell key={i} fill={PROJECT_COLORS[i % PROJECT_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip content={<CustomTooltip />} />
                <Legend
                  formatter={(value) => <span className="text-xs text-slate-600">{value}</span>}
                />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-sm text-slate-400 text-center py-8">データなし</p>
          )}
        </div>

        {/* 作業種別 ドーナツチャート */}
        <div>
          <h3 className="text-sm font-semibold text-slate-600 mb-3">作業種別の比率</h3>
          {data.task_type_breakdown.length > 0 ? (
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie
                  data={data.task_type_breakdown}
                  cx="50%"
                  cy="50%"
                  innerRadius={55}
                  outerRadius={90}
                  dataKey="value"
                  labelLine={false}
                  label={renderCustomLabel}
                >
                  {data.task_type_breakdown.map((entry, i) => (
                    <Cell key={i} fill={getTaskColor(entry.name, i)} />
                  ))}
                </Pie>
                <Tooltip content={<CustomTooltip />} />
                <Legend
                  formatter={(value) => <span className="text-xs text-slate-600">{value}</span>}
                />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-sm text-slate-400 text-center py-8">データなし</p>
          )}
        </div>
      </div>

      {/* 日次サマリー 棒グラフ */}
      {data.daily_summary.length > 1 && (
        <div>
          <h3 className="text-sm font-semibold text-slate-600 mb-3">日次サマリー</h3>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={data.daily_summary} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 11, fill: '#94a3b8' }}
                tickFormatter={v => v.slice(5)}
              />
              <YAxis
                tick={{ fontSize: 11, fill: '#94a3b8' }}
                tickFormatter={v => `${v}h`}
              />
              <Tooltip
                formatter={(value) => [`${value}h`, '作業時間']}
                labelFormatter={label => label}
                contentStyle={{
                  border: '1px solid #e2e8f0',
                  borderRadius: '12px',
                  fontSize: '12px',
                }}
              />
              <Bar dataKey="hours" fill="#6366f1" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* 作業種別 稼働率テーブル */}
      {data.task_type_breakdown.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-slate-600 mb-3">作業種別 稼働率</h3>
          <div className="space-y-2">
            {data.task_type_breakdown.map((item, i) => {
              const pct = data.total_minutes > 0
                ? Math.round((item.value / data.total_minutes) * 100)
                : 0
              const color = getTaskColor(item.name, i)
              return (
                <div key={item.name} className="flex items-center gap-3">
                  <div className="w-16 text-xs font-medium text-slate-600 text-right shrink-0">
                    {item.name}
                  </div>
                  <div className="flex-1 bg-slate-100 rounded-full h-2.5 overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{ width: `${pct}%`, backgroundColor: color }}
                    />
                  </div>
                  <div className="w-20 text-xs text-slate-500 shrink-0">
                    {pct}% ({minutesToHHMM(item.value)})
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
