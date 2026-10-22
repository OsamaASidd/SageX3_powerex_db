import { fetchNewInvoices } from '../sage/fetchDocuments';
import { nrsClient, NrsApiError } from '../nrs/client';
import { mapInvoiceToNrsPayload } from '../nrs/mapper';
import { getRecord, upsertRecord, getLastPollTimestamp, setLastPollTimestamp } from '../store';
import { logger } from '../logger';
import { config } from '../config';

const NRS_INVOICE_TYPE_NAME = 'Commercial Invoice';

export async function syncInvoices(): Promise<void> {
  const since = getLastPollTimestamp('invoice');
  const pollStartedAt = new Date().toISOString();

  const invoices = await fetchNewInvoices(since);
  if (invoices.length === 0) {
    logger.info('syncInvoices: no new invoices from Sage X3');
  }

  const invoiceTypeCode = invoices.length > 0 ? await nrsClient.resolveInvoiceTypeCode(NRS_INVOICE_TYPE_NAME) : undefined;

  for (const invoice of invoices) {
    const existing = getRecord('invoice', invoice.sourceId);
    if (existing && (existing.status === 'SUBMITTED' || existing.status === 'SYNCED')) {
      continue; // already handled
    }
    if (existing && existing.attempts >= config.sync.maxSubmitAttempts) {
      logger.warn(`syncInvoices: ${invoice.documentNumber} exceeded max attempts, skipping (manual review needed)`);
      continue;
    }

    try {
      const payload = mapInvoiceToNrsPayload(invoice, invoiceTypeCode!);
      const result = await nrsClient.generateInvoice(payload);
      await upsertRecord({
        docType: 'invoice',
        sourceId: invoice.sourceId,
        documentNumber: invoice.documentNumber,
        issueDate: invoice.issueDate,
        nrsId: result.id,
        nrsIrn: result.irn,
        nrsStatus: result.status,
        status: 'SUBMITTED',
        attempts: (existing?.attempts ?? 0) + 1,
        lastError: undefined,
      });
      logger.info(`syncInvoices: submitted ${invoice.documentNumber} -> IRN ${result.irn}`);
    } catch (err) {
      const message = err instanceof NrsApiError ? err.message : String(err);
      await upsertRecord({
        docType: 'invoice',
        sourceId: invoice.sourceId,
        documentNumber: invoice.documentNumber,
        status: 'FAILED',
        attempts: (existing?.attempts ?? 0) + 1,
        lastError: message,
      });
      logger.error(`syncInvoices: failed to submit ${invoice.documentNumber}`, message);
    }
  }

  await setLastPollTimestamp('invoice', pollStartedAt);
}
