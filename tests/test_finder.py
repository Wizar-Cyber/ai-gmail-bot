"""Tests for sheets/finder.py using mocked gspread."""
from datetime import date
from unittest.mock import MagicMock, patch
import pytest

from src.sheets.finder import SheetsFinder, RowFinder, find_column_by_header


class MockCell:
    def __init__(self, value):
        self.value = value


class MockWorksheet:
    def __init__(self, title, data):
        self.title = title
        self._data = data
        self.id = 123

    def get_all_values(self):
        return self._data

    def row_values(self, row):
        if row <= len(self._data):
            return self._data[row - 1]
        return []

    def cell(self, row, col):
        if row <= len(self._data) and col <= len(self._data[row - 1]):
            return MockCell(self._data[row - 1][col - 1])
        return MockCell(None)

    def batch_update(self, updates):
        pass

    def batch_clear(self, ranges):
        pass


class MockSpreadsheet:
    def __init__(self, worksheets):
        self._worksheets = worksheets

    def worksheets(self):
        return self._worksheets


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
