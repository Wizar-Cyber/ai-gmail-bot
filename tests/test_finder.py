"""Tests for sheets/finder.py using mocked gspread."""
from copy import deepcopy
from datetime import date
from unittest.mock import MagicMock, patch
import pytest

from src.sheets.finder import SheetsFinder, RowFinder, find_column_by_header, _MONTH_NAMES_UPPER


class MockCell:
    def __init__(self, value):
        self.value = value


class MockWorksheet:
    def __init__(self, title, data):
        self.title = title
        self._data = deepcopy(data)
        self.id = 123
        self.calls = []

    def get_all_values(self):
        return deepcopy(self._data)

    def row_values(self, row):
        if row <= len(self._data):
            return self._data[row - 1]
        return []

    def cell(self, row, col):
        if row <= len(self._data) and col <= len(self._data[row - 1]):
            return MockCell(self._data[row - 1][col - 1])
        return MockCell(None)

    def update_cell(self, row, col, value):
        self.calls.append(("update_cell", row, col, value))
        while len(self._data) < row:
            self._data.append([""] * 10)
        while len(self._data[row - 1]) < col:
            self._data[row - 1].append("")
        self._data[row - 1][col - 1] = str(value)

    def batch_update(self, updates):
        self.calls.append(("batch_update", updates))

    def batch_clear(self, ranges):
        pass

    def _insert_rows(self, start_idx, count):
        """Simulate insertDimension by inserting blank rows at 0-indexed position."""
        blank = [""] * (max(len(r) for r in self._data) if self._data else 10)
        for _ in range(count):
            self._data.insert(start_idx, blank.copy())


class MockSpreadsheet:
    def __init__(self, worksheets):
        self._worksheets = worksheets
        self._batch_requests = []

    def worksheets(self):
        return self._worksheets

    def batch_update(self, body):
        self._batch_requests.append(body)
        for req in body.get("requests", []):
            if "insertDimension" in req:
                r = req["insertDimension"]["range"]
                ws = next(w for w in self._worksheets if w.id == r.get("sheetId", 123))
                ws._insert_rows(r["startIndex"], r["endIndex"] - r["startIndex"])


def test_sheets_finder_finds_by_name():
    ws = MockWorksheet("MERCEDES E 200 JSZ167", [])
    ss = MockSpreadsheet([ws])
    finder = SheetsFinder(ss)
    result = finder.find_vehicle_sheet("MERCEDES E200")
    assert result is not None
    assert result.title == "MERCEDES E 200 JSZ167"


def test_sheets_finder_finds_by_plate():
    ws = MockWorksheet("AUDI Q3 JXV974", [])
    ss = MockSpreadsheet([ws])
    finder = SheetsFinder(ss)
    result = finder.find_vehicle_sheet("AUDI Q3", "JXV974")
    assert result is not None


def test_sheets_finder_returns_none_for_unknown():
    ws = MockWorksheet("SOME OTHER SHEET", [])
    ss = MockSpreadsheet([ws])
    finder = SheetsFinder(ss)
    result = finder.find_vehicle_sheet("UNKNOWN VEHICLE")
    assert result is None


def test_row_finder_finds_exact_date():
    data = [
        ["", "#", "FECHA", "KM"],
        ["", "1", "1/1/2026", "100"],
        ["", "2", "2/1/2026", "200"],
        ["", "3", "3/1/2026", "300"],
    ]
    ws = MockWorksheet("TEST", data)
    finder = RowFinder(ws)
    row = finder.find_date_row(date(2026, 1, 2), 3)
    assert row == 3


def test_row_finder_returns_none_for_unknown():
    data = [["", "#", "FECHA", "KM"]]
    ws = MockWorksheet("TEST", data)
    finder = RowFinder(ws)
    row = finder.find_date_row(date(2026, 5, 3), 3)
    assert row is None


def test_find_column_by_header_detects_columns():
    data = [
        ["", "", "FECHA", "KILOMETRAJE", "EXCESO", "ESTACIONAMIENTO", "COMBUSTIBLE"],
    ]
    ws = MockWorksheet("TEST", data)
    headers = ["FECHA", "KILOMETRAJE", "EXCESO", "ESTACIONAMIENTO", "COMBUSTIBLE"]
    result = find_column_by_header(ws, headers)
    assert result.get("FECHA") == 3
    assert result.get("KILOMETRAJE") == 4
    assert result.get("EXCESO") == 5
    assert result.get("ESTACIONAMIENTO") == 6
    assert result.get("COMBUSTIBLE") == 7


def test_find_column_by_header_prefers_fecha_kilometraje():
    data = [
        ["", "MES", "KILOMETRAJE", "EXCESO"],
        ["", "#", "FECHA", "KILOMETRAJE", "EXCESO", "COMBUSTIBLE"],
    ]
    ws = MockWorksheet("TEST", data)
    headers = ["FECHA", "KILOMETRAJE"]
    result = find_column_by_header(ws, headers)
    # Should prefer row 2 (has both FECHA and KILOMETRAJE)
    assert result.get("FECHA") == 3
    assert result.get("KILOMETRAJE") == 4


