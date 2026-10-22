import { config } from './config';
import { pool, sql, t } from './db';
import { PrintableInvoice } from './invoices';
import { invoiceTypeCode, NrsInvoicePayload } from './nrs';
import { getPost } from './store';

export interface Check {
  level: 'block' | 'warn';
  message: string;
}

export interface Customer {
  code: string;
  name: string;
  tin: string;
  email: string;
  phone: string;
  street: string;
  city: string;
  postcode: string;
  country: string;
}

const s = (v: unknown) => (v == null ? '' : String(v).trim());
const round2 = (v: number) => Math.round(v * 100) / 100;
const isoDate = (d: Date) => d.toISOString().slice(0, 10);

export async function getCustomer(num: string): Promise<Customer | null> {
  const p = await pool();
  const r = await p.request().input('num', sql.NVarChar, num).query(`
    SELECT h.BPR_0, h.BPRNAM_0, h.BPAADDLIG_0, h.BPAADDLIG_1, h.BPAADDLIG_2, h.CTY_0, h.POSCOD_0, h.CRY_0,
           c.ZTIN_0, b.CRN_0,
           (SELECT TOP 1 COALESCE(NULLIF(LTRIM(k.WEB_0), ''), m.CNTEMA_0) FROM ${t('CONTACT')} k
              LEFT JOIN ${t('CONTACTCRM')} m ON m.CNTNUM_0 = k.CCNCRM_0
              WHERE k.BPATYP_0 = 1 AND k.BPANUM_0 = h.BPR_0 AND (LTRIM(k.WEB_0) LIKE '%@%' OR m.CNTEMA_0 LIKE '%@%')) AS EMAIL,
           (SELECT TOP 1 COALESCE(NULLIF(LTRIM(k.TEL_0), ''), NULLIF(LTRIM(k.MOB_0), ''), m.CNTMOB_0) FROM ${t('CONTACT')} k
              LEFT JOIN ${t('CONTACTCRM')} m ON m.CNTNUM_0 = k.CCNCRM_0
              WHERE k.BPATYP_0 = 1 AND k.BPANUM_0 = h.BPR_0
                AND (LTRIM(k.TEL_0) <> '' OR LTRIM(k.MOB_0) <> '' OR LTRIM(m.CNTMOB_0) <> '')) AS PHONE,
           a.WEB_0 AS ADDR_EMAIL, a.TEL_0 AS ADDR_TEL
    FROM ${t('SINVOICE')} h
    LEFT JOIN ${t('BPARTNER')} b ON b.BPRNUM_0 = h.BPR_0
    LEFT JOIN ${t('BPCUSTOMER')} c ON c.BPCNUM_0 = h.BPR_0
    LEFT JOIN ${t('BPADDRESS')} a ON a.BPATYP_0 = 1 AND a.BPANUM_0 = h.BPR_0 AND a.BPAADD_0 = h.BPAINV_0
    WHERE h.NUM_0 = @num`);
  const x = r.recordset[0];
  if (!x) return null;
  const addrEmail = s(x.ADDR_EMAIL);
  return {
    code: s(x.BPR_0),
    name: s(x.BPRNAM_0),
    tin: s(x.ZTIN_0) || s(x.CRN_0),
    email: s(x.EMAIL) || (addrEmail.includes('@') ? addrEmail : ''),
    phone: s(x.PHONE) || s(x.ADDR_TEL),
    street: [s(x.BPAADDLIG_0), s(x.BPAADDLIG_1), s(x.BPAADDLIG_2)].map((l) => l.replace(/,\s*$/, '')).filter(Boolean).join(', '),
    city: s(x.CTY_0),
    postcode: s(x.POSCOD_0),
    country: s(x.CRY_0),
  };
}

