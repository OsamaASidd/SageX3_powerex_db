import { sageHttp } from './client';
import { config } from '../config';
import { SageCreditNote, SageInvoice } from './types';

/**
 * ============================================================================
 * INTEGRATION BOUNDARY - NOT YET CONFIRMED AGAINST THE REAL SAGE X3 API
 * ============================================================================
 * Everything above this comment (config, http client, normalized types) is done.
 * What's still needed to finish this file:
 *
 *   1. SAGE_INVOICE_ENDPOINT / SAGE_CREDIT_NOTE_ENDPOINT in .env - the actual
 *      path (relative to SAGE_BASE_URL) that lists sales invoices / credit
 *      notes. This depends on what PE Energy has exposed on erp.peenergy.net:
 *      either the Sage X3 "Web Services" (SOAP, entities like BPCINVOICE) or
 *      the newer X3 REST/OData-style API - ask the Sage X3 admin/consultant
 *      which is enabled, or run `npm run sage:inspect` (src/sage/inspect.ts)
 *      once you have a candidate path to see the raw JSON shape.
 *   2. The field names below (marked "CONFIRM") mapped from the raw response
 *      to the normalized SageInvoice/SageCreditNote shape in ./types.ts.
 *
 * Until then, this throws a clear error instead of guessing field names and
 * silently producing wrong data.
 * ============================================================================
 */

type RawRecord = Record<string, any>;

function assertConfigured(endpoint: string, envVarName: string): void {
  if (!endpoint) {
    throw new Error(
      `${envVarName} is not set. Configure it in .env once the Sage X3 invoice/credit-note ` +
        `endpoint is confirmed - see the comment block at the top of src/sage/fetchDocuments.ts.`,
    );
  }
}

function extractList(responseData: unknown): RawRecord[] {
  if (Array.isArray(responseData)) return responseData as RawRecord[];
  if (responseData && typeof responseData === 'object') {
    const obj = responseData as RawRecord;
    if (Array.isArray(obj.data)) return obj.data;
    if (Array.isArray(obj.items)) return obj.items;
    if (Array.isArray(obj.results)) return obj.results;
  }
  throw new Error('Unrecognized Sage X3 list response shape - could not find an array of records.');
}

/** CONFIRM: field names below are placeholders - adjust to match the real Sage X3 payload. */
function mapRawToInvoice(raw: RawRecord): SageInvoice {
  return {
    sourceId: String(raw.sourceId ?? raw.documentNumber ?? raw.number),
    documentNumber: String(raw.documentNumber ?? raw.number),
    issueDate: raw.issueDate ?? raw.date,
    dueDate: raw.dueDate,
    currencyCode: raw.currencyCode ?? 'NGN',
    customer: {
      name: raw.customer?.name,
      tin: raw.customer?.tin,
      email: raw.customer?.email,
      phone: raw.customer?.phone,
      addressStreet: raw.customer?.address?.street,
      addressCity: raw.customer?.address?.city,
      addressPostalZone: raw.customer?.address?.postalZone,
      countryCode: raw.customer?.address?.countryCode ?? 'NG',
    },
    lines: (raw.lines ?? []).map((l: RawRecord) => ({
      description: l.description,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      lineExtensionAmount: l.lineExtensionAmount,
      taxAmount: l.taxAmount,
      totalAmount: l.totalAmount,
      taxPercent: l.taxPercent,
    })),
    legalMonetaryTotal: {
      lineExtensionAmount: raw.totals?.lineExtensionAmount,
      taxExclusiveAmount: raw.totals?.taxExclusiveAmount,
      taxInclusiveAmount: raw.totals?.taxInclusiveAmount,
      payableAmount: raw.totals?.payableAmount,
    },
  };
}

/** CONFIRM: field names below are placeholders - adjust to match the real Sage X3 payload. */
function mapRawToCreditNote(raw: RawRecord): SageCreditNote {
  return {
    ...mapRawToInvoice(raw),
    linkedInvoiceSourceId: String(raw.linkedInvoiceNumber ?? raw.originalInvoiceNumber),
    reason: raw.reason,
  };
}

export async function fetchNewInvoices(sinceIso?: string): Promise<SageInvoice[]> {
  assertConfigured(config.sage.invoiceEndpoint, 'SAGE_INVOICE_ENDPOINT');
  const res = await sageHttp.get(config.sage.invoiceEndpoint, {
    params: sinceIso ? { since: sinceIso } : undefined,
  });
  return extractList(res.data).map(mapRawToInvoice);
}

export async function fetchNewCreditNotes(sinceIso?: string): Promise<SageCreditNote[]> {
  assertConfigured(config.sage.creditNoteEndpoint, 'SAGE_CREDIT_NOTE_ENDPOINT');
  const res = await sageHttp.get(config.sage.creditNoteEndpoint, {
    params: sinceIso ? { since: sinceIso } : undefined,
  });
  return extractList(res.data).map(mapRawToCreditNote);
}
