import { pool, sql, t } from './db';
import { BankDetails, billing, Issuer, templateIssuers } from './company';

export type LineSource = 'sales-invoice' | 'sales-order' | 'accounting';

export interface InvoiceListRow {
  num: string;
  companyCode: string;
  companyName: string;
  type: string; // ZAINV, ZACRN, PRF
  module: 'Sales' | 'Accounting';
  date: Date;
  customerCode: string;
  customerName: string;
  currency: string;
  net: number;
  vat: number;
  total: number;
  description: string;
}

export interface InvoiceLine {
  sn: number;
  mesc: string;
  qty: number | null;
  description: string;
  unitPrice: number | null;
  amount: number;
  /** X3 item code, sales unit and the item's HS code (ITMMASTER.ZHSN_0); empty for Accounting lines. */
  itemRef: string;
  unit: string;
  hsn: string;
}

export interface PrintableInvoice {
  num: string;
  companyCode: string;
  issuer: Issuer;
  dueDate: Date | null;
  /** For a credit note: the invoice it credits, when X3 records it. */
  originalInvoice: string;
  type: string;
  title: string;
  date: Date;
  currency: string;
  customerCode: string;
  billTo: string[];
  poNumber: string;
  vendorCode: string;
  incoterms: string;
  lines: InvoiceLine[];
  lineSource: LineSource;
  salesOrder: string;
  subtotal: number;
  vatRate: number;
  vat: number;
  total: number;
  bank: BankDetails | null;
  bankNote: string;
}

const s = (v: unknown) => (v == null ? '' : String(v).trim());
const n = (v: unknown) => (v == null ? 0 : Number(v));

export async function listInvoices(opts: { q?: string; from?: string; to?: string; type?: string; cpy?: string }): Promise<InvoiceListRow[]> {
  const p = await pool();
  const req = p.request();
  // X3's database collation (Latin1_General_BIN2) is case-sensitive; compare case- and
  // accent-insensitively so "chev" finds "Chevron". Every word typed must match some field.
  const ci = 'COLLATE Latin1_General_CI_AI';
  const words = (opts.q ?? '').split(/\s+/).filter(Boolean).slice(0, 6);
  const wordConditions = words.map((w, i) => {
    req.input(`w${i}`, sql.NVarChar, `%${w.replace(/[[%_]/g, '[$&]')}%`);
    return `(h.NUM_0 ${ci} LIKE @w${i} OR h.BPRNAM_0 ${ci} LIKE @w${i} OR h.BPR_0 ${ci} LIKE @w${i}
             OR h.DES_0 ${ci} LIKE @w${i} OR h.CUR_0 ${ci} LIKE @w${i}
             OR EXISTS (SELECT 1 FROM ${t('SINVOICED')} d WHERE d.NUM_0 = h.NUM_0 AND d.ITMDES_0 ${ci} LIKE @w${i}))`;
  });
  const r = await req
    .input('from', sql.Date, opts.from || null)
    .input('to', sql.Date, opts.to || null)
    .input('type', sql.NVarChar, opts.type ?? '')
    .input('cpy', sql.NVarChar, opts.cpy ?? '').query(`
      SELECT TOP 1000 h.NUM_0, h.CPY_0, c.CPYNAM_0, h.SIVTYP_0, h.ORIMOD_0, h.ACCDAT_0, h.BPR_0, h.BPRNAM_0, h.CUR_0,
             h.AMTNOT_0, h.AMTTAX_0, h.AMTATI_0, h.DES_0
      FROM ${t('SINVOICE')} h LEFT JOIN ${t('COMPANY')} c ON c.CPY_0 = h.CPY_0
      WHERE ${wordConditions.length ? wordConditions.join(' AND ') : '1 = 1'}
        AND (@from IS NULL OR h.ACCDAT_0 >= @from)
        AND (@to IS NULL OR h.ACCDAT_0 <= @to)
        AND (@type = '' OR h.SIVTYP_0 = @type)
        AND (@cpy = '' OR h.CPY_0 = @cpy)
      ORDER BY h.ACCDAT_0 DESC, h.NUM_0 DESC`);
  return r.recordset.map((x) => ({
    num: s(x.NUM_0),
    companyCode: s(x.CPY_0),
    companyName: s(x.CPYNAM_0),
    type: s(x.SIVTYP_0),
    module: n(x.ORIMOD_0) === 5 ? 'Sales' : 'Accounting',
    date: x.ACCDAT_0,
    customerCode: s(x.BPR_0),
    customerName: s(x.BPRNAM_0),
    currency: s(x.CUR_0),
    net: n(x.AMTNOT_0),
    vat: n(x.AMTTAX_0),
    total: n(x.AMTATI_0),
    description: s(x.DES_0),
  }));
}

