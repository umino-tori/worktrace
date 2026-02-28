# TimeLayer — 解説ドキュメント

## アプリ概要

「時間はレイヤー（層）である」というコンセプトのもと、作業時間の記録・分析を行う Web アプリ。
後から入力した記録が既存の時間を自動的に上書き・分割する「後出し優先ロジック」が核心機能。

---

## ファイル構成

```
timelayer/
├── backend/
│   ├── main.py            # FastAPI アプリ本体（DBモデル・重複処理・全エンドポイント）
│   └── requirements.txt   # Python 依存ライブラリ
└── frontend/
    ├── index.html
    ├── package.json
    ├── vite.config.js
    ├── tailwind.config.js
    ├── postcss.config.js
    └── src/
        ├── main.jsx
        ├── index.css
        ├── App.jsx                      # メイン UI・状態管理
        └── components/
            ├── Timeline.jsx             # タイムライン表示
            └── Analytics.jsx           # アナリティクスダッシュボード
```

---

## 技術スタック

| レイヤー | 技術 |
|---|---|
| Backend | Python / FastAPI |
| DB | SQLite（SQLAlchemy ORM） |
| Frontend | React 18 / Vite |
| スタイリング | Tailwind CSS |
| グラフ | Recharts |
| HTTP クライアント | Axios |

---

## 起動方法

### Backend（ポート 8000）

Debian/Ubuntu 系の Python 3.12 以降は **externally-managed-environment** のため、
システム全体への `pip install` が禁止されている。
仮想環境（venv）を作成してからインストールする。

```bash
cd backend

# 初回のみ: 仮想環境を作成
python3 -m venv .venv

# 仮想環境を有効化（プロンプトが (.venv) になる）
source .venv/bin/activate

# 依存ライブラリをインストール
pip install -r requirements.txt

# サーバー起動
uvicorn main:app --reload
```

> **2回目以降**は仮想環境の作成・pip install は不要。
> `source .venv/bin/activate` してから `uvicorn main:app --reload` だけでよい。
>
> 仮想環境を抜けるときは `deactivate`。

### Frontend（ポート 5173）

```bash
cd frontend
npm install
npm run dev
```

ブラウザで `http://localhost:5173` を開く。
Vite のプロキシ設定により、フロントエンドからの API リクエストは自動的に `localhost:8000` へ転送される。

---

## 機能詳細

### 1. スマート入力フォーム

- 開始時間・終了時間・プロジェクト名・作業種別を入力
- プロジェクト名と作業種別は過去の入力履歴をサジェスト（`<datalist>` + `/tags` API）
- 送信時に重複処理を自動実行

### 2. 後出し優先ロジック（Core Logic）

`backend/main.py` の `resolve_overlaps()` 関数が実装している。
新しいエントリ `[n_start, n_end]` に対し、既存の全エントリを 4 ケースで処理する。

```
ケース1: 完全内包（既存が新規の中にすっぽり収まる）
  既存:     [──e──]
  新規: [────────────]
  → 既存を削除

ケース2: 完全包含（既存が新規を丸ごと包む）
  既存: [──────────────]
  新規:     [──n──]
  → 既存を前後 2 つに分割
    前半: [e_start, n_start]
    後半: [n_end,   e_end  ]

ケース3: 左側重複（既存が左にはみ出す）
  既存: [────]
  新規:   [────────]
  → 既存の終端を n_start に短縮

ケース4: 右側重複（既存が右にはみ出す）
  既存:         [────]
  新規: [────────]
  → 既存の始端を n_end に短縮
```

処理フロー：
1. `POST /entries` でリクエストを受信
2. 新エントリを DB に INSERT し ID を確定（`db.flush()`）
3. `resolve_overlaps()` で重複を解決
4. `db.commit()` で一括確定

### 3. タイムライン表示（Timeline.jsx）

**24時間ビジュアルバー**
- 横幅全体 = 24時間（1440分）
- 各エントリの位置: `left = (開始分 / 1440) × 100%`
- 各エントリの幅: `width = (経過分 / 1440) × 100%`
- 未記録の隙間は破線ボーダーで視覚化

