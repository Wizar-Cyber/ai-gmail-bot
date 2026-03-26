# AI Gmail Bot

Automatiza la lectura y respuesta de correos usando Gmail API + IA (Gemini 1.5 Pro / GPT-4o).

**Flujo completo:**
```
Pub/Sub Webhook → Gmail API → Parser → RAG Context → AI Service → Gmail Draft Reply
```

---

## Arquitectura

```
src/
├── config/
│   ├── env.ts                # Validación de variables de entorno (falla rápido si faltan)
│   └── oauth.config.ts       # OAuth2 client + scopes declarados
├── repositories/
│   └── token.repository.ts   # Persistencia de tokens (interfaz + impl. en archivo)
├── services/
│   ├── gmail.service.ts      # Integración Gmail API (listar, leer, crear borrador)
│   └── ai.service.ts         # Proveedor de IA intercambiable (Gemini / GPT-4o)
├── rag/
│   ├── faq.json              # Base de conocimiento local
│   └── rag.service.ts        # Enriquecimiento de contexto por keywords
├── routes/
│   ├── webhook.route.ts      # POST /webhook/gmail  (pipeline principal)
│   └── auth.route.ts         # GET /auth/google + GET /auth/callback
├── middlewares/
│   └── webhook.middleware.ts # Validación del token de Pub/Sub
├── utils/
│   ├── logger.ts             # Winston + correlationId por request (AsyncLocalStorage)
│   ├── errors.ts             # Jerarquía de errores de dominio
│   ├── retry.ts              # Exponential backoff con jitter
│   └── parser.util.ts        # Decodificación base64url + extracción de cuerpo MIME
├── scripts/
│   └── auth.ts               # CLI para autenticación inicial (npm run auth)
├── app.ts                    # Express app + middlewares globales
└── server.ts                 # HTTP server + graceful shutdown
```

---

## Requisitos previos

- Node.js ≥ 18
- Una cuenta de Google Cloud con un proyecto activo
- Gmail API habilitada en el proyecto

---

## Instalación

```bash
git clone <repo-url>
cd ai-gmail-bot
npm install
cp .env.example .env
# Edita .env con tus credenciales reales
```

---

## Configuración del .env

```dotenv
PORT=3000
NODE_ENV=development
LOG_LEVEL=info

# OAuth 2.0 (ver sección "Google Cloud Setup")
GOOGLE_CLIENT_ID=your_client_id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-your_secret
GOOGLE_REDIRECT_URI=http://localhost:3000/auth/callback

# Proveedor de IA: "gemini" | "openai"
AI_PROVIDER=gemini
GEMINI_API_KEY=AIzaSy_your_key
GEMINI_MODEL=gemini-1.5-pro
OPENAI_API_KEY=sk-your_key
OPENAI_MODEL=gpt-4o

# Seguridad del webhook
PUBSUB_VERIFICATION_TOKEN=un_token_largo_y_aleatorio

# Almacenamiento de tokens OAuth
TOKEN_STORE_PATH=.tokens.json
```

---

## Google Cloud Setup

### 1. Habilitar la Gmail API

