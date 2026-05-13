# Arquitectura del Sistema — AI Gmail Bot

## 1. Visión General

El sistema está compuesto por **dos subsistemas independientes** que comparten el mismo repositorio:

```
┌─────────────────────────────────────────────────────────────────────┐
│                      AI GMAIL BOT (TypeScript)                      │
│  Express server · Polling · Webhook · AI drafts · RAG · Pipeline   │
│                       Bridge                                        │
├─────────────────────────────────────────────────────────────────────┤
│                  PIPELINE KILOMETRAJE (Python)                      │
│  PDF extraction · Google Sheets · Excel · PostgreSQL · Fuzzy match  │
└─────────────────────────────────────────────────────────────────────┘
```

### 1.1 Subsistema TypeScript

Servidor Express que:
- Lee correos de Gmail vía polling o webhook Pub/Sub
- Genera borradores de respuesta con IA (Gemini/OpenAI)
- Detecta PDFs adjuntos y ejecuta el pipeline Python
- Persiste estado (tokens OAuth, watch state, mensajes procesados)

### 1.2 Subsistema Python (Kilometraje)

Pipeline que:
- Extrae datos de PDFs "Rapport kilométrique" (Quebec)
- Escribe en Google Sheets (kilometraje + ingresos/gastos)
- Almacena en PostgreSQL/SQLite
- Actualiza fórmulas de resumen mensual

---

## 2. Diagrama de Arquitectura

```
                    ┌──────────────────────┐
                    │     Gmail API         │
                    │  (OAuth 2.0)          │
                    └──────┬───────────────┘
                           │
              ┌────────────┴────────────┐
              │                         │
       Polling (30s)           Pub/Sub Webhook
              │                         │
              └────────────┬────────────┘
                           │
                    ┌──────▼──────┐
                    │   Express   │
                    │   Server    │
                    │  (port 3001)│
                    └──────┬──────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
        ┌─────▼─────┐ ┌───▼────┐ ┌────▼─────┐
        │ AI Service │ │ RAG    │ │ Pipeline │
        │(Gemini/   │ │ Service│ │ Bridge   │
        │ OpenAI)   │ │ (FAQ)  │ │ (spawn)  │
        └───────────┘ └────────┘ └────┬─────┘
                                      │
                           ┌──────────▼──────────┐
                           │   Python Pipeline   │
                           │  (subprocess)        │
                           └──────────┬──────────┘
                                      │
              ┌───────────────────────┼───────────────────────┐
              │                       │                       │
        ┌─────▼──────┐        ┌───────▼──────┐        ┌──────▼─────┐
        │ PDF        │        │ Google       │        │ PostgreSQL │
        │ Extractor  │        │ Sheets       │        │ / SQLite   │
        │(pdfplumber)│        │ (gspread)    │        │(SQLAlchemy)│
        └────────────┘        └──────────────┘        └────────────┘
```

---

## 3. Flujo de Datos

### 3.1 Procesamiento de Email (Ciclo Principal)

```
1. Llega email a Gmail
2. Polling cada 30s detecta mensajes no leídos
3. Filtra mensajes ya procesados (processed-messages.json)
4. Por cada mensaje nuevo:

   a. getPdfAttachments() → ¿tiene PDFs?
      ├── NO → log "sin PDFs adjuntos"
      └── SÍ → saveAttachment() → spawn pipeline Python
               ├── pipeline extrae datos del PDF
               ├── escribe en Google Sheets (km, exceso, etc.)
               ├── guarda en PostgreSQL
               └── actualiza fórmulas de resumen

   b. enrichContext() → RAG sobre FAQ
   c. generateReply() → IA genera borrador
   d. createDraftReply() → guarda borrador en Gmail
   e. saveProcessedId() → marca como procesado
```

### 3.2 Flujo del Pipeline Python (PDF → Sheets)

```
PDF (Rapport kilométrique)
    │
    ▼
pdfplumber.open() → extrae texto
    │
    ▼
split_vehicle_sections() → separa por vehículo
    │
    ▼
parse_data_rows() → extrae: fecha, km, exceso, parking, combustible
    │
    ▼
Por cada entrada del vehículo:
    ├── SheetsUpdater.find_and_write_entry()
    │   ├── find_vehicle_sheet() → busca hoja por nombre
    │   ├── find_date_row() → busca/inserta fila por fecha
    │   ├── batch_update() → escribe km, exceso, parking, combustible
    │   └── detecta duplicados (mismo km en misma fecha)
    │
    ├── IngresosSheetUpdater.find_and_write_note() (opcional)
    │
    └── Database.save_entry() / save_income_entry()
```

