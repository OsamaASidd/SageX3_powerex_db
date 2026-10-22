import { fetchNewCreditNotes } from '../sage/fetchDocuments';
import { nrsClient, NrsApiError } from '../nrs/client';
import { mapCreditNoteToNrsPayload } from '../nrs/mapper';
import { getRecord, upsertRecord, getLastPollTimestamp, setLastPollTimestamp } from '../store';
import { logger } from '../logger';
import { config } from '../config';

const NRS_CREDIT_NOTE_TYPE_NAME = 'Credit Note';

export async function syncCreditNotes(): Promise<void> {
  const since = getLastPollTimestamp('credit_note');
  const pollStartedAt = new Date().toISOString();

  const creditNotes = await fetchNewCreditNotes(since);
  if (creditNotes.length === 0) {
    logger.info('syncCreditNotes: no new credit notes from Sage X3');
  }

  const creditNoteTypeCode =
    creditNotes.length > 0 ? await nrsClient.resolveInvoiceTypeCode(NRS_CREDIT_NOTE_TYPE_NAME) : undefined;

  for (const creditNote of creditNotes) {
    const existing = getRecord('credit_note', creditNote.sourceId);
    if (existing && (existing.status === 'SUBMITTED' || existing.status === 'SYNCED')) {
      continue;
    }
    if (existing && existing.attempts >= config.sync.maxSubmitAttempts) {
      logger.warn(`syncCreditNotes: ${creditNote.documentNumber} exceeded max attempts, skipping (manual review needed)`);
      continue;
    }

    const originalInvoiceRecord = getRecord('invoice', creditNote.linkedInvoiceSourceId);
    if (!originalInvoiceRecord?.nrsIrn || !originalInvoiceRecord.issueDate) {
      await upsertRecord({
        docType: 'credit_note',
        sourceId: creditNote.sourceId,
        documentNumber: creditNote.documentNumber,
        linkedInvoiceSourceId: creditNote.linkedInvoiceSourceId,
        status: 'AWAITING_PARENT',
        attempts: existing?.attempts ?? 0,
        lastError: 'Original invoice has not been synced to NRS yet (no IRN available)',
      });
      logger.warn(
        `syncCreditNotes: ${creditNote.documentNumber} waiting on original invoice ${creditNote.linkedInvoiceSourceId} to sync first`,
      );
      continue;
    }

    try {
      const payload = mapCreditNoteToNrsPayload(
        creditNote,
        creditNoteTypeCode!,
        originalInvoiceRecord.nrsIrn,
        originalInvoiceRecord.issueDate,
      );
      const result = await nrsClient.generateInvoice(payload);
      await upsertRecord({
        docType: 'credit_note',
        sourceId: creditNote.sourceId,
        documentNumber: creditNote.documentNumber,
        issueDate: creditNote.issueDate,
        linkedInvoiceSourceId: creditNote.linkedInvoiceSourceId,
        nrsId: result.id,
        nrsIrn: result.irn,
        nrsStatus: result.status,
        status: 'SUBMITTED',
        attempts: (existing?.attempts ?? 0) + 1,
        lastError: undefined,
      });
      logger.info(`syncCreditNotes: submitted ${creditNote.documentNumber} -> IRN ${result.irn}`);
    } catch (err) {
      const message = err instanceof NrsApiError ? err.message : String(err);
      await upsertRecord({
        docType: 'credit_note',
        sourceId: creditNote.sourceId,
        documentNumber: creditNote.documentNumber,
        linkedInvoiceSourceId: creditNote.linkedInvoiceSourceId,
        status: 'FAILED',
        attempts: (existing?.attempts ?? 0) + 1,
        lastError: message,
      });
      logger.error(`syncCreditNotes: failed to submit ${creditNote.documentNumber}`, message);
    }
  }

  await setLastPollTimestamp('credit_note', pollStartedAt);
}
