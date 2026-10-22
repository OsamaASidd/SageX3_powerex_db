import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config();

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const config = {
  sage: {
    baseUrl: required('SAGE_BASE_URL'),
    username: required('SAGE_USERNAME'),
    password: required('SAGE_PASSWORD'),
    invoiceEndpoint: process.env.SAGE_INVOICE_ENDPOINT ?? '',
    creditNoteEndpoint: process.env.SAGE_CREDIT_NOTE_ENDPOINT ?? '',
  },
  nrs: {
    baseUrl: required('NRS_BASE_URL'),
    apiKey: required('NRS_API_KEY'),
    entityName: process.env.NRS_ENTITY_NAME ?? '',
  },
  sync: {
    pollIntervalMinutes: Number(process.env.POLL_INTERVAL_MINUTES ?? '5'),
    maxSubmitAttempts: Number(process.env.MAX_SUBMIT_ATTEMPTS ?? '5'),
    defaultTransactionCategory: (process.env.DEFAULT_TRANSACTION_CATEGORY ?? 'B2B') as 'B2B' | 'B2C',
  },
  stateFile: path.resolve(process.cwd(), process.env.STATE_FILE ?? './data/sync-state.json'),
  viewer: {
    port: Number(process.env.VIEWER_PORT ?? '4000'),
  },
};
