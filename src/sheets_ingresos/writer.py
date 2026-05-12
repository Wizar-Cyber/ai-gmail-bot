from datetime import date, datetime
from typing import Optional
import gspread
import gspread.utils

from ..models.report import DailyEntry
from .finder import IngresosSheetFinder


class IngresosWriteError(Exception):
    pass


_DATA_START_ROW = 9
_NOTE_COL = 8
_DATE_COL = 3
_HEADER_ROW = 8


class IngresosSheetUpdater:
    """Writes kilometrage info to the NOTES column of the INGRESOS Y GASTOS vehicle sheets.

    The financial columns (income, expenses, customer, etc.) are manual entry —
    this only auto-populates the date tracking and kilometrage notes.
    """

    def __init__(self, spreadsheet: gspread.Spreadsheet):
        self.spreadsheet = spreadsheet

    def _find_date_row(self, ws: gspread.Worksheet, target_date: date) -> Optional[int]:
        values = ws.get_all_values()
        for row_idx in range(_DATA_START_ROW - 1, len(values)):
            row_num = row_idx + 1
            if _DATE_COL - 1 >= len(values[row_idx]):
                continue
            cell_val = values[row_idx][_DATE_COL - 1].strip() if values[row_idx][_DATE_COL - 1] else ""

            if not cell_val:
                continue

            for fmt in ("%d/%m/%Y", "%Y-%m-%d", "%d-%m-%Y", "%Y/%m/%d"):
                try:
                    if datetime.strptime(cell_val, fmt).date() == target_date:
                        return row_num
                except ValueError:
                    continue

        day_of_year = (target_date - date(target_date.year, 1, 1)).days + 1
        row_num = _DATA_START_ROW + day_of_year - 1
        return row_num

    def find_and_write_note(
        self,
        vehicle_name: str,
        entry: DailyEntry,
        vehicle_plate: str = "",
    ) -> tuple[bool, str]:
        finder = IngresosSheetFinder(self.spreadsheet)
        ws = finder.find_vehicle_sheet(vehicle_name, vehicle_plate)

        if not ws:
            return False, f"Hoja no encontrada para {vehicle_name}"

        row = self._find_date_row(ws, entry.date)

        if not row:
            return False, f"Fila no encontrada para fecha {entry.date}"

        note_text = f"KILOMETRAJE INFORME {entry.kilometers}"
        if entry.speed_excess_minutes:
            note_text += f" | EXCESO {entry.speed_excess_minutes}min"
        if entry.fuel_liters:
            note_text += f" | COMBUSTIBLE {entry.fuel_liters}L"

        existing_note = ws.cell(row, _NOTE_COL).value
        if existing_note is not None:
            note_str = str(existing_note).strip()
            if note_str and note_str not in ("0", "0.0"):
                if str(entry.kilometers) in note_str:
                    return False, "Nota ya existe"

        ws.update_cell(row, _NOTE_COL, note_text)

        return True, "OK"