/** "08037542063" / "8037542063" (NG) -> "+2348037542063"; anything not convertible is dropped. */
export function toE164(phone: string, country: string): string {
  const digits = phone.replace(/\D/g, '');
  if (!digits) return '';
  if (phone.trim().startsWith('+') && digits.length >= 8 && digits.length <= 15) return `+${digits}`;
  if (country === 'NG') {
    if (digits.startsWith('234') && digits.length === 13) return `+${digits}`;
    if (digits.startsWith('0') && digits.length === 11) return `+234${digits.slice(1)}`;
    if (digits.length === 10) return `+234${digits}`;
  }
  return '';
}

/** NRS wants "0000.00". Accepts "2701.90", "270190", "27019000". */
export function normaliseHsn(code: string): string {
  const v = code.trim();
  if (/^\d{4}\.\d{2}$/.test(v)) return v;
  const d = v.replace(/\D/g, '');
  return d.length >= 6 ? `${d.slice(0, 4)}.${d.slice(4, 6)}` : '';
}

/** X3 sales units -> UN/CEFACT Rec 20 codes accepted by NRS (C62 = "one", the generic unit). */
const UOM: Record<string, string> = {
  EA: 'EA', UN: 'C62', PC: 'C62', PCS: 'C62', SET: 'SET', KG: 'KGM', G: 'GRM', T: 'TNE', L: 'LTR', LT: 'LTR',
  M: 'MTR', M2: 'MTK', M3: 'MTQ', DR: 'C62', BX: 'BX', BOX: 'BX', HR: 'HUR', H: 'HUR', DAY: 'DAY', LOT: 'LO',
};
export const toUom = (unit: string) => UOM[unit.trim().toUpperCase()] ?? 'C62';

/**
 * product_category per line: the item's product group in X3 (statistical group 2, e.g.
 * "Valves and Actuators", "MRO Spares"); for Accounting lines the revenue account's name
 * (e.g. "Revenue MRO"); else "General".
 */
async function productCategories(inv: PrintableInvoice): Promise<string[]> {
  const p = await pool();
  const items = [...new Set(inv.lines.map((l) => l.itemRef).filter(Boolean))];
  const byItem = new Map<string, string>();
  if (items.length) {
    const req = p.request();
    items.forEach((it, i) => req.input(`i${i}`, sql.NVarChar, it));
    const r = await req.query(`
      SELECT m.ITMREF_0, t.TEXTE_0 FROM ${t('ITMMASTER')} m
      LEFT JOIN ${t('ATEXTRA')} t ON t.CODFIC_0 = 'ATABDIV' AND t.ZONE_0 = 'LNGDES' AND t.LANGUE_0 = 'ENG'
        AND t.IDENT1_0 = '21' AND t.IDENT2_0 = m.TSICOD_1
      WHERE m.ITMREF_0 IN (${items.map((_, i) => `@i${i}`).join(', ')})`);
    for (const x of r.recordset) if (s(x.TEXTE_0)) byItem.set(s(x.ITMREF_0), s(x.TEXTE_0));
  }
  let account = '';
  if (inv.lines.some((l) => !l.itemRef)) {
    const r = await p.request().input('num', sql.NVarChar, inv.num).query(`
      SELECT TOP 1 g.DES_0 FROM ${t('BPCINVLIG')} l JOIN ${t('GACCOUNT')} g ON g.ACC_0 = l.ACC_0
      WHERE l.NUM_0 = @num ORDER BY l.LIG_0`);
    account = s(r.recordset[0]?.DES_0);
  }
  return inv.lines.map((l) => byItem.get(l.itemRef) || account || 'General');
}

const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

/** City from the invoice, else the last part of the street line ("..., LEKKI, LAGOS" -> "Lagos"). */
export function cityOf(cust: Customer): string {
  if (cust.city) return titleCase(cust.city);
  const parts = cust.street.split(',').map((p) => p.trim()).filter(Boolean);
  const last = (parts[parts.length - 1] ?? '').replace(/\b(nigeria|state|f\.?c\.?t\.?)\b\.?/gi, '').replace(/[.\s]+$/, '').trim();
  return last && last.length <= 40 && !/\d{3,}/.test(last) && parts.length > 1 ? titleCase(last) : '';
}
const titleCase = (v: string) => v.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

