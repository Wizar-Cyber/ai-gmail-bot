import os
import logging
from datetime import datetime, date
from typing import Optional
from contextlib import contextmanager

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from .models import Base, DbProcessedEmail, DbDailyEntry, IncomeExpense

logger = logging.getLogger(__name__)


class Database:
    def __init__(self, db_url: Optional[str] = None):
        self.db_url = db_url or os.getenv(
            "DATABASE_URL",
            f"sqlite:///{os.getenv('DB_PATH', 'data/processed.db')}",
        )
        self._engine = create_engine(self.db_url, echo=False)
        self._init_db()

    def _init_db(self):
        Base.metadata.create_all(self._engine)

    @contextmanager
    def _session(self):
        session = Session(self._engine, expire_on_commit=False)
        try:
            yield session
            session.commit()
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()

    # ── Emails ──────────────────────────────────────────────────────────

    def save_email(self, email_id: str, subject: str, result: dict) -> bool:
        try:
            with self._session() as session:
                existing = session.query(DbProcessedEmail).filter_by(email_id=email_id).first()
                if existing:
                    return True
                email = DbProcessedEmail(
                    email_id=email_id,
                    subject=subject,
                    processed_at=datetime.now(),
                    attachments_count=result.get("attachments_count", 0),
                    reports_count=result.get("reports_count", 0),
                    entries_count=result.get("entries_count", 0),
                    status="success" if result.get("success") else "error",
                    error_message="; ".join(result.get("errors", [])) if result.get("errors") else None,
                )
                session.add(email)
            return True
        except Exception as e:
            logger.error(f"Error guardando email: {e}")
            return False

    def is_email_processed(self, email_id: str) -> bool:
        try:
            with self._session() as session:
                return session.query(DbProcessedEmail).filter_by(email_id=email_id).first() is not None
        except Exception as e:
            logger.error(f"Error checking email: {e}")
            return False

    # ── Daily entries ───────────────────────────────────────────────────

    def save_entry(
        self,
        vehicle_name: str,
        vehicle_plate: str,
        entry_date: str,
        kilometers: float,
        speed_excess: int,
        parking_time: int,
        fuel: float,
        source_file: str,
        email_id: str,
    ) -> bool:
        try:
            with self._session() as session:
                entry = DbDailyEntry(
                    vehicle_name=vehicle_name,
                    vehicle_plate=vehicle_plate,
                    entry_date=date.fromisoformat(entry_date) if isinstance(entry_date, str) else entry_date,
                    kilometers=kilometers,
                    speed_excess=speed_excess,
                    parking_time=parking_time,
                    fuel=fuel,
                    source_file=source_file,
                    email_id=email_id,
                )
                session.add(entry)
            return True
        except Exception as e:
            logger.error(f"Error guardando entry: {e}")
            return False

    def get_entries_by_date(self, start_date: str, end_date: str) -> list:
        try:
            with self._session() as session:
                rows = (
                    session.query(DbDailyEntry)
                    .filter(DbDailyEntry.entry_date.between(start_date, end_date))
                    .order_by(DbDailyEntry.entry_date.desc())
                    .all()
                )
                return rows
        except Exception as e:
            logger.error(f"Error querying entries: {e}")
            return []

    def get_entries_by_vehicle(self, vehicle_name: str) -> list:
        try:
            with self._session() as session:
                rows = (
                    session.query(DbDailyEntry)
                    .filter(DbDailyEntry.vehicle_name.like(f"%{vehicle_name}%"))
                    .order_by(DbDailyEntry.entry_date.desc())
                    .all()
                )
                return rows
        except Exception as e:
            logger.error(f"Error querying entries: {e}")
            return []

    def get_recent_emails(self, limit: int = 10) -> list:
        try:
            with self._session() as session:
                rows = (
                    session.query(DbProcessedEmail)
                    .order_by(DbProcessedEmail.processed_at.desc())
                    .limit(limit)
                    .all()
                )
                return rows
        except Exception as e:
            logger.error(f"Error querying emails: {e}")
            return []

    # ── Income / Expenses ───────────────────────────────────────────────

    def save_income_entry(
        self,
        vehicle_name: str,
        entry_date: date,
        kilometers: Optional[float] = None,
        notes: Optional[str] = None,
        source_file: Optional[str] = None,
        email_id: Optional[str] = None,
    ) -> bool:
        try:
            with self._session() as session:
                existing = (
                    session.query(IncomeExpense)
                    .filter_by(vehicle_name=vehicle_name, entry_date=entry_date)
                    .first()
                )
                if existing:
                    if kilometers is not None:
                        existing.kilometers = kilometers
                    if notes is not None:
                        existing.notes = notes
                    return True
                entry = IncomeExpense(
                    vehicle_name=vehicle_name,
                    entry_date=entry_date,
                    kilometers=kilometers,
                    notes=notes,
                    source_file=source_file,
                    email_id=email_id,
                )
                session.add(entry)
            return True
        except Exception as e:
            logger.error(f"Error guardando income entry: {e}")
            return False

    def get_income_by_vehicle(self, vehicle_name: str) -> list:
        try:
            with self._session() as session:
                rows = (
                    session.query(IncomeExpense)
                    .filter(IncomeExpense.vehicle_name.like(f"%{vehicle_name}%"))
                    .order_by(IncomeExpense.entry_date.desc())
                    .all()
                )
                return rows
        except Exception as e:
            logger.error(f"Error querying income: {e}")
            return []
