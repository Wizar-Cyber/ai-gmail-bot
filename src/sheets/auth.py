import gspread
from google.oauth2.service_account import Credentials

SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive.readonly",
]


class SheetsAuthManager:
    def __init__(self, service_account_file: str):
        self.service_account_file = service_account_file
        self._client: gspread.Client | None = None

    def get_client(self) -> gspread.Client:
        if self._client is None:
            creds = Credentials.from_service_account_file(
                self.service_account_file, scopes=SCOPES
            )
            self._client = gspread.authorize(creds)
        return self._client

    def open_spreadsheet(self, spreadsheet_id: str) -> gspread.Spreadsheet:
        return self.get_client().open_by_key(spreadsheet_id)
