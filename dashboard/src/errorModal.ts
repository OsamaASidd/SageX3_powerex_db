import { PostRecord } from './store';

/** Error details for the pop-up, as JSON that is safe inside a <script> tag. */
export function errorData(posts: Iterable<PostRecord>): string {
  const data: Record<string, { error: string; at?: string; status: string; attempts: number }> = {};
  for (const p of posts) if (p.error) data[p.num] = { error: p.error, at: p.errorAt, status: p.status, attempts: p.attempts };
  return JSON.stringify(data).replace(/</g, '\\u003c');
}

/**
 * The error pop-up and its script, shared by the list and invoice pages. Any element with
 * data-err="<invoice #>" opens it; `show` opens it on load (after a failed post).
 * Uses the page's --surface, --fg, --muted, --bad and --bad-soft colour tokens.
 */
export function errorModal(dataJson: string, show: string): string {
  return `<dialog id="errdlg" aria-labelledby="errttl">
  <form method="dialog">
    <h2 id="errttl">Could not post <span id="errnum"></span></h2>
    <div class="errmeta" id="errmeta"></div>
    <pre id="errmsg"></pre>
    <div class="errbtns"><a id="erropen" class="btn" href="#">Open invoice</a><button class="btn" value="close" autofocus>Close</button></div>
  </form>
</dialog>
<script id="errdata" type="application/json">${dataJson}</script>
<script>
(function () {
  var data = {}; try { data = JSON.parse(document.getElementById('errdata').textContent || '{}'); } catch (e) {}
  var dlg = document.getElementById('errdlg');
  function open(num) {
    var d = data[num]; if (!d) return;
    document.getElementById('errnum').textContent = num;
    var when = d.at ? d.at.replace('T', ' ').slice(0, 16) + ' UTC' : '';
    var sent = d.status === 'BLOCKED' ? 'not sent to NRS' : (d.attempts || 0) + ' attempt(s) sent to NRS';
    document.getElementById('errmeta').textContent = [d.status.replace(/_/g, ' ').toLowerCase(), when, sent].filter(Boolean).join(' \\u00b7 ');
    document.getElementById('errmsg').textContent = d.error;
    document.getElementById('erropen').href = '/invoice/' + encodeURIComponent(num);
    if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', '');
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-err]');
    if (b) open(b.getAttribute('data-err'));
  });
  dlg.addEventListener('click', function (e) { if (e.target === dlg) dlg.close(); });
  var show = ${JSON.stringify(show).replace(/</g, '\\u003c')};
  if (show) open(show);
})();
</script>`;
}

export const errorModalCss = `
  dialog#errdlg { border:0; border-radius:12px; padding:0; width:min(640px, calc(100vw - 32px)); background:var(--surface); color:var(--fg); box-shadow:0 20px 60px rgba(0,0,0,.35); font-family:"Segoe UI", Arial, sans-serif; }
  dialog#errdlg::backdrop { background:rgba(10,15,18,.55); }
  dialog#errdlg form { display:grid; gap:10px; padding:18px 20px; margin:0; }
  dialog#errdlg h2 { margin:0; font-size:17px; color:var(--bad); }
  dialog#errdlg .errmeta { font-size:12.5px; color:var(--muted); }
  dialog#errdlg pre { margin:0; white-space:pre-wrap; word-break:break-word; font:13px/1.5 Consolas, monospace; background:var(--bad-soft); color:var(--bad); padding:12px; border-radius:8px; max-height:50vh; overflow:auto; }
  dialog#errdlg .errbtns { display:flex; gap:8px; justify-content:flex-end; }
  dialog#errdlg .btn { font-size:13px; font-weight:600; padding:6px 12px; border-radius:6px; border:1px solid var(--muted); background:var(--surface); color:var(--fg); cursor:pointer; text-decoration:none; }
  .btn.err, button.err { background:var(--bad); border-color:var(--bad); color:#fff; }`;
