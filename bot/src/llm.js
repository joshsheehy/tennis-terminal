// The single paid path: claude-haiku-4-5 (multimodal). Used to (a) estimate
// macros from a text/restaurant description when Nutritionix misses, and
// (b) identify foods + estimate macros from a downscaled photo.
//
// In every case the model is told to return ONLY the strict JSON shape; we
// parse defensively in parse.js.

import Anthropic from '@anthropic-ai/sdk';
import { config } from './config.js';
import { parseLlmJson } from './parse.js';

const client = new Anthropic({ apiKey: config.anthropicApiKey });

const SHAPE = `{
  "items": [ { "name": string, "grams": number|null, "kcal": number, "protein_g": number, "carbs_g": number, "fat_g": number } ],
  "kcal": number, "protein_g": number, "carbs_g": number, "fat_g": number,
  "estimated": boolean, "assumptions": string|null
}`;

const SYSTEM = `You are a nutrition estimator. Given a meal (text description or photo), identify the foods, estimate portion sizes, and compute macros.
Return ONLY a single JSON object in exactly this shape, with no prose and no code fences:
${SHAPE}
Rules:
- Numbers are per the WHOLE meal for the top-level totals; per-item for each item.
- These are estimates, so always set "estimated": true.
- Put your portion/cooking assumptions in "assumptions" (e.g. "assumed ~6oz chicken, cooked in 1 tbsp oil") so they can be corrected.`;

const MAX_TOKENS = 1024;

/**
 * Estimate macros from a text/restaurant description. ONE paid call.
 */
export async function estimateFromText(description) {
  const msg = await client.messages.create({
    model: config.model,
    max_tokens: MAX_TOKENS,
    system: SYSTEM,
    messages: [
      {
        role: 'user',
        content: `Estimate the macros for this meal: ${description}`,
      },
    ],
  });

  const text = msg.content.find((b) => b.type === 'text')?.text ?? '';
  return parseLlmJson(text, { estimated: true });
}

/**
 * Estimate macros from a downscaled meal photo. ONE paid call.
 * `image` is { base64, mediaType } from image.js.
 */
export async function estimateFromPhoto(image, caption) {
  const content = [
    {
      type: 'image',
      source: {
        type: 'base64',
        media_type: image.mediaType,
        data: image.base64,
      },
    },
    {
      type: 'text',
      text: caption
        ? `Identify the foods in this meal photo and estimate macros. Extra context from me: ${caption}`
        : 'Identify the foods in this meal photo, estimate portions, and estimate macros.',
    },
  ];

  const msg = await client.messages.create({
    model: config.model,
    max_tokens: MAX_TOKENS,
    system: SYSTEM,
    messages: [{ role: 'user', content }],
  });

  const text = msg.content.find((b) => b.type === 'text')?.text ?? '';
  return parseLlmJson(text, { estimated: true });
}
