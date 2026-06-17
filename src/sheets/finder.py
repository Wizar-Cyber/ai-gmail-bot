import re
from datetime import date, datetime
from difflib import SequenceMatcher
from typing import Optional
import gspread
import gspread.utils


from ..normalization.dates import DATE_FORMATS as _DATE_FORMATS, MONTH_DAY_FORMATS as _MONTH_DAY_FORMATS


class BaseSheetFinder:
    """Base fuzzy sheet matcher. Subclasses override _BRAND_MODELS."""

    _BRAND_MODELS = {}

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

        best_match = None
        best_ratio = 0.6

        for ws in worksheets:
            sheet_norm = self._normalize(ws.title)
            sheet_key = self._extract_model_key(ws.title)

            if search_norm and search_norm in sheet_norm:
                return ws
            if sheet_norm and sheet_norm in search_norm:
                return ws
            if search_key and sheet_key and search_key in sheet_key:
                return ws
            if search_key and sheet_key and sheet_key in search_key:
                return ws

            ratio = SequenceMatcher(None, search_norm, sheet_norm).ratio()
            if ratio >= best_ratio:
                best_ratio = ratio
                best_match = ws

        if best_match:
            return best_match

        if vehicle_plate:
            plate_norm = vehicle_plate.lower().strip()
            for ws in worksheets:
                if plate_norm in ws.title.lower():
                    return ws
        return None


class SheetsFinder(BaseSheetFinder):
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


