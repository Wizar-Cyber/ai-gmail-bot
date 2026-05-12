# GUÍA DE CONFIGURACIÓN PARA EL CLIENTE

## Índice
1. [Requisitos](#1-requisitos)
2. [Google Cloud - Paso a paso](#2-google-cloud---paso-a-paso)
3. [Google Sheets - Preparar plantilla](#3-google-sheets---preparar-plantilla)
4. [Instalación del bot](#4-instalación-del-bot)
5. [Primera autenticación](#5-primera-autenticación)
6. [Uso diario](#6-uso-diario)
7. [Cambio de año](#7-cambio-de-año)
8. [Solución de problemas](#8-solución-de-problemas)

---

## 1. REQUISITOS

- Servidor Linux (Ubuntu/Debian recomendado) con Docker y Docker Compose
- Una cuenta de Google (Gmail)
- Una hoja de Google Sheets con la plantilla de kilometraje
- Un PDF de ejemplo para pruebas

---

## 2. GOOGLE CLOUD - PASO A PASO

### 2.1 Crear proyecto

1. Ve a https://console.cloud.google.com
2. Crea un proyecto nuevo (o usa uno existente)
3. Anota el **ID del proyecto** (lo usarás después)

### 2.2 Habilitar APIs

En tu proyecto, habilita estas APIs:
- **Gmail API** → https://console.cloud.google.com/apis/library/gmail.googleapis.com
- **Google Sheets API** → https://console.cloud.google.com/apis/library/sheets.googleapis.com

### 2.3 Crear Credenciales OAuth (para leer Gmail)

1. Ve a https://console.cloud.google.com/apis/credentials
2. Click **+ CREATE CREDENTIALS** → **OAuth client ID**
3. Tipo: **Web application**
4. Nombre: `AI Gmail Bot`
5. En **Authorized redirect URIs**: `http://localhost:3001/auth/callback`
6. Click **Create**
7. **Copia el Client ID y Client Secret** que aparecen

### 2.4 Crear Cuenta de Servicio (para Google Sheets)

1. Ve a https://console.cloud.google.com/iam-admin/serviceaccounts
2. Click **+ CREATE SERVICE ACCOUNT**
3. Nombre: `sheets-bot`
4. Click **Create and Continue** (sin permisos extra)
5. Click **Done**
6. Click en el email de la cuenta de servicio creada
7. Ve a la pestaña **Keys**
8. Click **Add Key** → **Create New Key** → **JSON**
9. Se descargará un archivo `.json` — **guárdalo como `service_account.json`**

### 2.5 Obtener API Key de Gemini (para IA)

1. Ve a https://aistudio.google.com/apikey
2. Click **Create API Key**
3. Selecciona tu proyecto
4. **Copia la API Key**

---

## 3. GOOGLE SHEETS - PREPARAR PLANTILLA

### 3.1 Crear el Sheet

1. Ve a https://sheets.new
2. Crea las hojas con los nombres de los vehículos (ej: `MERCEDES E 200 JSZ167`, `AUDI Q3 JXV974`, etc.)
3. En cada hoja, la estructura debe tener estas columnas:

| # | FECHA | KILOMETRAJE | EXCESO VELOCIDAD | TIEMPO ESTACIONAMIENTO | COMBUSTIBLE |
|---|-------|-------------|-----------------|----------------------|-------------|
| 1 | 1/1/2026 | 114,145 | 0 | 0 | 0 |

> **Importante**: Las columnas deben llamarse **FECHA**, **KILOMETRAJE**, **EXCESO VELOCIDAD** (o EXCESO), **TIEMPO ESTACIONAMIENTO** (o ESTACIONAMIENTO), **COMBUSTIBLE**. El bot las encuentra por nombre, no por posición.

4. Comparte el sheet con el email de la cuenta de servicio (rol **Editor**):
   - El email termina en `@proyecto.iam.gserviceaccount.com`
   - Pégalo en el botón **Compartir** del sheet

5. **Copia el ID del sheet** (está en la URL, entre `/d/` y `/edit`):
   ```
   https://docs.google.com/spreadsheets/d/ESTE_ES_EL_ID/edit
   ```

### 3.2 Opcional: Hoja de Total y Resumen

Si quieres que el bot actualice una hoja de resumen con fórmulas, crea una hoja llamada `TOTAL Y RESUM 2026` con el formato de reportes mensuales por vehículo.

---

## 4. INSTALACIÓN DEL BOT

### 4.1 En el servidor

```bash
# Clonar el repositorio (o copiar los archivos)
cd /var/www/ai-gmail-bot

# Configurar variables de entorno
cp .env.example .env
nano .env   # Editar con tus datos (ver sección 4.2)
```

### 4.2 Configurar `.env`

Edita el archivo `.env` con tus datos:

```env
# === TUS CREDENCIALES DE GOOGLE ===
# Del paso 2.3 (OAuth):
GOOGLE_CLIENT_ID=48387494860-xxxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxxxx
GOOGLE_REDIRECT_URI=http://localhost:3001/auth/callback

# Del paso 2.5 (Gemini):
GEMINI_API_KEY=AIzaSyxxxxx
GEMINI_MODEL=gemini-2.5-flash

# === GOOGLE SHEETS ===
# Del paso 3.1 (ID del sheet):
GOOGLE_SHEETS_ID=1wg28FRvAdsfw5AanFadKP6ZNQBTpWbAXzw8HXfNz9Rc
GOOGLE_SERVICE_ACCOUNT_FILE=service_account.json

# === PERSONALIZACIÓN ===
OWNER_NAME=Nombre del Cliente
GMAIL_SIGNATURE=Nombre del Cliente\ncorreo@cliente.com
```

### 4.3 Colocar archivos

```bash
# Copiar el JSON de la cuenta de servicio (del paso 2.4)
# al directorio del proyecto:
cp /ruta/del/descargado/service_account.json /var/www/ai-gmail-bot/
```

### 4.4 Iniciar el bot

```bash
# Iniciar PostgreSQL y el bot
cd /var/www/ai-gmail-bot
docker compose up -d bot
```

---

## 5. PRIMERA AUTENTICACIÓN

El bot necesita acceso a tu Gmail para leer correos y crear borradores.

### Paso 1: Abrir la URL de autenticación

```bash
# Verifica que el bot esté corriendo:
curl http://localhost:3001/health
# Debe responder: {"status":"ok","timestamp":"..."}
```

Luego abre en tu navegador:
```
http://localhost:3001/auth/google
```

### Paso 2: Autorizar

- Inicia sesión con la cuenta de Gmail del cliente
- Da click en **Permitir** (solicita permisos de lectura y crear borradores)
- Google redirigirá a una página que dice **"Authentication successful"**

### Paso 3: Verificar

```bash
# Revisa que los tokens se guardaron
ls -la .tokens.json
# Debe mostrar un archivo de ~500 bytes

# Revisa los logs del bot
docker compose logs bot --tail 10
# Debe mostrar:
# Polling started every 30s
# Polling: N correo(s) nuevo(s) por procesar
```

---

## 6. USO DIARIO

### 6.1 Funcionamiento normal

El bot funciona automáticamente. No necesita intervención:

1. **Cada 30 segundos** revisa la bandeja de entrada
2. Por cada correo nuevo:
   - Si tiene PDF de kilometraje → procesa y llena el sheet
   - Genera un **borrador de respuesta** con IA
3. Los borradores aparecen en Gmail > Borradores (revisar antes de enviar)

### 6.2 Comandos útiles

```bash
# Ver logs en vivo
docker compose logs -f bot

# Ver solo procesamiento de PDFs
docker compose logs bot | grep -i "pdf\|sheets\|kilometraje"

# Procesar un PDF manualmente
docker compose exec bot python3 -m src.main \
  --pdf "/app/data/pdfs/mi-reporte.pdf" \
  --sheets-id "ID_DEL_SHEET" \
  --service-account "service_account.json"

# Refrescar fórmulas del resumen
curl -X POST http://localhost:3001/api/sheets/refresh-summary
```

### 6.3 ¿Qué hace el bot con cada correo?

| Tipo de correo | ¿Crea borrador? | ¿Actualiza sheets? |
|---|---|---|
| Correo normal sin PDF | ✅ Sí | ❌ No |
| Correo con PDF de kilometraje | ✅ Sí | ✅ Sí |
| Correo con PDF no-km (ej: carta) | ✅ Sí | ❌ No (lo ignora) |

---

## 7. CAMBIO DE AÑO

Cada año solo necesitas **2 pasos**:

### Paso 1: Crear nuevo sheet

1. Copia la plantilla del año anterior en Google Sheets
2. Limpia los datos viejos pero mantén la estructura de columnas
3. Compártela con la misma cuenta de servicio
4. Copia el nuevo ID del sheet

### Paso 2: Actualizar `.env`

```bash
nano /var/www/ai-gmail-bot/.env
```

Cambia solo esta línea:
```env
GOOGLE_SHEETS_ID=nuevo_id_del_sheet_del_nuevo_año
```

Luego reinicia:
```bash
docker compose up -d bot
```

**Eso es todo.** El bot detecta automáticamente:
- Las columnas por su nombre (FECHA, KILOMETRAJE, etc.)
- La fila de cada vehículo por nombre aproximado
- Dónde insertar cada fecha entre las existentes

---

## 8. SOLUCIÓN DE PROBLEMAS

### "El bot no procesa mis correos"

```bash
# 1. Verificar que el bot está corriendo
docker compose ps
# Debe mostrar "bot" y "db" como "Up"

# 2. Revisar logs
docker compose logs bot --tail 20

# 3. Verificar tokens de Gmail
ls -la .tokens.json   # Debe existir y ser > 100 bytes

# 4. Re-autenticar si es necesario
# Eliminar tokens viejos y repetir paso 5:
rm .tokens.json
# Luego abrir http://localhost:3001/auth/google
```

### "Los datos se escriben en el lugar equivocado"

El bot escanea todas las filas del sheet y encuentra dónde debe ir cada fecha. Si el sheet tiene filas en blanco o Totales entre meses, el bot las respeta y se inserta donde corresponde.

### "Error de cuota de Gemini"

La capa gratuita de Gemini permite 5 requests por minuto. El bot espera y reintenta automáticamente. Para producción, usa Gemini pago o cambia a OpenAI en `.env`:
```env
AI_PROVIDER=openai
OPENAI_API_KEY=sk-tu_key
```

### "Error de cuota de Google Sheets"

Si procesas muchos PDFs seguidos, la API puede limitar. Espera 1 minuto y vuelve a intentar.

### "No encuentra la hoja del vehículo"

El bot busca por nombre aproximado. Si la hoja se llama "MERCEDES E 200 JSZ167", reconoce "Mercedes E200", "E200", "MERCEDES E 200" etc. Si no encuentra, verifica que el nombre de la hoja en el sheet sea reconocible.

---

## RESUMEN DE ARCHIVOS IMPORTANTES

| Archivo | Qué es | Dónde está |
|---|---|---|
| `.env` | Configuración (credenciales, IDs) | `/var/www/ai-gmail-bot/.env` |
| `service_account.json` | Llave de Google Sheets | `/var/www/ai-gmail-bot/service_account.json` |
| `.tokens.json` | Token de Gmail (se genera solo) | `/var/www/ai-gmail-bot/.tokens.json` |
| `data/processed-messages.json` | Historial de correos procesados | `/var/www/ai-gmail-bot/data/` |
| `docker-compose.yml` | Configuración de servicios | `/var/www/ai-gmail-bot/` |

---

*Documentación generada para el cliente. Para soporte técnico, contactar al desarrollador.*
