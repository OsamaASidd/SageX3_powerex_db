import * as fs from 'fs';
import * as path from 'path';
import { config } from './config';

/** What happened when an invoice was posted to NRS. Kept per environment so pre-prod tests never block prod. */
export interface PostRecord {
  num: string;
  env: string;
  nrsId?: string;
  irn?: string;
  status: string;
  qrCodeUrl?: string;
  transactionCategory?: string;
  /** Invoice issue date (YYYY-MM-DD) as sent, needed when a credit note references this invoice. */
  issueDate?: string;
  postedAt?: string;
  checkedAt?: string;
  /** Last problem: a check that stopped the post (status BLOCKED), an API error, or an NRS rejection. */
  error?: string;
  errorAt?: string;
  /** The exact JSON sent to NRS on the last attempt (shown by "See Payload"). */
  sentPayload?: unknown;
  sentAt?: string;
  attempts: number;
}

type StoreFile = Record<string, PostRecord>; // key: `${env}:${num}`

const file = () => path.join(config.dataDir, 'nrs-posts.json');
const key = (num: string) => `${config.nrs.env}:${num}`;

function load(): StoreFile {
  try {
    return JSON.parse(fs.readFileSync(file(), 'utf8')) as StoreFile;
  } catch {
    return {};
  }
}

// Serialise writes so two clicks can't interleave and lose a record.
let queue: Promise<unknown> = Promise.resolve();

function save(data: StoreFile): void {
  fs.mkdirSync(config.dataDir, { recursive: true });
  const tmp = `${file()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file());
}

export function getPost(num: string): PostRecord | undefined {
  return load()[key(num)];
}

export function allPosts(): Map<string, PostRecord> {
  const env = `${config.nrs.env}:`;
  return new Map(
    Object.entries(load())
      .filter(([k]) => k.startsWith(env))
      .map(([, v]) => [v.num, v]),
  );
}

export function updatePost(num: string, patch: Partial<PostRecord>): Promise<PostRecord> {
  const run = queue.then(() => {
    const data = load();
    const current = data[key(num)] ?? { num, env: config.nrs.env, status: 'NOT_POSTED', attempts: 0 };
    const next = { ...current, ...patch, num, env: config.nrs.env };
    data[key(num)] = next;
    save(data);
    return next;
  });
  queue = run.catch(() => undefined);
  return run;
}

/** Per-invoice lock so a double click doesn't submit the same invoice twice. */
const inFlight = new Set<string>();
export function tryLock(num: string): boolean {
  if (inFlight.has(num)) return false;
  inFlight.add(num);
  return true;
}
export function unlock(num: string): void {
  inFlight.delete(num);
}
