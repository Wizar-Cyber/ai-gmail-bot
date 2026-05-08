from datetime import date, datetime
from typing import Optional
import re
from datetime import timedelta


class ExcelFindError(Exception):
    pass


class CellFinder:
    def __init__(self, worksheet):
        self.ws = worksheet
        self._header_row = 12
        self._data_start_row = 13

    def find_header_row(self) -> int:
        for row in range(1, 10):
            cell_value = self.ws.cell(row, 1).value
            if cell_value and isinstance(cell_value, str):
                if "fecha" in cell_value.lower() or "date" in cell_value.lower():
                    return row
        return self._header_row

    def find_column_index(self, header_row: int, target_headers: list[str]) -> dict[str, int]:
        mapping = {}

        for col in range(1, 15):
            header = self.ws.cell(header_row, col).value
            if header and isinstance(header, str):
                header_clean = header.lower().strip()

                for target in target_headers:
                    if target.lower() in header_clean:
                        mapping[target] = col
                        break

        return mapping

    def find_date_row(self, target_date: date, date_col: int = 3) -> Optional[int]:
        for row in range(self._data_start_row, 200):
            cell_value = self.ws.cell(row, date_col).value

            if cell_value is None:
                continue

            if isinstance(cell_value, datetime):
                cell_date = cell_value.date()
                if cell_date == target_date:
                    return row

            elif isinstance(cell_value, date):
                if cell_value == target_date:
                    return row

            elif isinstance(cell_value, str):
                try:
                    num = int(cell_value)
                    target_day_of_year = (target_date - date(target_date.year, 1, 1)).days + 1
                    if num == target_day_of_year:
                        return row
                except (ValueError, TypeError):
                    pass

        day_of_year = (target_date - date(target_date.year, 1, 1)).days + 1
        row_num = self._data_start_row + (day_of_year - 1)
        if row_num < 200:
            return row_num

        return None

    def find_vehicle_header(self, vehicle_name: str) -> Optional[int]:
        for row in range(1, 10):
            cell_value = self.ws.cell(row, 1).value
            if cell_value and isinstance(cell_value, str):
                if vehicle_name.lower() in cell_value.lower():
                    return row
        return None


class SheetFinder:
    def __init__(self, workbook):
        self.wb = workbook
        self._brand_models = {
            "mercedes": ["e200", "e200cabri", "gle450", "gle", "c200", "gla", "glb", "glc", "gle", "gls", "s", "a", "b", "cla"],
            "audi": ["q3", "q5", "q7", "q8", "a3", "a4", "a5", "a6", "a7", "tt"],
            "bmw": ["x1", "x2", "x3", "x4", "x5", "x6", "x7", "series"],
            "toyota": ["corolla", "camry", "rav4", "highlander", "prado"],
            "honda": ["civic", "accord", "crv", "pilot"],
            "ford": ["fiesta", "focus", "fusion", "escape", "explorer"],
            "chevrolet": ["cruze", "malibu", "equinox", "traverse"],
            "nissan": ["sentra", "altima", "rogue", "pathfinder"],
        }

    def _extract_model_key(self, name: str) -> str:
        name_lower = name.lower()
        for brand, models in self._brand_models.items():
            if brand in name_lower:
                for model in models:
                    if model in name_lower:
                        return f"{brand}{model}"
        return re.sub(r'[\s,\.\-]+', '', name_lower)

    def find_vehicle_sheet(self, vehicle_name: str, vehicle_plate: str = "") -> Optional[object]:
        import difflib
        
        normalize = lambda s: re.sub(r'[\s,\.]+', '', s.lower()) if s else ""
        
        search_key = self._extract_model_key(vehicle_name)
        
        candidates = []
        for sheet_name in self.wb.sheetnames:
            sheet_norm = normalize(sheet_name)
            search_norm = normalize(vehicle_name)
            
            if search_norm and search_norm in sheet_norm:
                return self.wb[sheet_name]
            
            sheet_key = self._extract_model_key(sheet_name)
            if search_key and sheet_key and search_key in sheet_key:
                return self.wb[sheet_name]
            
            candidates.append((sheet_name, sheet_norm))
        
        for sheet_name, sheet_norm in candidates:
            if normalize(vehicle_name) in sheet_norm:
                return self.wb[sheet_name]
        
        if vehicle_plate:
            for sheet_name in self.wb.sheetnames:
                if vehicle_plate.lower() in sheet_name.lower():
                    return self.wb[sheet_name]
        
        return None

    def find_month_sheet(self, month: int, year: int = 2026) -> Optional[object]:
        month_names = [
            "", "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
            "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"
        ]

        target_name = month_names[month]
        if year:
            target_name = f"{target_name} {year}"

        for sheet_name in self.wb.sheetnames:
            if target_name.lower() in sheet_name.lower():
                return self.wb[sheet_name]

        return None


def find_total_row(worksheet) -> Optional[int]:
    for row in range(1, 60):
        cell_value = worksheet.cell(row, 1).value
        if cell_value and isinstance(cell_value, str):
            if cell_value.strip().lower() == "total":
                return row
    return None


def find_column_by_header(worksheet, headers: list[str], search_row: int = 3) -> dict[str, int]:
    mapping = {}

    for col in range(1, 20):
        cell_value = worksheet.cell(search_row, col).value
        if cell_value and isinstance(cell_value, str):
            cell_clean = cell_value.lower().strip()
            for header in headers:
                if header.lower() in cell_clean:
                    mapping[header] = col

    return mapping