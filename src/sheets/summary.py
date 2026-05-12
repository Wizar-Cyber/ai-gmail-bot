import re
from typing import Optional
import gspread
import gspread.utils

from .finder import SheetsFinder

_SUMMARY_KEYWORDS = ["total", "resumen", "consolidado"]
_DATA_START_ROW = 13

_MONTHS = [
    "enero", "febrero", "marzo", "abril", "mayo", "junio",
    "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
]

_VEHICLE_KEYWORDS = ["mercedes", "audi", "bmw", "toyota", "honda", "chevrolet", "nissan", "ford"]


def _normalize(s: str) -> str:
    return re.sub(r"[\s,\.\-]+", "", s.lower()) if s else ""


def _col_letter(c: int) -> str:
    return gspread.utils.rowcol_to_a1(1, c)[:-1]


def _parse_month(text: str) -> Optional[int]:
    t = text.lower().strip()
    for i, m in enumerate(_MONTHS):
        if m in t:
            return i + 1
    try:
        v = int(t)
        if 1 <= v <= 12:
            return v
    except ValueError:
        pass
    return None


def _find_vehicle_sheet(spreadsheet: gspread.Spreadsheet, vehicle_title_in_report: str) -> Optional[str]:
    finder = SheetsFinder(spreadsheet)
    match = finder.find_vehicle_sheet(vehicle_title_in_report)
    if match:
        return match.title

    for ws in spreadsheet.worksheets():
        ws_norm = _normalize(ws.title)
        report_norm = _normalize(vehicle_title_in_report)
        if report_norm in ws_norm or ws_norm in report_norm:
            return ws.title

    return None


class SummaryUpdater:
    def __init__(self, spreadsheet: gspread.Spreadsheet):
        self.spreadsheet = spreadsheet

    def _find_summary_sheet(self) -> Optional[gspread.Worksheet]:
        for ws in self.spreadsheet.worksheets():
            norm = _normalize(ws.title)
            if any(kw in norm for kw in _SUMMARY_KEYWORDS):
                return ws
        return None

    def update_formulas(self, year: int = 2026) -> int:
        summary = self._find_summary_sheet()
        if not summary:
            return 0

        values = summary.get_all_values()
        updated = 0

        for row_idx in range(len(values)):
            row = values[row_idx]
            if not row or len(row) < 2 or not row[1]:
                continue

            cell = row[1].strip()
            report_match = re.match(
                r"REPORTE\s+DE\s+KILOMETRAJE\s+DEL\s+(.+)",
                cell,
                re.IGNORECASE,
            )
            if not report_match:
                continue

            vehicle_desc = report_match.group(1).strip()
            vehicle_desc = re.sub(r"\s*[-\s]*[A-Z]{3}\d*$", "", vehicle_desc).strip()

            vehicle_sheet = _find_vehicle_sheet(self.spreadsheet, vehicle_desc)
            if not vehicle_sheet:
                continue

            scan = row_idx + 1
            while scan < len(values):
                scan_row = values[scan]
                scan_cell = scan_row[1].strip() if len(scan_row) > 1 else ""
                if scan_cell:
                    break
                scan += 1
            if scan >= len(values):
                continue
            data_header_row = scan

            header_row = values[data_header_row]
            h0 = header_row[1].strip() if len(header_row) > 1 else ""
            if _normalize(h0) not in ("mes",):
                continue

            # Find column indices for KM, EXCESO, PARQUEO, COMBUSTIBLE
            km_col = None
            excess_col = None
            parking_col = None
            fuel_col = None
            for ci, h in enumerate(header_row):
                h_norm = _normalize(h)
                if "kilometraje" in h_norm or h_norm == "kilometraje":
                    km_col = ci + 1
                elif "exceso" in h_norm:
                    excess_col = ci + 1
                elif "parqueo" in h_norm or "estacionamiento" in h_norm or "tiempo" in h_norm:
                    parking_col = ci + 1
                elif "combustible" in h_norm:
                    fuel_col = ci + 1

            if km_col is None:
                continue

            date_col_letter = _col_letter(3)
            km_col_letter = _col_letter(4)
            excess_col_letter = _col_letter(5) if excess_col else None
            parking_col_letter = _col_letter(6) if parking_col else None
            fuel_col_letter = _col_letter(7) if fuel_col else None

            vehicle_safe = vehicle_sheet.replace("'", "\\'")
            updates = []

            def _mk(col_let: str, m: int) -> str:
                return (
                    f'=IFERROR(SUM(FILTER(\'{vehicle_safe}\'!${col_let}${_DATA_START_ROW}:${col_let},'
                    f"MONTH('{vehicle_safe}'!${date_col_letter}${_DATA_START_ROW}:${date_col_letter})={m},"
                    f"YEAR('{vehicle_safe}'!${date_col_letter}${_DATA_START_ROW}:${date_col_letter})={year}"
                    f")),0)"
                )

            for month_offset in range(12):
                month_row = data_header_row + 1 + month_offset
                if month_row >= len(values):
                    break
                month_val = _parse_month(values[month_row][1].strip() if len(values[month_row]) > 1 else "")
                if month_val is None:
                    break
                mn = month_val

                updates.append({
                    "range": gspread.utils.rowcol_to_a1(month_row + 1, km_col),
                    "values": [[_mk(km_col_letter, mn)]],
                })
                for col, c_let in [
                    (excess_col, excess_col_letter),
                    (parking_col, parking_col_letter),
                    (fuel_col, fuel_col_letter),
                ]:
                    if col and c_let:
                        updates.append({
                            "range": gspread.utils.rowcol_to_a1(month_row + 1, col),
                            "values": [[_mk(c_let, mn)]],
                        })

            if updates:
                for i in range(0, len(updates), 10):
                    summary.batch_update(updates[i:i + 10])
                    updated += len(updates[i:i + 10])

        return updated
