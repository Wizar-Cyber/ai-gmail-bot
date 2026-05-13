import path from 'path';
import fs from 'fs/promises';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { spawnAndWait } from '../utils/exec';

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
   * but only if the filename ends with ".pdf".
   * @param filename - Attachment filename (case-insensitive ".pdf" check)
   * @param data - Raw file bytes
   * @returns Pipeline result, or null if the file is not a PDF
   */
  async processPdfIfExists(filename: string, data: Buffer): Promise<PipelineResult | null> {
    if (!filename.toLowerCase().endsWith('.pdf')) {
      return null;
    }
    const filePath = await this.saveAttachment(filename, data);
    return this.processPdf(filePath);
  }
}

export const pipelineBridge = new PipelineBridgeService();
