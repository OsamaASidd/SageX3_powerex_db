/**
 * Render invoices to local HTML files without starting the web server, for checking the layout.
 * Usage: npx ts-node --transpile-only scripts/render-sample.ts <outDir> <invoiceNum>...
 */
import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { config } from '../src/config';
import { getInvoice } from '../src/invoices';
import { renderInvoice } from '../src/invoiceHtml';
import { pool } from '../src/db';

async function main() {
  const [outDir, ...nums] = process.argv.slice(2);
  fs.mkdirSync(outDir, { recursive: true });
  const assets = pathToFileURL(config.assetsDir).href;
  for (const num of nums) {
    const inv = await getInvoice(num);
    if (!inv) {
      console.log(`${num}: not found`);
      continue;
    }
    // DEMO_IRN / DEMO_QR show how a posted invoice prints, without posting anything.
    const post = process.env.DEMO_IRN
      ? { num, env: 'preprod', irn: process.env.DEMO_IRN, qrCodeUrl: process.env.DEMO_QR, status: 'SIGNED', attempts: 1 }
      : undefined;
    const html = renderInvoice(inv, { forPdf: true, post, env: config.nrs.env }).replace(/\/assets\//g, `${assets}/`);
    const file = path.join(outDir, `${num}.html`);
    fs.writeFileSync(file, html);
    console.log(`${num}: ${inv.lineSource}, ${inv.lines.length} line(s), PO ${inv.poNumber || '-'}, ${inv.currency} ${inv.total} -> ${file}`);
  }
  (await pool()).close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
