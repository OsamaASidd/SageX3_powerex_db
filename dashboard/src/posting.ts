import { config } from './config';
import { getInvoice } from './invoices';
import { logger } from './logger';
import { generateInvoice, invoiceStatus, NrsError, retryInvoice } from './nrs';
import { buildPayload, getCustomer } from './payload';
import { getPost, PostRecord, tryLock, unlock, updatePost } from './store';

export const isFailed = (status: string) => /FAIL|REJECT|BLOCKED/i.test(status);
export const isDone = (status: string) => /SIGNED|TRANSMITTED|VALIDATED|SUCCESS/i.test(status) && !isFailed(status);

function describe(err: unknown): string {
  if (err instanceof NrsError && err.body && typeof err.body === 'object') {
    const b = err.body as { message?: unknown; errors?: unknown };
    const extra = b.errors ? ` ${JSON.stringify(b.errors).slice(0, 600)}` : '';
    return `${err.message}${extra}`;
  }
  return err instanceof Error ? err.message : String(err);
}

/** Submit one invoice. Never submits an invoice that already has an IRN in this environment. */
export async function postInvoice(num: string): Promise<PostRecord> {
  const existing = getPost(num);
  if (existing?.irn) return existing;
  if (!tryLock(num)) throw new Error(`${num} is already being posted.`);
  // Problems found before anything is sent are saved too, so the list can show them.
  const stop = async (message: string): Promise<never> => {
    logger.warn(`post ${num} blocked before sending`, message);
    await updatePost(num, { status: 'BLOCKED', error: message, errorAt: new Date().toISOString() });
    throw new Error(message);
  };
  try {
    const inv = await getInvoice(num);
    if (!inv) return await stop(`Invoice ${num} was not found in X3.`);
    const cust = await getCustomer(num);
    if (!cust) return await stop(`Customer for ${num} was not found in X3.`);
    let built;
    try {
      built = await buildPayload(inv, cust);
    } catch (err) {
      return await stop(`Could not prepare the NRS data: ${describe(err)}`);
    }
    const { payload, checks, transactionCategory } = built;
    const blocks = checks.filter((c) => c.level === 'block').map((c) => c.message);
    if (!payload || blocks.length) return await stop(blocks.join('\n'));

    const attempts = (existing?.attempts ?? 0) + 1;
    try {
      logger.info(`post ${num}: sending to NRS ${config.nrs.env} as ${transactionCategory} (attempt ${attempts})`);
      await updatePost(num, { sentPayload: payload, sentAt: new Date().toISOString() });
      const res = await generateInvoice(payload);
      logger.info(`post ${num}: accepted, IRN ${res.irn}, status ${res.status}`);
      return await updatePost(num, {
        nrsId: res.id,
        irn: res.irn,
        status: res.status || 'SUBMITTED',
        qrCodeUrl: res.qr_code_url,
        transactionCategory,
        issueDate: payload.issue_date,
        postedAt: new Date().toISOString(),
        error: undefined,
        errorAt: undefined,
        attempts,
      });
    } catch (err) {
      logger.error(`post ${num}: NRS rejected or failed`, describe(err));
      await updatePost(num, { status: 'POST_FAILED', error: describe(err), errorAt: new Date().toISOString(), attempts, transactionCategory });
      throw new Error(describe(err));
    }
  } finally {
    unlock(num);
  }
}

/** Ask NRS for the latest status of a posted invoice. */
export async function refreshStatus(num: string): Promise<PostRecord> {
  const rec = getPost(num);
  if (!rec?.irn) throw new Error(`${num} has not been posted to NRS.`);
  const st = await invoiceStatus(rec.irn);
  const errors = st.firsErrors && JSON.stringify(st.firsErrors) !== '[]' && JSON.stringify(st.firsErrors) !== '{}'
    ? JSON.stringify(st.firsErrors).slice(0, 800)
    : undefined;
  const failed = isFailed(st.status);
  logger.info(`status ${num} (${rec.irn}): ${st.status}${st.firsStatus ? ` / FIRS ${st.firsStatus}` : ''}`);
  return updatePost(num, {
    status: st.status || rec.status,
    checkedAt: new Date().toISOString(),
    error: failed ? errors ?? st.firsStatus ?? 'NRS reported a failure without details.' : undefined,
    errorAt: failed ? new Date().toISOString() : undefined,
  });
}

/** Ask NRS to resend a posted invoice that failed validation or transmission. */
export async function retryPost(num: string): Promise<PostRecord> {
  const rec = getPost(num);
  if (!rec?.irn) throw new Error(`${num} has not been posted to NRS.`);
  logger.info(`retry ${num} (${rec.irn}) requested`);
  await retryInvoice(rec.irn);
  await updatePost(num, { attempts: rec.attempts + 1 });
  return refreshStatus(num);
}
