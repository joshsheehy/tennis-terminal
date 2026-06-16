// Defensive parsing + normalization into the strict macro JSON shape.
// The LLM is instructed to return ONLY JSON, but models occasionally wrap it in
// code fences or add stray prose — so we strip and try/catch rather than trust.

function num(v, fallback = 0) {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

function round(n) {
  return Math.round(n * 10) / 10;
}

/**
 * Coerce an arbitrary parsed object into the strict shape, recomputing totals
 * from items when present so the numbers are always internally consistent.
 */
export function normalize(obj, { estimated = false } = {}) {
  const items = Array.isArray(obj?.items) ? obj.items : [];

  const normItems = items.map((it) => ({
    name: typeof it?.name === 'string' ? it.name : 'item',
    grams: it?.grams == null ? null : num(it.grams, null),
    kcal: round(num(it?.kcal)),
    protein_g: round(num(it?.protein_g)),
    carbs_g: round(num(it?.carbs_g)),
    fat_g: round(num(it?.fat_g)),
  }));

  // Prefer summing items; fall back to top-level totals if items are empty.
  const sum = (k) => normItems.reduce((a, it) => a + it[k], 0);
  const totals = normItems.length
    ? {
        kcal: sum('kcal'),
        protein_g: sum('protein_g'),
        carbs_g: sum('carbs_g'),
        fat_g: sum('fat_g'),
      }
    : {
        kcal: num(obj?.kcal),
        protein_g: num(obj?.protein_g),
        carbs_g: num(obj?.carbs_g),
        fat_g: num(obj?.fat_g),
      };

  return {
    items: normItems,
    kcal: round(totals.kcal),
    protein_g: round(totals.protein_g),
    carbs_g: round(totals.carbs_g),
    fat_g: round(totals.fat_g),
    estimated: Boolean(obj?.estimated ?? estimated),
    assumptions:
      typeof obj?.assumptions === 'string' && obj.assumptions.trim()
        ? obj.assumptions.trim()
        : null,
  };
}

/**
 * Parse raw LLM text into the strict shape. Strips ```json fences and grabs the
 * outermost {...} if there's surrounding prose. Throws if nothing parses.
 */
export function parseLlmJson(raw, opts = {}) {
  if (typeof raw !== 'string') throw new Error('LLM returned non-string');

  let text = raw.trim();

  // Strip code fences: ```json ... ``` or ``` ... ```
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fence) text = fence[1].trim();

  // If there's still surrounding prose, isolate the outermost object.
  if (!text.startsWith('{')) {
    const first = text.indexOf('{');
    const last = text.lastIndexOf('}');
    if (first !== -1 && last > first) text = text.slice(first, last + 1);
  }

  const obj = JSON.parse(text); // may throw — caller handles
  return normalize(obj, opts);
}
