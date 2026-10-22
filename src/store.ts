import * as fs from 'fs';
import * as path from 'path';
import { config } from './config';

export type DocType = 'invoice' | 'credit_note';

export type SyncStatus =
  | 'PENDING'          // discovered in Sage, not yet submitted to NRS
  | 'SUBMITTED'        // accepted by NRS, awaiting FIRS processing
  | 'SYNCED'           // FIRS confirmed (SIGNED/TRANSMITTED)
  | 'FAILED'           // submission or processing failed, may retry
  | 'AWAITING_PARENT'; // credit note waiting on its original invoice's IRN

export interface SyncRecord {
  docType: DocType;
  sourceId: string;            // stable key from Sage X3, e.g. "SO2-SINV-INV000123"
  documentNumber: string;      // human-readable Sage document number
  issueDate?: string;          // the document's own issue date (needed as original_issue_date on credit notes)
  linkedInvoiceSourceId?: string; // for credit notes: sourceId of the original invoice
  nrsId?: string;
  nrsIrn?: string;
  nrsStatus?: string;
  status: SyncStatus;
  attempts: number;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

interface StateFile {
  lastInvoicePollAt?: string;
  lastCreditNotePollAt?: string;
  records: Record<string, SyncRecord>; // keyed by `${docType}:${sourceId}`
}

let writeQueue: Promise<void> = Promise.resolve();

function keyFor(docType: DocType, sourceId: string): string {
  return `${docType}:${sourceId}`;
}

function load(): StateFile {
  if (!fs.existsSync(config.stateFile)) {
    return { records: {} };
  }
  const raw = fs.readFileSync(config.stateFile, 'utf-8');
  if (!raw.trim()) return { records: {} };
  return JSON.parse(raw) as StateFile;
}

function saveAtomic(state: StateFile): Promise<void> {
  writeQueue = writeQueue.then(() => {
    const dir = path.dirname(config.stateFile);
    fs.mkdirSync(dir, { recursive: true });
    const tmpFile = `${config.stateFile}.tmp`;
    fs.writeFileSync(tmpFile, JSON.stringify(state, null, 2), 'utf-8');
    fs.renameSync(tmpFile, config.stateFile);
  });
  return writeQueue;
}

export function getRecord(docType: DocType, sourceId: string): SyncRecord | undefined {
  return load().records[keyFor(docType, sourceId)];
}

export async function upsertRecord(record: Partial<SyncRecord> & { docType: DocType; sourceId: string }): Promise<SyncRecord> {
  const state = load();
  const key = keyFor(record.docType, record.sourceId);
  const existing = state.records[key];
  const now = new Date().toISOString();
  const defaults: Pick<SyncRecord, 'status' | 'attempts'> = { status: 'PENDING', attempts: 0 };
  const merged: SyncRecord = {
    ...defaults,
    ...existing,
    ...record,
    documentNumber: record.documentNumber ?? existing?.documentNumber ?? record.sourceId,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  state.records[key] = merged;
  await saveAtomic(state);
  return merged;
}

export function listByStatus(docType: DocType, statuses: SyncStatus[]): SyncRecord[] {
  const state = load();
  return Object.values(state.records).filter((r) => r.docType === docType && statuses.includes(r.status));
}

export function listInFlight(): SyncRecord[] {
  const state = load();
  return Object.values(state.records).filter((r) => r.status === 'SUBMITTED');
}

export function getLastPollTimestamp(docType: DocType): string | undefined {
  const state = load();
  return docType === 'invoice' ? state.lastInvoicePollAt : state.lastCreditNotePollAt;
}

export async function setLastPollTimestamp(docType: DocType, isoTimestamp: string): Promise<void> {
  const state = load();
  if (docType === 'invoice') state.lastInvoicePollAt = isoTimestamp;
  else state.lastCreditNotePollAt = isoTimestamp;
  await saveAtomic(state);
}
