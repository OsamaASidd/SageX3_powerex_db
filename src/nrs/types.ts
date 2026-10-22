export interface NrsPostalAddress {
  street_name?: string;
  city_name?: string;
  postal_zone?: string;
  country?: string; // ISO 3166-1 alpha-2, e.g. "NG"
}

export interface NrsAccountingCustomerParty {
  party_name: string;
  tin?: string;
  email?: string;
  telephone?: string; // E.164, e.g. +234...
  business_description?: string;
  postal_address?: NrsPostalAddress;
}

export interface NrsInvoiceLine {
  product_id?: string;
  description: string;
  hsn_code?: string;
  product_category?: string;
  invoiced_quantity: number;
  price_amount: number;
  base_quantity: number;
  price_unit: string;
  discount_rate?: number;
  discount_amount?: number;
  line_extension_amount: number;
  tax_amount: number;
  total_amount: number;
}

export interface NrsLegalMonetaryTotal {
  line_extension_amount: number;
  tax_exclusive_amount: number;
  tax_inclusive_amount: number;
  payable_amount: number;
}

export interface NrsTaxSubtotal {
  taxable_amount: number;
  tax_amount: number;
  tax_category_id: string;
  tax_percent: number;
}

export interface NrsTaxTotal {
  tax_amount: number;
  tax_subtotals?: NrsTaxSubtotal[];
}

export interface NrsCancelReference {
  original_irn: string;
  original_issue_date: string; // date-time
}

export interface NrsInvoicePayload {
  invoice_type: 'STANDARD' | 'SELF_BILLED';
  transaction_category: 'B2B' | 'B2C';
  customer_id?: string;
  accounting_customer_party?: NrsAccountingCustomerParty;
  document_identifier: string;
  issue_date: string;
  due_date?: string;
  invoice_type_code: string; // resolved dynamically from /reference-data/invoice-types
  payment_status?: 'PENDING' | 'PAID' | 'REJECTED';
  note?: string;
  document_currency_code: string;
  tax_currency_code?: string;
  actual_delivery_date?: string;
  additional_info?: string;
  cancel_references?: NrsCancelReference[];
  invoice_lines: NrsInvoiceLine[];
  legal_monetary_total: NrsLegalMonetaryTotal;
  tax_total?: NrsTaxTotal[];
}

export interface NrsInvoiceResponse {
  id: string;
  irn: string;
  status: 'PENDING' | 'VALIDATION_PENDING' | 'VALIDATED' | 'SIGNING_PENDING' | 'SIGNED' | 'FAILED' | 'RETRY_PENDING';
  qr_code_url?: string;
  invoiceType?: string;
  documentType?: string;
  transactionCategory?: string;
  customer?: { id: string; name: string; tin: string };
  createdAt?: string;
}

export interface NrsInvoiceStatus {
  id: string;
  irn: string;
  status: string;
  firsStatus?: string;
  firsErrors?: unknown;
  retryCount?: number;
  lastRetryAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface NrsInvoiceTypeRef {
  id: string;
  code: string;
  value: string;
}

export interface NrsReportInvoice {
  id: string;
  irn: string;
  issueDate: string;
  dueDate?: string | null;
  paymentStatus?: string;
  status: string;
  payableAmount: string;
  invoiceType?: string;
  documentType: string; // e.g. "COMMERCIAL_INVOICE", "CREDIT_NOTE"
  invoiceTypeCode: string;
  documentCurrencyCode: string;
  qrCodeUrl?: string;
  buyerReference?: string | null;
  orderReference?: string | null;
  customer?: { id: string; name: string; email?: string; tin?: string };
}

export interface NrsReportInvoiceFilters {
  status?: string;
  customerId?: string;
  invoiceType?: string;
  startDate?: string;
  endDate?: string;
}
