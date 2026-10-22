import * as fs from 'fs';
import * as path from 'path';
import './config'; // loads .env / .env.dashboard so LOG_DIR and LOG_RETENTION_DAYS are set

/**
 * Daily log files in dashboard/logs (override with LOG_DIR):
 *   app-YYYY-MM-DD.log  everything: startup, requests, posts, errors
 *   nrs-YYYY-MM-DD.log  every NRS API call with the data sent and the response, for audit and support
 * Files older than LOG_RETENTION_DAYS (default 90) are deleted at startup and once a day.
 */
const dir = path.resolve(process.env.LOG_DIR || path.join(__dirname, '..', 'logs'));
const retentionDays = Number(process.env.LOG_RETENTION_DAYS ?? '90');
fs.mkdirSync(dir, { recursive: true });

type Level = 'INFO' | 'WARN' | 'ERROR';

const day = () => new Date().toISOString().slice(0, 10);

function write(file: 'app' | 'nrs', line: string) {
  try {
    fs.appendFileSync(path.join(dir, `${file}-${day()}.log`), line + '\n');
  } catch (err) {
    console.error('could not write log file', err);
  }
}

function format(level: Level, message: string, extra?: unknown): string {
  let line = `${new Date().toISOString()} ${level.padEnd(5)} ${message}`;
  if (extra !== undefined) {
    const detail = extra instanceof Error ? extra.stack ?? extra.message : typeof extra === 'string' ? extra : JSON.stringify(extra);
    line += ` | ${detail}`;
  }
  return line;
}

function log(level: Level, message: string, extra?: unknown) {
  const line = format(level, message, extra);
  (level === 'ERROR' ? console.error : level === 'WARN' ? console.warn : console.log)(line);
  write('app', line);
}

export const logger = {
  info: (message: string, extra?: unknown) => log('INFO', message, extra),
  warn: (message: string, extra?: unknown) => log('WARN', message, extra),
  error: (message: string, extra?: unknown) => log('ERROR', message, extra),
  /** One NRS API exchange; the API key is never logged. */
  nrs: (entry: { env: string; method: string; path: string; status?: number; ms: number; request?: unknown; response?: unknown; error?: string }) => {
    write('nrs', JSON.stringify({ time: new Date().toISOString(), ...entry }));
    const summary = `NRS ${entry.env} ${entry.method} ${entry.path} -> ${entry.status ?? 'no response'} in ${entry.ms}ms`;
    if (entry.error) log('WARN', summary, entry.error);
    else write('app', format('INFO', summary));
  },
  dir,
};

function prune() {
  if (!(retentionDays > 0)) return;
  const cutoff = Date.now() - retentionDays * 86400000;
  for (const f of fs.readdirSync(dir)) {
    const m = /^(app|nrs)-(\d{4}-\d{2}-\d{2})\.log$/.exec(f);
    if (m && Date.parse(m[2]) < cutoff) fs.rmSync(path.join(dir, f), { force: true });
  }
}
prune();
setInterval(prune, 86400000).unref();