/**
 * accounting_customer_party. The API rejects the invoice when any of these text fields is missing,
 * so every field is always sent: X3's value first, then a configured default, and for email,
 * phone and TIN a placeholder in pre-prod only (production blocks instead).
 */
function customerParty(cust: Customer, block: (m: string) => void, warn: (m: string) => void): NrsInvoicePayload['accounting_customer_party'] {
  const { defaults, placeholders, env } = config.nrs;
  const pick = (label: string, real: string, placeholder: string): string => {
    if (real) return real;
    if (placeholder) {
      warn(`Customer has no ${label} in X3; sending pre-prod placeholder "${placeholder}".`);
      return placeholder;
    }
    if (env === 'prod') block(`Customer ${cust.code} has no ${label} in X3. Add it to the customer record before posting.`);
    else block(`Customer ${cust.code} has no ${label} in X3 and no NRS_PREPROD_PLACEHOLDER is set for it.`);
    return '';
  };

  const tin = pick('TIN', cust.tin, placeholders.tin);
  if (!cust.tin) warn(`No customer TIN in X3, so this goes to NRS as B2C.`);
  const email = pick('email address', isEmail(cust.email) ? cust.email : '', placeholders.email);
  const realPhone = toE164(cust.phone, cust.country);
  if (cust.phone && !realPhone) warn(`Customer phone "${cust.phone}" in X3 could not be converted to international format.`);
  const telephone = pick('phone number', realPhone, placeholders.phone);

  let city = cityOf(cust);
  if (!city && defaults.city) {
    city = defaults.city;
    warn(`No city on the invoice address; sending the default "${city}".`);
  }
  if (!city) block('No city on the invoice address. Set NRS_DEFAULT_CITY or add the city in X3.');

  const postcode = cust.country === 'NG' && !/^\d{6}$/.test(cust.postcode) ? '' : cust.postcode;
  const postalZone = postcode || defaults.postalZone;
  if (!postcode && postalZone) warn(`No valid postcode on the invoice address${cust.postcode ? ` (X3 has "${cust.postcode}")` : ''}; sending the default "${postalZone}".`);
  if (!postalZone) block('No postcode on the invoice address. Set NRS_DEFAULT_POSTAL_ZONE or add it in X3.');

  const street = cust.street || city;
  if (!cust.street) warn('No street address on the invoice; sending the city as the street.');

  return {
    party_name: cust.name,
    tin,
    email,
    telephone,
    business_description: defaults.businessDescription,
    postal_address: {
      street_name: street,
      city_name: city,
      postal_zone: postalZone,
      country: cust.country || 'NG',
    },
  };
}

