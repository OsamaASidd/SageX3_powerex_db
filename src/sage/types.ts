/**
 * Normalized document shape the rest of the middleware works with, independent of
 * however Sage X3's API actually represents invoices/credit notes. Everything under
 * src/sage/fetchDocuments.ts is responsible for producing this shape - that's the one
 * boundary that needs to be finished once the real Sage X3 endpoint/fields are known.
 */

export interface SageParty {
  name: string;
  tin?: string;
  email?: string;
  phone?: string; // E.164 format, e.g. +234...
  addressStreet?: string;
  addressCity?: string;
  addressPostalZone?: string;
  countryCode?: string; // ISO 3166-1 alpha-2, e.g. "NG"
  businessDescription?: string;
}

export interface SageInvoiceLine {
  description: string;
  hsnCode?: string;
  productCategory?: string;
  quantity: number;
  unitPrice: number;
  baseQuantity?: number;
  /** Must be a UN/CEFACT Recommendation 20 unit code (e.g. "EA", "KGM", "C62"), not free
   *  text - see GET /reference-data/uom on the NRS API. Sage X3's own UOM codes will need
   *  mapping to this list as part of finishing src/sage/fetchDocuments.ts. */
  priceUnit?: string;
  discountRate?: number;
  discountAmount?: number;
  lineExtensionAmount: number;
  taxAmount: number;
  totalAmount: number;
  taxPercent?: number;
  taxCategoryId?: string;
}

export interface SageLegalMonetaryTotal {
  lineExtensionAmount: number;
  taxExclusiveAmount: number;
  taxInclusiveAmount: number;
  payableAmount: number;
}

export interface SageDocumentBase {
  sourceId: string; // stable unique key, e.g. `${company}-${site}-${documentNumber}`
  documentNumber: string;
  issueDate: string; // ISO 8601
  dueDate?: string;
  currencyCode: string;
  customer: SageParty;
  lines: SageInvoiceLine[];
  legalMonetaryTotal: SageLegalMonetaryTotal;
  transactionCategory?: 'B2B' | 'B2C';
  note?: string;
}

export type SageInvoice = SageDocumentBase;

export interface SageCreditNote extends SageDocumentBase {
  /** sourceId of the original invoice this credit note is against, so we can look up its IRN */
  linkedInvoiceSourceId: string;
  reason?: string;
}