export async function invoiceYears(): Promise<number[]> {
  const p = await pool();
  const r = await p.request().query(`SELECT DISTINCT YEAR(ACCDAT_0) y FROM ${t('SINVOICE')} ORDER BY y DESC`);
  return r.recordset.map((x) => n(x.y));
}

export async function invoiceCompanies(): Promise<{ code: string; name: string }[]> {
  const p = await pool();
  const r = await p.request().query(`
    SELECT DISTINCT h.CPY_0, c.CPYNAM_0 FROM ${t('SINVOICE')} h LEFT JOIN ${t('COMPANY')} c ON c.CPY_0 = h.CPY_0 ORDER BY h.CPY_0`);
  return r.recordset.map((x) => ({ code: s(x.CPY_0), name: s(x.CPYNAM_0) }));
}

/** PE Energy uses its invoice template; other X3 companies get name, TIN and address from X3. */
async function issuerFor(cpy: string): Promise<Issuer> {
  if (templateIssuers[cpy]) return templateIssuers[cpy];
  const p = await pool();
  const r = await p.request().input('cpy', sql.NVarChar, cpy).query(`
    SELECT c.CPYNAM_0, c.CRN_0, a.BPAADDLIG_0, a.BPAADDLIG_1, a.BPAADDLIG_2, a.CTY_0, a.TEL_0, a.WEB_0, a.FCYWEB_0
    FROM ${t('COMPANY')} c
    LEFT JOIN ${t('BPADDRESS')} a ON a.BPATYP_0 = 2 AND a.BPANUM_0 = c.CPY_0 AND a.BPAADD_0 = c.BPAADD_0
    WHERE c.CPY_0 = @cpy`);
  const c = r.recordset[0] ?? {};
  return {
    code: cpy,
    name: s(c.CPYNAM_0) || `Company ${cpy}`,
    addressLines: [s(c.BPAADDLIG_0), s(c.BPAADDLIG_1), s(c.BPAADDLIG_2), s(c.CTY_0)]
      .map((l) => l.replace(/,\s*$/, ''))
      .filter(Boolean),
    email: s(c.WEB_0),
    url: s(c.FCYWEB_0),
    tel: s(c.TEL_0),
    tin: s(c.CRN_0),
    brandAssets: false,
    banks: {},
  };
}

/** Customer item descriptions often start with their material (MESC) code: "7050235 Spectrus OX1203 Box". */
export function splitMesc(description: string): { mesc: string; description: string } {
  const m = /^\s*(\d{5,})[\s,;:-]+(.+)$/.exec(description);
  return m ? { mesc: m[1], description: m[2].trim() } : { mesc: '', description: description.trim() };
}

/** "FRIESLAND 4504918098" -> "4504918098": keep the token that looks like a PO number. */
export function cleanPo(ref: string): string {
  const tokens = ref.split(/\s+/).filter(Boolean);
  const numeric = tokens.filter((tok) => /\d{5,}/.test(tok));
  return numeric.length === 1 ? numeric[0] : ref.trim();
}

