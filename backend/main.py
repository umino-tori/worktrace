from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import create_engine, Column, Integer, String, DateTime, text
from sqlalchemy.orm import DeclarativeBase, sessionmaker, Session
from pydantic import BaseModel
from datetime import datetime, timedelta, date as date_type
from typing import Optional

DATABASE_URL = "sqlite:///./worktrace.db"
engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


class TimeEntry(Base):
    __tablename__ = "time_entries"

    id = Column(Integer, primary_key=True, index=True)
    start_time = Column(DateTime, nullable=False)
    end_time = Column(DateTime, nullable=False)
    project = Column(String, nullable=False)
    task_type = Column(String, nullable=False)
    date = Column(String, nullable=False)  # YYYY-MM-DD (start_timeの日付)
    memo = Column(String, nullable=True, default='')


Base.metadata.create_all(bind=engine)

# 既存DBへのマイグレーション: memo カラムが無ければ追加
with engine.connect() as _conn:
    _cols = [row[1] for row in _conn.execute(text("PRAGMA table_info(time_entries)")).fetchall()]
    if "memo" not in _cols:
        _conn.execute(text("ALTER TABLE time_entries ADD COLUMN memo VARCHAR DEFAULT ''"))
        _conn.commit()


# ---------- Pydantic Schemas ----------

class TimeEntryCreate(BaseModel):
    start_date: str   # "YYYY-MM-DD"
    start_time: str   # "HH:MM"
    end_date: str     # "YYYY-MM-DD"
    end_time: str     # "HH:MM"
    project: str
    task_type: str
    memo: Optional[str] = ''


class CloneRequest(BaseModel):
    target_date: str  # "YYYY-MM-DD"


# ---------- Helpers ----------

def entry_to_dict(entry: TimeEntry) -> dict:
    duration = int((entry.end_time - entry.start_time).total_seconds() / 60)
    return {
        "id": entry.id,
        "start_date": entry.start_time.strftime("%Y-%m-%d"),
        "start_time": entry.start_time.strftime("%H:%M"),
        "end_date": entry.end_time.strftime("%Y-%m-%d"),
        "end_time": entry.end_time.strftime("%H:%M"),
        "project": entry.project,
        "task_type": entry.task_type,
        "memo": entry.memo or '',
        "date": entry.date,
        "duration_minutes": duration,
    }


def resolve_overlaps(db: Session, new_entry: TimeEntry) -> None:
    """
    後出し優先ロジック:
    新しいエントリが既存エントリと重なる場合、新しいエントリを優先する。
    重なった既存エントリは削除・分割・短縮される。
    """
    n_start = new_entry.start_time
    n_end = new_entry.end_time

    # 重なる既存エントリを全取得（日付をまたぐ場合も含め datetime で比較）
    overlapping = db.query(TimeEntry).filter(
        TimeEntry.id != new_entry.id,
        TimeEntry.start_time < n_end,
        TimeEntry.end_time > n_start,
    ).all()

    to_delete = []
    to_add = []

    for e in overlapping:
        e_start = e.start_time
        e_end = e.end_time

        if e_start >= n_start and e_end <= n_end:
            # ケース1: 完全内包 → 削除
            to_delete.append(e)

        elif e_start < n_start and e_end > n_end:
            # ケース2: 既存が新規を完全に包含 → 前後に分割
            # 前半: [e_start, n_start]
            e.end_time = n_start
            # 後半: [n_end, e_end] を新規エントリとして追加
            # date は後半セグメントの実際の開始日を使う（日またぎ対応）
            to_add.append(TimeEntry(
                start_time=n_end,
                end_time=e_end,
                project=e.project,
                task_type=e.task_type,
                memo=e.memo or '',
                date=n_end.strftime("%Y-%m-%d"),
            ))

        elif e_start < n_start:
            # ケース3: 左側重複 (既存が左にはみ出す) → 既存の終端を短縮
            e.end_time = n_start

        else:
            # ケース4: 右側重複 (既存が右にはみ出す) → 既存の始端を短縮
            # date も新しい開始日時に合わせて更新（日またぎ対応）
            e.start_time = n_end
            e.date = n_end.strftime("%Y-%m-%d")

    for e in to_delete:
        db.delete(e)
    for e in to_add:
        db.add(e)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# ---------- App ----------

