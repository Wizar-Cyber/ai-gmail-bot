# SPEC: Sistema de Automatización de Reportes Kilométricos

## 1. ARQUITECTURA GENERAL

```
project/
├── src/
│   ├── main.py                 # Entry point
│   ├── pipeline.py             # Orquestador principal
│   │
│   ├── gmail/                  # Módulo Gmail
│   │   ├── __init__.py
│   │   ├── auth.py             # Autenticación OAuth2
│   │   ├── client.py           # Cliente Gmail
│   │   ├── service.py          # Lógica de negocio Gmail
│   │   └── filters.py          # Filtros de emails
│   │
│   ├── pdf/                    # Módulo PDF
│   │   ├── __init__.py
│   │   ├── extractor.py        # Extracción de texto
│   │   ├── parser.py           # Parsing de datos
│   │   └── validator.py        # Validación de datos
│   │
│   ├── excel/                  # Módulo Excel
│   │   ├── __init__.py
│   │   ├── reader.py           # Lectura Excel
│   │   ├── writer.py           # Escritura segura
│   │   ├── finder.py           # Búsqueda de celdas
│   │   └── formulas.py        # Preservación de fórmulas
│   │
│   ├── models/                 # Modelos de datos
│   │   ├── __init__.py
│   │   ├── vehicle.py          # Entidades vehículo
│   │   ├── report.py           # Reportes
│   │   └── dto.py              # Data Transfer Objects
│   │
│   ├── normalization/          # Normalización
│   │   ├── __init__.py
│   │   ├── numbers.py         # Normalización números
│   │   ├── dates.py           # Normalización fechas
│   │   └── vehicles.py        # Normalización nombres vehículos
│   │
│   ├── storage/                # Almacenamiento
│   │   ├── __init__.py
│   │   ├── database.py        # SQLite para tracking
│   │   └── cache.py           # Cache de procesamiento
│   │
│   ├── logging/                # Logging
│   │   ├── __init__.py
│   │   ├── setup.py           # Configuración
│   │   └── formatters.py      # Formateadores
│   │
│   └── config/                 # Configuración
│       ├── __init__.py
│       ├── settings.py        # Settings
│       └── constants.py       # Constantes
│
├── tests/
│   ├── test_pdf_parser.py
│   ├── test_normalization.py
│   ├── test_excel_writer.py
│   └── fixtures/
│
├── logs/                       # Directorio de logs
├── data/                       # PDFs descargados
└── requirements.txt
```

## 2. MODELOS DE DATOS

### 2.1 Vehicle (Entidad)
```python
@dataclass
class Vehicle:
    name: str           # "MERCEDES E200"
    plate: str          # "JSZ167"
    normalize_name: str # "mercedes_e200"
    excel_sheet: str    # "MERCEDES E 200 JSZ167"
```

### 2.2 DailyEntry (Registro diario)
```python
@dataclass
class DailyEntry:
    date: date
    vehicle: Vehicle
    kilometers: float
    speed_excess_minutes: int
    parking_minutes: int
    fuel_liters: float
    raw_data: dict      # Para debugging
```

### 2.3 VehicleReport (Reporte completo)
```python
@dataclass
class VehicleReport:
    vehicle: Vehicle
    entries: List[DailyEntry]
    total_km: float
    total_fuel: float
    source_file: str
    processed_at: datetime
```

### 2.4 ProcessingResult (Resultado de procesamiento)
```python
@dataclass
class ProcessingResult:
    success: bool
    email_id: str
    attachments: List[str]
    reports: List[VehicleReport]
    errors: List[str]
    warnings: List[str]
    duration_seconds: float
```

## 3. PIPELINE PRINCIPAL

