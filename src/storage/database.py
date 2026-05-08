import sqlite3
import logging
from datetime import datetime
from typing import Optional
from pathlib import Path

logger = logging.getLogger(__name__)


class Database:
    def __init__(self, db_path: str = "data/processed.db"):
        self.db_path = db_path
        self._ensure_db_dir()
        self._init_db()

    def _ensure_db_dir(self):
        Path(self.db_path).parent.mkdir(parents=True, exist_ok=True)

    def _get_connection(self) -> sqlite3.Connection:
        return sqlite3.connect(self.db_path)

    def _init_db(self):
        conn = self._get_connection()
        cursor = conn.cursor()

        cursor.execute("""
            CREATE TABLE IF NOT EXISTS processed_emails (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email_id TEXT UNIQUE,
                subject TEXT,
                processed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                attachments_count INTEGER,
                reports_count INTEGER,
                entries_count INTEGER,
                status TEXT CHECK(status IN ('success', 'partial', 'error')),
                error_message TEXT
            )
        """)

        cursor.execute("""
            CREATE TABLE IF NOT EXISTS daily_entries (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                vehicle_name TEXT NOT NULL,
                vehicle_plate TEXT,
                entry_date DATE NOT NULL,
                kilometers REAL,
                speed_excess INTEGER,
                parking_time INTEGER,
                fuel REAL,
                source_file TEXT,
                email_id TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(vehicle_name, entry_date, kilometers)
            )
        """)

        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_entries_date ON daily_entries(entry_date)
        """)

        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_entries_vehicle ON daily_entries(vehicle_name)
        """)

        conn.commit()
        conn.close()

    def save_email(self, email_id: str, subject: str, result: dict) -> bool:
        conn = self._get_connection()
        cursor = conn.cursor()

        try:
            cursor.execute("""
                INSERT OR REPLACE INTO processed_emails
                (email_id, subject, processed_at, attachments_count, reports_count, entries_count, status, error_message)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                email_id,
                subject,
                datetime.now(),
                result.get('attachments_count', 0),
                result.get('reports_count', 0),
                result.get('entries_count', 0),
                'success' if result.get('success') else 'error',
                '; '.join(result.get('errors', [])) if result.get('errors') else None
            ))
            conn.commit()
            return True
        except sqlite3.Error as e:
            logger.error(f"Error guardando email: {e}")
            return False
        finally:
            conn.close()

    def is_email_processed(self, email_id: str) -> bool:
        conn = self._get_connection()
        cursor = conn.cursor()

        cursor.execute("SELECT 1 FROM processed_emails WHERE email_id = ?", (email_id,))
        result = cursor.fetchone()
        conn.close()

        return result is not None

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
        email_id: str
    ) -> bool:
        conn = self._get_connection()
        cursor = conn.cursor()

        try:
            cursor.execute("""
                INSERT OR IGNORE INTO daily_entries
                (vehicle_name, vehicle_plate, entry_date, kilometers, speed_excess, parking_time, fuel, source_file, email_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                vehicle_name, vehicle_plate, entry_date, kilometers,
                speed_excess, parking_time, fuel, source_file, email_id
            ))
            conn.commit()
            return cursor.rowcount > 0
        except sqlite3.Error as e:
            logger.error(f"Error guardando entry: {e}")
            return False
        finally:
            conn.close()

    def get_entries_by_date(self, start_date: str, end_date: str) -> list:
        conn = self._get_connection()
        cursor = conn.cursor()

        cursor.execute("""
            SELECT * FROM daily_entries
            WHERE entry_date BETWEEN ? AND ?
            ORDER BY entry_date DESC
        """, (start_date, end_date))

        results = cursor.fetchall()
        conn.close()
        return results

    def get_entries_by_vehicle(self, vehicle_name: str) -> list:
        conn = self._get_connection()
        cursor = conn.cursor()

        cursor.execute("""
            SELECT * FROM daily_entries
            WHERE vehicle_name LIKE ?
            ORDER BY entry_date DESC
        """, (f"%{vehicle_name}%",))

        results = cursor.fetchall()
        conn.close()
        return results

    def get_recent_emails(self, limit: int = 10) -> list:
        conn = self._get_connection()
        cursor = conn.cursor()

        cursor.execute("""
            SELECT * FROM processed_emails
            ORDER BY processed_at DESC
            LIMIT ?
        """, (limit,))

        results = cursor.fetchall()
        conn.close()
        return results