/** Accounting invoices carry the PO only in free text, e.g. "INVOICE PO - 4504918098". */
export function poFromDescription(des: string): string {
  const m = /\bP\.?O\.?\s*(?:NO\.?|#)?\s*[:#-]?\s*-?\s*([A-Z0-9][A-Z0-9\-\/]{4,})/i.exec(des);
  return m ? m[1] : '';
}

function titleFor(type: string, currency: string): string {
  if (type === 'ZACRN') return `CREDIT NOTE ${currency}`;
  if (type === 'PRF') return `PROFORMA INVOICE ${currency}`;
  return `INVOICE ${currency}`;
}

export async function getInvoice(num: string): Promise<PrintableInvoice | null> {
  const p = await pool();
  const hr = await p.request().input('num', sql.NVarChar, num).query(`
    SELECT h.*, v.EECICT_0 AS V_EECICT, v.SIHORINUM_0 AS V_ORINUM
    FROM ${t('SINVOICE')} h LEFT JOIN ${t('SINVOICEV')} v ON v.NUM_0 = h.NUM_0
    WHERE h.NUM_0 = @num`);
  const h = hr.recordset[0];
  if (!h) return null;

  const issuer = await issuerFor(s(h.CPY_0));
  const currency = s(h.CUR_0);
  const subtotal = n(h.AMTNOT_0);
  const vat = n(h.AMTTAX_0);
  const total = n(h.AMTATI_0);

  // VAT rate from the tax code's rate table; fall back to tax / base.
  let vatRate = 0;
  if (s(h.TAX_0)) {
    const rr = await p.request().input('vat', sql.NVarChar, s(h.TAX_0)).input('cpy', sql.NVarChar, s(h.CPY_0)).query(`
      SELECT TOP 1 VATRAT_0 FROM ${t('TABRATVAT')}
      WHERE VAT_0 = @vat AND (CPY_0 = @cpy OR CPY_0 = '') ORDER BY CASE WHEN CPY_0 = @cpy THEN 0 ELSE 1 END, STRDAT_0 DESC`);
    if (rr.recordset[0]) vatRate = n(rr.recordset[0].VATRAT_0);
  }
  if (!vatRate && n(h.BASTAX_0)) vatRate = Math.round((vat / n(h.BASTAX_0)) * 1000) / 10;

  let lines: InvoiceLine[] = [];
  let lineSource: LineSource = 'accounting';
  let salesOrder = '';
  let poNumber = '';
  let incoterms = s(h.V_EECICT);

  if (n(h.ORIMOD_0) === 5) {
    lineSource = 'sales-invoice';
    const lr = await p.request().input('num', sql.NVarChar, num).query(`
      SELECT d.SIDLIN_0, d.ITMREF_0, d.ITMDES_0, d.ITMDES1_0, d.QTY_0, d.SAU_0, d.NETPRI_0, d.AMTNOTLIN_0, d.SOHNUM_0, m.ZHSN_0
      FROM ${t('SINVOICED')} d LEFT JOIN ${t('ITMMASTER')} m ON m.ITMREF_0 = d.ITMREF_0
      WHERE d.NUM_0 = @num ORDER BY d.SIDLIN_0`);
    lines = lr.recordset.map((x, i) => {
      const { mesc, description } = splitMesc(s(x.ITMDES_0) || s(x.ITMDES1_0));
      return {
        sn: i + 1, mesc, qty: n(x.QTY_0), description, unitPrice: n(x.NETPRI_0), amount: n(x.AMTNOTLIN_0),
        itemRef: s(x.ITMREF_0), unit: s(x.SAU_0), hsn: s(x.ZHSN_0),
      };
    });
    salesOrder = lr.recordset.map((x) => s(x.SOHNUM_0)).find(Boolean) ?? '';
    if (salesOrder) {
      const or = await p.request().input('so', sql.NVarChar, salesOrder)
        .query(`SELECT CUSORDREF_0, EECICT_0 FROM ${t('SORDER')} WHERE SOHNUM_0 = @so`);
      if (or.recordset[0]) {
        poNumber = cleanPo(s(or.recordset[0].CUSORDREF_0));
        incoterms ||= s(or.recordset[0].EECICT_0);
      }
    }
  } else {
    // Invoice entered in Accounting: its lines are just GL postings. Find the sales order it bills,
    // first by PO number quoted in the description, then by matching amount, and print the order's items.
    const des = s(h.DES_0);
    const orders = (
      await p.request().input('bpr', sql.NVarChar, s(h.BPR_0)).input('cur', sql.NVarChar, currency).query(`
        SELECT SOHNUM_0, CUSORDREF_0, EECICT_0, ORDINVATI_0, ORDATI_0 FROM ${t('SORDER')}
        WHERE (BPCORD_0 = @bpr OR BPCINV_0 = @bpr) AND CUR_0 = @cur`)
    ).recordset;
    const byPo = orders.find((o) => {
      const po = cleanPo(s(o.CUSORDREF_0));
      return po.length >= 5 && des.toUpperCase().includes(po.toUpperCase());
    });
    const byAmount = orders.filter((o) => Math.abs(n(o.ORDATI_0) - total) < 1);
    const order = byPo ?? (byAmount.length === 1 ? byAmount[0] : undefined);

    if (order) {
      salesOrder = s(order.SOHNUM_0);
      poNumber = cleanPo(s(order.CUSORDREF_0));
      incoterms ||= s(order.EECICT_0);
      const lr = await p.request().input('so', sql.NVarChar, salesOrder).query(`
        SELECT p.SOPLIN_0, p.ITMREF_0, p.ITMDES_0, p.ITMDES1_0, q.QTY_0, p.SAU_0, p.NETPRI_0, m.ZHSN_0
        FROM ${t('SORDERP')} p
        JOIN ${t('SORDERQ')} q ON q.SOHNUM_0 = p.SOHNUM_0 AND q.SOPLIN_0 = p.SOPLIN_0 AND q.SOQSEQ_0 = p.SOPSEQ_0
        LEFT JOIN ${t('ITMMASTER')} m ON m.ITMREF_0 = p.ITMREF_0
        WHERE p.SOHNUM_0 = @so ORDER BY p.SOPLIN_0`);
      const orderLines = lr.recordset.map((x, i) => {
        const { mesc, description } = splitMesc(s(x.ITMDES_0) || s(x.ITMDES1_0));
        const qty = n(x.QTY_0);
        const price = n(x.NETPRI_0);
        return {
          sn: i + 1, mesc, qty, description, unitPrice: price, amount: Math.round(qty * price * 100) / 100,
          itemRef: s(x.ITMREF_0), unit: s(x.SAU_0), hsn: s(x.ZHSN_0),
        };
      });
      // Only print the order's items when they add up to this invoice (not a partial or milestone bill).
      const sum = orderLines.reduce((a, l) => a + l.amount, 0);
      if (orderLines.length && Math.abs(sum - subtotal) <= Math.max(1, subtotal * 0.005)) {
        lines = orderLines;
        lineSource = 'sales-order';
      }
    }
    if (!lines.length) {
      const lr = await p.request().input('num', sql.NVarChar, num).query(`
        SELECT LIG_0, DES_0, QTY_0, AMTNOTLIN_0 FROM ${t('BPCINVLIG')} WHERE NUM_0 = @num ORDER BY LIG_0`);
      lines = lr.recordset.map((x, i) => {
        const qty = n(x.QTY_0);
        const amount = n(x.AMTNOTLIN_0);
        const { mesc, description } = splitMesc(s(x.DES_0) || des);
        return {
          sn: i + 1, mesc, qty: qty || null, description, unitPrice: qty ? amount / qty : null, amount,
          itemRef: '', unit: '', hsn: '',
        };
      });
    }
    poNumber ||= poFromDescription(des);
  }

  // Bank: the invoice's own bank field if set, else the template account for its currency.
  let bank: BankDetails | null = issuer.banks[currency] ?? null;
  let bankNote = '';
  if (s(h.ZBAN_0)) {
    const br = await p.request().input('ban', sql.NVarChar, s(h.ZBAN_0))
      .query(`SELECT DES_0, BIDNUM_0 FROM ${t('BANK')} WHERE BAN_0 = @ban`);
    const b = br.recordset[0];
    if (b && s(b.BIDNUM_0) && s(b.BIDNUM_0) !== bank?.accountNumber) {
      bank = {
        accountName: issuer.name,
        accountNumber: s(b.BIDNUM_0),
        sortCode: '',
        bankName: s(b.DES_0).replace(/\s*-\s*[A-Z]{3}.*$/, ''),
        address: '',
      };
    }
  }
  if (!bank) bankNote = `Bank details for ${currency} payments to ${issuer.name} have not been set up yet.`;

  const billTo = [
    billing.attention,
    s(h.BPRNAM_0),
    s(h.BPAADDLIG_0).replace(/,\s*$/, ''),
    s(h.BPAADDLIG_1).replace(/,\s*$/, ''),
    s(h.BPAADDLIG_2).replace(/,\s*$/, ''),
    [s(h.POSCOD_0), s(h.CTY_0) && toTitle(s(h.CTY_0))].filter(Boolean).join(', ') + (s(h.CTY_0) ? '.' : ''),
    s(h.CRYNAM_0),
  ].filter(Boolean);

  const due: Date | null = h.STRDUDDAT_0 && new Date(h.STRDUDDAT_0).getUTCFullYear() > 1900 ? h.STRDUDDAT_0 : null;

  return {
    num,
    companyCode: s(h.CPY_0),
    issuer,
    dueDate: due,
    originalInvoice: s(h.V_ORINUM),
    type: s(h.SIVTYP_0),
    title: titleFor(s(h.SIVTYP_0), currency),
    date: h.ACCDAT_0,
    currency,
    customerCode: s(h.BPR_0),
    billTo,
    poNumber,
    vendorCode: billing.vendorCodeDefault,
    incoterms,
    lines,
    lineSource,
    salesOrder,
    subtotal,
    vatRate,
    vat,
    total,
    bank,
    bankNote,
  };
}

function toTitle(v: string): string {
  return v.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}
