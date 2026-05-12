import path from 'path';
import fs from 'fs/promises';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { spawnAndWait } from '../utils/exec';

export interface PipelineResult {
  success: boolean;
  pdfFile: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

export class PipelineBridgeService {
  private readonly downloadDir: string;
  private readonly cmdTemplate: string;

  constructor() {
    this.downloadDir = path.resolve(env.PDF_DOWNLOAD_DIR);
    this.cmdTemplate = env.PIPELINE_CMD;
  }

  async ensureDownloadDir(): Promise<void> {
    await fs.mkdir(this.downloadDir, { recursive: true });
  }

  async saveAttachment(filename: string, data: Buffer): Promise<string> {
    await this.ensureDownloadDir();
    const safe = path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, '_');
    const filePath = path.join(this.downloadDir, safe);
    await fs.writeFile(filePath, data);
    logger.info('PDF attachment saved', { filePath, size: data.length, originalName: filename });
    return filePath;
  }

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

  async processPdfIfExists(filename: string, data: Buffer): Promise<PipelineResult | null> {
    if (!filename.toLowerCase().endsWith('.pdf')) {
      return null;
    }
    const filePath = await this.saveAttachment(filename, data);
    return this.processPdf(filePath);
  }
}

export const pipelineBridge = new PipelineBridgeService();
