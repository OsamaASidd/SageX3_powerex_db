import axios, { AxiosInstance, isAxiosError } from 'axios';
import { Readable } from 'stream';
import { config } from '../config';
import {
  NrsInvoicePayload,
  NrsInvoiceResponse,
  NrsInvoiceStatus,
  NrsInvoiceTypeRef,
  NrsReportInvoice,
  NrsReportInvoiceFilters,
} from './types';

export class NrsApiError extends Error {
  constructor(
    message: string,
    public readonly httpStatus?: number,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = 'NrsApiError';
  }
}

interface Envelope<T> {
  status: string;
  message?: string;
  data: T;
}

function unwrap<T>(err: unknown, action: string): never {
  if (isAxiosError(err)) {
    const body = err.response?.data;
    const message = (body && (body as { message?: string }).message) || err.message;
    throw new NrsApiError(`NRS ${action} failed: ${message}`, err.response?.status, body);
  }
  throw err;
}

export class NrsClient {
  private readonly http: AxiosInstance;
  private invoiceTypeCache: Map<string, string> | null = null; // lowercased value -> code

  constructor() {
    this.http = axios.create({
      baseURL: config.nrs.baseUrl,
      headers: {
        'X-API-KEY': config.nrs.apiKey,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    });
  }

  /** Resolves an invoice-type code (e.g. the code for "Commercial Invoice" or "Credit Note")
   *  by name against the live reference data, since the codes are not fixed UBL constants
   *  in this API (verified: 380 = Credit Note, 381 = Commercial Invoice here). */
  async resolveInvoiceTypeCode(name: string): Promise<string> {
    if (!this.invoiceTypeCache) {
      try {
        const res = await this.http.get<Envelope<NrsInvoiceTypeRef[]>>('/reference-data/invoice-types');
        this.invoiceTypeCache = new Map(res.data.data.map((t) => [t.value.toLowerCase(), t.code]));
      } catch (err) {
        unwrap(err, 'fetch invoice types');
      }
    }
    const code = this.invoiceTypeCache!.get(name.toLowerCase());
    if (!code) {
      throw new NrsApiError(`Unknown NRS invoice type name: "${name}". Known types: ${[...this.invoiceTypeCache!.keys()].join(', ')}`);
    }
    return code;
  }

  async generateInvoice(payload: NrsInvoicePayload): Promise<NrsInvoiceResponse> {
    try {
      const res = await this.http.post<Envelope<NrsInvoiceResponse>>('/invoice/generate', payload);
      return res.data.data;
    } catch (err) {
      return unwrap(err, 'generate invoice');
    }
  }

  async getInvoiceStatus(identifier: string): Promise<NrsInvoiceStatus> {
    try {
      const res = await this.http.get<Envelope<NrsInvoiceStatus>>(`/invoice/${encodeURIComponent(identifier)}/status`);
      return res.data.data;
    } catch (err) {
      return unwrap(err, `get status for ${identifier}`);
    }
  }

  async retryInvoice(identifier: string): Promise<void> {
    try {
      await this.http.post(`/invoice/${encodeURIComponent(identifier)}/retry`);
    } catch (err) {
      unwrap(err, `retry invoice ${identifier}`);
    }
  }

  async cancelInvoice(irn: string, reason?: string): Promise<unknown> {
    try {
      const res = await this.http.patch(`/invoice/${encodeURIComponent(irn)}/cancel`, reason ? { reason } : {});
      return res.data;
    } catch (err) {
      return unwrap(err, `cancel invoice ${irn}`);
    }
  }

  /** Lists all invoices/credit notes for the organization (GET /reports/invoices). */
  async listInvoices(filters: NrsReportInvoiceFilters = {}): Promise<NrsReportInvoice[]> {
    try {
      const res = await this.http.get<Envelope<NrsReportInvoice[]>>('/reports/invoices', { params: filters });
      return res.data.data;
    } catch (err) {
      return unwrap(err, 'list invoices');
    }
  }

  /** Streams the PDF for an invoice/credit note by its UUID (not IRN). */
  async getInvoicePdfStream(id: string): Promise<Readable> {
    try {
      const res = await this.http.get(`/invoice/${encodeURIComponent(id)}/pdf`, { responseType: 'stream' });
      return res.data as Readable;
    } catch (err) {
      return unwrap(err, `download PDF for ${id}`);
    }
  }
}

export const nrsClient = new NrsClient();
