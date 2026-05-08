import pytest
from datetime import date
from src.models.vehicle import Vehicle, VehicleMapping
from src.models.report import DailyEntry, VehicleReport, ProcessingResult


class TestVehicle:
    """Tests para el modelo Vehicle."""

    def test_create_vehicle(self):
        v = Vehicle(name="MERCEDES E200", plate="JSZ167")
        assert v.name == "MERCEDES E200"
        assert v.plate == "JSZ167"

    def test_normalize_name(self):
        v = Vehicle(name="Mercedes E200", plate="JSZ167")
        assert v.normalize_name == "mercedese200"

    def test_fuzzy_match_exact(self):
        v = Vehicle(name="MERCEDES E200", plate="JSZ167")
        assert v.fuzzy_match("MERCEDES E200") == 1.0

    def test_fuzzy_match_partial(self):
        v = Vehicle(name="MERCEDES E200", plate="JSZ167")
        assert v.fuzzy_match("MERCEDES E") > 0.5


class TestVehicleMapping:
    """Tests para mapeo de vehículos."""

    def test_default_mappings(self):
        mappings = VehicleMapping.default_mappings()
        assert len(mappings) > 0

    def test_match_alias(self):
        mapping = VehicleMapping(
            canonical_name="MERCEDES E200",
            excel_sheet_name="MERCEDES E 200 JSZ167",
            aliases=["MERCEDES E200", "E200"]
        )
        assert mapping.match("MERCEDES E200") is True
        assert mapping.match("E200") is True


class TestDailyEntry:
    """Tests para DailyEntry."""

    def test_create_from_date(self):
        v = Vehicle(name="MERCEDES E200", plate="JSZ167")
        entry = DailyEntry(
            date=date(2026, 4, 23),
            vehicle=v,
            kilometers=114.962,
            speed_excess_minutes=0,
            parking_minutes=28,
            fuel_liters=9.2
        )
        assert entry.kilometers == 114.962
        assert entry.fuel_liters == 9.2

    def test_to_dict(self):
        v = Vehicle(name="MERCEDES E200", plate="JSZ167")
        entry = DailyEntry(
            date=date(2026, 4, 23),
            vehicle=v,
            kilometers=114.962,
            speed_excess_minutes=0,
            parking_minutes=28,
            fuel_liters=9.2
        )
        d = entry.to_dict()
        assert d["kilometers"] == 114.962
        assert d["plate"] == "JSZ167"


class TestVehicleReport:
    """Tests para VehicleReport."""

    def test_add_entry(self):
        v = Vehicle(name="MERCEDES E200", plate="JSZ167")
        entry = DailyEntry(
            date=date(2026, 4, 23),
            vehicle=v,
            kilometers=114.962,
            speed_excess_minutes=0,
            parking_minutes=28,
            fuel_liters=9.2
        )

        report = VehicleReport(vehicle=v, entries=[])
        report.add_entry(entry)

        assert len(report.entries) == 1
        assert report.total_km == 114.962


class TestProcessingResult:
    """Tests para ProcessingResult."""

    def test_to_dict(self):
        v = Vehicle(name="MERCEDES E200", plate="JSZ167")
        entry = DailyEntry(
            date=date(2026, 4, 23),
            vehicle=v,
            kilometers=114.962,
            speed_excess_minutes=0,
            parking_minutes=28,
            fuel_liters=9.2
        )
        report = VehicleReport(vehicle=v, entries=[entry])
        result = ProcessingResult(
            success=True,
            email_id="123",
            attachments=["file.pdf"],
            reports=[report]
        )
        d = result.to_dict()
        assert d["success"] is True
        assert d["email_id"] == "123"
        assert d["reports_count"] == 1