def test_row_finder_creates_month_section_for_new_month():
    """When the target date is in a new month without a section,
    RowFinder should create the section and return the correct data row."""
    data = [
        ["", "#", "FECHA", "KILOMETRAJE"],
        ["", "1", "1/1/2026", "100"],
        ["", "2", "10/1/2026", "200"],
    ]
    ws = MockWorksheet("TEST", data)
    ss = MockSpreadsheet([ws])

    finder = RowFinder(ws)
    finder.ws.spreadsheet = ss

    row = finder.find_date_row(date(2026, 2, 1), 3)

    assert row is not None
    assert row == 6  # 3 (Jan 10 row) + 3 = 6
    # Verify section headers were inserted
    assert ws._data[3][1] == "MES: Febrero 2026"  # row 4, col B
    assert ws._data[4][2] == "FECHA"  # row 5, col C


def test_row_finder_does_not_recreate_existing_section():
    """If the month section already exists, no new section should be created."""
    data = [
        ["", "#", "FECHA", "KILOMETRAJE"],
        ["", "", "MES: ENERO 2026", ""],
        ["", "", "FECHA", "KILOMETRAJE"],
        ["", "1", "1/1/2026", "100"],
        ["", "", "MES: FEBRERO 2026", ""],
        ["", "", "FECHA", "KILOMETRAJE"],
        ["", "1", "1/2/2026", "200"],
    ]
    ws = MockWorksheet("TEST", data)
    initial_len = len(ws._data)

    finder = RowFinder(ws)
    row = finder.find_date_row(date(2026, 2, 5), 3)

    assert row is not None
    assert len(ws._data) == initial_len  # no rows were inserted


def test_row_finder_handles_consecutive_months():
    """Creating section for March when Jan and Feb sections exist."""
    data = [
        ["", "#", "FECHA", "KILOMETRAJE"],
        ["", "", "MES: ENERO 2026", ""],
        ["", "", "FECHA", "KILOMETRAJE"],
        ["", "1", "1/1/2026", "100"],
        ["", "", "MES: FEBRERO 2026", ""],
        ["", "", "FECHA", "KILOMETRAJE"],
        ["", "1", "1/2/2026", "200"],
    ]
    ws = MockWorksheet("TEST", data)
    ss = MockSpreadsheet([ws])
    finder = RowFinder(ws)
    finder.ws.spreadsheet = ss

    row = finder.find_date_row(date(2026, 3, 1), 3)

    assert row is not None
    assert row == 10  # 7 (Feb 1 row) + 3 = 10
    assert ws._data[7][1] == "MES: Marzo 2026"

    copy_paste_requests = [
        r for r in ss._batch_requests
        for req in r.get("requests", [])
        if "copyPaste" in req
    ]
    assert len(copy_paste_requests) > 0


def test_row_finder_same_month_no_section_needed():
    """Same month as existing data should not trigger section creation."""
    data = [
        ["", "#", "FECHA", "KILOMETRAJE"],
        ["", "", "MES: ENERO 2026", ""],
        ["", "", "FECHA", "KILOMETRAJE"],
        ["", "1", "1/1/2026", "100"],
        ["", "2", "10/1/2026", "200"],
    ]
    ws = MockWorksheet("TEST", data)
    calls_before = len(ws.calls)

    finder = RowFinder(ws)
    row = finder.find_date_row(date(2026, 1, 15), 3)

    assert row is not None
    # Should not have made any batch_update or update_cell calls for section creation
    section_calls = [c for c in ws.calls[calls_before:] if "MES:" in str(c)]
    assert len(section_calls) == 0


def test_new_section_copies_total_row():
    """When creating a new month section, the TOTAL row with formulas should be copied."""
    data = [
        ["", "#", "FECHA", "KILOMETRAJE", "EXCESO"],
        ["", "", "MES: ENERO 2026", "", ""],
        ["", "", "FECHA", "KILOMETRAJE", "EXCESO"],
        ["", "1", "1/1/2026", "100", "0"],
        ["", "", "TOTAL", "100", "0"],
        ["", "", "MES: FEBRERO 2026", "", ""],
        ["", "", "FECHA", "KILOMETRAJE", "EXCESO"],
        ["", "1", "1/2/2026", "200", "5"],
        ["", "", "TOTAL", "200", "5"],
    ]
    ws = MockWorksheet("TEST", data)
    ss = MockSpreadsheet([ws])
    finder = RowFinder(ws)
    finder.ws.spreadsheet = ss

    row = finder.find_date_row(date(2026, 3, 1), 3)

    assert row is not None
    assert row == 12  # 9 (Feb TOTAL row) + 3 = 12

    paste_normal = [
        req for r in ss._batch_requests
        for req in r.get("requests", [])
        if req.get("copyPaste", {}).get("pasteType") == "PASTE_NORMAL"
    ]
    assert len(paste_normal) == 1