```
┌─────────────────────────────────────────────────────────────────┐
│                    PIPELINE DE PROCESAMIENTO                    │
└─────────────────────────────────────────────────────────────────┘

1. GMAIL SERVICE
   │
   ├─► auth.py          → OAuth2 credentials
   ├─► client.py        → Google API client
   ├─► filters.py       → q: "subject:rapport OR subject:kilométrik"
   │
   ▼
2. EMAIL PROCESSING
   │
   ├─► Descargar emails no leídos
   ├─► Filtrar por asunto/patrón
   ├─► Identificar PDFs adjuntos
   ├─► Descargar a data/
   │
   ▼
3. PDF EXTRACTION
   │
   ├─► extractor.py     → pdfplumber/PyMuPDF
   ├─► parser.py       → Regex patterns
   │                      "Appareil:VEHÍCULO - PLACA"
   │                      "1 2026-04-23 114.962 0 28 9.2"
   │
   ▼
4. NORMALIZATION
   │
   ├─► numbers.py       → Manejar formatos:
   │                      "114.962" → 114.962
   │                      "31.902,000" → 31.902
   │                      "4.412,00" → 4.412
   │                      "0,00" → 0.0
   │
   ├─► dates.py         → Normalizar fechas:
   │                      "2026-04-23" → date(2026,4,23)
   │                      "16/4/2026" → date(2026,4,16)
   │
   ├─► vehicles.py      → Fuzzy matching:
   │                      "MERCEDES E200 - JSZ167"
   │                      → "MERCEDES E 200 JSZ167" (hoja Excel)
   │
   ▼
5. EXCEL UPDATE
   │
   ├─► finder.py        → Encontrar hoja por nombre aproximado
   ├─► Búsqueda de fila por fecha
   ├─► writer.py        → Escribir sin romper fórmulas
   ├─► Verificar duplicados (same date + vehicle + km)
   │
   ▼
6. LOGGING & STORAGE
   │
   ├─► SQLite: tracking de procesados
   ├─► Logs rotación daily
   └─► Reporte de errores
```

## 4. ESTRATEGIA DE PARSING PDF

### 4.1 Estructura del PDF (según descripción)
```
Appareil:MERCEDES E200 - JSZ167
Consommation du véhicule : 8 L/100KM

1 2026-04-23 114.962 0 28 9.2

Total 114.962 0 28 9.2
```

### 4.2 Patrones Regex
```python
# Extraer vehículo y placa
VEHICLE_PATTERN = r"Appareil:\s*([A-ZÀÈÌÒÙÁÉÍÓÚÑ\s]+)\s*-\s*([A-Z0-9]+)"

# Extraer fila de datos (número, fecha, km, exceso, estacionamiento, combustible)
# Formato: "1 2026-04-23 114.962 0 28 9.2" o "1 2026-04-23 114.962 0 28 9.2"
DATA_ROW_PATTERN = r"^\d+\s+(\d{4}-\d{2}-\d{2})\s+([\d.,]+)\s+(\d+)\s+(\d+)\s+([\d.,]+)"

# Ignorar línea "Total"
TOTAL_LINE_IGNORED = "^Total"
```

### 4.3 Algoritmo de Extracción
```python
def extract_from_pdf(filepath: str) -> List[VehicleReport]:
    reports = []

    with pdfplumber.open(filepath) as pdf:
        text = extract_all_text(pdf)

    # Dividir por vehículo
    vehicle_sections = split_by_vehicle(text)

    for section in vehicle_sections:
        vehicle = parse_vehicle_header(section)
        entries = parse_data_rows(section)
        reports.append(VehicleReport(vehicle, entries))

    return reports
```

## 5. ESTRATEGIA DE NORMALIZACIÓN DE NÚMEROS

### 5.1 Problemas identificados
| Input | Output esperado |
|-------|-----------------|
| `114.962` | `114.962` |
| `31.902,000` | `31.902` |
| `4.412,00` | `4.412` |
| `0.263` | `0.263` |
| `0,00` | `0.0` |
| `45.477` | `45.477` |
| `1587` | `1587` |