### 3.3 Búsqueda de Fila por Fecha (Google Sheets)

```
find_date_row(target_date):
    1. Escanea TODAS las filas del sheet
    2. Por cada celda en columna FECHA:
       ├── ¿Coincide exactamente con target_date? → return row
       └── No → guarda en lista de fechas ordenadas
    3. Si no encontró coincidencia exacta:
       ├── Busca primera fecha > target_date en la lista
       │   └── insertDimension() → inserta fila vacía → return
       └── Si target_date > todas las fechas → append al final
```

---

## 4. Stack Tecnológico

| Componente | Tecnología | Versión |
|---|---|---|
| Servidor Web | Express (Node.js) | 4.x |
| Lenguaje (Bot) | TypeScript | 5.4 |
| Lenguaje (Pipeline) | Python | 3.12 |
| Base de Datos | PostgreSQL 16 / SQLite | SQLAlchemy 2.0 |
| Google Sheets | gspread | 6.x |
| PDF | pdfplumber | 0.10 |
| IA | Gemini 2.5 Flash / GPT-4o | - |
| Contenedores | Docker + Compose | - |
| OAuth | googleapis (Node) | 171.x |

---

## 5. Estructura de Directorios

```
ai-gmail-bot/
│
├── src/                          # Código fuente
│   ├── server.ts                 # Entry point (Express HTTP)
│   ├── app.ts                    # Configuración Express
│   ├── main.py                   # Entry point (Python CLI)
│   ├── pipeline.py               # Orquestador Python
│   │
│   ├── config/                   # Configuración
│   │   ├── env.ts                # Variables de entorno
│   │   └── oauth.config.ts       # Cliente OAuth2
│   │
│   ├── routes/                   # API endpoints
│   │   ├── auth.route.ts         # OAuth flow
│   │   ├── webhook.route.ts      # Pub/Sub handler
│   │   ├── watch.route.ts        # Gmail watch CRUD
│   │   └── sheets.route.ts       # Resumen formulas
│   │
│   ├── middlewares/              # Express middlewares
│   │   └── webhook.middleware.ts # Validación Pub/Sub token
│   │
│   ├── services/                 # Lógica de negocio
│   │   ├── gmail.service.ts      # Wrapper Gmail API
│   │   ├── ai.service.ts         # Strategy Pattern IA
│   │   ├── pipeline-bridge.service.ts  # Bridge TS→Python
│   │   ├── polling.service.ts    # Polling automático
│   │   └── email-processor.service.ts  # Procesamiento email
│   │
│   ├── repositories/            # Persistencia
│   │   ├── token.repository.ts  # OAuth tokens (file)
│   │   └── watch.repository.ts  # Watch state (file)
│   │
│   ├── rag/                     # RAG FAQ
│   │   ├── rag.service.ts       # Keyword matching
│   │   └── faq.json             # Preguntas frecuentes
│   │
│   ├── utils/                   # Utilidades
│   │   ├── errors.ts            # Jerarquía de errores
│   │   ├── logger.ts            # Winston + correlation ID
│   │   ├── parser.util.ts       # Parseo MIME Gmail
│   │   ├── retry.ts             # Exponential backoff
│   │   └── exec.ts              # spawn wrapper
│   │
│   ├── sheets/                  # Google Sheets (km)
│   │   ├── auth.py              # Service Account auth
│   │   ├── finder.py            # SheetsFinder, RowFinder
│   │   ├── writer.py            # SheetsUpdater
│   │   └── summary.py           # SummaryUpdater (fórmulas)
│   │
│   ├── sheets_ingresos/         # Google Sheets (ingresos)
│   │   ├── finder.py            # IngresosSheetFinder
│   │   └── writer.py            # IngresosSheetUpdater
│   │
│   ├── storage/                 # Base de datos
│   │   ├── database.py          # Database (SQLAlchemy)
│   │   └── models.py            # ORM models
│   │
│   ├── pdf/                     # Procesamiento PDF
│   │   └── extractor.py        # Extracción Quebec PDFs
│   │
│   ├── excel/                   # Excel (legacy)
│   │   ├── finder.py           # SheetFinder, CellFinder
│   │   └── writer.py           # ExcelUpdater
│   │
│   ├── models/                  # Data models
│   │   ├── vehicle.py          # Vehicle, VehicleMapping
│   │   └── report.py           # DailyEntry, VehicleReport
│   │
│   ├── normalization/           # Normalización
│   │   ├── numbers.py          # Números (comas/puntos)
│   │   ├── dates.py            # Fechas (múltiples formatos)
│   │   └── vehicles.py         # Vehículos (fuzzy match)
│   │
│   ├── gmail/                   # Cliente Gmail (Python)
│   │   ├── auth.py             # GmailAuthManager
│   │   ├── client.py           # GmailClient API calls
│   │   └── service.py          # GmailService orquestación
│   │
│   └── logs_handler/            # Logging
│       └── setup.py            # Rotating file handler
│
├── tests/                       # Tests Python
│   ├── test_models.py           # Modelos
│   ├── test_normalization.py    # Normalización
│   ├── test_pdf_parser.py       # PDF
│   ├── test_excel.py            # Excel
│   ├── test_integration.py      # Integración
│   ├── test_storage.py          # Base de datos (nuevo)
│   └── test_finder.py           # Sheets finder (nuevo)
│
├── data/                        # Datos runtime
│   ├── processed.db             # SQLite local
│   ├── processed-messages.json  # IDs procesados
│   └── pdfs/                    # PDFs descargados
│
├── docker-compose.yml           # Orquestación Docker
├── Dockerfile                   # Python pipeline
├── Dockerfile.bot               # TypeScript bot
├── .env                         # Config (gitignored)
├── .env.example                 # Template config
└── requirements.txt             # Dependencias Python
```

