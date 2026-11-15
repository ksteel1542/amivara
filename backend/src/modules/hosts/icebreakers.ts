import { createHash } from 'node:crypto';

import { PROMPTS } from '../profiles/catalog';

/** The public profile fields icebreakers may use: what the member chose to show. Nothing else. */
export interface IcebreakerProfile {
  firstName: string;
  city: string | null;
  interests: string[];
  prompts: Array<{ prompt_id: string; answer: string }>;
}

const INTEREST_LABEL: Record<string, string> = {
  afrobeats: 'Afrobeats',
  amapiano: 'amapiano',
  highlife: 'highlife',
  nollywood: 'Nollywood',
  owambe: 'owambe parties',
  tech: 'tech',
  startups: 'startups',
  movies: 'movies',
  podcasts: 'podcasts',
  pets: 'pets',
  food: 'food',
};
const label = (interest: string) => INTEREST_LABEL[interest] ?? interest;

const SHARED_INTEREST = [
  "You're into {interest} too! What got you started?",
  'Fellow {interest} fan here. What are you enjoying most right now?',
];
const THEIR_INTEREST = [
  "I see you're into {interest}. What's the best part of it for you?",
  "Teach me something about {interest} I wouldn't know.",
];
const PROMPT_FOLLOW_UP = [
  'Your answer to "{prompt}" made me smile. Tell me more?',
  'Okay, "{prompt}" Now I need the full story!',
];
const CITY = [
  "What's your favourite spot in {city} that most people don't know about?",
  'Best place for small chops in {city}? I need a recommendation.',
];
const GENERAL = [
  "Hi {name}! What's been the highlight of your week so far?",
  'Hey {name}, if you could be anywhere this weekend, where would you be?',
  "Hi {name}! What's one thing that always makes your day better?",
];

/** A stable pick per conversation and day, so the bar doesn't reshuffle on every open. */
function pick<T>(options: readonly T[], seed: string): T {
  const n = createHash('sha256').update(seed).digest().readUInt32BE(0);
  return options[n % options.length]!;
}

const fill = (template: string, values: Record<string, string>) =>
  template.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? '');

/**
 * 3–5 one-tap conversation starters for a Host (MONETIZATION_PLAN.md 3d), from
 * templates filled with the other member's public profile: shared interests
 * first, then their interests, a prompt they answered, their city, then
 * general openers. No location beyond the city they wrote, and nothing from
 * other chats. Suggestions only: whatever is sent goes through normal billing
 * and safety scanning.
 */
export function buildIcebreakers(them: IcebreakerProfile, myInterests: string[], seed: string, max = 5): string[] {
  const out: string[] = [];
  const add = (s: string) => {
    if (out.length < max && !out.includes(s)) out.push(s);
  };

  const shared = them.interests.filter((i) => myInterests.includes(i));
  for (const [n, interest] of shared.slice(0, 2).entries()) {
    add(fill(pick(SHARED_INTEREST, `${seed}:s${n}`), { interest: label(interest) }));
  }
  const theirs = them.interests.find((i) => !shared.includes(i));
  if (theirs) add(fill(pick(THEIR_INTEREST, `${seed}:t`), { interest: label(theirs) }));

  const answered = them.prompts.find((p) => PROMPTS.some((q) => q.id === p.prompt_id) && p.answer.trim());
  if (answered) {
    const text = PROMPTS.find((q) => q.id === answered.prompt_id)!.text.replace(/…$/, '');
    add(fill(pick(PROMPT_FOLLOW_UP, `${seed}:p`), { prompt: text }));
  }
  const city = them.city?.trim();
  if (city && city.length <= 60) add(fill(pick(CITY, `${seed}:c`), { city }));

  for (let i = 0; out.length < Math.min(3, max) && i < GENERAL.length; i++) {
    add(
      fill(GENERAL[(i + (createHash('sha256').update(seed).digest()[0] ?? 0)) % GENERAL.length]!, {
        name: them.firstName,
      }),
    );
  }
  return out;
}
