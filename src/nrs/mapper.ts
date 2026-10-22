import { config } from '../config';
import { NrsCancelReference, NrsInvoiceLine, NrsInvoicePayload } from './types';
import { SageCreditNote, SageInvoice, SageParty } from '../sage/types';

/** The NRS API requires plain YYYY-MM-DD despite its OpenAPI schema saying "date-time". */
function toDateOnly(iso: string): string;
function toDateOnly(iso: string | undefined): string | undefined;
function toDateOnly(iso: string | undefined): string | undefined {
  if (!iso) return undefined;
  return iso.slice(0, 10);
}

function mapParty(party: SageParty): NrsInvoicePayload['accounting_customer_party'] {
  return {
    party_name: party.name,
    tin: party.tin,
    email: party.email,
    telephone: party.phone,
    business_description: party.businessDescription,
    postal_address: {
      street_name: party.addressStreet,
      city_name: party.addressCity,
      postal_zone: party.addressPostalZone,
      country: party.countryCode ?? 'NG',
    },
  };
}

/** Fallback UN/CEFACT Recommendation 20 unit code ("unit") - used only when the source
 *  document doesn't carry a real unit of measure. Verified against GET /reference-data/uom
 *  (2162 valid codes); free-text values like "NGN per bag" are rejected by the live API
 *  despite appearing in the OpenAPI spec's own example. */
const FALLBACK_UOM_CODE = 'C62';

function mapLines(doc: SageInvoice): NrsInvoiceLine[] {
  return doc.lines.map((line) => ({
    description: line.description,
    hsn_code: line.hsnCode,
    product_category: line.productCategory,
    invoiced_quantity: line.quantity,
    price_amount: line.unitPrice,
    base_quantity: line.baseQuantity ?? 1,
    price_unit: line.priceUnit ?? FALLBACK_UOM_CODE,
    discount_rate: line.discountRate,
    discount_amount: line.discountAmount,
    line_extension_amount: line.lineExtensionAmount,
    tax_amount: line.taxAmount,
    total_amount: line.totalAmount,
  }));
}

function baseFields(doc: SageInvoice): Omit<NrsInvoicePayload, 'invoice_type_code' | 'cancel_references'> {
  return {
    invoice_type: 'STANDARD',
    transaction_category: doc.transactionCategory ?? config.sync.defaultTransactionCategory,
    accounting_customer_party: mapParty(doc.customer),
    document_identifier: doc.documentNumber,
    issue_date: toDateOnly(doc.issueDate),
    due_date: toDateOnly(doc.dueDate),
    document_currency_code: doc.currencyCode,
    note: doc.note,
    invoice_lines: mapLines(doc),
    legal_monetary_total: {
      line_extension_amount: doc.legalMonetaryTotal.lineExtensionAmount,
      tax_exclusive_amount: doc.legalMonetaryTotal.taxExclusiveAmount,
      tax_inclusive_amount: doc.legalMonetaryTotal.taxInclusiveAmount,
      payable_amount: doc.legalMonetaryTotal.payableAmount,
    },
  };
}

export function mapInvoiceToNrsPayload(invoice: SageInvoice, invoiceTypeCode: string): NrsInvoicePayload {
  return {
    ...baseFields(invoice),
    invoice_type_code: invoiceTypeCode,
  };
}

export function mapCreditNoteToNrsPayload(
  creditNote: SageCreditNote,
  creditNoteTypeCode: string,
  originalIrn: string,
  originalIssueDate: string,
): NrsInvoicePayload {
  const cancelReferences: NrsCancelReference[] = [
    { original_irn: originalIrn, original_issue_date: toDateOnly(originalIssueDate) },
  ];
  return {
    ...baseFields(creditNote),
    invoice_type_code: creditNoteTypeCode,
    cancel_references: cancelReferences,
    additional_info: creditNote.reason,
  };
}
