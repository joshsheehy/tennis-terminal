const appUrl = process.env.APP_URL ?? process.env.RAILWAY_PUBLIC_DOMAIN;

function normalizeBaseUrl(value: string | undefined) {
  if (!value) return null;

  if (value.startsWith('http://') || value.startsWith('https://')) {
    return value.replace(/\/$/, '');
  }

  return `https://${value.replace(/\/$/, '')}`;
}

async function runStep(label: string, url: string) {
  console.log(`Starting ${label}: ${url}`);

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      accept: 'application/json',
      'user-agent': 'TennisCutsCron/0.3',
    },
  });

  const body = await response.text();
  console.log(`${label} response:`);
  console.log(body);

  if (!response.ok) {
    throw new Error(`${label} failed with status ${response.status}`);
  }

  console.log(`Finished ${label}`);
}

async function main() {
  const baseUrl = normalizeBaseUrl(appUrl);

  if (!baseUrl) {
    throw new Error('APP_URL or RAILWAY_PUBLIC_DOMAIN is required for scheduled data sync');
  }

  console.log(`Starting Tennis Cuts scheduled data sync for ${baseUrl}`);

  await runStep('calendar import', `${baseUrl}/api/import-calendars`);
  await runStep('2026 cutoff import', `${baseUrl}/api/import-cutoffs?year=2026`);
  await runStep('2025 cutoff import', `${baseUrl}/api/import-cutoffs?year=2025`);
  await runStep('2024 cutoff import', `${baseUrl}/api/import-cutoffs?year=2024`);

  console.log('Full Tennis Cuts scheduled data sync finished');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
