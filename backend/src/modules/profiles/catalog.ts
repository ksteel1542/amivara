/**
 * Profile catalogue (PRD §5.2): the prompts, interest tags and languages a
 * member can choose from. Served by GET /v1/profiles/catalog so the app and
 * the API never drift apart. Ids are stable; texts can be reworded freely.
 */

export const MAX_PROMPTS = 5;
export const MAX_PROMPT_ANSWER = 150;
export const MAX_INTERESTS = 10;
export const MAX_LANGUAGES = 8;
export const MAX_BIO = 500;

export const PROMPTS = [
  { id: 'perfect_sunday', text: 'My perfect Sunday looks like…' },
  { id: 'green_flag', text: 'The green flag I look for…' },
  { id: 'jollof_take', text: 'My most controversial jollof opinion…' },
  { id: 'love_language', text: 'My love language is…' },
  { id: 'proud_of', text: "Something I'm quietly proud of…" },
  { id: 'first_date', text: 'My ideal first date in my city…' },
  { id: 'never_shut_up', text: 'I could talk for hours about…' },
  { id: 'simple_pleasure', text: 'A simple pleasure I never skip…' },
  { id: 'looking_for', text: "I'm looking for someone who…" },
  { id: 'family_means', text: 'Family to me means…' },
  { id: 'weekend_plan', text: 'This weekend you will find me…' },
  { id: 'song_on_repeat', text: 'The song on repeat right now…' },
] as const;

export const INTERESTS = [
  'afrobeats',
  'amapiano',
  'highlife',
  'gospel',
  'nollywood',
  'football',
  'basketball',
  'fitness',
  'dancing',
  'owambe',
  'cooking',
  'food',
  'fashion',
  'art',
  'photography',
  'reading',
  'writing',
  'poetry',
  'travel',
  'beach',
  'nature',
  'tech',
  'startups',
  'business',
  'faith',
  'volunteering',
  'gaming',
  'movies',
  'podcasts',
  'pets',
] as const;

/** ISO 639 codes (pcm = Nigerian Pidgin). */
export const LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'pcm', name: 'Pidgin' },
  { code: 'yo', name: 'Yorùbá' },
  { code: 'ig', name: 'Igbo' },
  { code: 'ha', name: 'Hausa' },
  { code: 'ff', name: 'Fulfulde' },
  { code: 'ibb', name: 'Ibibio' },
  { code: 'efi', name: 'Efik' },
  { code: 'tiv', name: 'Tiv' },
  { code: 'ur', name: 'Urhobo' },
  { code: 'bin', name: 'Edo' },
  { code: 'fr', name: 'French' },
  { code: 'ar', name: 'Arabic' },
] as const;

export const PROMPT_IDS = new Set<string>(PROMPTS.map((p) => p.id));
export const INTEREST_IDS = new Set<string>(INTERESTS);
export const LANGUAGE_CODES = new Set<string>(LANGUAGES.map((l) => l.code));