class RowFinder:
    """Finds the correct row for a date, respecting month sections with TOTAL separators."""

    def __init__(self, worksheet: gspread.Worksheet):
        """Initialize with a worksheet.

        Args:
            worksheet: A gspread Worksheet instance.
        """
        self.ws = worksheet
        self._cache: list[list] | None = None

    def _values(self) -> list[list]:
        """Return all worksheet values, using a cached copy on subsequent calls.

        Returns:
            List of rows, each row being a list of cell strings.
        """
        if self._cache is None:
            self._cache = self.ws.get_all_values()
        return self._cache

    def _try_parse_date(self, cell_val: str) -> Optional[date]:
        """Try to parse a cell value as a date using known formats.

        Args:
            cell_val: The cell string value.

        Returns:
            A date object if parsing succeeds, None otherwise.
        """
        for fmt in _DATE_FORMATS:
            try:
                return datetime.strptime(cell_val, fmt).date()
            except ValueError:
                continue
        return None

    def _is_separator(self, cell_val: str) -> bool:
        """Check if a cell value is a section separator keyword.

        Args:
            cell_val: The cell string value.

        Returns:
            True if the value is a separator keyword.
        """
        return cell_val.upper() in ("TOTAL", "FECHA", "MES", "SUBTOTAL", "TOTALES")

    def _month_section_exists(self, values: list[list], target_date: date) -> bool:
        target_name = _MONTH_NAMES_UPPER[target_date.month]
        target_str = f"{target_name} {target_date.year}"
        for row in values:
            for cell in row:
                if cell and target_str in cell.strip().upper():
                    return True
        return False

    def _find_last_section_rows(self, values: list[list], date_col: int = 3) -> tuple[Optional[int], Optional[int], Optional[int], Optional[int]]:
        col_idx = date_col - 1
        month_headers = []
        for row_idx, row in enumerate(values):
            row_text = " ".join(c.strip().upper() for c in row if c)
            for m_name in _MONTH_NAMES_UPPER[1:]:
                if m_name in row_text and re.search(r'\b\d{4}\b', row_text):
                    month_headers.append(row_idx + 1)
                    break

        if not month_headers:
            return None, None, None, None

        last_mh_row = month_headers[-1]
        last_col_row = last_mh_row + 1
        first_data = None
        total_row = None

        for row_idx in range(last_col_row + 1, min(last_col_row + 60, len(values) + 1)):
            row = values[row_idx - 1]
            if first_data and total_row is None:
                for cell in row:
                    if cell and cell.strip().upper() == "TOTAL":
                        total_row = row_idx
                        break
            if first_data is None and col_idx < len(row):
                cell_val = row[col_idx].strip() if row[col_idx] else ""
                if cell_val and not self._is_separator(cell_val):
                    parsed = self._try_parse_date(cell_val)
                    if parsed:
                        first_data = row_idx

        return last_mh_row, last_col_row, first_data, total_row

    def _create_month_section(self, after_row_1: int, target_date: date, values: list[list]) -> None:
        rows_to_insert = 4
        body = {"requests": [{
            "insertDimension": {
                "range": {
                    "sheetId": self.ws.id,
                    "dimension": "ROWS",
                    "startIndex": after_row_1,
                    "endIndex": after_row_1 + rows_to_insert,
                }
            }
        }]}
        self.ws.spreadsheet.batch_update(body)

        month_row = after_row_1 + 1
        target_name = _MONTH_NAMES_UPPER[target_date.month]
        self.ws.update_cell(month_row, 2, f"MES: {target_name.title()} {target_date.year}")

        header_row = _find_header_row(self.ws, ["FECHA", "KILOMETRAJE"])
        header_vals = self.ws.row_values(header_row)
        col_header_row = month_row + 1
        for ci, val in enumerate(header_vals, 1):
            if val:
                self.ws.update_cell(col_header_row, ci, val)

        ref_mh, ref_col, ref_data, ref_total = self._find_last_section_rows(values)
        requests = []
        cols = len(header_vals) + 1

        if ref_mh:
            requests.append({
                "copyPaste": {
                    "source": {"sheetId": self.ws.id, "startRowIndex": ref_mh - 1, "endRowIndex": ref_mh, "startColumnIndex": 0, "endColumnIndex": cols},
                    "destination": {"sheetId": self.ws.id, "startRowIndex": month_row - 1, "endRowIndex": month_row, "startColumnIndex": 0, "endColumnIndex": cols},
                    "pasteType": "PASTE_FORMAT",
                }
            })

        if ref_col:
            requests.append({
                "copyPaste": {
                    "source": {"sheetId": self.ws.id, "startRowIndex": ref_col - 1, "endRowIndex": ref_col, "startColumnIndex": 0, "endColumnIndex": cols},
                    "destination": {"sheetId": self.ws.id, "startRowIndex": col_header_row - 1, "endRowIndex": col_header_row, "startColumnIndex": 0, "endColumnIndex": cols},
                    "pasteType": "PASTE_FORMAT",
                }
            })

        if ref_data:
            requests.append({
                "copyPaste": {
                    "source": {"sheetId": self.ws.id, "startRowIndex": ref_data - 1, "endRowIndex": ref_data, "startColumnIndex": 0, "endColumnIndex": cols},
                    "destination": {"sheetId": self.ws.id, "startRowIndex": month_row + 1, "endRowIndex": month_row + 2, "startColumnIndex": 0, "endColumnIndex": cols},
                    "pasteType": "PASTE_FORMAT",
                }
            })

        total_data_row = month_row + 2
        if ref_total:
            requests.append({
                "copyPaste": {
                    "source": {"sheetId": self.ws.id, "startRowIndex": ref_total - 1, "endRowIndex": ref_total, "startColumnIndex": 0, "endColumnIndex": cols},
                    "destination": {"sheetId": self.ws.id, "startRowIndex": total_data_row, "endRowIndex": total_data_row + 1, "startColumnIndex": 0, "endColumnIndex": cols},
                    "pasteType": "PASTE_NORMAL",
                }
            })

        if requests:
            self.ws.spreadsheet.batch_update({"requests": requests})

    def find_date_row(self, target_date: date, date_col: int = 3) -> Optional[int]:
        """Find the row number for a target date, inserting a new row if not found.

        Automatically creates a month section header (month name + column headers)
        when the target date belongs to a new month that has no section yet.

        Args:
            target_date: The date to locate.
            date_col: The 1-indexed column containing dates (default 3).

        Returns:
            The 1-indexed row number, or None if no date rows exist.
        """
        col_idx = date_col - 1
        values = self._values()

        exact_match = None
        date_rows: list[tuple[date, int]] = []

        for row_idx, row in enumerate(values):
            if col_idx >= len(row):
                continue
            cell_val = row[col_idx].strip() if row[col_idx] else ""
            if not cell_val:
                continue

            if self._is_separator(cell_val):
                continue

            parsed = self._try_parse_date(cell_val)
            if parsed:
                if parsed == target_date:
                    exact_match = row_idx + 1
                date_rows.append((parsed, row_idx + 1))

        if exact_match:
            return exact_match

        if not date_rows:
            return None

        date_rows.sort(key=lambda x: x[0])

        target_month_start = date(target_date.year, target_date.month, 1)
        dates_before = [(d, r) for d, r in date_rows if d < target_month_start]
        if dates_before:
            last_before_row = dates_before[-1][1]
            if not self._month_section_exists(values, target_date):
                insert_after = last_before_row
                scan_limit = min(last_before_row + 10, len(values))
                for r in range(last_before_row, scan_limit):
                    for cell in values[r]:
                        if cell and cell.strip().upper() == "TOTAL":
                            insert_after = r + 1
                            break
                self._create_month_section(insert_after, target_date, values)
                self._cache = None
                return insert_after + 3

        for d, row_num in date_rows:
            if d > target_date:
                body = {
                    "requests": [{
                        "insertDimension": {
                            "range": {
                                "sheetId": self.ws.id,
                                "dimension": "ROWS",
                                "startIndex": row_num - 1,
                                "endIndex": row_num,
                            }
                        }
                    }]
                }
                self.ws.spreadsheet.batch_update(body)
                return row_num

        return date_rows[-1][1] + 1


def _find_header_row(worksheet: gspread.Worksheet, headers: list[str]) -> int:
    """Scan ALL worksheet rows to find the data header row.

    Prefers rows containing both FECHA and KILOMETRAJE together.
    Falls back to the first row matching any single header.
    """
    values = worksheet.get_all_values()
    header_lower = [h.lower() for h in headers]
    best_row = 3

    for row_idx, row in enumerate(values):
        row_cells = [c.lower().strip() for c in row if c]
        matched = [h for h in header_lower if any(h in c for c in row_cells)]

        if 'fecha' in matched and 'kilometraje' in matched:
            return row_idx + 1

        if matched:
            best_row = row_idx + 1

    return best_row


def find_column_by_header(
    worksheet: gspread.Worksheet,
    headers: list[str],
    search_row: Optional[int] = None,
) -> dict[str, int]:
    """Returns a dict of header → 1-indexed column number.

    Auto-detects the header row if search_row is not provided.
    """
    if search_row is None:
        search_row = _find_header_row(worksheet, headers)

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


_MONTH_NAMES_UPPER = [
    "", "ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO",
    "JULIO", "AGOSTO", "SEPTIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE",
]



