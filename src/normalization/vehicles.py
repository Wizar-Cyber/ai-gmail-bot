import re
from difflib import SequenceMatcher
from typing import Optional
from ..models.vehicle import Vehicle, VehicleMapping


def normalize_vehicle_name(name: str) -> str:
    name = re.sub(r"[\s\-_]+", " ", name.strip())
    name = name.upper()
    return name


def extract_vehicle_and_plate(text: str) -> tuple[str, str]:
    """
    Extrae nombre del vehículo y placa del texto.
    Ej: "Appareil:MERCEDES E200 - JSZ167" -> ("MERCEDES E200", "JSZ167")
    "Appareil:TOYOTA PRADO TXL" -> ("TOYOTA PRADO TXL", "")
    """
    patterns = [
        (r"Appareil:\s*([A-ZÀÈÌÒÙÁÉÍÓÚÑ][A-ZÀÈÌÒÙÁÉÍÓÚÑ0-9 ]+?)\s*[-–]\s*([A-Z0-9]+)", 2),
        (r"Vehículo:\s*([A-ZÀÈÌÒÙÁÉÍÓÚÑ][A-ZÀÈÌÒÙÁÉÍÓÚÑ0-9 ]+?)\s*[-–]\s*([A-Z0-9]+)", 2),
        (r"([A-Z][A-Z0-9 ]+?)\s*[-–]\s*([A-Z0-9]+)", 2),
        (r"(?:Appareil|Vehículo):\s*([A-ZÀÈÌÒÙÁÉÍÓÚÑ][A-ZÀÈÌÒÙÁÉÍÓÚÑ0-9 ]+)", 1),
    ]

    for pattern, groups in patterns:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            name = normalize_vehicle_name(match.group(1).strip())
            plate = match.group(2).strip() if groups >= 2 else ""
            return name, plate

    return "", ""


def fuzzy_match_vehicle(
    input_name: str,
    mappings: list[VehicleMapping],
    threshold: float = 0.7
) -> Optional[VehicleMapping]:
    """
    Encuentra coincidencia aproximada del vehículo con las hojas del Excel.
    """
    input_norm = normalize_vehicle_name(input_name)

    for mapping in mappings:
        if mapping.match(input_name):
            return mapping

        ratio = SequenceMatcher(None, input_norm, normalize_vehicle_name(mapping.canonical_name)).ratio()
        if ratio >= threshold:
            return mapping

        for alias in mapping.aliases:
            ratio = SequenceMatcher(None, input_norm, normalize_vehicle_name(alias)).ratio()
            if ratio >= threshold:
                return mapping

    return None


def find_excel_sheet_name(
    vehicle_name: str,
    available_sheets: list[str]
) -> Optional[str]:
    """
    Encuentra el nombre de la hoja de Excel que corresponde al vehículo.
    """
    mappings = VehicleMapping.default_mappings()
    input_norm = normalize_vehicle_name(vehicle_name)

    for mapping in mappings:
        if mapping.match(vehicle_name):
            for sheet in available_sheets:
                sheet_norm = sheet.lower().replace(" ", "").replace(",", "").replace("-", "")
                excel_norm = mapping.excel_sheet_name.lower().replace(" ", "").replace(",", "").replace("-", "")
                canonical_norm = mapping.canonical_name.lower().replace(" ", "")

                if sheet_norm and (canonical_norm in sheet_norm or excel_norm in sheet_norm):
                    return sheet

    for sheet in available_sheets:
        if sheet == "TOTAL Y RESUM 2026":
            continue
        sheet_norm = sheet.lower().replace(" ", "").replace(",", "")
        if input_norm.replace(" ", "").replace("-", "") in sheet_norm:
            return sheet

    return None


def create_vehicle_from_parsing(name: str, plate: str) -> Vehicle:
    name = normalize_vehicle_name(name)
    return Vehicle(name=name, plate=plate)