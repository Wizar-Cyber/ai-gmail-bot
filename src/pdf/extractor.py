import logging
import re
from typing import Optional
from ..models.vehicle import Vehicle
from ..models.report import DailyEntry, VehicleReport
from ..normalization.numbers import safe_normalize_number
from ..normalization.dates import parse_date_from_row
from ..normalization.vehicles import extract_vehicle_and_plate

logger = logging.getLogger("km_automation")

PDF_MAGIC = b"%PDF"


class PDFParseError(Exception):
    pass


def is_valid_pdf(file_path: str) -> bool:
    """Verifica que el archivo tenga los bytes mágicos de PDF (%PDF)."""
    try:
        with open(file_path, "rb") as f:
            header = f.read(len(PDF_MAGIC))
            return header == PDF_MAGIC
    except Exception:
        return False


def extract_text_from_pdf(pdf_path: str) -> str:
    """Extrae texto de PDF usando pdfplumber."""
    try:
        import pdfplumber
    except ImportError:
        raise ImportError("pdfplumber no está instalado: pip install pdfplumber")

    text_parts = []

    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            text = page.extract_text()
            if text:
                text_parts.append(text)

    return "\n".join(text_parts)


def split_vehicle_sections(full_text: str) -> list[dict]:
    """Divide el texto por bloques de vehículos."""
    sections = []
    current_section = ""

    lines = full_text.split("\n")

    for line in lines:
        line = line.strip()
        if not line:
            continue

        if re.match(r"Appareil:", line, re.IGNORECASE) or re.match(r"Vehículo:", line, re.IGNORECASE):
            if current_section:
                sections.append({"text": current_section})
            current_section = line + "\n"
        else:
            current_section += line + "\n"

    if current_section:
        sections.append({"text": current_section})

    return sections


def parse_vehicle_from_section(section_text: str) -> Vehicle:
    """Extrae información del vehículo del texto."""
    name, plate = extract_vehicle_and_plate(section_text)
    if not name:
        raise PDFParseError("No se pudo extraer nombre del vehículo")
    return Vehicle(name=name, plate=plate)


def parse_data_rows(section_text: str) -> list[DailyEntry]:
    """Extrae las filas de datos del PDF. Formato: '1 2026-04-23 114.962 0 28 9.2'"""
    entries = []
    lines = section_text.split("\n")

    for line in lines:
        line = line.strip()
        if not line:
            continue

        if re.match(r"^Total", line, re.IGNORECASE):
            continue

        row_match = re.match(
            r"^\d+\s+(\d{4}-\d{2}-\d{2})\s+([\d.,]+)\s+(\d+)\s+(\d+)\s+([\d.,]+)",
            line
        )

        if row_match:
            date_str = row_match.group(1)
            kilometers = row_match.group(2)
            speed_excess = row_match.group(3)
            parking = row_match.group(4)
            fuel = row_match.group(5)

            entry_date = parse_date_from_row(line)
            if not entry_date:
                continue

            entry = DailyEntry(
                date=entry_date,
                vehicle=None,
                kilometers=safe_normalize_number(kilometers),
                speed_excess_minutes=int(speed_excess),
                parking_minutes=int(parking),
                fuel_liters=safe_normalize_number(fuel),
                raw_data={"raw_line": line}
            )
            entries.append(entry)

    return entries


def extract_reports_from_pdf(pdf_path: str) -> list[VehicleReport]:
    """Extrae todos los reportes de vehículos de un PDF."""
    if not is_valid_pdf(pdf_path):
        raise PDFParseError(f"No es un PDF válido (cabecera %PDF no encontrada): {pdf_path}")
    full_text = extract_text_from_pdf(pdf_path)
    sections = split_vehicle_sections(full_text)

    reports = []

    for section in sections:
        text = section["text"]
        try:
            vehicle = parse_vehicle_from_section(text)
            entries = parse_data_rows(text)

            for entry in entries:
                entry.vehicle = vehicle

            report = VehicleReport(
                vehicle=vehicle,
                entries=entries,
                source_file=pdf_path
            )

            if entries:
                reports.append(report)

        except Exception as e:
            logger.warning(f"Error parseando sección: {e}")
            continue

    return reports


def validate_report(report: VehicleReport) -> list[str]:
    """Valida un reporte y retorna lista de advertencias."""
    warnings = []

    for entry in report.entries:
        if entry.kilometers < 0:
            warnings.append(f"Kilómetros negativos: {entry.kilometers}")
        if entry.kilometers > 10000:
            warnings.append(f"Kilómetros muy altos: {entry.kilometers}")
        if entry.fuel_liters < 0:
            warnings.append(f"Combustible negativo: {entry.fuel_liters}")

    return warnings