import { errorData, errorModal, errorModalCss } from './errorModal';
import { PrintableInvoice } from './invoices';
import { Check } from './payload';
import { isDone, isFailed } from './posting';
import { PostRecord } from './store';
import { amountInWords } from './words';

export interface InvoicePageOptions {
  forPdf: boolean;
  post?: PostRecord;
  checks?: Check[];
  flash?: { ok?: string; err?: string };
  env?: string;
  /** Open the error pop-up on load (after a failed post). */
  showError?: boolean;
}

export function statusPill(post: PostRecord | undefined): string {
  if (!post || post.status === 'NOT_POSTED') return '<span class="pill none">Not posted</span>';
  const cls = isFailed(post.status) ? 'bad' : isDone(post.status) ? 'good' : 'wait';
  return `<span class="pill ${cls}">${esc(post.status.replace(/_/g, ' ').toLowerCase())}</span>`;
}

const SYMBOL: Record<string, string> = { USD: '$', NGN: '₦', EUR: '€', GBP: '£', ZAR: 'R' };

export const esc = (v: unknown) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

export const money = (v: number | null) =>
  v == null ? '' : v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const qtyFmt = (v: number | null) =>
  v == null ? '' : v.toLocaleString('en-US', { maximumFractionDigits: 3 });

export function formatDate(d: Date): string {
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${d.getUTCFullYear()}`;
}

export function renderInvoice(inv: PrintableInvoice, opts: InvoicePageOptions): string {
  const co = inv.issuer;
  const post = opts.post;
  const irnBlock = post?.irn
    ? `<div class="irn">
        ${post.qrCodeUrl ? `<img src="${esc(post.qrCodeUrl)}" alt="NRS QR code">` : ''}
        <div><b>IRN:</b> <span class="mono">${esc(post.irn)}</span></div>
        <div class="small">Reported to NRS (FIRS e-invoicing)${opts.env && opts.env !== 'prod' ? ` · ${esc(opts.env)} test environment` : ''}</div>
      </div>`
    : '';
  const sym = SYMBOL[inv.currency] ?? inv.currency;
  const contact = [
    ...co.addressLines.map(esc),
    co.email && `Email: ${esc(co.email)}`,
    co.url && `URL: ${esc(co.url)}`,
  ].filter(Boolean).join('<br>');
  const header = co.brandAssets
    ? `<img class="logo" src="/assets/pe-logo.png" alt="PE Energy Ltd">
    <img class="iso" src="/assets/iso-badge.png" alt="ISO 9001 Bureau Veritas Certification">`
    : `<div class="coname">${esc(co.name)}</div>`;
  const vatLabel = `${Number(inv.vatRate.toFixed(2))}% VAT`;
  const lineRows = inv.lines
    .map(
      (l) => `
      <tr>
        <td class="c">${l.sn}</td>
        <td class="c">${esc(l.mesc)}</td>
        <td class="c">${qtyFmt(l.qty)}</td>
        <td>${esc(l.description)}</td>
        <td class="c">${esc(inv.currency)}</td>
        <td class="r">${money(l.unitPrice)}</td>
        <td class="r">${money(l.amount)}</td>
      </tr>`,
    )
    .join('');
  const total = (label: string, value: number) => `
      <tr class="tot">
        <td colspan="5" class="blank"></td>
        <td class="lbl">${label}</td>
        <td class="amt"><span class="sym">${esc(sym)}</span><span>${money(value)}</span></td>
      </tr>`;

  const bank = inv.bank
    ? `<div>Account Name: ${esc(inv.bank.accountName)}</div>
       <div>Account Number: ${esc(inv.bank.accountNumber)}</div>
       ${inv.bank.sortCode ? `<div>Bank Branch Sort Code: ${esc(inv.bank.sortCode)}</div>` : ''}
       <div>Bank Name: ${esc(inv.bank.bankName)}</div>
       ${inv.bank.address ? `<div>Address: ${esc(inv.bank.address)}</div>` : ''}`
    : `<div>${esc(inv.bankNote)}</div>`;

  const sourceNote =
    inv.lineSource === 'sales-order'
      ? `Lines taken from sales order ${esc(inv.salesOrder)} (this invoice was entered in Accounting).`
      : inv.lineSource === 'accounting'
        ? 'This invoice was entered in Accounting and has no linked sales order with matching items, so its accounting lines are shown.'
        : `Lines taken from the sales invoice${inv.salesOrder ? ` (order ${esc(inv.salesOrder)})` : ''}.`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(inv.num)} - ${esc(co.name)}</title>
<style>
  @page { size: A4; margin: 12mm 12mm 14mm; }
  * { box-sizing: border-box; }
  :root { --surface: #fff; --fg: #1c2326; --muted: #66717a; --bad: #a3361f; --bad-soft: #fbe9e4; }
  html { background: #e9eaec; }
  ${errorModalCss}
  body { margin: 0; font-family: Calibri, Carlito, "Segoe UI", Arial, sans-serif; font-size: 10.5pt; color: #000; }
  .bar { position: sticky; top: 0; z-index: 2; display: flex; gap: 8px; flex-wrap: wrap; align-items: center;
         padding: 10px max(16px, env(safe-area-inset-left)); background: #1f2a30; color: #fff; font-family: "Segoe UI", Arial, sans-serif; font-size: 13px; }
  .bar a, .bar button { color: #fff; background: #33434c; border: 0; border-radius: 6px; padding: 7px 12px; font: inherit; cursor: pointer; text-decoration: none; }
  .bar a.primary { background: #e87722; }
  .bar .note { margin-left: auto; opacity: .75; font-size: 12px; }
  .sheet { width: 210mm; min-height: 297mm; margin: 16px auto; padding: 12mm; background: #fff; box-shadow: 0 2px 10px rgba(0,0,0,.15); }
  .scroll { overflow-x: auto; }
  @media print {
    html { background: #fff; }
    .bar { display: none; }
    .sheet { width: auto; min-height: 0; margin: 0; padding: 0; box-shadow: none; }
  }
  .hdr { display: flex; justify-content: space-between; align-items: flex-start; }
  .hdr .logo { height: 16mm; margin-left: 4mm; margin-top: 2mm; }
  .hdr .iso { height: 19mm; }
  .hdr .coname { font-size: 18pt; font-weight: 700; margin: 4mm 0 2mm; }
  .co { display: grid; grid-template-columns: 1fr 1.25fr auto; gap: 4mm; margin-top: 2mm; font-size: 9.5pt; line-height: 1.35; }
  h1 { text-align: center; font-size: 12.5pt; margin: 9mm 0 3mm; }
  .to-row { display: flex; justify-content: space-between; align-items: flex-start; gap: 6mm; font-size: 9.5pt; line-height: 1.4; }
  .to b { display: block; }
  table { border-collapse: collapse; }
  table.meta { width: 85mm; margin-top: 5mm; font-size: 9pt; }
  table.meta td { border: 1px solid #000; padding: .6mm 1.5mm; }
  table.meta td:first-child { font-weight: 700; width: 36mm; }
  table.meta td:last-child { text-align: center; }
  .inco { margin-top: 7mm; font-size: 9.5pt; line-height: 1.4; }
  table.lines { width: 100%; margin-top: 4mm; font-size: 9pt; }
  table.lines th { border: 1px solid #000; padding: .8mm 1.5mm; font-weight: 700; }
  table.lines td { border: 1px solid #000; padding: .6mm 1.5mm; vertical-align: top; }
  table.lines .c { text-align: center; }
  table.lines .r { text-align: right; font-variant-numeric: tabular-nums; }
  table.lines tr.tot td.blank { border: 0; }
  table.lines tr.tot td.lbl { text-align: center; font-weight: 700; }
  table.lines tr.tot td.amt { font-weight: 700; }
  table.lines tr.tot td.amt span:last-child { float: right; font-variant-numeric: tabular-nums; }
  .words { margin-top: 7mm; font-size: 9.5pt; }
  .words b { margin-right: 2mm; }
  .pay { display: flex; justify-content: space-between; align-items: flex-end; margin-top: 6mm; font-size: 9.5pt; font-weight: 700; line-height: 1.45; }
  .pay .sign { text-align: right; }
  .irn { display: grid; grid-template-columns: auto 1fr; grid-template-rows: auto auto; column-gap: 4mm; align-items: center;
         margin-top: 5mm; padding: 2.5mm; border: 1px solid #000; font-size: 9pt; }
  .irn img { grid-row: span 2; width: 26mm; height: 26mm; }
  .irn .mono { font-family: Consolas, "Courier New", monospace; font-size: 8.5pt; word-break: break-all; }
  .irn .small { font-size: 8pt; color: #444; align-self: start; }
  .src { margin-top: 10mm; font-size: 8pt; color: #666; }
  .nrs { font-family: "Segoe UI", Arial, sans-serif; font-size: 13px; width: 210mm; max-width: calc(100% - 32px); margin: 16px auto 0;
         background: #fff; border: 1px solid #cfd5d9; border-radius: 8px; padding: 12px 16px; display: grid; gap: 8px; color: #1c2326; }
  .nrs h2 { font-size: 14px; margin: 0; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .nrs ul { margin: 0; padding-left: 18px; display: grid; gap: 3px; }
  .nrs li.block { color: #a3361f; }
  .nrs li.warn { color: #7a5200; }
  .nrs .err { color: #a3361f; word-break: break-word; }
  .nrs .ok { color: #2f6b3a; }
  .nrs .kv { display: flex; flex-wrap: wrap; gap: 4px 18px; color: #4b565c; }
  .nrs .kv b { color: #1c2326; font-weight: 600; }
  .nrs form { display: inline; }
  .pill { font-size: 11.5px; font-weight: 600; padding: 2px 8px; border-radius: 999px; text-transform: capitalize; }
  .pill.none { background: #eef0f2; color: #5b666c; }
  .pill.good { background: #e6f2e7; color: #2f6b3a; }
  .pill.wait { background: #fbf1dc; color: #7a5200; }
  .pill.bad { background: #fbe9e4; color: #a3361f; }
  .bar form { display: inline; margin: 0; }
  .bar button.post { background: #2f8f4e; font-weight: 600; }
  .bar button.err { background: #c0392b; font-weight: 600; }
  .bar button[disabled] { opacity: .45; cursor: not-allowed; }
  @media print { .nrs { display: none; } }
  @media print { .src { display: none; } }
</style>
</head>
<body>
${opts.forPdf ? '' : renderNrsBar(inv, opts, sourceNote)}
<div class="scroll"><div class="sheet">
  <div class="hdr">
    ${header}
  </div>
  <div class="co">
    <div>${contact}</div>
    <div>${co.tel ? `Tel: ${esc(co.tel)}` : ''}</div>
    <div>TIN #: ${esc(co.tin || 'Not on file')}</div>
  </div>

  <h1>${esc(inv.title)}</h1>

  <div class="to-row">
    <div class="to"><b>TO:</b>${inv.billTo.map(esc).join('<br>')}</div>
    <table class="meta">
      <tr><td>${inv.type === 'ZACRN' ? 'CREDIT NOTE #' : 'INVOICE #'}</td><td>${esc(inv.num)}</td></tr>
      <tr><td>INVOICE DATE</td><td>${formatDate(inv.date)}</td></tr>
      <tr><td>VENDOR CODE</td><td>${esc(inv.vendorCode)}</td></tr>
      <tr><td>PURCHASE ORDER #</td><td>${esc(inv.poNumber || 'NIL')}</td></tr>
    </table>
  </div>

  <div class="inco"><b>INCOTERMS:</b><br>${esc(inv.incoterms || 'N/A')}</div>

  <table class="lines">
    <colgroup>
      <col style="width:9%"><col style="width:12%"><col style="width:6%"><col style="width:37%">
      <col style="width:5%"><col style="width:13%"><col style="width:18%">
    </colgroup>
    <thead><tr><th>S/N</th><th>MESC CODE</th><th>QTY</th><th>DESCRIPTION</th><th>CUR</th><th>UNIT PRICE</th><th>AMOUNT</th></tr></thead>
    <tbody>
      ${lineRows}
      ${total('SUBTOTAL', inv.subtotal)}
      ${total(vatLabel, inv.vat)}
      ${total('TOTAL', inv.total)}
    </tbody>
  </table>

  <div class="words"><b>Amount in words:</b>${esc(amountInWords(inv.total, inv.currency))}</div>
  ${irnBlock}

  <div class="pay">
    <div><div>Please pay in favour of:</div>${bank}</div>
    <div class="sign">Authorized signature<br>for ${esc(co.name)}</div>
  </div>
  ${opts.forPdf ? '' : `<div class="src">${sourceNote}</div>`}
</div></div>
${opts.forPdf ? '' : errorModal(errorData(post ? [post] : []), opts.showError && post?.error ? inv.num : '')}
</body>
</html>`;
}

