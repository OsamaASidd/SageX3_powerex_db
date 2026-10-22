/**
 * Build the NRS submission for invoices without sending it, and print the checks.
 * Usage: npx ts-node --transpile-only scripts/dry-run.ts <invoiceNum>...
 */
import { config } from '../src/config';
import { pool } from '../src/db';
import { getInvoice } from '../src/invoices';
import { buildPayload, getCustomer } from '../src/payload';

async function main() {
  // --hsn=0000.00 tries a default HS code for this run only (nothing is saved or sent).
  const args = process.argv.slice(2);
  const hsnArg = args.find((a) => a.startsWith('--hsn='));
  if (hsnArg) config.nrs.defaultHsnCode = hsnArg.slice(6);
  console.log(`NRS environment: ${config.nrs.env} -> ${config.nrs.baseUrl}`);
  for (const num of args.filter((a) => !a.startsWith('--'))) {
    const inv = await getInvoice(num);
    const cust = inv && (await getCustomer(num));
    if (!inv || !cust) {
      console.log(`\n${num}: not found`);
      continue;
    }
    const { payload, checks, transactionCategory } = await buildPayload(inv, cust);
    console.log(`\n=== ${num} (${transactionCategory}) ${payload ? 'READY' : 'BLOCKED'}`);
    for (const c of checks) console.log(`  [${c.level}] ${c.message}`);
    if (payload) console.log(JSON.stringify(payload, null, 2));
  }
  (await pool()).close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