export async function buildPayload(
  inv: PrintableInvoice,
  cust: Customer,
): Promise<{ payload: NrsInvoicePayload | null; checks: Check[]; transactionCategory: 'B2B' | 'B2C' }> {
  const checks: Check[] = [];
  const block = (message: string) => checks.push({ level: 'block', message });
  const warn = (message: string) => checks.push({ level: 'warn', message });

  if (!config.nrs.baseUrl || !config.nrs.apiKey) block(`NRS ${config.nrs.env} has no base URL or API key in .env.dashboard.`);
  if (inv.type === 'PRF') block('Proforma invoices are not submitted to NRS.');
  if (inv.companyCode !== '01') {
    block(`This invoice belongs to ${inv.issuer.name}. The NRS API key is for ${config.nrs.entityName || 'PE Energy'}; each company needs its own.`);
  }
  if (!inv.lines.length) block('The invoice has no lines.');

  // B2B only when X3 has the customer's real TIN; a pre-prod placeholder never makes it B2B.
  const transactionCategory: 'B2B' | 'B2C' = cust.tin ? 'B2B' : 'B2C';
  const party = customerParty(cust, block, warn);

  // HS codes: item's ZHSN, else the configured default.
  const fallbackHsn = normaliseHsn(config.nrs.defaultHsnCode);
  const missingHsn: number[] = [];
  const lineHsn = inv.lines.map((l) => {
    const own = normaliseHsn(l.hsn);
    if (own) return own;
    if (!fallbackHsn) missingHsn.push(l.sn);
    return fallbackHsn;
  });
  if (missingHsn.length) {
    block(`No HS code for line${missingHsn.length > 1 ? 's' : ''} ${missingHsn.join(', ')}. Fill the item's HSN field (ZHSN) in X3, or set NRS_DEFAULT_HSN_CODE.`);
  } else if (inv.lines.some((l) => !normaliseHsn(l.hsn))) {
    warn(`Lines without an item HS code use the default ${fallbackHsn}.`);
  }

  const lineSum = round2(inv.lines.reduce((a, l) => a + l.amount, 0));
  if (Math.abs(lineSum - inv.subtotal) > 1) {
    block(`Lines add up to ${lineSum.toFixed(2)} but the invoice subtotal is ${inv.subtotal.toFixed(2)}.`);
  }

  let cancelReferences: NrsInvoicePayload['cancel_references'];
  if (inv.type === 'ZACRN') {
    const orig = inv.originalInvoice ? getPost(inv.originalInvoice) : undefined;
    if (!inv.originalInvoice) block('X3 does not record which invoice this credit note is against.');
    else if (!orig?.irn) block(`Post the original invoice ${inv.originalInvoice} to NRS first; a credit note must reference its IRN.`);
    else if (!orig.issueDate) block(`The NRS record for ${inv.originalInvoice} has no issue date.`);
    else cancelReferences = [{ original_irn: orig.irn, original_issue_date: orig.issueDate }];
  }

  if (checks.some((c) => c.level === 'block')) return { payload: null, checks, transactionCategory };

  const categories = await productCategories(inv);

  // Spread the invoice VAT over the lines; the last line takes the rounding difference.
  const rate = inv.vatRate / 100;
  let vatLeft = round2(inv.vat);
  const lines = inv.lines.map((l, i) => {
    const qty = l.qty && l.qty > 0 ? l.qty : 1;
    const price = l.unitPrice != null && l.qty ? l.unitPrice : l.amount;
    const tax = i === inv.lines.length - 1 ? vatLeft : round2(l.amount * rate);
    vatLeft = round2(vatLeft - tax);
    return {
      description: [l.mesc, l.description].filter(Boolean).join(' ') || inv.num,
      hsn_code: lineHsn[i],
      product_category: categories[i],
      invoiced_quantity: qty,
      price_amount: round2(price),
      base_quantity: 1,
      price_unit: toUom(l.unit),
      tax_rate: inv.vatRate,
      tax_category_id: inv.vatRate > 0 ? ('STANDARD_VAT' as const) : ('ZERO_VAT' as const),
      discount_rate: 0,
      line_extension_amount: round2(l.amount),
      tax_amount: tax,
      total_amount: round2(l.amount + tax),
    };
  });

  const payload: NrsInvoicePayload = {
    invoice_type: 'STANDARD',
    transaction_category: transactionCategory,
    accounting_customer_party: party,
    document_identifier: inv.num,
    issue_date: isoDate(inv.date),
    ...(inv.dueDate ? { due_date: isoDate(inv.dueDate) } : {}),
    invoice_type_code: await invoiceTypeCode(inv.type === 'ZACRN' ? 'Credit Note' : 'Commercial Invoice'),
    document_currency_code: inv.currency,
    ...(inv.poNumber ? { note: `PO ${inv.poNumber}` } : {}),
    ...(cancelReferences ? { cancel_references: cancelReferences } : {}),
    invoice_lines: lines,
    legal_monetary_total: {
      line_extension_amount: round2(inv.subtotal),
      tax_exclusive_amount: round2(inv.subtotal),
      tax_inclusive_amount: round2(inv.total),
      payable_amount: round2(inv.total),
    },
  };
  return { payload, checks, transactionCategory };
}
