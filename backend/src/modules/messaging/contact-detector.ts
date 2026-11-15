/**
 * Spots attempts to move a conversation off AMIVARA (PRD §5.6: romance scams
 * start by moving victims to WhatsApp or Telegram). Returns which signals
 * fired; it never blocks a message by itself. Tuned for Nigerian usage:
 * 080/081/070/090/091 numbers, +234, digits split by spaces or dots, and
 * numbers spelled out in words.
 */
export type ContactSignal =
  'phone' | 'email' | 'handle' | 'whatsapp' | 'instagram' | 'snapchat' | 'telegram' | 'other_app';

const WORD_DIGITS: Record<string, string> = {
  zero: '0',
  oh: '0',
  o: '0',
  one: '1',
  two: '2',
  three: '3',
  four: '4',
  five: '5',
  six: '6',
  seven: '7',
  eight: '8',
  nine: '9',
};

/** Digits possibly broken up by spaces, dots, dashes, slashes, brackets or underscores. */
const DIGIT_RUN = /\+?\d(?:[\s.\-/()_]{0,3}\d){6,}/g;
const EMAIL =
  /[a-z0-9._%+-]+\s*(?:@|\(at\)|\[at\]|\s+at\s+)\s*[a-z0-9-]+(?:\s*(?:\.|\(dot\)|\[dot\]|\s+dot\s+)\s*[a-z]{2,})+/i;
const HANDLE = /(?:^|[\s(])@[a-z0-9._]{3,30}\b/i;

const APPS: Array<[ContactSignal, RegExp]> = [
  ['whatsapp', /\b(?:whats\s*app|whatsap+|watsap+|wassap|wa\.me|whtsapp)\b/i],
  ['instagram', /\b(?:instagram|insta|ig)\b/i],
  ['snapchat', /\b(?:snap\s*chat|snap)\b/i],
  ['telegram', /\b(?:telegram|t\.me|tg)\b/i],
  [
    'other_app',
    /\b(?:tik\s*tok|facebook|messenger|imo|signal app|my handle|my number|call me on|text me on|dm me on)\b/i,
  ],
];

/** A run of digits that looks like a phone number (not a price, a time or a year). */
function isPhoneLike(digits: string, hadPlus: boolean): boolean {
  if (hadPlus) return digits.length >= 8 && digits.length <= 15;
  if (/^234\d{10}$/.test(digits)) return true; // 234 8031234567
  if (/^0[789][01]\d{8}$/.test(digits)) return true; // 080, 081, 070, 090, 091 …
  if (/^[789][01]\d{8}$/.test(digits)) return true; // 8031234567 (leading 0 dropped)
  return digits.length >= 10 && digits.length <= 15;
}

/** "zero eight zero three …" → "0803…", so spelled-out numbers are caught too. */
function spelledDigits(text: string): string[] {
  const runs: string[] = [];
  let current = '';
  for (const token of text.toLowerCase().split(/[^a-z0-9]+/)) {
    const d = WORD_DIGITS[token] ?? (/^\d+$/.test(token) ? token : undefined);
    if (d !== undefined) {
      current += d;
    } else if (token !== '') {
      if (current.length >= 10) runs.push(current);
      current = '';
    }
  }
  if (current.length >= 10) runs.push(current);
  return runs;
}

export function detectContactSharing(text: string): ContactSignal[] {
  const found = new Set<ContactSignal>();

  for (const match of text.matchAll(DIGIT_RUN)) {
    const raw = match[0];
    if (isPhoneLike(raw.replace(/\D/g, ''), raw.startsWith('+'))) found.add('phone');
  }
  if (!found.has('phone') && spelledDigits(text).some((d) => isPhoneLike(d, false))) found.add('phone');
  if (EMAIL.test(text)) found.add('email');
  else if (HANDLE.test(text)) found.add('handle');
  for (const [signal, re] of APPS) if (re.test(text)) found.add(signal);

  return [...found];
}
