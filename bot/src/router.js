// Routing logic — the heart of the cost-minimization strategy.
//
// Three input modes, each annotated with WHERE the one paid call happens:
//
//   1. TEXT        → Nutritionix (free) first; LLM only on a miss.
//   2. RESTAURANT  → same path as TEXT (Nutritionix covers chains); LLM on miss.
//   3. PHOTO       → always one paid vision call (downscaled image).
//
// Text and restaurant share the exact same API path — Nutritionix's
// natural-language endpoint handles both plain foods and branded/restaurant
// items. The only difference is the `source` label we store, derived from a
// light heuristic so the log distinguishes the two.

import { lookupNutritionix } from './nutritionix.js';
import { estimateFromText, estimateFromPhoto } from './llm.js';
import { downscaleToJpeg } from './image.js';

// Heuristic: does this text look like a restaurant/branded lookup?
// e.g. "chicken bowl from Chipotle", "Big Mac at McDonald's".
const RESTAURANT_RE = /\b(from|at)\s+[A-Z][\w'&.-]*/;

function classifyText(text) {
  return RESTAURANT_RE.test(text) ? 'restaurant' : 'text';
}

/**
 * Route a text/restaurant message.
 * Returns { source, parsed, usedLlm }.
 */
export async function routeText(text) {
  const source = classifyText(text);

  // FREE path first — Nutritionix natural-language nutrients endpoint.
  const fromNutritionix = await lookupNutritionix(text);
  if (fromNutritionix) {
    return { source, parsed: fromNutritionix, usedLlm: false };
  }

  // MISS → the ONE paid call: estimate from the description (flagged estimated).
  const parsed = await estimateFromText(text);
  return { source, parsed, usedLlm: true };
}

/**
 * Route a photo message. Always exactly ONE paid vision call.
 * `imageBuffer` is the raw downloaded image; `caption` is optional text.
 * Returns { source: 'photo', parsed, usedLlm: true }.
 */
export async function routePhoto(imageBuffer, caption) {
  // Downscale BEFORE the paid call to minimize vision token cost.
  const image = await downscaleToJpeg(imageBuffer);
  const parsed = await estimateFromPhoto(image, caption);
  return { source: 'photo', parsed, usedLlm: true };
}
