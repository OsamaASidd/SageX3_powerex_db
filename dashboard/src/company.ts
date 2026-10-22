export interface BankDetails {
  accountName: string;
  accountNumber: string;
  sortCode: string;
  bankName: string;
  address: string;
}

/** The company issuing the invoice, printed in the letterhead and payment section. */
export interface Issuer {
  code: string;
  name: string;
  addressLines: string[];
  email: string;
  url: string;
  tel: string;
  tin: string;
  /** Show the PE Energy logo and ISO 9001 badge. */
  brandAssets: boolean;
  /** Remit-to account per invoice currency. */
  banks: Record<string, BankDetails>;
}

/**
 * PE Energy Limited (X3 company 01), from PE Energy's invoice template, not from X3: X3's company
 * address (Plot 94 Rivoc Road) differs from the template's, and X3 bank records have no sort code
 * or branch address. Only the USD account is confirmed (from the sample invoice).
 * Other X3 companies get their letterhead from the COMPANY and BPADDRESS tables (see invoices.ts).
 */
export const templateIssuers: Record<string, Issuer> = {
  '01': {
    code: '01',
    name: 'PE Energy Limited',
    addressLines: ['54 Emekuku Street, D-Line', 'Port Harcourt, Rivers State'],
    email: 'accounts@pe-ng.com',
    url: 'www.pe-ng.com',
    tel: '+234(84)360759, +2347026000116',
    tin: '02859836-0001',
    brandAssets: true,
    banks: {
      USD: {
        accountName: 'PE Energy Limited',
        accountNumber: '0012314806',
        sortCode: '221210679',
        bankName: 'Stanbic IBTC Bank',
        address: 'No. 133, Olu-Obasanjo Road, Port Harcourt, Rivers State',
      },
    },
  },
};

export const billing = {
  attention: 'Finance Accounting Department',
  vendorCodeDefault: 'NIL',
};
