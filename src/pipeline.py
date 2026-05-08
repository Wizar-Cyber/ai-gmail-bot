from datetime import datetime
from typing import Optional
from .gmail.auth import GmailAuthManager
from .gmail.service import GmailService
from .excel.writer import ExcelUpdater
from .storage.database import Database
from .logs_handler.setup import setup_logging, get_logger
from .models.report import ProcessingResult


class KilometerPipeline:
    def __init__(
        self,
        excel_path: Optional[str] = None,
        data_dir: str = "data",
        db_path: str = "data/processed.db",
        sheets_id: Optional[str] = None,
        service_account_file: Optional[str] = None,
    ):
        self.excel_path = excel_path
        self.data_dir = data_dir
        self.db_path = db_path
        self.sheets_id = sheets_id
        self.service_account_file = service_account_file

        self.logger = setup_logging()
        self.database = Database(db_path)

        self.auth_manager = GmailAuthManager()
        self.gmail_service = Optional[GmailService]

    def _build_sheets_updater(self):
        """Returns a SheetsUpdater if Sheets credentials are configured, else None."""
        if not self.sheets_id or not self.service_account_file:
            return None
        from .sheets.auth import SheetsAuthManager
        from .sheets.writer import SheetsUpdater
        auth = SheetsAuthManager(self.service_account_file)
        spreadsheet = auth.open_spreadsheet(self.sheets_id)
        return SheetsUpdater(spreadsheet)

    def run(self, max_emails: int = 10, query: Optional[str] = None) -> list[ProcessingResult]:
        self.logger.info("=" * 50)
        self.logger.info("Iniciando pipeline de kilometraje")
        self.logger.info("=" * 50)

        results = []

        try:
            self.gmail_service = GmailService(self.auth_manager)
            self.gmail_service.connect()

            self.logger.info(f"Buscando emails (max: {max_emails})")
            emails = self.gmail_service.search_emails(
                query=query,
                max_results=max_emails
            )

            self.logger.info(f"Encontrados {len(emails)} emails")

            for email_msg in emails:
                email_id = email_msg['id']

                if self.database.is_email_processed(email_id):
                    self.logger.info(f"Email {email_id} ya procesado, saltando")
                    continue

                self.logger.info(f"Procesando email: {email_id}")

                result = self.gmail_service.process_email(
                    message_id=email_id,
                    excel_path=self.excel_path,
                    output_dir=self.data_dir
                )

                metadata = self.gmail_service.get_email_metadata(email_id)
                self.database.save_email(
                    email_id=email_id,
                    subject=metadata.get('subject', ''),
                    result=result.to_dict()
                )

                for report in result.reports:
                    for entry in report.entries:
                        self.database.save_entry(
                            vehicle_name=entry.vehicle.name,
                            vehicle_plate=entry.vehicle.plate,
                            entry_date=entry.date.isoformat(),
                            kilometers=entry.kilometers,
                            speed_excess=entry.speed_excess_minutes,
                            parking_time=entry.parking_minutes,
                            fuel=entry.fuel_liters,
                            source_file=report.source_file,
                            email_id=email_id
                        )

                results.append(result)

                status = "OK" if result.success else "ERROR"
                self.logger.info(f"Resultado: {status} - {len(result.reports)} reportes")

        except Exception as e:
            self.logger.exception(f"Error en pipeline: {e}")

        return results

    def process_single_pdf(self, pdf_path: str) -> list:
        from .pdf.extractor import extract_reports_from_pdf

        self.logger.info(f"Procesando PDF: {pdf_path}")

        reports = extract_reports_from_pdf(pdf_path)

        if not reports:
            self.logger.warning("No se extrajeron reportes del PDF")
            return []

        # --- Excel output ---
        excel_updater = None
        if self.excel_path:
            try:
                excel_updater = ExcelUpdater(self.excel_path).load()
            except Exception as e:
                self.logger.warning(f"No se pudo abrir Excel ({self.excel_path}): {e}")

        # --- Google Sheets output ---
        sheets_updater = None
        try:
            sheets_updater = self._build_sheets_updater()
        except Exception as e:
            self.logger.warning(f"No se pudo conectar a Google Sheets: {e}")

        for report in reports:
            for entry in report.entries:
                if excel_updater:
                    success, msg = excel_updater.find_and_write_entry(
                        entry.vehicle.name, entry
                    )
                    tag = "Excel OK" if success else f"Excel skip ({msg})"
                    self.logger.info(f"{entry.vehicle.name} [{entry.date}] → {tag}")

                if sheets_updater:
                    success, msg = sheets_updater.find_and_write_entry(
                        entry.vehicle.name, entry
                    )
                    tag = "Sheets OK" if success else f"Sheets skip ({msg})"
                    self.logger.info(f"{entry.vehicle.name} [{entry.date}] → {tag}")

        if excel_updater:
            excel_updater.save()

        self.logger.info(f"Procesados {len(reports)} reportes del PDF")

        return reports