### 5.2 Algoritmo
```python
def normalize_number(value: str) -> float:
    value = value.strip()

    # Si tiene coma como decimal (formato europeo)
    # "31.902,000" o "4,00" o "0,00"
    if ',' in value:
        # Si tiene punto Y coma: punto es miles, coma es decimal
        if '.' in value:
            value = value.replace('.', '').replace(',', '.')
        else:
            value = value.replace(',', '.')
    # Si es número simple
    elif value.replace('.', '').isdigit():
        pass

    try:
        return float(value)
    except ValueError:
        raise NumberFormatError(f"No se pudo parsear: {value}")

# Casos especiales:
# "31.902,000" -> "31902,000" -> "31902.000" -> 31902.0
# "4.412,00"   -> "4412,00"   -> "4412.00"   -> 4412.0
```

## 6. ESTRATEGIA EXCEL

### 6.1 Estructura de hojas
```
TOTAL Y RESUM 2026  (resumen global)
MERCEDES E 200 JSZ167
MERCEDES GLE450
MERCEDES C200C 
AUDI Q3 JXV974,
AUDI Q8
TOYOTA TXL
```

### 6.2 Algoritmo de búsqueda
```python
class ExcelFinder:
    def find_vehicle_sheet(self, wb, vehicle_name: str) -> Optional[Worksheet]:
        """Encuentra la hoja del vehículo con fuzzy matching"""
        normalize = lambda s: re.sub(r'[\s,]+', '', s.lower())

        target = normalize(vehicle_name)
        for sheet_name in wb.sheetnames:
            if normalize(sheet_name) == target:
                return wb[sheet_name]

        # Fuzzy: buscar coincidencia parcial
        for sheet_name in wb.sheetnames:
            if normalize(vehicle_name) in normalize(sheet_name):
                return wb[sheet_name]

        return None

    def find_date_row(self, sheet, target_date: date) -> Optional[int]:
        """Encuentra la fila corresponding a la fecha"""
        for row in range(5, 40):  # Rango típico de datos
            cell_date = sheet.cell(row, 1).value
            if isinstance(cell_date, datetime):
                if cell_date.date() == target_date:
                    return row
            elif isinstance(cell_date, str):
                # Parsear formato texto
                parsed = parse_date(cell_date)
                if parsed == target_date:
                    return row
        return None

    def find_column_index(self, sheet, headers: List[str]) -> Dict[str, int]:
        """Mapea headers a índices de columna"""
        mapping = {}
        for col in range(1, 10):
            header = sheet.cell(3, col).value  # Fila típica de headers
            if header in headers:
                mapping[header] = col
        return mapping
```

### 6.3 Escritura segura (preservar fórmulas)
```python
class ExcelWriter:
    def safe_write(self, sheet, row: int, col: int, value):
        """Escribe valor sin afectar fórmulas"""
        cell = sheet.cell(row, col)

        # Preservar fórmulas existentes
        if cell.data_type == 'f':
            # No sobreescribir celdas con fórmulas
            pass

        cell.value = value

    def update_totals(self, sheet):
        """Actualiza fila TOTAL sin romper fórmulas"""
        # Los totales se calculan automáticamente
        # Solo actualizar celdas de datos
        pass

    def check_duplicate(self, sheet, vehicle: str, date: date, km: float) -> bool:
        """Verifica si ya existe el registro"""
        for row in range(5, 40):
            if sheet.cell(row, 1).value == date:
                if sheet.cell(row, 2).value == km:
                    return True  # Duplicado
        return False
```

## 7. MANEJO DE ERRORES

### 7.1 Tipos de errores
```python
class ProcessingError(Exception):
    """Error general de procesamiento"""
    pass

class EmailNotFoundError(ProcessingError):
    """Email no encontrado"""
    pass

class PDFParseError(ProcessingError):
    """Error al parsear PDF"""
    pass

class ExcelWriteError(ProcessingError):
    """Error al escribir en Excel"""
    pass

class VehicleNotFoundError(ProcessingError):
    """Vehículo no encontrado en Excel"""
    pass

class DuplicateEntryError(ProcessingError):
    """Registro duplicado"""
    pass
```

