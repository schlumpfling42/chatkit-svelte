import { createInterface } from 'node:readline/promises';

export interface PromptIO {
  question(query: string): Promise<string>;
  close(): void;
}

// Node's readline/promises has a real limitation with piped (non-TTY)
// stdin: sequential `question()` calls hang after the first one, because
// the whole input arrives as a single chunk before the second call even
// starts listening for a 'line' event (reproduced independently of this
// codebase — a minimal two-question script hangs the same way). That
// matters beyond just automated testing: any real user piping answers in
// non-interactively (CI, a wrapper script) would hit the same hang. When
// stdin isn't a TTY, read it all upfront and serve answers from a queue
// instead of issuing repeated `question()` calls.
function createPipedPromptIO(): PromptIO {
  const chunks: Buffer[] = [];
  const readAll = new Promise<string[]>((resolve) => {
    process.stdin.on('data', (chunk) => chunks.push(chunk));
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8').split('\n')));
  });
  let linesPromise: Promise<string[]> | undefined;
  let index = 0;

  return {
    async question(query: string) {
      process.stdout.write(query);
      linesPromise ??= readAll;
      const lines = await linesPromise;
      const line = (lines[index] ?? '').replace(/\r$/, '');
      index += 1;
      process.stdout.write(`${line}\n`);
      return line;
    },
    close() {},
  };
}

export function createPromptIO(): PromptIO {
  if (!process.stdin.isTTY) return createPipedPromptIO();
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return { question: (query) => rl.question(query), close: () => rl.close() };
}

export async function askText(io: PromptIO, label: string, defaultValue: string): Promise<string> {
  const answer = (await io.question(`${label} (${defaultValue}): `)).trim();
  return answer || defaultValue;
}

export async function askChoice<T extends string>(io: PromptIO, label: string, choices: T[], defaultValue: T): Promise<T> {
  const answer = (await io.question(`${label} [${choices.join('/')}] (${defaultValue}): `)).trim();
  return (choices as string[]).includes(answer) ? (answer as T) : defaultValue;
}

export async function askMultiChoice<T extends string>(
  io: PromptIO,
  label: string,
  choices: T[],
  defaults: T[]
): Promise<T[]> {
  const answer = (
    await io.question(
      `${label} [${choices.join(', ')}] (default: ${defaults.join(', ')}, comma-separated, "none" for empty): `
    )
  ).trim();
  if (!answer) return defaults;
  if (answer === 'none') return [];
  return answer
    .split(',')
    .map((s) => s.trim())
    .filter((s): s is T => (choices as string[]).includes(s));
}
