import express, { Request, Response } from 'express';
import { config } from '../config';
import { logger } from '../logger';
import { nrsClient } from '../nrs/client';
import { NrsReportInvoice } from '../nrs/types';

const app = express();

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!));
}

function renderRow(inv: NrsReportInvoice): string {
  const kind = inv.documentType === 'CREDIT_NOTE' ? 'Credit Note' : 'Invoice';
  const amount = Number(inv.payableAmount).toLocaleString('en-NG', { minimumFractionDigits: 2 });
  const statusClass = /FAILED/.test(inv.status) ? 'status-failed' : /SIGNED|TRANSMITTED/.test(inv.status) ? 'status-ok' : 'status-pending';
  return `
    <tr>
      <td>${escapeHtml(kind)}</td>
      <td><code>${escapeHtml(inv.irn)}</code></td>
      <td>${escapeHtml(inv.customer?.name ?? '')}</td>
      <td>${escapeHtml(inv.documentCurrencyCode)} ${amount}</td>
      <td>${new Date(inv.issueDate).toLocaleDateString('en-NG')}</td>
      <td><span class="${statusClass}">${escapeHtml(inv.status)}</span></td>
      <td>
        <a href="/pdf/${encodeURIComponent(inv.id)}" target="_blank">PDF</a>
        ${inv.qrCodeUrl ? ` | <a href="${escapeHtml(inv.qrCodeUrl)}" target="_blank">QR</a>` : ''}
      </td>
    </tr>`;
}

app.get('/', async (req: Request, res: Response) => {
  try {
    const filters: Record<string, string> = {};
    for (const key of ['status', 'customerId', 'invoiceType', 'startDate', 'endDate']) {
      const val = req.query[key];
      if (typeof val === 'string' && val) filters[key] = val;
    }
    const invoices = await nrsClient.listInvoices(filters);
    const rows = invoices.length
      ? invoices.map(renderRow).join('\n')
      : '<tr><td colspan="7">No documents found.</td></tr>';

    res.type('html').send(`<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(config.nrs.entityName)} - NRS documents</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 2rem; background: #f7f7f8; color: #1a1a1a; }
    h1 { font-size: 1.25rem; }
    table { width: 100%; border-collapse: collapse; background: white; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    th, td { text-align: left; padding: 0.6rem 0.8rem; border-bottom: 1px solid #eee; font-size: 0.9rem; }
    th { background: #fafafa; }
    .status-ok { color: #0a7d2c; font-weight: 600; }
    .status-failed { color: #b3261e; font-weight: 600; }
    .status-pending { color: #8a6d00; font-weight: 600; }
    .meta { color: #666; font-size: 0.85rem; margin-bottom: 1rem; }
    a { color: #1a56db; text-decoration: none; }
    a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <h1>${escapeHtml(config.nrs.entityName)} - NRS invoices &amp; credit notes</h1>
  <p class="meta">Live from ${escapeHtml(config.nrs.baseUrl)} - ${invoices.length} document(s). Refresh to update.</p>
  <table>
    <thead>
      <tr><th>Type</th><th>IRN</th><th>Customer</th><th>Amount</th><th>Issue date</th><th>Status</th><th>Files</th></tr>
    </thead>
    <tbody>
      ${rows}
    </tbody>
  </table>
</body>
</html>`);
  } catch (err) {
    logger.error('viewer: failed to load invoice list', err);
    res.status(500).type('html').send(`<pre>Failed to load invoices: ${escapeHtml(String(err))}</pre>`);
  }
});

app.get('/pdf/:id', async (req: Request, res: Response) => {
  try {
    const stream = await nrsClient.getInvoicePdfStream(req.params.id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${req.params.id}.pdf"`);
    stream.pipe(res);
  } catch (err) {
    logger.error(`viewer: failed to fetch PDF for ${req.params.id}`, err);
    res.status(502).type('html').send(`<pre>Failed to fetch PDF: ${escapeHtml(String(err))}</pre>`);
  }
});

app.listen(config.viewer.port, () => {
  logger.info(`Invoice viewer running at http://localhost:${config.viewer.port}`);
});
