import pytest
from src.normalization.numbers import normalize_number, safe_normalize_number
from src.normalization.dates import normalize_date, safe_normalize_date
from src.normalization.vehicles import normalize_vehicle_name


class TestNumberNormalization:
    """Tests para normalización de números."""

    def test_decimal_with_dot(self):
        assert normalize_number("114.962") == pytest.approx(114.962)

    def test_european_comma_thousands(self):
        assert normalize_number("31.902,000") == pytest.approx(31902.0)

    def test_european_comma_decimal(self):
        assert normalize_number("4.412,00") == pytest.approx(4412.0)
        assert normalize_number("0,00") == pytest.approx(0.0)

    def test_simple_decimal(self):
        assert normalize_number("0.263") == pytest.approx(0.263)
        assert normalize_number("45.477") == pytest.approx(45.477)

    def test_integer(self):
        assert normalize_number("1587") == pytest.approx(1587)

    def test_already_float(self):
        assert normalize_number(1587.5) == pytest.approx(1587.5)

    def test_safe_normalize_default(self):
        assert safe_normalize_number("invalid", default=0.0) == 0.0


class TestDateNormalization:
    """Tests para normalización de fechas."""

    def test_iso_format(self):
        assert normalize_date("2026-04-23").isoformat() == "2026-04-23"

    def test_slash_format(self):
        assert normalize_date("23/04/2026").isoformat() == "2026-04-23"

    def test_dash_format(self):
        assert normalize_date("23-04-2026").isoformat() == "2026-04-23"

    def test_safe_normalize_none(self):
        assert safe_normalize_date("invalid") is None
        assert safe_normalize_date("invalid", default=None) is None


class TestVehicleNormalization:
    """Tests para normalización de nombres de vehículos."""

    def test_uppercase(self):
        assert normalize_vehicle_name("Mercedes e200") == "MERCEDES E200"

    def test_remove_extra_spaces(self):
        assert normalize_vehicle_name("Mercedes  E200") == "MERCEDES E200"

    def test_dash_normalization(self):
        assert normalize_vehicle_name("Mercedes-E200") == "MERCEDES E200"