# RECOMENDACIONES PARA IMPLEMENTACIÓN

## 1. MIGRACIÓN A GOOGLE SHEETS (RECOMENDADO)

### ¿Por qué Google Sheets en lugar de Excel?

| Aspecto | Excel Local | Google Sheets |
|---------|-------------|---------------|
| Concurrencia |❌ Problemas con escrituras simultáneas| ✅ API estable|
| Disponibilidad |❌ Solo una máquina | ✅ Acceso múltiple|
| Versionado |❌ No nativo | ✅ Historial automático|
| API |❌ Complejo | ✅ gspread simple|
| Errors |❌ Se corrompe | ✅ Recover auto|

### Instalación

```bash
pip install gspread google-auth
```

### Código actual (Excel)

```python
from src.excel.writer import ExcelUpdater
updater = ExcelUpdater("archivo.xlsx").load()
```

### Código sugerido (Google Sheets)

```python
import gspread
from google.oauth2.service_account import Credentials

class GoogleSheetsClient:
    def __init__(self, credentials_path: str, spreadsheet_id: str):
        scope = [
            'https://spreadsheets.google.com/feeds',
            'https://www.googleapis.com/auth/drive'
        ]
        self.credentials = Credentials.from_service_account_file(credentials_path, scopes=scope)
        self.gc = gspread.authorize(self.credentials)
        self.spreadsheet = self.gc.open_by_key(spreadsheet_id)

    def get_worksheet(self, title: str):
        return self.spreadsheet.worksheet(title)

    def append_row(self, sheet_title: str, values: list):
        ws = self.get_worksheet(sheet_title)
        ws.append_row(values)

    def update_cell(self, sheet_title: str, row: int, col: int, value):
        ws = self.get_worksheet(sheet_title)
        ws.update_cell(row, col, value)
```

## 2. PASOS PARA PROBAR EL SISTEMA

### Paso 1: Instalar dependencias

```bash
pip install -r requirements.txt
```

### Paso 2: Ejecutar tests

```bash
pytest tests/ -v
```

### Paso 3: Probar con PDF local

```bash
python src/main.py --pdf "Rapport kilométrique(20260423-20260423).pdf"
```

### Paso 4: Probar con Gmail

```bash
# Verificar credenciales
python -c "from src.gmail.auth import GmailAuthManager; print(GmailAuthManager().get_auth_url())"

# Procesar emails
python src/main.py --max-emails 5
```

## 3. ESTRUCTURA DE CREDENTIALS

### Google Cloud Console

1. Crear proyecto
2. Habilitar Gmail API y Sheets API
3. Crear OAuth Client ID (Desktop App)
4. Descargar `credentials.json`

### Para Sheets adicional

```python
# credentials.json debe incluir:
{
  "type": "service_account",
  "project_id": "...",
  "private_key_id": "...",
  "private_key": "...",
  "client_email": "...@gserviceaccount.com",
  ...
}
```

## 4. MEJORAS SUGERIDAS

### A) Monitoreo con Slack/Discord

```python
import requests

def send_alert(message: str, webhook_url: str):
    requests.post(webhook_url, json={"text": message})
```

### B) Métricas con Prometheus

```python
from prometheus_client import Counter, Histogram

processed_emails = Counter('processed_emails_total', 'Total emails processed')
processing_time = Histogram('processing_seconds', 'Processing time')
```

### C) Retry con exponential backoff

```python
from src.utils.retry import retry_with_backoff

@retry_with_backoff(max_retries=3)
def process_email_safe(email_id: str):
    return process_email(email_id)
```

### D) Notificaciones por email de errores

```python
import smtplib
from email.mime.text import MIMEText

def send_error_email(error: str):
    msg = MIMEText(error)
    msg['Subject'] = 'Error en pipeline km'
    # configurar SMTP
```

## 5. ARQUITECTURA FINAL SUGERIDA

```
ai-gmail-bot/
├── src/
│   ├── main.py
│   ├── pipeline.py
│   │
│   ├── gmail/           # Gmail API
│   ├── pdf/             # PDF parsing
│   ├── sheets/          # Google Sheets (nuevo)
│   ├── models/
│   ├── normalization/
│   ├── storage/
│   ├── monitoring/      # Métricas
│   └── notifications/   # Alertas
│
├── docker-compose.yml   # Orquestación
├── .env                 # Variables ambiente
└── credentials/
    ├── gmail.json       # OAuth Gmail
    └── sheets.json      # Service Account
```

## 6. PRÁCTICAS RECOMENDADAS

### Para producción

1. **Dockerizar** todo el sistema
2. **CI/CD** con GitHub Actions
3. **Logs** en CloudWatch/Stackdriver
4. **Alarmas** cuando falla más de X%
5. **Tests覆盖率 > 80%**

### Para empezar

1. ✅ Probar con PDF local
2. ✅ Probar con un email
3. ✅ Verificar datos en Excel
4. ✅ Automatizar con cron/scheduler
5. 📌 Migrar a Google Sheets

## 7. SCHEDULER

```python
# scheduler.py
import schedule
import time

def run_pipeline():
    from src.pipeline import KilometerPipeline
    pipeline = KilometerPipeline(excel_path="...")
    pipeline.run(max_emails=5)

schedule.every().day.at("09:00").do(run_pipeline)

while True:
    schedule.run_pending()
    time.sleep(60)
```

## 8. VARIABLES DE ENTORNO RECOMENDADAS

```env
# .env
EXCEL_PATH=KILOMETRAJE Y DEPRECIACION VEHICULOS 2026 (1).xlsx
GMAIL_QUERY=subject:(rapport OR kilométrique) has:attachment
MAX_EMAILS=10
DATA_DIR=data
LOGS_DIR=logs

# Google
SPREADSHEET_ID=1abc123...
SHEETS_CREDENTIALS=credentials/sheets.json
```

¿Querés que genere el código completo de Google Sheets integration?