function renderNrsBar(inv: PrintableInvoice, opts: InvoicePageOptions, sourceNote: string): string {
  const post = opts.post;
  const n = encodeURIComponent(inv.num);
  const blocks = (opts.checks ?? []).filter((c) => c.level === 'block');
  const posted = !!post?.irn;
  const failed = post && isFailed(post.status);

  const actions = posted
    ? `<a class="primary" href="/invoice/${n}.pdf">Download PDF</a>
       ${post!.nrsId ? `<a href="/invoice/${n}/nrs.pdf">NRS copy (PDF)</a>` : ''}
       <form method="post" action="/invoice/${n}/status"><button type="submit">Refresh NRS status</button></form>
       ${failed ? `<form method="post" action="/invoice/${n}/retry"><button type="submit">Retry at NRS</button></form>` : ''}`
    : `<form method="post" action="/invoice/${n}/post"
          onsubmit="this.querySelector('button').disabled=true;this.querySelector('button').textContent='Posting…'">
         <button type="submit" class="post"${blocks.length ? ' disabled title="Fix the problems listed below first"' : ''}>${post?.error ? 'Post again' : 'Post to NRS'}</button>
       </form>`;

  const checks = (opts.checks ?? [])
    .map((c) => `<li class="${c.level}">${c.level === 'block' ? 'Must fix: ' : ''}${esc(c.message)}</li>`)
    .join('');

  const details = posted
    ? `<div class="kv">
         <span><b>IRN</b> ${esc(post!.irn)}</span>
         <span><b>Type</b> ${esc(post!.transactionCategory ?? '')}</span>
         <span><b>Posted</b> ${esc((post!.postedAt ?? '').replace('T', ' ').slice(0, 16))} UTC</span>
         ${post!.checkedAt ? `<span><b>Status checked</b> ${esc(post!.checkedAt.replace('T', ' ').slice(0, 16))} UTC</span>` : ''}
       </div>`
    : '';

  return `<div class="bar">
  <a href="/">&larr; All invoices</a>
  ${post?.error ? `<button type="button" class="err" data-err="${esc(inv.num)}">Error</button>` : ''}
  ${actions}
  <a href="/invoice/${n}/payload" target="_blank" rel="noopener">See Payload</a>
  <span class="note">NRS ${esc(opts.env ?? '')}</span>
</div>
<section class="nrs" aria-label="NRS submission">
  <h2>NRS e-invoicing ${statusPill(post)}</h2>
  ${opts.flash?.ok ? `<div class="ok">${esc(opts.flash.ok)}</div>` : ''}
  ${opts.flash?.err ? `<div class="err">${esc(opts.flash.err)}</div>` : ''}
  ${post?.error ? `<div class="err">NRS: ${esc(post.error)}</div>` : ''}
  ${details}
  ${!posted && checks ? `<ul>${checks}</ul>` : ''}
  ${!posted && !checks ? '<div class="ok">Ready to post.</div>' : ''}
  <div class="kv">${sourceNote}</div>
</section>`;
}
