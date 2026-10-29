// The wizard's answers as they live in the address: every answer is in the URL, so the phone's back gesture steps
// back through the questions.
import { NO_PREFERENCE, STEP_ORDER, type Criteria, type WizardStep } from '@curatorr/shared';
import { withQuery } from './url';

/** "Surprise me": no answers, straight to a pick. */
export const SURPRISE_URL = withQuery('/pick', Object.fromEntries(STEP_ORDER.map((s) => [s, NO_PREFERENCE])));

export const isStep = (s: string | undefined): s is WizardStep => STEP_ORDER.includes(s as WizardStep);

export function criteriaFrom(search: URLSearchParams): Criteria {
  return {
    genre: search.get('genre'),
    theme: search.get('theme'),
    mood: search.get('mood'),
    time: search.get('time'),
    shelf: search.get('shelf'),
  };
}

/** Answers given before `step`; later answers are dropped when going back. */
export function answersBefore(step: WizardStep, c: Criteria): Criteria {
  const out: Criteria = {};
  for (const s of STEP_ORDER) {
    if (s === step) break;
    out[s] = c[s] ?? null;
  }
  return out;
}

export function nextUrl(step: WizardStep, c: Criteria, value: string) {
  const answers = { ...answersBefore(step, c), [step]: value };
  const index = STEP_ORDER.indexOf(step);
  const next = STEP_ORDER[index + 1];
  return withQuery(next ? `/ask/${next}` : '/pick', answers);
}
