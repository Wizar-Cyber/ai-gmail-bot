from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Optional
from .vehicle import Vehicle


@dataclass
class DailyEntry:
    date: date
    vehicle: Vehicle
    kilometers: float
    speed_excess_minutes: int
    parking_minutes: int
    fuel_liters: float
    raw_data: dict = field(default_factory=dict)

    def __post_init__(self):
        if isinstance(self.date, str):
            self.date = self._parse_date(self.date)
        if isinstance(self.kilometers, str):
            self.kilometers = float(self.kilometers.replace(",", "."))

    @staticmethod
    def _parse_date(date_str: str) -> date:
        from datetime import datetime

        formats = [
            "%Y-%m-%d",
            "%d/%m/%Y",
            "%d-%m-%Y",
            "%Y/%m/%d",
        ]

        for fmt in formats:
            try:
                return datetime.strptime(date_str, fmt).date()
            except ValueError:
                continue

        raise ValueError(f"Formato de fecha no reconocido: {date_str}")

    def to_dict(self) -> dict:
        return {
            "date": self.date.isoformat(),
            "vehicle": self.vehicle.name,
            "plate": self.vehicle.plate,
            "kilometers": self.kilometers,
            "speed_excess": self.speed_excess_minutes,
            "parking": self.parking_minutes,
            "fuel": self.fuel_liters,
        }


@dataclass
class VehicleReport:
    vehicle: Vehicle
    entries: list[DailyEntry] = field(default_factory=list)
    total_km: float = 0.0
    total_fuel: float = 0.0
    source_file: str = ""
    processed_at: datetime = field(default_factory=datetime.now)

    def __post_init__(self):
        if self.entries:
            self.total_km = sum(e.kilometers for e in self.entries)
            self.total_fuel = sum(e.fuel_liters for e in self.entries)

    def add_entry(self, entry: DailyEntry):
        self.entries.append(entry)
        self.total_km += entry.kilometers
        self.total_fuel += entry.fuel_liters


@dataclass
class ProcessingResult:
    success: bool
    email_id: str
    attachments: list[str] = field(default_factory=list)
    reports: list[VehicleReport] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    duration_seconds: float = 0.0

    def to_dict(self) -> dict:
        return {
            "success": self.success,
            "email_id": self.email_id,
            "attachments_count": len(self.attachments),
            "reports_count": len(self.reports),
            "entries_count": sum(len(r.entries) for r in self.reports),
            "errors": self.errors,
            "warnings": self.warnings,
            "duration": f"{self.duration_seconds:.2f}s",
        }


@dataclass
class EmailAttachment:
    id: str
    filename: str
    mime_type: str
    size: int
    local_path: Optional[str] = None

    def is_pdf(self) -> bool:
        return self.mime_type == "application/pdf" or self.filename.lower().endswith(".pdf")