---

## 6. Componentes Detallados

### 6.1 Express Server (`server.ts`, `app.ts`)

- **Framework:** Express 4.x
- **Puerto:** 3000 (default), mapeado a 3001 en host
- **Middlewares:** Body parser (10mb), correlation ID, request logger, error handler
- **Graceful shutdown:** SIGTERM/SIGINT handlers
- **OAuth refresh listener:** Persiste tokens automáticamente al refrescar

### 6.2 Polling Service (`polling.service.ts`)

- **Intervalo:** Configurable via `POLL_INTERVAL` (default 30s)
- **Flujo por ciclo:**
  1. Carga tokens OAuth
  2. Lista hasta 50 mensajes no leídos
  3. Filtra contra `processed-messages.json`
  4. Procesa cada mensaje pendiente via `EmailProcessorService`
  5. Guarda ID en archivo de procesados
- **Persistencia:** Las IDs se guardan en `data/processed-messages.json`

### 6.3 Email Processor (`email-processor.service.ts`)

Servicio compartido entre polling y webhook. Procesa un email:
1. `getMessageContent()` → obtiene asunto, cuerpo, remitente
2. `getPdfAttachments()` → descarga solo PDFs
3. `pipelineBridge.processPdfIfExists()` → ejecuta pipeline Python
4. `enrichContext()` → RAG sobre FAQ
5. `generateReply()` → IA genera borrador
6. `createDraftReply()` → guarda en Gmail

### 6.4 Pipeline Bridge (`pipeline-bridge.service.ts`)

- Ejecuta el pipeline Python como subproceso
- Usa `spawnAndWait()` de `utils/exec.ts`
- Sanitiza nombres de archivo (path traversal prevention)
- Retorna `PipelineResult` con stdout/stderr/exitCode

### 6.5 AI Service (`ai.service.ts`)

- **Strategy Pattern:** `GeminiProvider` | `OpenAIProvider`
- **Temperatura:** 0.3 (baja para consistencia)
- **System prompt:** Instrucciones en español, firma incluida
- **Retry:** 3 intentos con exponential backoff + jitter
- **Contexto:** RAG opcional y firma del propietario

### 6.6 Gmail Service (`gmail.service.ts`)

- Wrapper completo de Gmail API v1
- **Métodos principales:**
  - `listUnreadMessages()` - lista no leídos
  - `getMessageContent()` - obtiene contenido completo
  - `getPdfAttachments()` - descarga solo PDFs
  - `getPdfAttachmentFilenames()` - solo nombres (chequeo rápido)
  - `createDraftReply()` - crea borrador con threading headers
  - `setupWatch()` / `stopWatch()` - gestión de push notifications
  - `getHistory()` - historial de cambios
