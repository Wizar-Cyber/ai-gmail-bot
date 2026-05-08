from typing import Optional

import gspread
import gspread.utils

from ..models.report import DailyEntry
from .finder import SheetsFinder, RowFinder, find_column_by_header


class SheetsWriteError(Exception):
    pass


_HEADER_KEYS = ["FECHA", "KILOMETRAJE", "EXCESO", "ESTACIONAMIENTO", "COMBUSTIBLE"]

# Default column positions matching the Excel layout
_DEFAULT_COLS = {
    "FECHA": 3,
    "KILOMETRAJE": 4,
    "EXCESO": 5,
    "ESTACIONAMIENTO": 6,
    "COMBUSTIBLE": 7,
}


class SheetsUpdater:
    """Writes DailyEntry records to a Google Spreadsheet.

    Drop-in replacement for ExcelUpdater: same find_and_write_entry() interface.
    """

    def __init__(self, spreadsheet: gspread.Spreadsheet):
        self.spreadsheet = spreadsheet

    def find_and_write_entry(
        self,
        vehicle_name: str,
        entry: DailyEntry,
    ) -> tuple[bool, str]:
        finder = SheetsFinder(self.spreadsheet)
        ws = finder.find_vehicle_sheet(entry.vehicle.name, entry.vehicle.plate)

        if not ws:
            return False, f"Hoja no encontrada para {entry.vehicle.name}"

        headers = find_column_by_header(ws, _HEADER_KEYS)
        # Fall back to defaults for any missing header
        cols = {k: headers.get(k, _DEFAULT_COLS[k]) for k in _DEFAULT_COLS}

        row_finder = RowFinder(ws)
        row = row_finder.find_date_row(entry.date, cols["FECHA"])

        if not row:
            return False, f"Fila no encontrada para fecha {entry.date}"

        # Duplicate check: skip if km already written and matches within tolerance
        existing_km = ws.cell(row, cols["KILOMETRAJE"]).value
        if existing_km:
            try:
                if abs(float(existing_km) - entry.kilometers) < 0.1:
                    return False, "Duplicado"
            except (ValueError, TypeError):
                pass

        # Batch-write all four data columns in one API call
        updates = [
            {
                "range": gspread.utils.rowcol_to_a1(row, cols["KILOMETRAJE"]),
                "values": [[entry.kilometers]],
            },
            {
                "range": gspread.utils.rowcol_to_a1(row, cols["EXCESO"]),
                "values": [[entry.speed_excess_minutes]],
            },
            {
                "range": gspread.utils.rowcol_to_a1(row, cols["ESTACIONAMIENTO"]),
                "values": [[entry.parking_minutes]],
            },
            {
                "range": gspread.utils.rowcol_to_a1(row, cols["COMBUSTIBLE"]),
                "values": [[entry.fuel_liters]],
            },
        ]
        ws.batch_update(updates)

        return True, "OK"