app = FastAPI(title="workTrace API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------- Endpoints ----------

@app.get("/entries")
def get_entries(date: str, db: Session = Depends(get_db)):
    """指定日のエントリを開始時刻順に返す"""
    entries = (
        db.query(TimeEntry)
        .filter(TimeEntry.date == date)
        .order_by(TimeEntry.start_time)
        .all()
    )
    return [entry_to_dict(e) for e in entries]


@app.post("/entries", status_code=201)
def create_entry(body: TimeEntryCreate, db: Session = Depends(get_db)):
    """新規エントリを追加。重複は後出し優先で自動解決する。"""
    try:
        start_dt = datetime.strptime(f"{body.start_date} {body.start_time}", "%Y-%m-%d %H:%M")
        end_dt = datetime.strptime(f"{body.end_date} {body.end_time}", "%Y-%m-%d %H:%M")
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date/time format")

    if end_dt <= start_dt:
        raise HTTPException(status_code=400, detail="終了日時は開始日時より後にしてください")

    if (end_dt.date() - start_dt.date()).days > 1:
        raise HTTPException(status_code=400, detail="終了日は開始日の翌日まで指定可能です")

    new_entry = TimeEntry(
        start_time=start_dt,
        end_time=end_dt,
        project=body.project,
        task_type=body.task_type,
        memo=body.memo or '',
        date=body.start_date,
    )
    db.add(new_entry)
    db.flush()  # IDを確定させる

    resolve_overlaps(db, new_entry)
    db.commit()
    db.refresh(new_entry)
    return entry_to_dict(new_entry)


@app.delete("/entries/{entry_id}")
def delete_entry(entry_id: int, db: Session = Depends(get_db)):
    entry = db.query(TimeEntry).filter(TimeEntry.id == entry_id).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Entry not found")
    db.delete(entry)
    db.commit()
    return {"ok": True}


@app.get("/analytics")
def get_analytics(start_date: str, end_date: str, db: Session = Depends(get_db)):
    """
    指定期間の集計データを返す。
    - project_breakdown: プロジェクト別合計 [{name, value(分)}]
    - task_type_breakdown: 作業種別合計 [{name, value(分)}]
    - daily_summary: 日次合計 [{date, minutes, hours}]
    - 全体サマリー
    """
    entries = (
        db.query(TimeEntry)
        .filter(TimeEntry.date >= start_date, TimeEntry.date <= end_date)
        .all()
    )

    project_totals: dict[str, int] = {}
    task_type_totals: dict[str, int] = {}
    daily_totals: dict[str, int] = {}
    total_minutes = 0

    for e in entries:
        duration = int((e.end_time - e.start_time).total_seconds() / 60)
        project_totals[e.project] = project_totals.get(e.project, 0) + duration
        task_type_totals[e.task_type] = task_type_totals.get(e.task_type, 0) + duration
        daily_totals[e.date] = daily_totals.get(e.date, 0) + duration
        total_minutes += duration

    return {
        "project_breakdown": [
            {"name": k, "value": v} for k, v in sorted(project_totals.items(), key=lambda x: -x[1])
        ],
        "task_type_breakdown": [
            {"name": k, "value": v} for k, v in sorted(task_type_totals.items(), key=lambda x: -x[1])
        ],
        "daily_summary": [
            {"date": d, "minutes": m, "hours": round(m / 60, 1)}
            for d, m in sorted(daily_totals.items())
        ],
        "total_minutes": total_minutes,
        "total_hours": round(total_minutes / 60, 1),
        "entry_count": len(entries),
    }


@app.post("/entries/{entry_id}/clone", status_code=201)
def clone_entry(entry_id: int, body: CloneRequest, db: Session = Depends(get_db)):
    """指定エントリを target_date の日付でクローンする（時刻はそのまま、日付のみ置換）"""
    entry = db.query(TimeEntry).filter(TimeEntry.id == entry_id).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Entry not found")

    try:
        target = datetime.strptime(body.target_date, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid target_date format")

    # 元エントリの開始日からの日数差を計算してシフト
    delta = target - entry.start_time.date()
    new_entry = TimeEntry(
        start_time=entry.start_time + timedelta(days=delta.days),
        end_time=entry.end_time + timedelta(days=delta.days),
        project=entry.project,
        task_type=entry.task_type,
        memo=entry.memo or '',
        date=body.target_date,
    )
    db.add(new_entry)
    db.flush()
    resolve_overlaps(db, new_entry)
    db.commit()
    db.refresh(new_entry)
    return entry_to_dict(new_entry)


@app.get("/entries/recent")
def get_recent_entries(limit: int = 20, db: Session = Depends(get_db)):
    """直近 limit 件のエントリを新しい順で返す"""
    entries = (
        db.query(TimeEntry)
        .order_by(TimeEntry.start_time.desc())
        .limit(limit)
        .all()
    )
    return [entry_to_dict(e) for e in entries]


@app.get("/tags")
def get_tags(db: Session = Depends(get_db)):
    """過去に入力されたプロジェクト名・作業種別を候補として返す"""
    projects = db.query(TimeEntry.project).distinct().all()
    task_types = db.query(TimeEntry.task_type).distinct().all()
    return {
        "projects": sorted([p[0] for p in projects]),
        "task_types": sorted([t[0] for t in task_types]),
    }