- **Parseo MIME:** `extractBodyFromPayload()` recursivo, soporta multipart/alternative, multipart/mixed

### 6.7 Google Sheets Finder (`sheets/finder.py`)

- **BaseSheetFinder** → clase base con fuzzy matching por marca/modelo
- **SheetsFinder** → busca hoja de vehículo por nombre
- **RowFinder** → encuentra fila por fecha:
  1. Escanea todas las filas buscando coincidencia exacta
  2. Si no encuentra, busca posición cronológica
  3. Si hay espacio, `insertDimension()` para insertar fila
  4. Si no, append al final
- **find_column_by_header** → detecta columnas por nombre (FECHA, KILOMETRAJE, etc.)

### 6.8 Summary Updater (`sheets/summary.py`)

- Busca hoja "TOTAL Y RESUM" por nombre
- Detecta secciones de vehículos y meses
- Escribe fórmulas FILTER:
  ```
  =IFERROR(SUM(FILTER('VEHICLE'!D$13:D,
    MONTH('VEHICLE'!C$13:C)=mes,
    YEAR('VEHICLE'!C$13:C)=año)),0)
  ```

### 6.9 Database (`storage/database.py`)

- **SQLAlchemy** con soporte PostgreSQL y SQLite
- **3 tablas:** `processed_emails`, `daily_entries`, `income_expenses`
- **Context manager** `_session()` con rollback automático
- **expire_on_commit=False** para acceso a objetos fuera de sesión
- **Unique constraints** evitan duplicados

### 6.10 PDF Extractor (`pdf/extractor.py`)

- Usa `pdfplumber` para extracción de texto
- Reconoce formato Quebec: `Appareil: VEHICLE - PLATE`
- `split_vehicle_sections()` → secciona por vehículo
- `parse_data_rows()` → regex: `\d+ YYYY-MM-DD KM SPEED PARK FUEL`
- `validate_report()` → validación de rangos

---

## 7. Modelo de Datos

### 7.1 PostgreSQL / SQLite

```sql
-- Emails procesados (deduplicación)
processed_emails:
  id              INTEGER PRIMARY KEY
  email_id        TEXT UNIQUE NOT NULL
  subject         TEXT
  processed_at    TIMESTAMP
  attachments_count INTEGER
  reports_count   INTEGER
  entries_count   INTEGER
  status          TEXT  -- success | error
  error_message   TEXT

-- Entradas diarias de kilometraje
daily_entries:
  id              INTEGER PRIMARY KEY
  vehicle_name    TEXT NOT NULL
  vehicle_plate   TEXT
  entry_date      DATE NOT NULL
  kilometers      FLOAT
  speed_excess    INTEGER
  parking_time    INTEGER
  fuel            FLOAT
  source_file     TEXT
  email_id        TEXT
  created_at      TIMESTAMP
  UNIQUE(vehicle_name, entry_date, kilometers)

-- Datos de ingresos/gastos
income_expenses:
  id              INTEGER PRIMARY KEY
  vehicle_name    TEXT NOT NULL
  entry_date      DATE NOT NULL
  kilometers      FLOAT
  notes           TEXT
  source_file     TEXT
  email_id        TEXT
  created_at      TIMESTAMP
  UNIQUE(vehicle_name, entry_date)
```

### 7.2 Archivos JSON

```typescript
// processed-messages.json — IDs de mensajes procesados
["id1", "id2", ...]

// watch-state.json — Estado del watch de Gmail
{
  historyId: "123456",
  emailAddress: "user@gmail.com",
  expiration: 1715123456789,
  lastProcessedHistoryId: "123456",
  topicName: "projects/p/topics/gmail"
}

// .tokens.json — Tokens OAuth
{
  access_token: "...",
  refresh_token: "...",
  expiry_date: 1715123456789
}
```

---

## 8. API Endpoints

| Método | Ruta | Propósito | Auth |
|---|---|---|---|
| GET | `/health` | Health check | No |
| GET | `/auth/google` | Iniciar OAuth flow | No |
| GET | `/auth/callback` | Callback OAuth | No |
| POST | `/webhook/gmail` | Webhook Pub/Sub | Token |
| GET | `/api/watch/status` | Estado del watch | No |
| POST | `/api/watch/start` | Activar watch | OAuth |
| POST | `/api/watch/renew` | Renovar watch | OAuth |
| DELETE | `/api/watch/stop` | Detener watch | OAuth |
| POST | `/api/sheets/refresh-summary` | Actualizar fórmulas | No |

