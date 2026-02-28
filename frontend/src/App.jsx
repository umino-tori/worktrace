import { useState, useEffect, useCallback } from 'react'
import axios from 'axios'
import Timeline from './components/Timeline'
import Analytics from './components/Analytics'

const API = ''  // vite proxy 経由

const DEFAULT_TASK_TYPES = ['設計', '実装', 'MTG', 'レビュー', 'テスト', '調査', '雑務']

function toToday() {
  return new Date().toISOString().slice(0, 10)
}

function addDays(dateStr, n) {
  const d = new Date(dateStr)
  d.setDate(d.getDate() + n)
  return d.toISOString().slice(0, 10)
}

function formatDateLabel(dateStr) {
  const d = new Date(dateStr + 'T00:00:00')
  const today = toToday()
  const yesterday = addDays(today, -1)
  if (dateStr === today) return `今日 (${dateStr})`
  if (dateStr === yesterday) return `昨日 (${dateStr})`
  return d.toLocaleDateString('ja-JP', { month: 'long', day: 'numeric', weekday: 'short' })
}

export default function App() {
  const [selectedDate, setSelectedDate] = useState(toToday)
  const [entries, setEntries] = useState([])
  const [recentEntries, setRecentEntries] = useState([])
  const [analytics, setAnalytics] = useState(null)
  const [analyticsPeriod, setAnalyticsPeriod] = useState('week') // today | week | month
  const [tags, setTags] = useState({ projects: [], task_types: DEFAULT_TASK_TYPES })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  // フォーム状態
  const [form, setForm] = useState({
    start_date: toToday(),
    start_time: '',
    end_date: toToday(),
    end_time: '',
    project: '',
    task_type: '実装',
    memo: '',
  })

  // ---------- Data Fetching ----------

  const fetchEntries = useCallback(async (date) => {
    try {
      const res = await axios.get(`${API}/entries`, { params: { date } })
      setEntries(res.data)
    } catch {
      setError('エントリの取得に失敗しました')
    }
  }, [])

  const fetchAnalytics = useCallback(async (period) => {
    const today = toToday()
    let start = today
    if (period === 'week') start = addDays(today, -6)
    else if (period === 'month') start = addDays(today, -29)

    try {
      const res = await axios.get(`${API}/analytics`, {
        params: { start_date: start, end_date: today },
      })
      setAnalytics(res.data)
    } catch {
      // analytics failure is non-critical
    }
  }, [])

  const fetchRecentEntries = useCallback(async () => {
    try {
      const res = await axios.get(`${API}/entries/recent`)
      setRecentEntries(res.data)
    } catch {
      // non-critical
    }
  }, [])

  const fetchTags = useCallback(async () => {
    try {
      const res = await axios.get(`${API}/tags`)
      setTags(t => ({
        projects: res.data.projects,
        task_types: res.data.task_types.length > 0 ? res.data.task_types : DEFAULT_TASK_TYPES,
      }))
    } catch {
      // non-critical
    }
  }, [])

  useEffect(() => {
    fetchEntries(selectedDate)
    // 日付ナビ変更時にフォームの開始・終了日も同期
    setForm(f => ({ ...f, start_date: selectedDate, end_date: selectedDate }))
  }, [selectedDate, fetchEntries])

  useEffect(() => {
    fetchAnalytics(analyticsPeriod)
  }, [analyticsPeriod, fetchAnalytics])

  useEffect(() => {
    fetchTags()
  }, [fetchTags])

  useEffect(() => {
    fetchRecentEntries()
  }, [fetchRecentEntries])

  // ---------- Actions ----------

  const showSuccess = (msg) => {
    setSuccess(msg)
    setTimeout(() => setSuccess(''), 3000)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.start_date || !form.start_time || !form.end_date || !form.end_time || !form.project || !form.task_type) {
      setError('全項目を入力してください')
      return
    }
    setError('')
    setLoading(true)
    try {
      await axios.post(`${API}/entries`, { ...form })
      setForm(f => ({ ...f, start_time: '', end_time: '', memo: '' }))
      await fetchEntries(selectedDate)
      await fetchAnalytics(analyticsPeriod)
      await fetchTags()
      await fetchRecentEntries()
      showSuccess('記録しました')
    } catch (err) {
      setError(err.response?.data?.detail || '保存に失敗しました')
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async (id) => {
    try {
      await axios.delete(`${API}/entries/${id}`)
      await fetchEntries(selectedDate)
      await fetchAnalytics(analyticsPeriod)
      await fetchRecentEntries()
    } catch {
      setError('削除に失敗しました')
    }
  }

  const handleClone = (entry) => {
    const crossDay = entry.end_date && entry.end_date > entry.start_date
    setForm({
      start_date: selectedDate,
      start_time: entry.start_time,
      end_date: crossDay ? addDays(selectedDate, 1) : selectedDate,
      end_time: entry.end_time,
      project: entry.project,
      task_type: entry.task_type,
      memo: entry.memo || '',
    })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  // ---------- Render ----------

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-indigo-50">
      {/* Header */}
      <header className="bg-white border-b border-slate-100 shadow-sm sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center">
              <span className="text-white font-bold text-sm">WT</span>
            </div>
            <h1 className="text-lg font-bold text-slate-800 tracking-tight">workTrace</h1>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setSelectedDate(d => addDays(d, -1))}
              className="btn-secondary px-3 py-1.5 text-sm"
            >
              ←
            </button>
            <input
              type="date"
              value={selectedDate}
              onChange={e => setSelectedDate(e.target.value)}
              className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />
            <button
              onClick={() => setSelectedDate(d => addDays(d, 1))}
              className="btn-secondary px-3 py-1.5 text-sm"
            >
              →
            </button>
            <button
              onClick={() => setSelectedDate(toToday())}
              className="btn-secondary px-3 py-1.5 text-sm"
            >
              今日
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6 space-y-6">

        {/* Notification */}
        {success && (
          <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-xl px-4 py-3 text-sm font-medium">
            ✓ {success}
          </div>
        )}
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm font-medium flex justify-between">
            <span>⚠ {error}</span>
            <button onClick={() => setError('')} className="opacity-60 hover:opacity-100">✕</button>
          </div>
        )}

        {/* Input Form */}
        <section className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-slate-700">
              {formatDateLabel(selectedDate)} の記録を追加
            </h2>
          </div>

          <form onSubmit={handleSubmit} className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <div>
              <label className="label">開始</label>
              <input
                type="date"
                value={form.start_date}
                onChange={e => {
                  const newStart = e.target.value
                  const maxEnd = addDays(newStart, 1)
                  setForm(f => ({
                    ...f,
                    start_date: newStart,
                    // 終了日が範囲外になった場合は自動補正
                    end_date: f.end_date > maxEnd ? maxEnd : f.end_date < newStart ? newStart : f.end_date,
                  }))
                }}
                className="input-field mb-1"
                required
              />
              <input
                type="time"
                value={form.start_time}
                onChange={e => setForm(f => ({ ...f, start_time: e.target.value }))}
                className="input-field"
                required
              />
            </div>
            <div>
              <label className="label">終了</label>
              <input
                type="date"
                value={form.end_date}
                min={form.start_date}
                max={addDays(form.start_date, 1)}
                onChange={e => setForm(f => ({ ...f, end_date: e.target.value }))}
                className="input-field mb-1"
                required
              />
              <input
                type="time"
                value={form.end_time}
                onChange={e => setForm(f => ({ ...f, end_time: e.target.value }))}
                className="input-field"
                required
              />
            </div>
            <div className="col-span-2 md:col-span-1">
              <label className="label">プロジェクト</label>
              <input
                list="project-suggestions"
                value={form.project}
                onChange={e => setForm(f => ({ ...f, project: e.target.value }))}
                placeholder="例: ProjectA"
                className="input-field"
                required
              />
              <datalist id="project-suggestions">
                {tags.projects.map(p => <option key={p} value={p} />)}
              </datalist>
            </div>
            <div>
              <label className="label">作業種別</label>
              <input
                list="tasktype-suggestions"
                value={form.task_type}
                onChange={e => setForm(f => ({ ...f, task_type: e.target.value }))}
                className="input-field"
                required
              />
              <datalist id="tasktype-suggestions">
                {tags.task_types.map(t => <option key={t} value={t} />)}
              </datalist>
            </div>
            <div className="flex items-end">
              <button
                type="submit"
                disabled={loading}
                className="btn-primary w-full"
              >
                {loading ? '保存中…' : '記録する'}
              </button>
            </div>
            <div className="col-span-2 md:col-span-5">
              <label className="label">作業メモ（任意）</label>
              <input
                type="text"
                value={form.memo}
                onChange={e => setForm(f => ({ ...f, memo: e.target.value }))}
                placeholder="作業内容のメモを入力…"
                className="input-field"
              />
            </div>
          </form>
        </section>

        {/* Timeline */}
        <section className="card">
          <h2 className="font-semibold text-slate-700 mb-4">
            タイムライン
            <span className="ml-2 text-sm font-normal text-slate-400">
              直近 {recentEntries.length} 件
            </span>
          </h2>
          <Timeline entries={entries} recentEntries={recentEntries} onDelete={handleDelete} onClone={handleClone} selectedDate={selectedDate} />
        </section>

        {/* Analytics */}
        <section className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-slate-700">アナリティクス</h2>
            <div className="flex gap-1 bg-slate-100 rounded-lg p-1">
              {[
                { key: 'today', label: '今日' },
                { key: 'week', label: '7日' },
                { key: 'month', label: '30日' },
              ].map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setAnalyticsPeriod(key)}
                  className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
                    analyticsPeriod === key
                      ? 'bg-white text-indigo-600 shadow-sm'
                      : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <Analytics data={analytics} />
        </section>
      </main>
    </div>
  )
}
