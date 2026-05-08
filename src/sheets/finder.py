import re
from datetime import date, datetime
from typing import Optional

import gspread


class SheetsFinder:
    """Locates the right gspread Worksheet for a vehicle, mirroring ExcelSheetFinder logic."""

    _BRAND_MODELS = {
        "mercedes": ["e200cabri", "e200", "gle450", "gle", "c200", "gla", "glb", "glc", "gls", "cla"],
        "audi": ["q3", "q5", "q7", "q8", "a3", "a4", "a5", "a6", "a7", "tt"],
        "bmw": ["x1", "x2", "x3", "x4", "x5", "x6", "x7"],
        "toyota": ["corolla", "camry", "rav4", "highlander", "prado"],
        "honda": ["civic", "accord", "crv", "pilot"],
        "ford": ["fiesta", "focus", "fusion", "escape", "explorer"],
        "chevrolet": ["cruze", "malibu", "equinox", "traverse"],
        "nissan": ["sentra", "altima", "rogue", "pathfinder"],
    }

    def __init__(self, spreadsheet: gspread.Spreadsheet):
        self.spreadsheet = spreadsheet

    @staticmethod
    def _normalize(s: str) -> str:
        return re.sub(r"[\s,\.]+", "", s.lower()) if s else ""

    def _extract_model_key(self, name: str) -> str:
        name_lower = name.lower()
        for brand, models in self._BRAND_MODELS.items():
            if brand in name_lower:
                for model in models:
                    if model in name_lower:
                        return f"{brand}{model}"
        return re.sub(r"[\s,\.\-]+", "", name_lower)

    def find_vehicle_sheet(self, vehicle_name: str, vehicle_plate: str = "") -> Optional[gspread.Worksheet]:
        search_norm = self._normalize(vehicle_name)
        search_key = self._extract_model_key(vehicle_name)

        worksheets = self.spreadsheet.worksheets()

        for ws in worksheets:
            sheet_norm = self._normalize(ws.title)
            if search_norm and search_norm in sheet_norm:
                return ws
            sheet_key = self._extract_model_key(ws.title)
            if search_key and sheet_key and search_key in sheet_key:
                return ws

        # Second pass: plate matching
        if vehicle_plate:
            plate_norm = vehicle_plate.lower().strip()
            for ws in worksheets:
                if plate_norm in ws.title.lower():
                    return ws

        return None


class RowFinder:
    """Finds the 1-indexed row number for a given date inside a gspread Worksheet."""

    DATA_START_ROW = 13

    def __init__(self, worksheet: gspread.Worksheet):
        self.ws = worksheet
        self._cache: list[list] | None = None

    def _values(self) -> list[list]:
        if self._cache is None:
            self._cache = self.ws.get_all_values()
        return self._cache

    def find_date_row(self, target_date: date, date_col: int = 3) -> Optional[int]:
        """Returns 1-indexed row or None. Falls back to positional offset like the Excel version."""
        target_day = (target_date - date(target_date.year, 1, 1)).days + 1
        col_idx = date_col - 1  # 0-indexed for list access

        for row_idx, row in enumerate(self._values()[self.DATA_START_ROW - 1:], start=self.DATA_START_ROW):
            if col_idx >= len(row):
                continue
            cell_val = row[col_idx].strip() if row[col_idx] else ""
            if not cell_val:
                continue

            # Numeric day-of-year
            try:
                if int(cell_val) == target_day:
                    return row_idx
            except ValueError:
                pass

            # Date string
            for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y"):
                try:
                    if datetime.strptime(cell_val, fmt).date() == target_date:
                        return row_idx
                except ValueError:
                    continue

        # Positional fallback: row 13 = day 1, row 14 = day 2, …
        row_num = self.DATA_START_ROW + (target_day - 1)
        return row_num if row_num <= 400 else None


def find_column_by_header(
    worksheet: gspread.Worksheet,
    headers: list[str],
    search_row: int = 3,
) -> dict[str, int]:
    """Returns a dict of header → 1-indexed column number."""
    row_values = worksheet.row_values(search_row)
    mapping: dict[str, int] = {}
    for col_idx, cell in enumerate(row_values, start=1):
        if not cell:
            continue
        cell_clean = cell.lower().strip()
        for header in headers:
            if header.lower() in cell_clean:
                mapping[header] = col_idx
    return mapping
