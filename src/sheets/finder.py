import re
from datetime import date, datetime
from typing import Optional
import gspread


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

        for ws in worksheets:
            sheet_norm = self._normalize(ws.title)
            if search_norm and search_norm in sheet_norm:
                return ws
            sheet_key = self._extract_model_key(ws.title)
            if search_key and sheet_key and search_key in sheet_key:
                return ws

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

    def find_date_row(self, target_date: date, date_col: int = 3) -> Optional[int]:
        """Find the row number for a target date, inserting a new row if not found.

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
    """Scan worksheet rows 1-30 to find the data header row.

    Prefers rows containing both FECHA and KILOMETRAJE together.
    Falls back to the first row matching any single header.
    """
    values = worksheet.get_all_values()
    header_lower = [h.lower() for h in headers]
    best_row = 3

    for row_idx, row in enumerate(values[:30]):
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
