import os
import json
from typing import Optional
from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from google_auth_oauthlib.flow import InstalledAppFlow


SCOPES = [
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/gmail.modify',
]


class GmailAuthError(Exception):
    pass


class GmailAuthManager:
    def __init__(
        self,
        token_path: str = ".tokens.json",
        credentials_path: str = "credentials.json"
    ):
        self.token_path = token_path
        self.credentials_path = credentials_path
        self.credentials: Optional[Credentials] = None

    def load_credentials(self) -> Credentials:
        if os.path.exists(self.token_path):
            with open(self.token_path, 'r') as f:
                creds_data = json.load(f)

            self.credentials = Credentials.from_authorized_user_info(creds_data, SCOPES)

            if self.credentials.expired and self.credentials.refresh_token:
                self.credentials.refresh(Request())

        return self.credentials

    def save_credentials(self, credentials: Credentials):
        with open(self.token_path, 'w') as f:
            creds_dict = {
                'token': credentials.token,
                'refresh_token': credentials.refresh_token,
                'token_uri': credentials.token_uri,
                'client_id': credentials.client_id,
                'client_secret': credentials.client_secret,
                'scopes': list(credentials.scopes)
            }
            json.dump(creds_dict, f)

    def get_credentials(self) -> Credentials:
        if not self.credentials:
            self.credentials = self.load_credentials()

        if not self.credentials or not self.credentials.valid:
            if os.path.exists(self.credentials_path):
                flow = InstalledAppFlow.from_client_secrets_file(
                    self.credentials_path, SCOPES
                )
                self.credentials = flow.run_local_server(port=0)
                self.save_credentials(self.credentials)
            else:
                raise GmailAuthError(f"No se encontró {self.credentials_path}")

        return self.credentials

    def get_auth_url(self) -> str:
        flow = InstalledAppFlow.from_client_secrets_file(
            self.credentials_path, SCOPES
        )
        return flow.authorization_url(prompt='consent')[0]

    def authenticate_from_code(self, code: str):
        flow = InstalledAppFlow.from_client_secrets_file(
            self.credentials_path, SCOPES
        )
        self.credentials = flow.run_local_server(code=code)
        self.save_credentials(self.credentials)