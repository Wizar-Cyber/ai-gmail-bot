from datetime import date, datetime
from typing import Optional
import re


class DateNormalizationError(Exception):
    pass


DATE_FORMATS = [
    "%Y-%m-%d",
    "%d/%m/%Y",
    "%d-%m-%Y",
    "%Y/%m/%d",
    "%d.%m.%Y",
    "%Y%m%d",
    "%d %m %Y",
]

MONTH_NAMES = {
    "enero": 1, "febrero": 2, "marzo": 3, "abril": 4,
    "mayo": 5, "junio": 6, "julio": 7, "agosto": 8,
    "septiembre": 9, "octubre": 10, "noviembre": 11, "diciembre": 12,
    "january": 1, "february": 2, "march": 3, "april": 4,
    "may": 5, "june": 6, "july": 7, "august": 8,
    "september": 9, "october": 10, "november": 11, "december": 12,
}


def normalize_date(value: str) -> date:
    """
    Normaliza fechas de múltiples formatos.
    """
    if isinstance(value, date):
        return value

    if isinstance(value, datetime):
        return value.date()

    if not isinstance(value, str):
        raise DateNormalizationError(f"Tipo no soportado: {type(value)}")

    value = value.strip()

    for fmt in DATE_FORMATS:
        try:
            return datetime.strptime(value, fmt).date()
        except ValueError:
            continue

    value_lower = value.lower()
    for month_name, month_num in MONTH_NAMES.items():
        if month_name in value_lower:
            match = re.search(r"(\d{1,2})\s*" + month_name + r"\s*(\d{4})", value_lower)
            if match:
                day = int(match.group(1))
                year = int(match.group(2))
                return date(year, month_num, day)

            match = re.search(month_name + r"\s*(\d{1,2}),?\s*(\d{4})", value_lower)
            if match:
                day = int(match.group(1))
                year = int(match.group(2))
                return date(year, month_num, day)

    raise DateNormalizationError(f"Formato de fecha no reconocido: {value}")


def safe_normalize_date(value: str, default: Optional[date] = None) -> Optional[date]:
    try:
        return normalize_date(value)
    except DateNormalizationError:
        return default


def is_valid_date_range(d: date, min_year: int = 2020, max_year: int = 2030) -> bool:
    return min_year <= d.year <= max_year


def parse_date_from_row(row_text: str) -> Optional[date]:
    """
    Extrae fecha de una fila de datos PDF.
    Ej: "1 2026-04-23 114.962 0 28 9.2"
    """
    patterns = [
        r"(\d{4}-\d{2}-\d{2})",
        r"(\d{2}/\d{2}/\d{4})",
        r"(\d{2}-\d{2}-\d{4})",
    ]

    for pattern in patterns:
        match = re.search(pattern, row_text)
        if match:
            return safe_normalize_date(match.group(1))

    return None


def get_month_from_date(d: date) -> int:
    return d.month


def get_year_from_date(d: date) -> int:
    return d.year


def get_month_name(month: int, lang: str = "es") -> str:
    names_es = ["", "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
                "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"]
    names_en = ["", "January", "February", "March", "April", "May", "June",
                "July", "August", "September", "October", "November", "December"]

    if lang == "es":
        return names_es[month]
    return names_en[month]