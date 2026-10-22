const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve',
  'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
const SCALES = ['', 'Thousand', 'Million', 'Billion', 'Trillion'];

const CURRENCY_WORDS: Record<string, [string, string]> = {
  NGN: ['Naira', 'Kobo'],
  USD: ['US Dollars', 'Cents'],
  EUR: ['Euros', 'Cents'],
  GBP: ['Pounds Sterling', 'Pence'],
  ZAR: ['Rand', 'Cents'],
};

function below1000(n: number): string {
  const parts: string[] = [];
  if (n >= 100) {
    parts.push(`${ONES[Math.floor(n / 100)]} Hundred`);
    n %= 100;
    if (n) parts.push('and');
  }
  if (n >= 20) parts.push(TENS[Math.floor(n / 10)] + (n % 10 ? `-${ONES[n % 10]}` : ''));
  else if (n) parts.push(ONES[n]);
  return parts.join(' ');
}

export function integerToWords(n: number): string {
  if (n === 0) return 'Zero';
  const groups: string[] = [];
  let scale = 0;
  while (n > 0) {
    const chunk = n % 1000;
    if (chunk) groups.unshift(below1000(chunk) + (SCALES[scale] ? ` ${SCALES[scale]}` : ''));
    n = Math.floor(n / 1000);
    scale++;
  }
  return groups.join(', ');
}

/** 25989514.38, "NGN" -> "Twenty-Five Million, ... Naira and Thirty-Eight Kobo Only" */
export function amountInWords(amount: number, currency: string): string {
  const [major, minor] = CURRENCY_WORDS[currency] ?? [currency, 'Cents'];
  const cents = Math.round(Math.abs(amount) * 100);
  const whole = Math.floor(cents / 100);
  const frac = cents % 100;
  let text = `${integerToWords(whole)} ${major}`;
  if (frac) text += ` and ${integerToWords(frac)} ${minor}`;
  return `${text} Only`;
}
