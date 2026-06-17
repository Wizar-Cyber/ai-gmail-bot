from datetime import datetime
from typing import Optional
import logging
from .auth import GmailAuthManager
from .client import GmailClient
from ..models.report import ProcessingResult
from ..pdf.extractor import extract_reports_from_pdf, validate_report

logger = logging.getLogger(__name__)

DEFAULT_QUERY = "subject:(rapport OR kilométrique OR kilometraj OR reporte) has:attachment"


class GmailService:
    def __init__(self, auth_manager: GmailAuthManager):
        self.auth_manager = auth_manager
        self.client: Optional[GmailClient] = None

    def connect(self):
        credentials = self.auth_manager.get_credentials()
        self.client = GmailClient(credentials)
        return self

    def search_emails(
        self,
        query: str = DEFAULT_QUERY,
        max_results: int = 10
    ) -> list[dict]:
        if not self.client:
            self.connect()
        return self.client.search_messages(query, max_results)

    def get_email_metadata(self, message_id: str) -> dict:
        if not self.client:
            raise RuntimeError("Cliente Gmail no conectado")
        return self.client.get_message_metadata(message_id)

    def download_attachments(
        self,
        message_id: str,
        output_dir: str = "data"
    ) -> list:
        if not self.client:
            raise RuntimeError("Cliente Gmail no conectado")
        return self.client.get_attachments(message_id, output_dir)

    def mark_email_processed(self, message_id: str):
        if not self.client:
            raise RuntimeError("Cliente Gmail no conectado")
        self.client.mark_as_read(message_id)

    def process_email(
        self,
        message_id: str,
        excel_path: str,
        output_dir: str = "data"
    ) -> ProcessingResult:
        start_time = datetime.now()
        result = ProcessingResult(
            success=False,
            email_id=message_id
        )

        try:
            metadata = self.get_email_metadata(message_id)
            result.email_id = message_id

            logger.info(f"Procesando email: {metadata.get('subject') or 'Sin asunto'}")

            attachments = self.download_attachments(message_id, output_dir)
            result.attachments = [a.filename for a in attachments if a.is_pdf()]

            if not result.attachments:
                result.warnings.append("No se encontraron PDFs adjuntos")
                return result

            for attachment in attachments:
                if attachment.is_pdf() and attachment.local_path:
                    try:
                        reports = extract_reports_from_pdf(attachment.local_path)
                        result.reports.extend(reports)

                        for report in reports:
                            warnings = validate_report(report)
                            result.warnings.extend(warnings)

                    except Exception as e:
                        result.errors.append(f"Error parseando {attachment.filename}: {str(e)}")

            if result.reports:
                from ..excel.writer import ExcelUpdater
                updater = ExcelUpdater(excel_path).load()

                for report in reports:
                    for entry in report.entries:
                        success, msg = updater.find_and_write_entry(
                            entry.vehicle.name,
                            entry
                        )
                        if not success:
                            result.warnings.append(f"{entry.vehicle.name}: {msg}")

                updater.save()

            result.success = len(result.errors) == 0
            self.mark_email_processed(message_id)

        except Exception as e:
            result.errors.append(f"Error general: {str(e)}")
            logger.exception("Error en process_email")

        result.duration_seconds = (datetime.now() - start_time).total_seconds()
        return result