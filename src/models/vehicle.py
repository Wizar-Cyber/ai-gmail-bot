from dataclasses import dataclass
import re
from typing import Optional


@dataclass
class Vehicle:
    name: str
    plate: str
    normalize_name: str = ""
    excel_sheet: str = ""

    def __post_init__(self):
        if not self.normalize_name:
            self.normalize_name = self._normalize(self.name)
        if not self.excel_sheet:
            self.excel_sheet = f"{self.name} {self.plate}".strip()

    @staticmethod
    def _normalize(text: str) -> str:
        text = re.sub(r'[\s\-_]+', '', text.lower())
        text = re.sub(r'[^a-z0-9]', '', text)
        return text

    @staticmethod
    def from_string(vehicle_str: str) -> "Vehicle":
        parts = vehicle_str.split("-")
        if len(parts) >= 2:
            name = parts[0].strip()
            plate = parts[1].strip()
        else:
            name = vehicle_str.strip()
            plate = ""
        return Vehicle(name=name, plate=plate)

    def fuzzy_match(self, other: str) -> float:
        self_norm = self.normalize_name
        other_norm = Vehicle._normalize(other)

        if self_norm == other_norm:
            return 1.0
        if self_norm in other_norm or other_norm in self_norm:
            return 0.8

        return 0.0


@dataclass
class VehicleMapping:
    canonical_name: str
    excel_sheet_name: str
    aliases: list[str]

    @classmethod
    def default_mappings(cls) -> list["VehicleMapping"]:
        return [
            cls(
                canonical_name="MERCEDES E200",
                excel_sheet_name="MERCEDES E 200 JSZ167",
                aliases=["MERCEDES E200", "E200", "MERCEDES E 200", "MERCEDES E200 JSZ167"]
            ),
            cls(
                canonical_name="MERCEDES GLE450",
                excel_sheet_name="MERCEDES GLE450",
                aliases=["GLE450", "MERCEDES GLE", "MERCEDES GLE450", "GLE"]
            ),
            cls(
                canonical_name="MERCEDES C200",
                excel_sheet_name="MERCEDES C200C ",
                aliases=["C200", "MERCEDES C", "C200 CABRIO", "MERCEDES C200 CABRIO"]
            ),
            cls(
                canonical_name="AUDI Q3",
                excel_sheet_name="AUDI Q3 JXV974,",
                aliases=["Q3", "AUDI Q3", "Q3 SPORTBACK", "AUDI Q3 SPORTBACK"]
            ),
            cls(
                canonical_name="AUDI Q8",
                excel_sheet_name="AUDI Q8",
                aliases=["Q8"]
            ),
            cls(
                canonical_name="TOYOTA TXL",
                excel_sheet_name="TOYOTA TXL ",
                aliases=["TXL", "TOYOTA"]
            ),
        ]

    def match(self, input_name: str) -> bool:
        input_norm = Vehicle._normalize(input_name)
        for alias in self.aliases:
            if Vehicle._normalize(alias) in input_norm:
                return True
        return False