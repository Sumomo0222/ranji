// Prompt construction for the food label set. Read-only on src/data/foods.js.
import { FOODS, NEGATIVE_PROMPTS } from '../../../../src/data/foods.js';

/**
 * Prompt settings compared in the evaluation.
 *  A: one template, exactly as specified in the brief.
 *  B: five templates for phone photos of meals. None of them adds an article, because most phrases in foods.js
 *     already carry one ("a bowl of cooked white rice", "a stack of pancakes").
 * The extra settings are exploratory and are reported for sensitivity only.
 */
export const SETTINGS = {
  A: ['a photo of {}.'],
  B: ['a photo of {}.', 'a close-up photo of {}.', 'a photo of {} on a plate.', 'a photo of {} on a table.', 'a top-down photo of {}.'],
  // exploratory
  B3: ['a photo of {}.', 'a close-up photo of {}.', 'a photo of {} on a plate.'],
  Bhalf: ['a photo of {}', 'a close-up photo of {}', 'a photo of {} on a plate', 'a photo of {} on a table', 'a top-down photo of {}'],
  B7: [
    'a photo of {}.', 'a close-up photo of {}.', 'a photo of {} on a plate.', 'a photo of {} on a table.',
    'a top-down photo of {}.', 'a photo of {} in a bowl.', 'a photo of {} in a restaurant.',
  ],
};

export const render = (template, phrase) => template.replace('{}', phrase);

/** @returns {{ id: string, zh: string, phrases: string[] }[]} */
export const foodPhrases = () => FOODS.map((f) => ({ id: f.id, zh: f.zh, phrases: [f.en, ...f.alt] }));

/** every distinct prompt text used by a setting (foods only; negatives are embedded verbatim) */
export const promptsFor = (setting) => {
  const templates = SETTINGS[setting];
  const out = new Set();
  for (const f of foodPhrases()) for (const p of f.phrases) for (const t of templates) out.add(render(t, p));
  return [...out];
};

export { FOODS, NEGATIVE_PROMPTS };
