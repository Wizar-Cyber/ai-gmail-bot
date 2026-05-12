"""Tests for storage/database.py using in-memory SQLite."""
from datetime import date, datetime
from src.storage.models import Base, DbProcessedEmail, DbDailyEntry, IncomeExpense
from src.storage.database import Database


def test_database_initializes_in_memory():
    db = Database("sqlite:///:memory:")
    assert db._engine is not None


def test_save_email():
    db = Database("sqlite:///:memory:")
    result = db.save_email("test123", "Test Subject", {
        "success": True,
        "attachments_count": 1,
        "reports_count": 2,
        "entries_count": 5,
        "errors": [],
    })
    assert result is True
    assert db.is_email_processed("test123") is True
    assert db.is_email_processed("nonexistent") is False


def test_save_email_dedup():
    db = Database("sqlite:///:memory:")
    db.save_email("dup123", "First", {"success": True, "errors": []})
    db.save_email("dup123", "Second", {"success": True, "errors": []})
    recent = db.get_recent_emails(10)
    assert len(recent) == 1


def _get_kilometers(entries, idx=0):
    """Helper to read attribute within a session context."""
    if not entries:
        return None
    return entries[idx].kilometers


def _get_notes(entries, idx=0):
    if not entries:
        return None
    return entries[idx].notes


def test_save_entry():
    db = Database("sqlite:///:memory:")
    result = db.save_entry(
        vehicle_name="MERCEDES E200",
        vehicle_plate="JSZ167",
        entry_date="2026-05-03",
        kilometers=169.814,
        speed_excess=426,
        parking_time=18,
        fuel=13.59,
        source_file="test.pdf",
        email_id="email1",
    )
    assert result is True
    entries = db.get_entries_by_vehicle("MERCEDES")
    assert len(entries) == 1
    assert _get_kilometers(entries) == 169.814


def test_save_income_entry():
    db = Database("sqlite:///:memory:")
    result = db.save_income_entry(
        vehicle_name="MERCEDES E200",
        entry_date=date(2026, 5, 3),
        kilometers=169.814,
        notes="KILOMETRAJE INFORME 169.814",
        source_file="test.pdf",
        email_id="email1",
    )
    assert result is True
    entries = db.get_income_by_vehicle("MERCEDES")
    assert len(entries) == 1
    assert _get_notes(entries) == "KILOMETRAJE INFORME 169.814"


def test_save_income_entry_update():
    db = Database("sqlite:///:memory:")
    db.save_income_entry("MERCEDES E200", date(2026, 5, 3), kilometers=100.0)
    db.save_income_entry("MERCEDES E200", date(2026, 5, 3), kilometers=200.0)
    entries = db.get_income_by_vehicle("MERCEDES")
    assert len(entries) == 1
    assert _get_kilometers(entries) == 200.0


def test_get_entries_by_date():
    db = Database("sqlite:///:memory:")
    db.save_entry("V1", "", "2026-01-15", 100, 0, 0, 0, "f1", "e1")
    db.save_entry("V1", "", "2026-02-20", 200, 0, 0, 0, "f1", "e1")
    results = db.get_entries_by_date("2026-02-01", "2026-03-01")
    assert len(results) == 1
    assert _get_kilometers(results) == 200


def test_get_recent_emails():
    db = Database("sqlite:///:memory:")
    db.save_email("a", "A", {"success": True, "errors": []})
    db.save_email("b", "B", {"success": True, "errors": []})
    db.save_email("c", "C", {"success": True, "errors": []})
    recent = db.get_recent_emails(2)
    assert len(recent) == 2


def test_error_email():
    db = Database("sqlite:///:memory:")
    result = db.save_email("err1", "Error Test", {
        "success": False,
        "attachments_count": 0,
        "reports_count": 0,
        "entries_count": 0,
        "errors": ["Connection failed", "Timeout"],
    })
    assert result is True
    assert db.is_email_processed("err1") is True
