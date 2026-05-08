import pytest
import os


class TestPDFParser:
    """Tests para parser de PDFs."""

    @pytest.fixture
    def pdf_path(self):
        path = "Rapport kilométrique(20260423-20260423).pdf"
        if os.path.exists(path):
            return path
        pytest.skip("PDF file not found")

    def test_extract_text_from_pdf(self, pdf_path):
        """Verifica que se puede extraer texto del PDF."""
        from src.pdf.extractor import extract_text_from_pdf
        text = extract_text_from_pdf(pdf_path)
        assert len(text) > 0
        print(f"Text length: {len(text)}")

    def test_find_vehicle_in_text(self, pdf_path):
        """Verifica que se encuentra el vehículo en el texto."""
        from src.pdf.extractor import extract_text_from_pdf
        from src.normalization.vehicles import extract_vehicle_and_plate

        text = extract_text_from_pdf(pdf_path)
        name, plate = extract_vehicle_and_plate(text)
        print(f"Vehicle: {name}, Plate: {plate}")

        assert name is not None

    def test_extract_reports(self, pdf_path):
        """Verifica extracción completa de reportes."""
        from src.pdf.extractor import extract_reports_from_pdf

        reports = extract_reports_from_pdf(pdf_path)
        print(f"Reports found: {len(reports)}")

        for report in reports:
            print(f"Vehicle: {report.vehicle.name}, Entries: {len(report.entries)}")
            for entry in report.entries:
                print(f"  Date: {entry.date}, KM: {entry.kilometers}, Fuel: {entry.fuel_liters}")

        assert len(reports) > 0


class TestPDFDataRows:
    """Tests específicos para parseo de filas de datos."""

    def test_parse_sample_row(self):
        """Testea parsing de una fila de datos."""
        from src.pdf.extractor import parse_data_rows

        sample_text = """
        Appareil:MERCEDES E200 - JSZ167

        1 2026-04-23 114.962 0 28 9.2

        Total 114.962 0 28 9.2
        """

        entries = parse_data_rows(sample_text)
        assert len(entries) == 1
        assert entries[0].kilometers == 114.962
        assert entries[0].fuel_liters == 9.2