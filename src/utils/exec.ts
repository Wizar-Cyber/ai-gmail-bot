import { spawn } from 'child_process';
import path from 'path';

export interface SpawnResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

export function spawnAndWait(
  command: string,
  args: string[],
  cwd?: string,
): Promise<SpawnResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: cwd || path.resolve('.'),
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data: Buffer) => { stdout += data.toString(); });
    child.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });

    child.on('close', (exitCode) => {
      resolve({ exitCode, stdout, stderr });
    });

    child.on('error', (err) => {
      resolve({ exitCode: -1, stdout: '', stderr: `Failed to spawn: ${err.message}` });
    });
  });
}