---

## 9. Seguridad

### 9.1 Tokens y Credenciales

Los tokens OAuth se almacenan en texto plano en `.tokens.json` (`.gitignore`). Para producción, migrar a un vault: Google Secret Manager, AWS Secrets Manager, o al menos cifrar con `cryptography.fernet`.

### 9.2 Scopes de Gmail

- `gmail.readonly` — solo lectura de correos
- `gmail.compose` — crear borradores (NO enviar)
- `gmail.send` está **intencionalmente excluido**

### 9.3 Webhook Security

- Validación via `PUBSUB_VERIFICATION_TOKEN` en query param
- Token **obligatorio** en producción (error si no está configurado)
- Respuesta 200 incluso para tokens inválidos (evita retries de Pub/Sub)

### 9.4 Path Traversal

Los nombres de archivo de attachments se sanitizan:
```typescript
path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, '_')
```

### 9.5 Command Injection

- `spawn()` con array de argumentos (no shell string)
- `spawnAndWait()` evita `child_process.exec()`

---

## 10. Despliegue

### 10.1 Docker Compose

```yaml
services:
  bot:      # TypeScript (siempre activo)
    build: Dockerfile.bot
    ports: 3001:3000
    volumes: ./data:/app/data, ./logs:/app/logs

  db:       # PostgreSQL (siempre activo)
    image: postgres:16-alpine
    ports: 5433:5432
    healthcheck: pg_isready

  pipeline: # Python (bajo demanda)
    build: .  # Dockerfile (Python)
    profiles: [manual]
```

### 10.2 Variables de Entorno

Ver `.env.example` para la lista completa. Las críticas son:

| Variable | Propósito |
|---|---|
| `GOOGLE_CLIENT_ID` | OAuth Client ID |
| `GOOGLE_CLIENT_SECRET` | OAuth Client Secret |
| `GOOGLE_REDIRECT_URI` | Callback URL |
| `GEMINI_API_KEY` | API Key de Gemini |
| `GOOGLE_SHEETS_ID` | ID del Google Sheet |
| `GOOGLE_SERVICE_ACCOUNT_FILE` | Ruta al JSON de service account |
| `DATABASE_URL` | URL de conexión PostgreSQL |

---

## 11. Tests

### 11.1 Cobertura Actual (42 tests pasan)

| Archivo | Tests | Tipo |
|---|---|---|
| `test_models.py` | 9 | Unitarios (sin dependencias externas) |
| `test_normalization.py` | 11 | Unitarios (sin dependencias externas) |
| `test_pdf_parser.py` | 4 | Unitarios (1 con fixture) |
| `test_excel.py` | 4 | Unitarios (3 con fixture condicional) |
| `test_integration.py` | 4 | Integración (3 con fixture condicional) |
| `test_storage.py` | 10 | Unitarios (SQLite in-memory) |
| `test_finder.py` | 7 | Unitarios (mocks gspread) |

### 11.2 Ejecutar Tests

```bash
docker compose exec bot python3 -m pytest tests/ -v
```

---

## 12. Mantenimiento

### 12.1 Cambio de Año

1. Copiar el Google Sheet del año anterior
2. Limpiar datos viejos
3. Compartir con service account
4. Actualizar `GOOGLE_SHEETS_ID` en `.env`
5. `docker compose up -d bot`

### 12.2 Renovación de Watch (Pub/Sub)

El watch de Gmail expira cada 7 días. Renovar:
```bash
curl -X POST http://localhost:3001/api/watch/renew
```

### 12.3 Logs

```bash
# Ver todos los logs
docker compose logs -f bot

# Solo PDFs y sheets
docker compose logs bot | grep -i "pdf\|sheets\|pipeline"
```

---

## 13. Dependencias Externas

| Servicio | Propósito | Configuración |
|---|---|---|
| Google Cloud Console | APIs, OAuth, Service Account | Google Cloud Project |
| Gmail API | Leer correos, crear borradores | Habilitar en Cloud Console |
| Google Sheets API | Leer/escribir sheets | Habilitar en Cloud Console |
| Gemini API (o OpenAI) | Generar borradores con IA | API Key |
| Google Pub/Sub (opcional) | Notificaciones push | Topic + Subscription |

---

*Documento generado el 2026-05-12. Para la guía de configuración del cliente, ver `GUIA-CLIENTE.md`.*
