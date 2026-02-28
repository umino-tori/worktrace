from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import create_engine, Column, Integer, String, DateTime
from sqlalchemy.orm import DeclarativeBase, sessionmaker, Session
from pydantic import BaseModel
from datetime import datetime, timedelta, date as date_type
from typing import Optional

DATABASE_URL = "sqlite:///./timelayer.db"
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


Base.metadata.create_all(bind=engine)


# ---------- Pydantic Schemas ----------

class TimeEntryCreate(BaseModel):
    start_time: str   # "HH:MM"
    end_time: str     # "HH:MM"
    project: str
    task_type: str
    date: str         # "YYYY-MM-DD"


# ---------- Helpers ----------

def entry_to_dict(entry: TimeEntry) -> dict:
    duration = int((entry.end_time - entry.start_time).total_seconds() / 60)
    return {
        "id": entry.id,
        "start_time": entry.start_time.strftime("%H:%M"),
        "end_time": entry.end_time.strftime("%H:%M"),
        "project": entry.project,
        "task_type": entry.task_type,
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

    # 重なる既存エントリを全取得（同日のみ）
    overlapping = db.query(TimeEntry).filter(
        TimeEntry.id != new_entry.id,
        TimeEntry.date == new_entry.date,
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
            to_add.append(TimeEntry(
                start_time=n_end,
                end_time=e_end,
                project=e.project,
                task_type=e.task_type,
                date=e.date,
            ))

        elif e_start < n_start:
            # ケース3: 左側重複 (既存が左にはみ出す) → 既存の終端を短縮
            e.end_time = n_start

        else:
            # ケース4: 右側重複 (既存が右にはみ出す) → 既存の始端を短縮
            e.start_time = n_end

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

app = FastAPI(title="TimeLayer API")

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
        start_dt = datetime.strptime(f"{body.date} {body.start_time}", "%Y-%m-%d %H:%M")
        end_dt = datetime.strptime(f"{body.date} {body.end_time}", "%Y-%m-%d %H:%M")
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date/time format")

    if end_dt <= start_dt:
        raise HTTPException(status_code=400, detail="終了時間は開始時間より後にしてください")

    new_entry = TimeEntry(
        start_time=start_dt,
        end_time=end_dt,
        project=body.project,
        task_type=body.task_type,
        date=body.date,
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


@app.post("/entries/yesterday-clone")
def yesterday_clone(db: Session = Depends(get_db)):
    """昨日の作業ログ構成を今日にコピーする"""
    today = date_type.today()
    yesterday = today - timedelta(days=1)
    today_str = today.strftime("%Y-%m-%d")
    yesterday_str = yesterday.strftime("%Y-%m-%d")

    yesterday_entries = (
        db.query(TimeEntry)
        .filter(TimeEntry.date == yesterday_str)
        .order_by(TimeEntry.start_time)
        .all()
    )

    if not yesterday_entries:
        raise HTTPException(status_code=404, detail="昨日のエントリが見つかりません")

    created = []
    for e in yesterday_entries:
        new_entry = TimeEntry(
            start_time=e.start_time + timedelta(days=1),
            end_time=e.end_time + timedelta(days=1),
            project=e.project,
            task_type=e.task_type,
            date=today_str,
        )
        db.add(new_entry)
        db.flush()
        resolve_overlaps(db, new_entry)
        db.commit()
        db.refresh(new_entry)
        created.append(entry_to_dict(new_entry))

    return created


@app.get("/tags")
def get_tags(db: Session = Depends(get_db)):
    """過去に入力されたプロジェクト名・作業種別を候補として返す"""
    projects = db.query(TimeEntry.project).distinct().all()
    task_types = db.query(TimeEntry.task_type).distinct().all()
    return {
        "projects": sorted([p[0] for p in projects]),
        "task_types": sorted([t[0] for t in task_types]),
    }
