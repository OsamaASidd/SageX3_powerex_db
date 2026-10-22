import cron from 'node-cron';
import { config } from './config';
import { logger } from './logger';
import { syncInvoices } from './sync/syncInvoices';
import { syncCreditNotes } from './sync/syncCreditNotes';
import { reconcileStatuses } from './sync/reconcileStatus';

let running = false;

async function tick(): Promise<void> {
  if (running) {
    logger.warn('tick: previous sync still running, skipping this interval');
    return;
  }
  running = true;
  const startedAt = Date.now();
  try {
    await syncInvoices();
    await syncCreditNotes();
    await reconcileStatuses();
  } catch (err) {
    logger.error('tick: unhandled error during sync cycle', err);
  } finally {
    running = false;
    logger.info(`tick: completed in ${Date.now() - startedAt}ms`);
  }
}

function main(): void {
  logger.info(`Starting Sage X3 -> NRS middleware for "${config.nrs.entityName}"`, {
    pollIntervalMinutes: config.sync.pollIntervalMinutes,
  });

  const cronExpression = `*/${config.sync.pollIntervalMinutes} * * * *`;
  cron.schedule(cronExpression, () => {
    void tick();
  });

  // run once immediately on startup instead of waiting for the first interval
  void tick();
}

main();
