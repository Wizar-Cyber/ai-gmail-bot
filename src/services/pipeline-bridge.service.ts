import path from 'path';
import fs from 'fs/promises';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { spawnAndWait } from '../utils/exec';

const PDF_MAGIC = Buffer.from('%PDF');

/** Result of executing the external Python pipeline on a PDF. */
export interface PipelineResult {
  success: boolean;
  pdfFile: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

/**
 * Bridges PDF attachment processing to an external Python pipeline.
 * Saves PDFs to a download directory, spawns the pipeline, and returns results.
 */
export class PipelineBridgeService {
  private readonly downloadDir: string;
  private readonly cmdTemplate: string;

  constructor() {
    this.downloadDir = path.resolve(env.PDF_DOWNLOAD_DIR);
    this.cmdTemplate = env.PIPELINE_CMD;
  }

  /**
   * Ensures the configured download directory exists, creating it recursively if needed.
   */
  async ensureDownloadDir(): Promise<void> {
    await fs.mkdir(this.downloadDir, { recursive: true });
  }

  /**
   * Saves a PDF attachment to the download directory with a sanitised filename.
   * @param filename - Original attachment name (sanitised for the filesystem)
   * @param data - Raw PDF bytes
   * @returns The absolute path to the saved file
   */
  async saveAttachment(filename: string, data: Buffer): Promise<string> {
    await this.ensureDownloadDir();
    const safe = path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, '_');
    const filePath = path.join(this.downloadDir, safe);
    await fs.writeFile(filePath, data);
    logger.info('PDF attachment saved', { filePath, size: data.length, originalName: filename });
    return filePath;
  }

  /**
   * Runs the external Python pipeline against a PDF file already on disk.
   * @param pdfPath - Absolute or relative path to the PDF file
   * @returns The pipeline result including exit code, stdout, and stderr
   */
  async processPdf(pdfPath: string): Promise<PipelineResult> {
    const resolvedPath = path.resolve(pdfPath);
    const cmdParts = this.cmdTemplate.split(/\s+/);
    const cmd = cmdParts[0];
    const args = [...cmdParts.slice(1), '--pdf', resolvedPath];

    logger.info('Spawning Python pipeline', { cmd, args, pdf: resolvedPath });
    const result = await spawnAndWait(cmd, args);

    const success = result.exitCode === 0;
    logger.info('Pipeline finished', {
      pdf: resolvedPath,
      exitCode: result.exitCode,
      success,
      stdoutLength: result.stdout.length,
      stderrLength: result.stderr.length,
    });

    return { success, pdfFile: resolvedPath, ...result };
  }

  /**
   * Saves the attachment to disk and processes it through the pipeline,
   * but only if the filename ends with ".pdf" or the MIME type indicates PDF.
   * @param filename - Attachment filename
   * @param data - Raw file bytes
   * @param mimeType - Optional MIME type of the attachment
   * @returns Pipeline result, or null if the file is not a PDF
   */
  async processPdfIfExists(filename: string, data: Buffer, mimeType?: string): Promise<PipelineResult | null> {
    const fn = filename.toLowerCase();
    const mime = (mimeType || '').toLowerCase();
    const isPdf = fn.endsWith('.pdf') || mime === 'application/pdf';
    if (!isPdf) {
      return null;
    }

    // Validate PDF magic bytes to prevent processing non-PDF files
    if (data.length < PDF_MAGIC.length || data.subarray(0, PDF_MAGIC.length).compare(PDF_MAGIC) !== 0) {
      logger.warn('File rejected: not a valid PDF (missing %PDF header)', { filename });
      return null;
    }
    const filePath = await this.saveAttachment(filename, data);
    return this.processPdf(filePath);
  }
}

export const pipelineBridge = new PipelineBridgeService();
