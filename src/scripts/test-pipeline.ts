/**
 * Script de prueba del pipeline completo.
 * Ejecutar con: npx tsx src/scripts/test-pipeline.ts
 *
 * Flujo:
 *   1. Carga tokens guardados
 *   2. Lista los últimos 3 correos no leídos
 *   3. Obtiene contenido del primero
 *   4. Enriquece con RAG
 *   5. Genera respuesta con IA
 *   6. Crea borrador en Gmail
 */
import './env-load';
import { oauth2Client } from '../config/oauth.config';
import { tokenRepository } from '../repositories/token.repository';
import { GmailService } from '../services/gmail.service';
import { AIService } from '../services/ai.service';
import { RAGService } from '../rag/rag.service';
import { AppError } from '../utils/errors';

async function main(): Promise<void> {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(' Gmail Bot — Test Pipeline');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // 1. Cargar tokens
  const tokens = await tokenRepository.load();
  if (!tokens?.refresh_token) {
    console.error('✗ No hay tokens guardados. Ejecuta primero: npm run auth');
    process.exit(1);
  }
  oauth2Client.setCredentials(tokens);
  console.log('✓ Tokens cargados correctamente\n');

  const gmailService = new GmailService(oauth2Client);
  const aiService    = new AIService();
  const ragService   = new RAGService();

  // 2. Listar correos no leídos
  console.log('→ Listando correos no leídos (max 3)...');
  const unread = await gmailService.listUnreadMessages(3);

  if (unread.length === 0) {
    console.log('✓ No hay correos no leídos en el inbox.\n');
    console.log('  El pipeline está listo. Cuando llegue un correo via Pub/Sub se procesará automáticamente.');
    return;
  }

  console.log(`✓ Encontrados ${unread.length} correo(s) no leído(s)\n`);

  // 3. Procesar el primero
  const first = unread[0];
  console.log(`→ Procesando mensaje: ${first.id}`);
  const message = await gmailService.getMessageContent(first.id!);

  console.log(`✓ Correo parseado:`);
  console.log(`  De:      ${message.from}`);
  console.log(`  Asunto:  ${message.subject}`);
  console.log(`  Cuerpo:  ${message.body.slice(0, 120).replace(/\n/g, ' ')}…\n`);

  // 4. RAG context
  const context = ragService.enrichContext(`${message.subject} ${message.body}`);
  if (context) {
    console.log(`✓ RAG: contexto inyectado (${context.split('\n').length} entradas)\n`);
  } else {
    console.log('  RAG: sin coincidencias en el FAQ\n');
  }

  // 5. Generar respuesta con IA
  console.log('→ Generando respuesta con IA...');
  const replyText = await aiService.generateReply({
    subject: message.subject,
    body: message.body,
    context: context || undefined,
  });

  console.log(`✓ Respuesta generada:\n`);
  console.log('─'.repeat(60));
  console.log(replyText);
  console.log('─'.repeat(60));
  console.log();

  // 6. Crear borrador
  console.log('→ Creando borrador en Gmail...');
  const draftId = await gmailService.createDraftReply(message, replyText);

  console.log(`\n✓ Borrador creado: ${draftId}`);
  console.log(`  → Revísalo en Gmail > Borradores antes de enviarlo.\n`);
  console.log('Pipeline completo ✓\n');
}

main().catch((err: unknown) => {
  if (err instanceof AppError) {
    console.error('\n✗ Error en el pipeline:', err.message);
    console.error('  Código:', err.code);
    // Muestra el error subyacente del provider (Gemini / Gmail)
    if (err.details) console.error('  Causa:', JSON.stringify(err.details, null, 2));
    console.error(err.stack);
  } else {
    const e = err as Error;
    console.error('\n✗ Error inesperado:', e.message);
    console.error(e.stack);
  }
  process.exit(1);
});
