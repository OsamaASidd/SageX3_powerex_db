import { errorData, errorModal, errorModalCss } from './errorModal';
import { InvoiceListRow } from './invoices';
import { esc, formatDate, money, statusPill } from './invoiceHtml';
import { isDone, isFailed } from './posting';
import { PostRecord } from './store';

const TYPE_LABEL: Record<string, string> = { ZAINV: 'Invoice', ZACRN: 'Credit note', PRF: 'Proforma' };
/** Row class per document type: drives the coloured stripe, tint and badge. */
const TYPE_CLASS: Record<string, string> = { ZAINV: 'inv', ZACRN: 'cn', PRF: 'pf' };

export interface ListFilters {
  q: string;
  from: string;
  to: string;
  type: string;
  cpy: string;
  nrs: string; // '', 'not', 'posted', 'failed'
}

export function matchesNrsFilter(post: PostRecord | undefined, nrs: string): boolean {
  if (!nrs) return true;
  if (nrs === 'not') return !post?.irn;
  if (nrs === 'posted') return !!post?.irn && !isFailed(post.status);
  if (nrs === 'failed') return !!post && isFailed(post.status);
  return true;
}

export function renderList(
  rows: InvoiceListRow[],
  posts: Map<string, PostRecord>,
  companies: { code: string; name: string }[],
  f: ListFilters,
  env: string,
  flash: { ok?: string; err?: string },
  show = '',
  typeCounts: Record<string, number> = {},
): string {
  // Tabs: All / Invoices / Credit notes / Proformas, keeping the other filters.
  const tabUrl = (type: string) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...f, type })) if (v) q.set(k, v);
    if (!f.from) q.set('from', '');
    return `/?${q.toString()}`;
  };
  const total = Object.values(typeCounts).reduce((a, b) => a + b, 0);
  const tabs = [
    ['', 'All', total, ''],
    ['ZAINV', 'Invoices', typeCounts.ZAINV ?? 0, 'inv'],
    ['ZACRN', 'Credit notes', typeCounts.ZACRN ?? 0, 'cn'],
    ['PRF', 'Proformas', typeCounts.PRF ?? 0, 'pf'],
  ]
    .filter(([v, , count]) => v === '' || count || v === f.type)
    .map(([v, label, count, cls]) => `<a class="tab ${cls}${v === f.type ? ' on' : ''}" href="${esc(tabUrl(String(v)))}"${v === f.type ? ' aria-current="page"' : ''}>
        ${cls ? `<i class="dot ${cls}"></i>` : ''}${esc(String(label))} <b>${count}</b></a>`)
    .join('');
  const postedCount = rows.filter((r) => posts.get(r.num)?.irn).length;
  const doneCount = rows.filter((r) => { const p = posts.get(r.num); return p?.irn && isDone(p.status); }).length;
  const failedCount = rows.filter((r) => { const p = posts.get(r.num); return p && isFailed(p.status); }).length;

  const byCur = new Map<string, { count: number; total: number }>();
  for (const r of rows) {
    const a = byCur.get(r.currency) ?? { count: 0, total: 0 };
    a.count++;
    a.total += r.type === 'ZACRN' ? -r.total : r.total;
    byCur.set(r.currency, a);
  }
  const curTiles = [...byCur.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .map(([cur, a]) => `<div class="tile"><span class="k">${esc(cur)} · ${a.count}</span><b>${money(a.total)}</b><span class="s">incl. VAT, net of credit notes</span></div>`)
    .join('');

  const body = rows.length
    ? rows
        .map((r) => {
          const post = posts.get(r.num);
          const n = encodeURIComponent(r.num);
          const canPost = !post?.irn && r.type !== 'PRF' && r.companyCode === '01';
          const errorBtn = post?.error
            ? `<button type="button" class="btn err" data-err="${esc(r.num)}">Error</button>`
            : '';
          const action = errorBtn + (post?.irn
            ? isFailed(post.status) ? '' : `<a class="btn pdf" href="/invoice/${n}.pdf">PDF</a>`
            : canPost
              ? `<form method="post" action="/invoice/${n}/post?back=list"
                   onsubmit="return confirm('Post ${esc(r.num)} to NRS (${esc(env)})?') && (this.querySelector('button').disabled=true, true)">
                   <button class="btn post" type="submit">${post?.error ? 'Post again' : 'Post'}</button></form>`
              : '');
          const cls = TYPE_CLASS[r.type] ?? 'inv';
          const sign = r.type === 'ZACRN' ? '−' : '';
          return `<tr class="row-${cls}">
        <td class="stripe"><a href="/invoice/${n}" class="num">${esc(r.num)}</a></td>
        <td class="mono">${formatDate(r.date)}</td>
        <td><div class="cust">${esc(r.customerName)}</div><div class="sub mono">${esc(r.customerCode)}</div>
            ${r.companyCode !== '01' ? `<div class="sub">Issued by ${esc(r.companyName)}</div>` : ''}</td>
        <td><span class="doctype ${cls}">${esc((TYPE_LABEL[r.type] ?? r.type).toUpperCase())}</span>
            <div class="sub">${r.module}</div></td>
        <td class="sub desc">${esc(r.description)}</td>
        <td class="mono">${esc(r.currency)}</td>
        <td class="num-r strong amt-${cls}">${sign}${money(r.total)}<div class="sub">VAT ${sign}${money(r.vat)}</div></td>
        <td>${statusPill(post)}${post?.irn ? `<div class="sub mono irn" title="${esc(post.irn)}">${esc(post.irn)}</div>` : ''}</td>
        <td class="acts"><a class="btn" href="/invoice/${n}">View</a>${action}</td>
      </tr>`;
        })
        .join('')
    : `<tr><td colspan="9" class="empty">No invoices match these filters.</td></tr>`;

  const opt = (v: string, label: string, cur: string) => `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${esc(label)}</option>`;
  const typeOpts = [['', 'All types'], ['ZAINV', 'Invoices'], ['ZACRN', 'Credit notes'], ['PRF', 'Proformas']].map(([v, l]) => opt(v, l, f.type)).join('');
  const nrsOpts = [['', 'Any NRS status'], ['not', 'Not posted'], ['posted', 'Posted'], ['failed', 'Failed']].map(([v, l]) => opt(v, l, f.nrs)).join('');
  const companyOpts = [opt('', 'All companies', f.cpy)].concat(companies.map((c) => opt(c.code, c.name || c.code, f.cpy))).join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>PE Energy Invoices</title>
<style>
  :root { --bg:#f3f4f2; --surface:#fff; --fg:#1c2326; --muted:#66717a; --line:#dde1df; --brand:#1d8fd0; --orange:#e87722; --green:#2f8f4e;
          --good:#2f6b3a; --good-soft:#e6f2e7; --wait:#7a5200; --wait-soft:#fbf1dc; --bad:#a3361f; --bad-soft:#fbe9e4; --none-soft:#eef0f2; --soft:#e7f3fa; }
  @media (prefers-color-scheme: dark) { :root { --bg:#121719; --surface:#1a2124; --fg:#e4e8ea; --muted:#94a0a8; --line:#2c3639; --brand:#5cb6ea; --orange:#f39a52; --green:#4fb36f;
          --good:#86c792; --good-soft:#1b2f1f; --wait:#e3b55a; --wait-soft:#362a12; --bad:#f19a83; --bad-soft:#3a201b; --none-soft:#252d31; --soft:#1a3140; color-scheme: dark; } }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--fg); font-family:"Segoe UI", system-ui, Arial, sans-serif; font-size:14px; }
  header { background:var(--surface); border-bottom:1px solid var(--line); }
  .in { max-width:1360px; margin:0 auto; padding-left:max(16px, env(safe-area-inset-left)); padding-right:max(16px, env(safe-area-inset-right)); }
  header .in { display:flex; align-items:center; gap:16px; padding-block:12px; flex-wrap:wrap; }
  header img { height:40px; background:#fff; border-radius:6px; padding:2px 4px; }
  header h1 { font-size:18px; margin:0; font-weight:600; }
  header .src { margin-left:auto; color:var(--muted); font-size:12.5px; }
  .env { font-weight:700; color:${env === 'prod' ? 'var(--bad)' : 'var(--wait)'}; text-transform:uppercase; }
  main .in { display:grid; gap:16px; padding-block:20px 48px; }
  form.filters { display:flex; flex-wrap:wrap; gap:8px; align-items:end; background:var(--surface); border:1px solid var(--line); border-radius:10px; padding:12px; }
  form.filters label { display:grid; gap:3px; font-size:12px; color:var(--muted); }
  input, select, button { font:inherit; font-size:14px; padding:7px 10px; border:1px solid var(--line); border-radius:8px; background:var(--surface); color:var(--fg); }
  input[type=search] { width:320px; max-width:100%; }
  form.filters button { background:var(--brand); border-color:var(--brand); color:#fff; font-weight:600; cursor:pointer; }
  form.filters a.reset { align-self:center; font-size:13px; }
  .tiles { display:grid; grid-template-columns:repeat(auto-fill, minmax(190px,1fr)); gap:10px; }
  .tile { background:var(--surface); border:1px solid var(--line); border-radius:10px; padding:12px 14px; display:grid; gap:2px; }
  .tile .k { font-size:12px; color:var(--muted); text-transform:uppercase; letter-spacing:.05em; }
  .tile b { font-size:21px; font-variant-numeric:tabular-nums; }
  .tile .s { font-size:12px; color:var(--muted); }
  .tile.good b { color:var(--good); } .tile.bad b { color:var(--bad); }
  .flash { padding:10px 14px; border-radius:8px; }
  .flash.ok { background:var(--good-soft); color:var(--good); }
  .flash.err { background:var(--bad-soft); color:var(--bad); word-break:break-word; }
  .wrap { overflow-x:auto; background:var(--surface); border:1px solid var(--line); border-radius:10px; }
  table { width:100%; border-collapse:collapse; min-width:1120px; }
  th { text-align:left; font-size:11.5px; text-transform:uppercase; letter-spacing:.05em; color:var(--muted); font-weight:600; padding:10px; border-bottom:1px solid var(--line); background:var(--surface); }
  td { padding:9px 10px; border-bottom:1px solid var(--line); vertical-align:top; }
  tr:last-child td { border-bottom:0; }
  tr:hover td { background:var(--soft); }
  a { color:var(--brand); text-decoration:none; }
  a:hover { text-decoration:underline; }
  a.num { font-weight:600; font-family:Consolas, monospace; font-size:13px; }
  .mono { font-family:Consolas, monospace; font-size:12.5px; }
  .sub { color:var(--muted); font-size:12px; }
  .irn { max-width:190px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .desc { max-width:240px; }
  .cust { font-weight:500; }
  .num-r { text-align:right; font-variant-numeric:tabular-nums; white-space:nowrap; }
  .strong { font-weight:600; }
  .tag { display:inline-block; font-size:11.5px; font-weight:600; padding:2px 8px; border-radius:999px; background:var(--soft); color:var(--brand); }
  .tag.cn { background:var(--bad-soft); color:var(--bad); }
  .tag.pf { background:var(--none-soft); color:var(--muted); }
  .pill { display:inline-block; font-size:11.5px; font-weight:600; padding:2px 8px; border-radius:999px; text-transform:capitalize; white-space:nowrap; }
  .pill.none { background:var(--none-soft); color:var(--muted); }
  .pill.good { background:var(--good-soft); color:var(--good); }
  .pill.wait { background:var(--wait-soft); color:var(--wait); }
  .pill.bad { background:var(--bad-soft); color:var(--bad); }
  .acts { white-space:nowrap; }
  .acts form { display:inline; }
  .btn { display:inline-block; font-size:12.5px; font-weight:600; padding:4px 10px; border-radius:6px; border:1px solid var(--line); background:var(--surface); color:var(--brand); cursor:pointer; margin-left:4px; text-decoration:none; }
  .btn:hover { text-decoration:none; border-color:var(--brand); }
  .btn.post { background:var(--green); border-color:var(--green); color:#fff; }
  .btn.pdf { background:var(--orange); border-color:var(--orange); color:#fff; }
  .btn[disabled] { opacity:.5; }
  .empty { color:var(--muted); padding:24px 10px; }
  .meta { color:var(--muted); font-size:12.5px; }
  /* Document type: stripe on the first cell, tinted credit-note rows, bold badge. */
  :root { --inv:#1d6fb8; --cn:#c0392b; --pf:#8a949b; --cn-row:#fdf3f1; }
  @media (prefers-color-scheme: dark) { :root { --inv:#5cb6ea; --cn:#f0836c; --pf:#7d888f; --cn-row:#2a1a17; } }
  td.stripe { border-left:5px solid var(--inv); }
  tr.row-cn td.stripe { border-left-color:var(--cn); }
  tr.row-pf td.stripe { border-left-color:var(--pf); }
  tr.row-cn td { background:var(--cn-row); }
  tr.row-cn:hover td { background:var(--bad-soft); }
  tr.row-cn a.num { color:var(--cn); }
  .doctype { display:inline-block; font-size:11px; font-weight:700; letter-spacing:.06em; padding:3px 8px; border-radius:4px; color:#fff; white-space:nowrap; }
  .doctype.inv { background:var(--inv); }
  .doctype.cn { background:var(--cn); }
  .doctype.pf { background:var(--pf); }
  .amt-cn { color:var(--cn); }
  .tabs { display:flex; flex-wrap:wrap; gap:6px; }
  .tab { display:inline-flex; align-items:center; gap:6px; padding:7px 14px; border-radius:999px; border:1px solid var(--line); background:var(--surface); color:var(--fg); font-size:13.5px; text-decoration:none; }
  .tab:hover { text-decoration:none; border-color:var(--brand); }
  .tab b { font-variant-numeric:tabular-nums; color:var(--muted); font-weight:600; }
  .tab.on { background:var(--fg); border-color:var(--fg); color:var(--surface); }
  .tab.on b { color:var(--surface); }
  .dot { width:10px; height:10px; border-radius:2px; display:inline-block; }
  .dot.inv { background:var(--inv); } .dot.cn { background:var(--cn); } .dot.pf { background:var(--pf); }
  ${errorModalCss}
</style>
</head>
<body>
<header><div class="in">
  <img src="/assets/pe-logo.png" alt="PE Energy Ltd">
  <h1>Customer invoices</h1>
  <span class="src">Live from Sage X3 · NRS <span class="env">${esc(env)}</span></span>
</div></header>
<main><div class="in">
  ${flash.ok ? `<div class="flash ok">${esc(flash.ok)}</div>` : ''}
  ${flash.err ? `<div class="flash err">${esc(flash.err)}</div>` : ''}
  <form class="filters" method="get" action="/">
    <label for="q">Search
      <input type="search" name="q" id="q" value="${esc(f.q)}" placeholder="Invoice #, customer, PO, item or description"></label>
    <label for="from">From<input type="date" name="from" id="from" value="${esc(f.from)}"></label>
    <label for="to">To<input type="date" name="to" id="to" value="${esc(f.to)}"></label>
    <label for="type">Type<select name="type" id="type">${typeOpts}</select></label>
    <label for="nrs">NRS<select name="nrs" id="nrs">${nrsOpts}</select></label>
    <label for="cpy">Company<select name="cpy" id="cpy">${companyOpts}</select></label>
    <button type="submit">Apply</button>
    <a class="reset" href="/">Reset</a>
  </form>
  <div class="tiles">
    <div class="tile"><span class="k">Documents shown</span><b>${rows.length}</b><span class="s">${esc(f.from || 'start')} to ${esc(f.to || 'today')}</span></div>
    <div class="tile good"><span class="k">Posted to NRS</span><b>${postedCount}</b><span class="s">${doneCount} confirmed by NRS</span></div>
    <div class="tile bad"><span class="k">Failed</span><b>${failedCount}</b><span class="s">open the invoice to see why</span></div>
    ${curTiles}
  </div>
  <nav class="tabs" aria-label="Document type">${tabs}</nav>
  <div class="meta">${total === 1000 ? 'Showing the latest 1,000 matches. Narrow the dates to see older ones. ' : ''}Newest first. Credit notes are shown in red with negative amounts.</div>
  <div class="wrap"><table>
    <thead><tr><th>Document #</th><th>Date</th><th>Customer</th><th>Type</th><th>Description</th><th>Cur</th>
      <th style="text-align:right">Total</th><th>NRS</th><th></th></tr></thead>
    <tbody>${body}</tbody>
  </table></div>
</div></main>
${errorModal(errorData(rows.map((r) => posts.get(r.num)).filter((p): p is PostRecord => !!p)), show)}
</body>
</html>`;
}
