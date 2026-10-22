/**
 * Render the invoice list to a local HTML file without starting the web server, for checking the layout.
 * Usage: npx ts-node --transpile-only scripts/render-list.ts <outFile> <fromDate> [showErrorFor]
 */
import * as fs from 'fs';
import { pathToFileURL } from 'url';
import { config } from '../src/config';
import { pool } from '../src/db';
import { invoiceCompanies, listInvoices } from '../src/invoices';
import { renderList } from '../src/listHtml';
import { allPosts } from '../src/store';

async function main() {
  const [out, from, show = ''] = process.argv.slice(2);
  const to = process.env.TO ?? '';
  const rows = (await listInvoices({ from, to })).slice(0, 8);
  const f = { q: '', from, to, type: '', cpy: '', nrs: '' };
  const typeCounts: Record<string, number> = {};
  for (const r of rows) typeCounts[r.type] = (typeCounts[r.type] ?? 0) + 1;
  const posts = allPosts();
  // DEMO_ERROR shows how a saved error looks on the `show` invoice; kept in memory only.
  if (show && process.env.DEMO_ERROR) {
    posts.set(show, { num: show, env: config.nrs.env, status: 'BLOCKED', error: process.env.DEMO_ERROR, errorAt: new Date().toISOString(), attempts: 0 });
  }
  const html = renderList(rows, posts, await invoiceCompanies(), f, config.nrs.env, {}, show, typeCounts);
  fs.writeFileSync(out, html.replace(/\/assets\//g, `${pathToFileURL(config.assetsDir).href}/`));
  console.log(`${rows.length} rows -> ${out}`);
  (await pool()).close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