### 7.2 Logging estructurado
```python
import logging
from datetime import datetime

logger = logging.getLogger("km_automation")

# Formato: [2026-05-07 10:30:45] [ERROR] [email:123] mensaje
class StructuredFormatter(logging.Formatter):
    def format(self, record):
        record.email_id = getattr(record, 'email_id', 'N/A')
        return super().format(record)

# Niveles:
# INFO: Procesamiento exitoso
# WARNING: Datos incompletos, vehículo no encontrado
# ERROR: Fallo crítico
```

## 8. TRACKING DE PROCESADOS (SQLite)

```python
# Tabla: processed_emails
CREATE TABLE processed_emails (
    id INTEGER PRIMARY KEY,
    email_id TEXT UNIQUE,
    subject TEXT,
    processed_at TIMESTAMP,
    attachments_count INTEGER,
    reports_count INTEGER,
    status TEXT,  -- 'success', 'partial', 'error'
    error_message TEXT
);

# Tabla: daily_entries
CREATE TABLE daily_entries (
    id INTEGER PRIMARY KEY,
    vehicle_plate TEXT,
    entry_date DATE,
    kilometers REAL,
    speed_excess INTEGER,
    parking_time INTEGER,
    fuel REAL,
    source_file TEXT,
    created_at TIMESTAMP,
    UNIQUE(vehicle_plate, entry_date, kilometers)
);
```

## 9. CONFIGURACIÓN

```python
# config/settings.py
class Settings:
    # Gmail
    SCOPES = [
        'https://www.googleapis.com/auth/gmail.readonly',
        'https://www.googleapis.com/auth/gmail.modify'
    ]

    # Filtros de email
    EMAIL_QUERY = "subject:(rapport OR kilométrique ORkilometraj) has:attachment"

    # Paths
    EXCEL_PATH = "KILOMETRAJE Y DEPRECIACION VEHICULOS 2026 (1).xlsx"
    DATA_PATH = "data/"
    LOGS_PATH = "logs/"

    # Normalización
    FUZZY_MATCH_THRESHOLD = 0.8

    # Processing
    MAX_RETRIES = 3
    BATCH_SIZE = 10
```

## 10. MEJORAS SUGERIDAS

### 10.1 Sobre el Excel actual

**Problemas identificados:**
- Excel puede corromperse con escrituras concurrentes
- Fórmulas pueden romperse
- No hay versionado

**Alternativas:**

| Opción | Ventajas | Desventajas |
|--------|----------|-------------|
| **Google Sheets API** | Colaborativo, API estable | Requiere cuenta Google |
| **SQLite** | Rápido, fiable, versionado | Requiere migración |
| **PostgreSQL** | Producción, escalable | Overkill para este caso |
| **Excel + Git** | Versionado manual | Complejo |

**Recomendación:** Google Sheets API para integración directa y colaboración.

### 10.2 Arquitectura alternativa con Google Sheets

```python
# instead of openpyxl
import gspread
from google.oauth2.service_account import Credentials

class GoogleSheetsWriter:
    def __init__(self, credentials_path: str):
        scope = ['https://spreadsheets.google.com/feeds']
        self.gc = gspread.authorize(credentials)
        self.sh = self.gc.open_by_key(SPREADSHEET_ID)

    def append_row(self, sheet_name: str, values: List):
        ws = self.sh.worksheet(sheet_name)
        ws.append_row(values)
```

## 11. CÓDIGO BASE

Ver archivos generados en `src/`

## 12. CONSIDERACIONES FINALES

1. **Persistencia**: Usar SQLite para tracking, no depender solo del Excel
2. **Idempotencia**: Mismo email no debe procesarse dos veces
3. **Retry**: 3 intentos con backoff exponencial
4. **Monitoreo**: Logs estructurados + métricas
5. **Testing**: Tests unitarios para parser, normalización, Excel finder