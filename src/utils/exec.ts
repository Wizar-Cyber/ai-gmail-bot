import { spawn } from 'child_process';
import path from 'path';

/** Result of executing a child process. */
export interface SpawnResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

/**
 * Spawns a child process and waits for it to exit, collecting stdout and stderr.
 * @param command - The executable to run
 * @param args - Command-line arguments
 * @param cwd - Working directory for the child process (defaults to project root)
 * @returns A promise that resolves with the exit code and captured output
 */
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
