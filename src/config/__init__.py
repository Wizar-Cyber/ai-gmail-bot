import os
from pathlib import Path

BASE_DIR = Path(__file__).parent.parent

EXCEL_PATH = os.getenv("EXCEL_PATH", "KILOMETRAJE Y DEPRECIACION VEHICULOS 2026 (1).xlsx")
DATA_DIR = os.getenv("DATA_DIR", "data")
LOGS_DIR = os.getenv("LOGS_DIR", "logs")
DB_PATH = os.getenv("DB_PATH", "data/processed.db")

GMAIL_QUERY = os.getenv("GMAIL_QUERY", "subject:(rapport OR kilométrique OR kilometraj) has:attachment")
MAX_EMAILS = int(os.getenv("MAX_EMAILS", "10"))

SCOPES = [
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/gmail.modify',
]

TOKEN_PATH = ".tokens.json"
CREDENTIALS_PATH = "credentials.json"