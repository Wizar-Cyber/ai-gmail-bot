import { Router, Request, Response } from 'express';
import path from 'path';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { spawnAndWait } from '../utils/exec';

const router = Router();

/** Trigger the Python pipeline to recalculate summary sheet formulas for a given year. */
router.post('/refresh-summary', async (_req: Request, res: Response) => {
  try {
    const cmd = env.PIPELINE_CMD.split(/\s+/);
    const cmdName = cmd[0];
    const cmdArgs = [...cmd.slice(1), '--update-summary', '--summary-year', '2026'];

    logger.info('Refreshing summary formulas', { cmd: cmdName, args: cmdArgs });

    const result = await spawnAndWait(cmdName, cmdArgs, path.resolve('.'));

    if (result.exitCode === 0) {
      logger.info('Summary formulas updated successfully');
      res.json({ status: 'ok', message: 'Summary formulas updated', output: result.stdout.trim() });
    } else {
      logger.error('Failed to update summary formulas', { exitCode: result.exitCode, stderr: result.stderr.trim() });
      res.status(502).json({
        error: 'SUMMARY_UPDATE_ERROR',
        message: `Pipeline exited with code ${result.exitCode}`,
        stderr: result.stderr.trim(),
      });
    }
  } catch (error: any) {
    logger.error('Unhandled error in refresh-summary', { error: error.message });
    res.status(500).json({ error: 'INTERNAL_ERROR', message: error.message });
  }
});

export default router;
