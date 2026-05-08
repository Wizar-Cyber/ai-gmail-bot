import os
from typing import Optional
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload
import io
from ..models.report import EmailAttachment
import logging

logger = logging.getLogger(__name__)


class GmailClientError(Exception):
    pass


class GmailClient:
    def __init__(self, credentials):
        self.service = build('gmail', 'v1', credentials=credentials)

    def search_messages(self, query: str, max_results: int = 10) -> list[dict]:
        results = self.service.users().messages().list(
            userId='me',
            q=query,
            maxResults=max_results
        ).execute()
        return results.get('messages', [])

    def get_message(self, message_id: str) -> dict:
        return self.service.users().messages().get(
            userId='me',
            id=message_id
        ).execute()

    def get_message_metadata(self, message_id: str) -> dict:
        msg = self.get_message(message_id)
        headers = msg.get('payload', {}).get('headers', [])
        subject = from_email = ""
        for header in headers:
            if header['name'] == 'Subject':
                subject = header['value']
            if header['name'] == 'From':
                from_email = header['value']
        return {
            'id': msg['id'],
            'subject': subject,
            'from': from_email,
            'date': msg.get('internalDate'),
            'snippet': msg.get('snippet', '')
        }

    def get_attachments(self, message_id: str, output_dir: str = "data") -> list[EmailAttachment]:
        attachments = []
        os.makedirs(output_dir, exist_ok=True)
        msg = self.get_message(message_id)
        parts = msg.get('payload', {}).get('parts', [])

        def process_parts(parts):
            for part in parts:
                if part.get('filename'):
                    filename = part['filename']
                    mime_type = part.get('mimeType', 'application/octet-stream')
                    body = part.get('body', {})
                    attachment_id = body.get('attachmentId')
                    if attachment_id:
                        local_path = self._download_attachment(message_id, attachment_id, filename, output_dir)
                        attachment = EmailAttachment(
                            id=attachment_id,
                            filename=filename,
                            mime_type=mime_type,
                            size=body.get('size', 0),
                            local_path=local_path
                        )
                        attachments.append(attachment)
                if part.get('parts'):
                    process_parts(part['parts'])

        process_parts(parts)
        return attachments

    def _download_attachment(self, message_id: str, attachment_id: str, filename: str, output_dir: str) -> Optional[str]:
        try:
            response = self.service.users().messages().attachments().get(
                userId='me',
                messageId=message_id,
                id=attachment_id
            ).execute()
            file_data = response.get('data')
            if not file_data:
                return None
            file_path = os.path.join(output_dir, filename)
            with open(file_path, 'wb') as f:
                f.write(io.Base64DecodingIO(file_data).read())
            logger.info(f"Descargado: {filename}")
            return file_path
        except Exception as e:
            logger.error(f"Error descargando {filename}: {e}")
            return None

    def mark_as_read(self, message_id: str):
        self.service.users().messages().modify(
            userId='me',
            id=message_id,
            body={'removeLabelIds': ['UNREAD']}
        ).execute()