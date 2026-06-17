import nodemailer from 'nodemailer';
import { AttachmentData } from './webmail.service';
import { AIService } from './ai.service';
import { RAGService } from '../rag/rag.service';
import { pipelineBridge } from './pipeline-bridge.service';
import { logger } from '../utils/logger';

export interface SmtpConfig {
  host: string;
  port: number;
  tls: boolean;
  user: string;
  pass: string;
}

export class EmailProcessorService {
  constructor(
    private readonly aiService: AIService,
    private readonly ragService: RAGService,
  ) {}

  async processEmail(
    getPdfAttachments: () => Promise<AttachmentData[]>,
    context: { messageId: string; subject: string; from: string; body: string },
    smtp: SmtpConfig,
  ): Promise<void> {
    const { messageId, subject, from: originalSender, body } = context;

    logger.info('Processing message', { messageId, subject: subject || '(sin asunto)', from: originalSender });

    let hasPdfs = false;
    try {
      const pdfs = await getPdfAttachments();
      if (pdfs.length > 0) {
        hasPdfs = true;
        logger.info(`${pdfs.length} PDF(s) detected, processing...`, {
          messageId,
          filenames: pdfs.map((p) => p.filename),
        });
        for (const pdf of pdfs) {
          const result = await pipelineBridge.processPdfIfExists(pdf.filename, pdf.data, pdf.mimeType);
          if (result) {
            logger.info(`Pipeline ${result.success ? 'OK' : 'ERROR'} for ${pdf.filename}`, {
              messageId,
              exitCode: result.exitCode,
            });
          }
        }
      }
    } catch (err: any) {
      logger.error(`Error processing PDFs for ${messageId}`, { error: err.message });
    }

    try {
      const enriched = this.ragService.enrichContext(`${subject} ${body}`);
      const replyText = await this.aiService.generateReply({
        subject,
        body,
        context: enriched || undefined,
      });

      const transporter = nodemailer.createTransport({
        host: smtp.host,
        port: smtp.port,
        secure: smtp.tls,
        auth: { user: smtp.user, pass: smtp.pass },
      });

      const cleanSubject = subject.replace(/^(Re:\s*)+/i, '').trim();
      const finalSubject = cleanSubject ? `Re: ${cleanSubject}` : '(sin asunto)';

      await transporter.sendMail({
        from: smtp.user,
        to: originalSender,
        subject: finalSubject,
        text: replyText,
        inReplyTo: messageId,
        references: messageId,
      });

      logger.info('AI reply sent via SMTP', {
        messageId,
        to: originalSender,
        subject: finalSubject,
        hasPdfs,
        ragUsed: !!enriched,
      });
    } catch (err: any) {
      logger.error(`Failed to generate/send reply for ${messageId}`, { error: err.message });
    }
  }
}
