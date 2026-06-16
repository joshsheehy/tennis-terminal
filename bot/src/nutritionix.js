// Nutritionix natural-language endpoint — the FREE first-choice lookup for both
// plain food text and restaurant/branded items. We only fall back to the paid
// LLM when this returns nothing usable.

import { config } from './config.js';
import { normalize } from './parse.js';

const ENDPOINT = 'https://trackapi.nutritionix.com/v2/natural/nutrients';

/**
 * Query Nutritionix with a natural-language food description.
 * Returns a normalized strict-shape object on a good match, or null on a miss
 * (so the caller knows to fall back to the LLM). estimated is always false here
 * because these are real published numbers.
 */
export async function lookupNutritionix(query) {
  let resp;
  try {
    resp = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-app-id': config.nutritionixAppId,
        'x-app-key': config.nutritionixApiKey,
      },
      body: JSON.stringify({ query }),
    });
  } catch {
    return null; // network error → treat as a miss, fall back to LLM
  }

  // 404 = no foods recognized. Any non-OK → miss.
  if (!resp.ok) return null;

  let data;
  try {
    data = await resp.json();
  } catch {
    return null;
  }

  const foods = Array.isArray(data?.foods) ? data.foods : [];
  if (foods.length === 0) return null;

  const items = foods.map((f) => ({
    name: [f.food_name, f.brand_name].filter(Boolean).join(' — ') || 'item',
    grams: f.serving_weight_grams ?? null,
    kcal: f.nf_calories ?? 0,
    protein_g: f.nf_protein ?? 0,
    carbs_g: f.nf_total_carbohydrate ?? 0,
    fat_g: f.nf_total_fat ?? 0,
  }));

  // Guard against a response that has foods but no calorie data at all.
  const totalKcal = items.reduce((a, it) => a + (it.kcal || 0), 0);
  if (totalKcal <= 0) return null;

  return normalize({ items, estimated: false });
}
