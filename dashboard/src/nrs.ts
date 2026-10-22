import { config } from './config';
import { logger } from './logger';

/** Subset of the Cryptware NRS API the dashboard uses. See ../../src/nrs for the full client and its notes. */

export interface NrsInvoiceLine {
  description: string;
  hsn_code: string;
  product_category: string;
  invoiced_quantity: number;
  price_amount: number;
  base_quantity: number;
  price_unit: string;
  tax_rate: number;
  tax_category_id: 'STANDARD_VAT' | 'ZERO_VAT';
  discount_rate: number;
  line_extension_amount: number;
  tax_amount: number;
  total_amount: number;
}

export interface NrsInvoicePayload {
  invoice_type: 'STANDARD';
  transaction_category: 'B2B' | 'B2C';
  accounting_customer_party: {
    party_name: string;
    tin: string;
    email: string;
    telephone: string;
    business_description: string;
    postal_address: { street_name: string; city_name: string; postal_zone: string; country: string };
  };
  document_identifier: string;
  issue_date: string;
  due_date?: string;
  invoice_type_code: string;
  document_currency_code: string;
  note?: string;
  cancel_references?: { original_irn: string; original_issue_date: string }[];
  invoice_lines: NrsInvoiceLine[];
  legal_monetary_total: {
    line_extension_amount: number;
    tax_exclusive_amount: number;
    tax_inclusive_amount: number;
    payable_amount: number;
  };
}

export interface NrsGenerateResult {
  id: string;
  irn: string;
  status: string;
  qr_code_url?: string;
}

export interface NrsStatus {
  id: string;
  irn: string;
  status: string;
  firsStatus?: string;
  firsErrors?: unknown;
}

export class NrsError extends Error {
  constructor(message: string, readonly httpStatus?: number, readonly body?: unknown) {
    super(message);
  }
}

function ready() {
  if (!config.nrs.baseUrl || !config.nrs.apiKey) {
    throw new NrsError(`NRS ${config.nrs.env} is not configured: set its base URL and API key in .env.dashboard.`);
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  ready();
  const started = Date.now();
  const entry = { env: config.nrs.env, method, path, request: body };
  let res: Response;
  try {
    res = await fetch(`${config.nrs.baseUrl}${path}`, {
      method,
      headers: { 'X-API-KEY': config.nrs.apiKey, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.nrs({ ...entry, ms: Date.now() - started, error: msg });
    throw new NrsError(`NRS ${method} ${path} could not be reached: ${msg}`);
  }
  const text = await res.text();
  let json: any = undefined;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    /* non-JSON error page */
  }
  const ms = Date.now() - started;
  // Reference-data lookups are large and uninteresting; log their size only.
  const response = path.startsWith('/reference-data') ? `${text.length} bytes` : json ?? text.slice(0, 2000);
  if (!res.ok) {
    const detail = json?.message ?? json?.error ?? text.slice(0, 300) ?? res.statusText;
    const message = `NRS ${method} ${path} failed (${res.status}): ${Array.isArray(detail) ? detail.join('; ') : detail}`;
    logger.nrs({ ...entry, status: res.status, ms, response, error: message });
    throw new NrsError(message, res.status, json ?? text);
  }
  logger.nrs({ ...entry, status: res.status, ms, response });
  return (json?.data ?? json) as T;
}

let typeCodes: Map<string, string> | null = null;

/** Invoice-type codes come from reference data (verified: 380 = Credit Note, 381 = Commercial Invoice). */
export async function invoiceTypeCode(name: string): Promise<string> {
  if (!typeCodes) {
    const list = await call<{ code: string; value: string }[]>('GET', '/reference-data/invoice-types');
    typeCodes = new Map(list.map((x) => [x.value.toLowerCase(), x.code]));
  }
  const code = typeCodes.get(name.toLowerCase());
  if (!code) throw new NrsError(`NRS has no invoice type called "${name}"`);
  return code;
}

export const generateInvoice = (payload: NrsInvoicePayload) => call<NrsGenerateResult>('POST', '/invoice/generate', payload);
export const invoiceStatus = (irn: string) => call<NrsStatus>('GET', `/invoice/${encodeURIComponent(irn)}/status`);
export const retryInvoice = (irn: string) => call<unknown>('POST', `/invoice/${encodeURIComponent(irn)}/retry`);

/** NRS's own PDF for a posted invoice, by its NRS id (not the IRN). */
export async function nrsPdf(id: string): Promise<Buffer> {
  ready();
  const started = Date.now();
  const path = `/invoice/${encodeURIComponent(id)}/pdf`;
  const res = await fetch(`${config.nrs.baseUrl}${path}`, {
    headers: { 'X-API-KEY': config.nrs.apiKey },
    signal: AbortSignal.timeout(30000),
  });
  const error = res.ok ? undefined : `NRS PDF download failed (${res.status})`;
  logger.nrs({ env: config.nrs.env, method: 'GET', path, status: res.status, ms: Date.now() - started, error });
  if (error) throw new NrsError(error, res.status);
  return Buffer.from(await res.arrayBuffer());
}
