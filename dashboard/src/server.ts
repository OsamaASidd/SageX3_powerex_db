import express, { NextFunction, Request, Response } from 'express';
import { timingSafeEqual } from 'crypto';
import { config } from './config';
import { getInvoice, invoiceCompanies, listInvoices } from './invoices';
import { renderInvoice, esc } from './invoiceHtml';
import { ListFilters, matchesNrsFilter, renderList } from './listHtml';
import { nrsPdf } from './nrs';
import { buildPayload, Check, getCustomer } from './payload';
import { renderPdf } from './pdf';
import { postInvoice, refreshStatus, retryPost } from './posting';
import { allPosts, getPost } from './store';
import { logger } from './logger';

const app = express();
app.disable('x-powered-by');

// One line per request (except images/styles): who, what, result, how long.
app.use((req: Request, res: Response, next: NextFunction) => {
  if (req.path.startsWith('/assets/')) return next();
  const started = Date.now();
  res.on('finish', () => {
    const ip = (req.headers['x-forwarded-for'] as string | undefined) ?? req.socket.remoteAddress ?? '';
    const line = `${req.method} ${req.originalUrl.slice(0, 300)} -> ${res.statusCode} ${Date.now() - started}ms from ${ip}`;
    if (res.statusCode >= 500) logger.error(line);
    else if (res.statusCode === 401 || res.statusCode === 403) logger.warn(line);
    else logger.info(line);
  });
  next();
});

const isLocal = (req: Request) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress ?? '');

