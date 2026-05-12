import { GmailService, AttachmentData } from './gmail.service';
import { AIService } from './ai.service';
import { RAGService } from '../rag/rag.service';
import { pipelineBridge } from './pipeline-bridge.service';
import { logger } from '../utils/logger';

export class EmailProcessorService {
  constructor(
    private readonly aiService: AIService,
    private readonly ragService: RAGService,
  ) {}

  async processEmail(gmailService: GmailService, messageId: string): Promise<void> {
    logger.info('Fetching message', { messageId });
    const message = await gmailService.getMessageContent(messageId);

    logger.info('Message parsed', {
      messageId,
      subject: message.subject || '(sin asunto)',
      from: message.from,
    });

    // Process PDF attachments
    try {
      const pdfs: AttachmentData[] = await gmailService.getPdfAttachments(messageId);
      if (pdfs.length > 0) {
        logger.info(`${pdfs.length} PDF(s) detected, processing...`);
        for (const pdf of pdfs) {
          const result = await pipelineBridge.processPdfIfExists(pdf.filename, pdf.data);
          if (result) {
            logger.info(`Pipeline ${result.success ? 'OK' : 'ERROR'} for ${pdf.filename}`);
          }
        }
      }
    } catch (err: any) {
      logger.error(`Error processing PDFs for ${messageId}`, { error: err.message });
    }

    // Generate AI draft reply
    try {
      const context = this.ragService.enrichContext(`${message.subject} ${message.body}`);
      const replyText = await this.aiService.generateReply({
        subject: message.subject,
        body: message.body,
        context: context || undefined,
      });

      const draftId = await gmailService.createDraftReply(message, replyText);

      logger.info('Draft reply created', {
        messageId,
        draftId,
        subject: message.subject,
        ragUsed: !!context,
      });
    } catch (err: any) {
      logger.error(`Failed to generate draft for ${messageId}`, { error: err.message });
    }
  }
}