**エントリリスト**
- 開始時刻順にソートして表示
- プロジェクト名をハッシュ関数で色に変換（同じプロジェクトは常に同じ色）
- 隙間時間（未記録）もリストに「未記録」として挿入

### 4. アナリティクスダッシュボード（Analytics.jsx）

| グラフ | 内容 |
|---|---|
| ドーナツチャート（左） | プロジェクト別合計時間の内訳 |
| ドーナツチャート（右） | 作業種別（設計/実装/MTG…）の比率 |
| 棒グラフ | 日次作業時間のサマリー（7日・30日） |
| 稼働率バー | 作業種別ごとのパーセンテージをプログレスバーで表示 |

分析期間は「今日 / 7日間 / 30日間」で切り替え可能。

### 5. Yesterday Clone

ボタン一つで昨日の作業ログ構成を今日にコピーする。

- `POST /entries/yesterday-clone` を呼び出す
- 昨日の全エントリを取得し、日付を +1 日ずらして今日のエントリとして追加
- 追加時に通常の重複処理を実行（既存エントリとの衝突も安全に解決）

### 6. タグサジェスト

- `GET /tags` で過去に使用したプロジェクト名・作業種別を取得
- フォームの `<datalist>` に反映し、入力補完を提供
- エントリ追加のたびに自動更新

---

## API エンドポイント一覧

| メソッド | パス | 説明 |
|---|---|---|
| `GET` | `/entries?date=YYYY-MM-DD` | 指定日のエントリを時刻順で取得 |
| `POST` | `/entries` | 新規エントリ追加（重複自動解決） |
| `DELETE` | `/entries/{id}` | エントリ削除 |
| `GET` | `/analytics?start_date=...&end_date=...` | 期間集計データ取得 |
| `POST` | `/entries/yesterday-clone` | 昨日のログを今日にコピー |
| `GET` | `/tags` | 過去のプロジェクト名・作業種別を取得 |

### レスポンス例

**GET /entries**
```json
[
  {
    "id": 1,
    "start_time": "09:00",
    "end_time": "10:30",
    "project": "ProjectA",
    "task_type": "実装",
    "date": "2026-02-27",
    "duration_minutes": 90
  }
]
```

**GET /analytics**
```json
{
  "project_breakdown": [
    { "name": "ProjectA", "value": 210 },
    { "name": "ProjectB", "value": 90 }
  ],
  "task_type_breakdown": [
    { "name": "実装", "value": 180 },
    { "name": "MTG", "value": 60 }
  ],
  "daily_summary": [
    { "date": "2026-02-27", "minutes": 300, "hours": 5.0 }
  ],
  "total_minutes": 300,
  "total_hours": 5.0,
  "entry_count": 4
}
```

---

## DB スキーマ

```sql
CREATE TABLE time_entries (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  start_time DATETIME NOT NULL,
  end_time   DATETIME NOT NULL,
  project    VARCHAR  NOT NULL,
  task_type  VARCHAR  NOT NULL,
  date       VARCHAR  NOT NULL   -- YYYY-MM-DD（検索・フィルタ用）
);
```

SQLite ファイルは初回起動時に `backend/timelayer.db` として自動生成される。

---

## UI レイアウト

```
┌─────────────────────────────────────────┐
│ ヘッダー: TimeLayer ロゴ  ← 日付ナビ →  │
├─────────────────────────────────────────┤
│ 入力フォーム                             │
│  [開始] [終了] [プロジェクト] [種別] [追加] │
│                         [Yesterday Clone] │
├─────────────────────────────────────────┤
│ タイムライン                             │
│  ████░░░████████░░░░████  ← 24h バー    │
│  00   06  09  12  15  18  21  24        │
│  09:00–10:30  90分  ProjectA  実装       │
│  ░░ 10:30–11:00  隙間 30分              │
│  11:00–12:00  60分  ProjectB  MTG       │
├─────────────────────────────────────────┤
│ アナリティクス         [今日|7日|30日]   │
│  [合計時間] [件数] [平均時間]            │
│  ドーナツ(PJ別)   ドーナツ(種別)         │
│  日次棒グラフ                            │
│  稼働率プログレスバー                    │
└─────────────────────────────────────────┘
```
