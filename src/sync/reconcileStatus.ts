import { nrsClient } from '../nrs/client';
import { listInFlight, upsertRecord } from '../store';
import { logger } from '../logger';
import { config } from '../config';

const TERMINAL_SUCCESS = new Set(['SIGNED', 'TRANSMITTED']);
const TERMINAL_FAILURE = new Set(['FAILED']);

export async function reconcileStatuses(): Promise<void> {
  const inFlight = listInFlight();
  if (inFlight.length === 0) {
    logger.info('reconcileStatuses: nothing in flight');
    return;
  }

  for (const record of inFlight) {
    if (!record.nrsIrn) continue;
    try {
      const status = await nrsClient.getInvoiceStatus(record.nrsIrn);

      if (TERMINAL_SUCCESS.has(status.status)) {
        await upsertRecord({ ...record, status: 'SYNCED', nrsStatus: status.status });
        logger.info(`reconcileStatuses: ${record.documentNumber} confirmed ${status.status}`);
        continue;
      }

      if (TERMINAL_FAILURE.has(status.status)) {
        await upsertRecord({ ...record, status: 'FAILED', nrsStatus: status.status, lastError: JSON.stringify(status.firsErrors) });
        logger.warn(`reconcileStatuses: ${record.documentNumber} failed at FIRS`, status.firsErrors);

        if (record.attempts < config.sync.maxSubmitAttempts) {
          await nrsClient.retryInvoice(record.nrsIrn);
          await upsertRecord({ ...record, status: 'SUBMITTED', attempts: record.attempts + 1 });
          logger.info(`reconcileStatuses: requeued ${record.documentNumber} for retry (attempt ${record.attempts + 1})`);
        }
        continue;
      }

      // still PENDING / VALIDATION_PENDING / SIGNING_PENDING / RETRY_PENDING - just refresh the cached status
      await upsertRecord({ ...record, nrsStatus: status.status });
    } catch (err) {
      logger.error(`reconcileStatuses: failed to check status for ${record.documentNumber}`, err);
    }
  }
}