1. Ve a [Google Cloud Console → API Library](https://console.cloud.google.com/apis/library)
2. Busca **Gmail API** → **Enable**

### 2. Crear credenciales OAuth 2.0

1. **APIs & Services → Credentials → Create Credentials → OAuth 2.0 Client ID**
2. Tipo de aplicación: **Web application**
3. Añade en *Authorized redirect URIs*:
   - `http://localhost:3000/auth/callback` (desarrollo)
   - `https://your-domain.com/auth/callback` (producción)
4. Copia **Client ID** y **Client Secret** a tu `.env`

### 3. Scopes requeridos

| Scope | Por qué es necesario |
|-------|---------------------|
| `https://www.googleapis.com/auth/gmail.readonly` | Leer mensajes no leídos con `users.messages.list` y `users.messages.get`. Sin este scope no podemos acceder al contenido del inbox. |
| `https://www.googleapis.com/auth/gmail.compose` | Crear borradores de respuesta con `users.drafts.create`. Permite crear y editar borradores **sin capacidad de enviar**, lo que limita el daño en caso de compromiso. |

> **Nota de seguridad:** `gmail.send` está excluido intencionalmente. Los borradores deben revisarse y enviarse manualmente.

### 4. Configurar Google Cloud Pub/Sub

#### 4.1 Crear el Topic

```bash
# Con gcloud CLI
gcloud pubsub topics create gmail-notifications

# O desde la consola:
# Google Cloud Console → Pub/Sub → Topics → Create Topic
# Topic ID: gmail-notifications
```

#### 4.2 Otorgar permiso a Gmail para publicar en el topic

```bash
gcloud pubsub topics add-iam-policy-binding gmail-notifications \
  --member="serviceAccount:gmail-api-push@system.gserviceaccount.com" \
  --role="roles/pubsub.publisher"
```

#### 4.3 Crear la Subscription (push)

```bash
gcloud pubsub subscriptions create gmail-push-subscription \
  --topic=gmail-notifications \
  --push-endpoint="https://your-domain.com/webhook/gmail?token=TU_VERIFICATION_TOKEN" \
  --push-auth-service-account=your-sa@your-project.iam.gserviceaccount.com
```

O desde la consola:
1. **Pub/Sub → Subscriptions → Create Subscription**
2. Subscription ID: `gmail-push-subscription`
3. Topic: `gmail-notifications`
4. Delivery type: **Push**
5. Endpoint URL: `https://your-domain.com/webhook/gmail?token=TU_VERIFICATION_TOKEN`

#### 4.4 Activar notificaciones push de Gmail Watch

Llama a `users.watch` para suscribir el buzón a las notificaciones (válido por 7 días, debe renovarse):

```bash
curl -X POST https://gmail.googleapis.com/gmail/v1/users/me/watch \
  -H "Authorization: Bearer <ACCESS_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "topicName": "projects/YOUR_PROJECT_ID/topics/gmail-notifications",
    "labelIds": ["INBOX"]
  }'
```

> **Información confirmada:** El watch expira en 7 días. Implementa un cron job o Cloud Scheduler para renovarlo con `POST /gmail/v1/users/me/watch` periódicamente.

---

## Autenticación inicial (OAuth)

**Opción A — Script CLI (recomendado para desarrollo):**

```bash
npm run auth
# Sigue las instrucciones: abre la URL, autoriza, pega el código
```

**Opción B — Flujo HTTP:**

```bash
npm run dev
# Abre en el navegador:
open http://localhost:3000/auth/google
```

En ambos casos, los tokens se guardan en `.tokens.json`.

---

## Ejecución

```bash
# Desarrollo (hot reload)
npm run dev

# Producción
npm run build
npm start
```

Endpoints disponibles:

| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET` | `/auth/google` | Inicia el flujo OAuth |
| `GET` | `/auth/callback` | Callback OAuth de Google |
| `POST` | `/webhook/gmail` | Recibe notificaciones Pub/Sub |
| `GET` | `/health` | Health check |

---

## Ejemplo de payload del webhook (Pub/Sub)

```json
POST /webhook/gmail?token=TU_VERIFICATION_TOKEN
Content-Type: application/json

{
  "message": {
    "data": "eyJlbWFpbEFkZHJlc3MiOiJ1c2VyQGdtYWlsLmNvbSIsImhpc3RvcnlJZCI6IjEyMzQ1In0=",
    "messageId": "11223344556677",
    "publishTime": "2024-01-15T10:30:00.000Z"
  },
  "subscription": "projects/my-project/subscriptions/gmail-push-subscription"
}
```

El campo `data` decodificado en base64 contiene:

```json
{
  "emailAddress": "user@gmail.com",
  "historyId": "12345"
}
```

---

## Proveedor de IA

Cambia entre Gemini y GPT-4o con una línea en `.env`:

```dotenv
AI_PROVIDER=gemini   # Gemini 1.5 Pro (por defecto)
AI_PROVIDER=openai   # GPT-4o
```

**Temperatura: 0.3** — Configurado deliberadamente bajo para respuestas consistentes y profesionales con mínimas alucinaciones. Emails de negocio priorizan exactitud sobre variedad creativa.

---

## RAG (Extensión opcional)

El `RAGService` enriquece el prompt de IA con entradas relevantes del archivo `src/rag/faq.json` basándose en keywords encontradas en el email.

**Flujo de integración:**
```
email.body + email.subject
        ↓
RAGService.enrichContext()  →  matched FAQ answers (texto plano)
        ↓
AIService.generateReply({ subject, body, context })
        ↓
El AI usa el contexto para responder preguntas con datos reales
```

**Para escalar a RAG vectorial:** reemplaza la búsqueda por keywords con embeddings + búsqueda de similitud (pgvector / Pinecone / Qdrant) usando `text-embedding-3-small` de OpenAI o `embedding-001` de Gemini.

---

## Seguridad

- Las credenciales solo se leen de variables de entorno — nunca están en el código
- `.env` y `.tokens.json` están en `.gitignore`
- El scope `gmail.send` está excluido — los borradores requieren aprobación manual
- El webhook valida un token de verificación en la URL (`?token=...`)
- Los tokens OAuth se refrescan automáticamente; el nuevo `access_token` se persiste de inmediato
- Todos los errores son trazables via `correlationId` en los logs estructurados

---

## Logs estructurados

Cada request tiene un `correlationId` único propagado automáticamente via `AsyncLocalStorage`.

```json
{
  "timestamp": "2024-01-15T10:30:00.123Z",
  "level": "info",
  "correlationId": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "message": "Pipeline completed",
  "messageId": "18d4a2f1b9c3e5a7",
  "draftId": "r9876543210",
  "subject": "Question about pricing"
}
```
