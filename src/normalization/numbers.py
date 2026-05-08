import re
from typing import Union
from decimal import Decimal, InvalidOperation


class NumberNormalizationError(Exception):
    pass


def normalize_number(value: Union[str, float, int]) -> float:
    """
    Normaliza números con formatos inconsistentes.

    Formatos esperados:
    - "114.962" -> 114.962
    - "31.902,000" -> 31.902
    - "4.412,00" -> 4.412
    - "0.263" -> 0.263
    - "0,00" -> 0.0
    - "45.477" -> 45.477
    - "1587" -> 1587
    - 1587 -> 1587
    """
    if isinstance(value, (int, float)):
        return float(value)

    if not isinstance(value, str):
        raise NumberNormalizationError(f"Tipo no soportado: {type(value)}")

    value = value.strip()

    if not value:
        return 0.0

    if value.replace(".", "").replace(",", "").replace("-", "").isdigit():
        pass

    has_comma = "," in value
    has_dot = "." in value

    if has_comma and has_dot:
        if value.rfind(",") > value.rfind("."):
            value = value.replace(".", "").replace(",", ".")
        else:
            value = value.replace(",", "")

    elif has_comma:
        if "," in value:
            parts = value.split(",")
            if len(parts[-1]) == 3 and parts[-1].isdigit() and len(parts) == 1:
                value = value.replace(",", ".")
            elif len(parts[-1]) <= 2:
                value = value.replace(",", ".")
            else:
                value = value.replace(",", "")

    try:
        return float(value)
    except ValueError as e:
        raise NumberNormalizationError(f"No se pudo normalizar '{value}': {e}")


def safe_normalize_number(value: Union[str, float, int], default: float = 0.0) -> float:
    try:
        return normalize_number(value)
    except NumberNormalizationError:
        return default


def is_valid_kilometer(value: float) -> bool:
    return 0 <= value <= 100000


def is_valid_fuel(value: float) -> bool:
    return 0 <= value <= 1000


def is_valid_minutes(value: int) -> bool:
    return 0 <= value <= 1440


def parse_all_numbers(values: list) -> list[float]:
    return [safe_normalize_number(v) for v in values]


def format_number(value: float, decimals: int = 3) -> str:
    return f"{value:.{decimals}f}"