function same(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

// Invoices hold customer and banking data and the server listens on a public IP: require a login.
// Requests from the server itself (headless Edge rendering a PDF) are let through.
app.use((req: Request, res: Response, next: NextFunction) => {
  if (isLocal(req) && req.headers['x-forwarded-for'] === undefined) return next();
  const [scheme, encoded] = (req.headers.authorization ?? '').split(' ');
  if (scheme === 'Basic' && encoded) {
    const [user, ...rest] = Buffer.from(encoded, 'base64').toString().split(':');
    if (same(user, config.dashboard.user) && same(rest.join(':'), config.dashboard.password)) return next();
  }
  res.set('WWW-Authenticate', 'Basic realm="PE Energy invoices", charset="UTF-8"').status(401).send('Login required');
});

// Posting changes things at NRS: only accept form posts that come from this dashboard's own pages.
app.use((req: Request, res: Response, next: NextFunction) => {
  if (req.method !== 'POST') return next();
  const origin = req.headers.origin ?? req.headers.referer;
  if (origin) {
    try {
      if (new URL(origin).host !== req.headers.host) return res.status(403).send('Cross-site request refused');
    } catch {
      return res.status(403).send('Cross-site request refused');
    }
  }
  next();
});

app.use('/assets', express.static(config.assetsDir, { maxAge: '1d' }));

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const dateParam = (v: unknown) => (/^\d{4}-\d{2}-\d{2}$/.test(str(v)) ? str(v) : '');
const flashOf = (req: Request) => ({ ok: str(req.query.ok) || undefined, err: str(req.query.err) || undefined });

/** Redirect back to the page the form was on (same host only), with a message. */
function back(req: Request, res: Response, fallback: string, msg: { ok?: string; err?: string; show?: string }) {
  let target = fallback;
  const ref = req.headers.referer;
  if (ref) {
    try {
      const u = new URL(ref);
      if (u.host === req.headers.host) target = u.pathname + u.search;
    } catch {
      /* use fallback */
    }
  }
  const u = new URL(target, 'http://x');
  for (const k of ['ok', 'err', 'show']) u.searchParams.delete(k);
  if (msg.ok) u.searchParams.set('ok', msg.ok.slice(0, 500));
  if (msg.err) u.searchParams.set('err', msg.err.slice(0, 500));
  if (msg.show) u.searchParams.set('show', msg.show);
  res.redirect(303, u.pathname + u.search);
}

app.get('/', async (req, res) => {
  try {
    const hasDates = 'from' in req.query || 'to' in req.query;
    const f: ListFilters = {
      q: str(req.query.q),
      from: hasDates ? dateParam(req.query.from) : `${new Date().getFullYear()}-01-01`,
      to: dateParam(req.query.to),
      type: /^[A-Z]{0,5}$/.test(str(req.query.type)) ? str(req.query.type) : '',
      cpy: /^[A-Z0-9]{0,5}$/i.test(str(req.query.cpy)) ? str(req.query.cpy) : '',
      nrs: ['not', 'posted', 'failed'].includes(str(req.query.nrs)) ? str(req.query.nrs) : '',
    };
    // Fetch all types so the Invoices / Credit notes tabs can show counts; filter by type here.
    const [rows, companies] = await Promise.all([listInvoices({ ...f, type: '' }), invoiceCompanies()]);
    const posts = allPosts();
    const nrsRows = rows.filter((r) => matchesNrsFilter(posts.get(r.num), f.nrs));
    const typeCounts: Record<string, number> = {};
    for (const r of nrsRows) typeCounts[r.type] = (typeCounts[r.type] ?? 0) + 1;
    const shown = f.type ? nrsRows.filter((r) => r.type === f.type) : nrsRows;
    res.type('html').send(renderList(shown, posts, companies, f, config.nrs.env, flashOf(req), str(req.query.show), typeCounts));
  } catch (err) {
    logger.error('invoice list failed', err);
    res.status(500).type('html').send(`<pre>Could not load invoices: ${esc(String(err))}</pre>`);
  }
});

app.get('/invoice/:num.pdf', async (req, res) => {
  const num = req.params.num;
  try {
    if (!(await getInvoice(num))) return res.status(404).send('Invoice not found');
    const pdf = await renderPdf(`http://127.0.0.1:${config.dashboard.port}/invoice/${encodeURIComponent(num)}?pdf=1`);
    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', `inline; filename="${num.replace(/[^\w.-]/g, '_')}.pdf"`);
    res.send(pdf);
  } catch (err) {
    logger.error(`pdf failed for ${num}`, err);
    res.status(500).type('html').send(`<pre>Could not create the PDF: ${esc(String(err))}</pre>`);
  }
});

app.get('/invoice/:num/nrs.pdf', async (req, res) => {
  const post = getPost(req.params.num);
  if (!post?.nrsId) return res.status(404).send('This invoice has not been posted to NRS.');
  try {
    const pdf = await nrsPdf(post.nrsId);
    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', `inline; filename="${req.params.num.replace(/[^\w.-]/g, '_')}-NRS.pdf"`);
    res.send(pdf);
  } catch (err) {
    res.status(502).type('html').send(`<pre>${esc(String(err))}</pre>`);
  }
});

const prettyJson = (res: Response, status: number, body: unknown) =>
  res.status(status).type('application/json').send(JSON.stringify(body, null, 2));

/**
 * "See Payload": the JSON last sent to NRS for this invoice, plus what would be sent now
 * (built fresh from X3, with the checks that would block or warn).
 */
app.get('/invoice/:num/payload', async (req, res) => {
  try {
    const num = req.params.num;
    const inv = await getInvoice(num);
    const cust = inv && (await getCustomer(num));
    if (!inv || !cust) return prettyJson(res, 404, { error: 'Invoice not found' });
    const post = getPost(num);
    const { payload, checks, transactionCategory } = await buildPayload(inv, cust);
    prettyJson(res, 200, {
      invoice: num,
      environment: config.nrs.env,
      lastSent: post?.sentPayload
        ? { at: post.sentAt, status: post.status, irn: post.irn ?? null, error: post.error ?? null, payload: post.sentPayload }
        : null,
      nextPost: { transactionCategory, checks, payload },
    });
  } catch (err) {
    prettyJson(res, 500, { error: String(err) });
  }
});

app.post('/invoice/:num/post', async (req, res) => {
  const num = req.params.num;
  const fallback = req.query.back === 'list' ? '/' : `/invoice/${encodeURIComponent(num)}`;
  try {
    const rec = await postInvoice(num);
    back(req, res, fallback, { ok: `${num} posted to NRS (${config.nrs.env}). IRN ${rec.irn}, status ${rec.status}.` });
  } catch (err) {
    logger.warn(`post ${num} not completed`, err instanceof Error ? err.message : String(err));
    // The error is saved with the invoice; the page opens it in the error pop-up.
    if (getPost(num)?.error) return back(req, res, fallback, { show: num });
    back(req, res, fallback, { err: `${num}: ${err instanceof Error ? err.message : String(err)}` });
  }
});

app.post('/invoice/:num/status', async (req, res) => {
  const num = req.params.num;
  try {
    const rec = await refreshStatus(num);
    back(req, res, `/invoice/${encodeURIComponent(num)}`, { ok: `NRS status for ${num}: ${rec.status}.` });
  } catch (err) {
    back(req, res, `/invoice/${encodeURIComponent(num)}`, { err: err instanceof Error ? err.message : String(err) });
  }
});

app.post('/invoice/:num/retry', async (req, res) => {
  const num = req.params.num;
  try {
    const rec = await retryPost(num);
    back(req, res, `/invoice/${encodeURIComponent(num)}`, { ok: `Retry sent for ${num}. Status now ${rec.status}.` });
  } catch (err) {
    back(req, res, `/invoice/${encodeURIComponent(num)}`, { err: err instanceof Error ? err.message : String(err) });
  }
});

app.get('/invoice/:num', async (req, res) => {
  const num = req.params.num;
  try {
    const inv = await getInvoice(num);
    if (!inv) return res.status(404).type('html').send('Invoice not found. <a href="/">Back to all invoices</a>');
    const forPdf = req.query.pdf === '1';
    const post = getPost(num);
    let checks: Check[] = [];
    if (!forPdf && !post?.irn) {
      try {
        const cust = await getCustomer(num);
        checks = cust ? (await buildPayload(inv, cust)).checks : [{ level: 'block', message: 'Customer not found in X3.' }];
      } catch (err) {
        checks = [{ level: 'block', message: `Could not prepare the NRS data: ${err instanceof Error ? err.message : String(err)}` }];
      }
    }
    res.type('html').send(
      renderInvoice(inv, { forPdf, post, checks, flash: flashOf(req), env: config.nrs.env, showError: str(req.query.show) === num }),
    );
  } catch (err) {
    logger.error(`invoice page ${num} failed`, err);
    res.status(500).type('html').send(`<pre>Could not load invoice: ${esc(String(err))}</pre>`);
  }
});

app.listen(config.dashboard.port, config.dashboard.host, () => {
  logger.info(`Invoice dashboard listening on http://${config.dashboard.host}:${config.dashboard.port}`);
  logger.info(`NRS environment: ${config.nrs.env} (${config.nrs.baseUrl || 'not configured'})`);
  if (config.dashboard.publicUrl) logger.info(`Public URL: ${config.dashboard.publicUrl}`);
  logger.info(`Logs: ${logger.dir}`);
});

process.on('unhandledRejection', (err) => logger.error('unhandled promise rejection', err));
process.on('uncaughtException', (err) => {
  logger.error('uncaught exception, stopping', err);
  process.exit(1);
});
