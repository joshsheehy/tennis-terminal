// Reply formatting — keeps Telegram message construction in one place.

function macros(m) {
  return `${Math.round(m.kcal)} kcal · P ${Math.round(m.protein_g)}g · C ${Math.round(
    m.carbs_g
  )}g · F ${Math.round(m.fat_g)}g`;
}

/**
 * Confirmation reply after logging a meal, including today's running total.
 */
export function formatLogReply(parsed, today) {
  const lines = [];

  for (const it of parsed.items) {
    const grams = it.grams != null ? ` (${Math.round(it.grams)}g)` : '';
    lines.push(`• ${it.name}${grams} — ${macros(it)}`);
  }
  if (lines.length === 0) lines.push('• (no items parsed)');

  const tag = parsed.estimated ? ' (estimated)' : '';
  lines.push('');
  lines.push(`Meal: ${macros(parsed)}${tag}`);

  if (parsed.estimated && parsed.assumptions) {
    lines.push(`Assumptions: ${parsed.assumptions}`);
  }

  lines.push('');
  lines.push(`Today so far: ${macros(today)} · ${today.meals} meal(s)`);

  return lines.join('\n');
}

/**
 * /today on-demand total.
 */
export function formatToday(today) {
  if (today.meals === 0) return 'No meals logged today yet.';
  const tag = today.any_estimated ? ' · includes estimates' : '';
  return `Today: ${macros(today)} · ${today.meals} meal(s)${tag}`;
}

/**
 * The unprompted 9 PM daily summary.
 */
export function formatDailySummary(today) {
  if (today.meals === 0) return 'Daily summary: no meals logged today.';
  const tag = today.any_estimated
    ? '\n(some entries were estimates)'
    : '';
  return `Daily summary\n${macros(today)}\n${today.meals} meal(s) logged${tag}`;
}
