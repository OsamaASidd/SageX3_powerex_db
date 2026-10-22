// Smoke test: submits a sample invoice and a linked credit note through the real
// NrsClient/mapper against the live pre-prod sandbox, to catch API contract drift
// (date formats, code validation, etc.) independent of the Sage X3 side.
// Run with: npm run nrs:smoke-test
import { nrsClient } from '../src/nrs/client';
import { mapInvoiceToNrsPayload, mapCreditNoteToNrsPayload } from '../src/nrs/mapper';
import { SageInvoice, SageCreditNote } from '../src/sage/types';

async function main() {
  const sampleInvoice: SageInvoice = {
    sourceId: 'TEST-MW-0001',
    documentNumber: `MW-TEST-${Date.now()}`,
    issueDate: new Date().toISOString(),
    currencyCode: 'NGN',
    transactionCategory: 'B2B',
    customer: {
      name: 'Dangote Refinery',
      tin: '1234567890',
      email: 'sales@dangoteref.com',
      phone: '+2348012345678',
      addressStreet: '1 Refinery Road',
      addressCity: 'Lekki',
      addressPostalZone: '105102',
      countryCode: 'NG',
      businessDescription: 'Oil and Gas',
    },
    lines: [
      {
        description: 'Premium Cement 50kg',
        hsnCode: '2701.90',
        quantity: 100,
        unitPrice: 5000,
        baseQuantity: 1,
        priceUnit: 'EA',
        discountRate: 2.5,
        discountAmount: 12500,
        lineExtensionAmount: 487500,
        taxAmount: 36562.5,
        totalAmount: 524062.5,
      },
    ],
    legalMonetaryTotal: {
      lineExtensionAmount: 487500,
      taxExclusiveAmount: 487500,
      taxInclusiveAmount: 524062.5,
      payableAmount: 524062.5,
    },
    note: 'Middleware integration test',
  };

  console.log('Resolving invoice type code...');
  const invoiceCode = await nrsClient.resolveInvoiceTypeCode('Commercial Invoice');
  console.log('Commercial Invoice code =', invoiceCode);

  console.log('Submitting test invoice...');
  const payload = mapInvoiceToNrsPayload(sampleInvoice, invoiceCode);
  const result = await nrsClient.generateInvoice(payload);
  console.log('Invoice created:', result);

  console.log('Checking status...');
  const status = await nrsClient.getInvoiceStatus(result.irn);
  console.log('Status:', status);

  const creditNoteCode = await nrsClient.resolveInvoiceTypeCode('Credit Note');
  console.log('Credit Note code =', creditNoteCode);

  const sampleCreditNote: SageCreditNote = {
    ...sampleInvoice,
    sourceId: 'TEST-MW-0001-CN1',
    documentNumber: `MW-TEST-CN-${Date.now()}`,
    linkedInvoiceSourceId: sampleInvoice.sourceId,
    reason: 'Partial return - middleware integration test',
    lines: [
      {
        description: 'Premium Cement 50kg - partial credit',
        hsnCode: '2701.90',
        quantity: 10,
        unitPrice: 5000,
        baseQuantity: 1,
        priceUnit: 'EA',
        lineExtensionAmount: 50000,
        taxAmount: 3750,
        totalAmount: 53750,
      },
    ],
    legalMonetaryTotal: {
      lineExtensionAmount: 50000,
      taxExclusiveAmount: 50000,
      taxInclusiveAmount: 53750,
      payableAmount: 53750,
    },
  };

  const cnPayload = mapCreditNoteToNrsPayload(sampleCreditNote, creditNoteCode, result.irn, sampleInvoice.issueDate);
  console.log('Submitting test credit note...');
  const cnResult = await nrsClient.generateInvoice(cnPayload);
  console.log('Credit note created:', cnResult);
}

main().catch((err) => {
  console.error('FAILED:', err.message, err.body ?? '');
  process.exit(1);
});
