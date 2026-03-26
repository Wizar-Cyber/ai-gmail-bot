/**
 * SISTEMA PROFESIONAL DE SUGERENCIAS PARA GMAIL CON IA
 * Arquitectura: Clean Architecture / Modular Node.js
 * Tecnologías: Express, Google APIs, Gemini SDK
 */

const express = require('express');
const { google } = require('googleapis');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const dotenv = require('dotenv');
const crypto = require('crypto');

// 1. CONFIGURACIÓN Y VARIABLES DE ENTORNO
dotenv.config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

// Configuración de Google OAuth 2.0
const oauth2Client = new google.auth.OAuth2(
    process.env.CLIENT_ID,
    process.env.CLIENT_SECRET,
    process.env.REDIRECT_URI
);

// Configuración de Gemini AI
const genAI = new GoogleGenerativeAI(process.env.API_KEY || "");
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-preview-09-2025" });

// --------------------------------------------------------------------------
// 2. SERVICIO DE INTELIGENCIA ARTIFICIAL (IA)
// --------------------------------------------------------------------------
const AIService = {
    /**
     * Genera una respuesta profesional basada en el contexto del correo.
     */
    generateEmailResponse: async (subject, body) => {
        const systemPrompt = `
            Actúa como un asistente ejecutivo altamente profesional y amable.
            Tu tarea es redactar una respuesta borrador para el siguiente correo electrónico.
            
            REGLAS:
            1. Mantén un tono profesional, empático y servicial.
            2. Basa la respuesta ÚNICAMENTE en la información proporcionada en el cuerpo del correo.
            3. Si el remitente hace una pregunta que no puedes responder, indica que el equipo se pondrá en contacto pronto.
            4. No inventes datos externos.
            5. La respuesta debe estar en el mismo idioma que el correo recibido.
            
            CONTEXTO DEL CORREO:
            Asunto: ${subject}
            Cuerpo: ${body}
            
            Genera solo el texto del cuerpo de la respuesta.
        `;

        try {
            const result = await model.generateContent(systemPrompt);
            const response = await result.response;
            return response.text();
        } catch (error) {
            console.error("Error en IA Service:", error);
            throw new Error("No se pudo generar la respuesta con IA.");
        }
    }
};

// --------------------------------------------------------------------------
// 3. SERVICIO DE GMAIL (GOOGLE API)
// --------------------------------------------------------------------------
const GmailService = {
    /**
     * Extrae el texto plano de un mensaje multipart/alternative
     */
    getTextFromBody: (payload) => {
        let text = "";
        if (payload.body && payload.body.data) {
            text = Buffer.from(payload.body.data, 'base64').toString();
        } else if (payload.parts) {
            payload.parts.forEach(part => {
                if (part.mimeType === 'text/plain' && part.body.data) {
                    text += Buffer.from(part.body.data, 'base64').toString();
                } else if (part.parts) {
                    text += GmailService.getTextFromBody(part);
                }
            });
        }
        return text;
    },

    /**
     * Procesa un correo específico y crea un borrador de respuesta
     */
    processMessageAndCreateDraft: async (auth, messageId) => {
        const gmail = google.gmail({ version: 'v1', auth });

        // Obtener contenido completo del mensaje
        const res = await gmail.users.messages.get({ userId: 'me', id: messageId });
        const message = res.data;
        const subject = message.payload.headers.find(h => h.name === 'Subject')?.value || 'Sin Asunto';
        const from = message.payload.headers.find(h => h.name === 'From')?.value || 'Desconocido';
        const body = GmailService.getTextFromBody(message.payload);

        console.log(`Procesando correo de: ${from}`);

        // Generar respuesta con IA
        const suggestedText = await AIService.generateEmailResponse(subject, body);

        // Crear el borrador (Draft)
        const rawMessage = [
            `To: ${from}`,
            `Subject: Re: ${subject}`,
            'Content-Type: text/plain; charset=utf-8',
            'MIME-Version: 1.0',
            '',
            suggestedText
        ].join('\n');

        const encodedMessage = Buffer.from(rawMessage)
            .toString('base64')
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=+$/, '');

        await gmail.users.drafts.create({
            userId: 'me',
            requestBody: {
                message: {
                    raw: encodedMessage,
                    threadId: message.threadId
                }
            }
        });

        return { success: true, messageId };
    }
};

// --------------------------------------------------------------------------
// 4. CONTROLADORES Y RUTAS (WEBHOOKS)
// --------------------------------------------------------------------------

/**
 * Endpoint de Webhook para Google Cloud Pub/Sub
 * Recibe notificaciones push cuando llega un correo nuevo
 */
app.post('/webhook/gmail', async (req, res) => {
    try {
        // En producción, aquí validarías el token de seguridad de Pub/Sub
        const message = req.body.message;
        if (!message) return res.status(400).send('No message received');

        // Decodificar data de Pub/Sub
        const data = JSON.parse(Buffer.from(message.data, 'base64').toString());
        const emailAddress = data.emailAddress;

        console.log(`Nueva notificación para: ${emailAddress}`);

        // Aquí deberías recuperar el token de acceso/refresh de tu DB (Postgres/Redis)
        // Por simplicidad, asumimos que el cliente ya está autenticado
        const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
        
        // Listar mensajes no leídos recientes
        const listRes = await gmail.users.messages.list({
            userId: 'me',
            q: 'is:unread',
            maxResults: 1
        });

        if (listRes.data.messages && listRes.data.messages.length > 0) {
            const lastMessageId = listRes.data.messages[0].id;
            await GmailService.processMessageAndCreateDraft(oauth2Client, lastMessageId);
        }

        res.status(200).send('OK');
    } catch (error) {
        console.error("Error en Webhook:", error);
        res.status(500).send('Internal Server Error');
    }
});

/**
 * Rutas de Autenticación OAuth 2.0
 */
app.get('/auth/google', (req, res) => {
    const scopes = [
        'https://www.googleapis.com/auth/gmail.readonly',
        'https://www.googleapis.com/auth/gmail.compose'
    ];
    const url = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: scopes,
        prompt: 'consent'
    });
    res.redirect(url);
});

app.get('/auth/callback', async (req, res) => {
    const { code } = req.query;
    try {
        const { tokens } = await oauth2Client.getToken(code);
        oauth2Client.setCredentials(tokens);
        // NOTA: Aquí guardarías 'tokens.refresh_token' en tu base de datos
        res.send('Autenticación exitosa. El sistema ya puede procesar correos.');
    } catch (error) {
        res.status(500).send('Error en la autenticación');
    }
});

// Inicio del servidor
app.listen(PORT, () => {
    console.log(`Servidor escuchando en http://localhost:${PORT}`);
    console.log(`Webhook listo en http://localhost:${PORT}/webhook/gmail`);
});