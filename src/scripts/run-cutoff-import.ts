const appUrl = process.env.APP_URL ?? process.env.RAILWAY_PUBLIC_DOMAIN;

function normalizeBaseUrl(value: string | undefined) {
  if (!value) return null;

  if (value.startsWith('http://') || value.startsWith('https://')) {
    return value.replace(/\/$/, '');
  }

  return `https://${value.replace(/\/$/, '')}`;
}

async function main() {
  const baseUrl = normalizeBaseUrl(appUrl);

  if (!baseUrl) {
    throw new Error('APP_URL or RAILWAY_PUBLIC_DOMAIN is required for scheduled cutoff imports');
  }

  const importUrl = `${baseUrl}/api/import-cutoffs`;

  console.log(`Starting cutoff import from ${importUrl}`);

  const response = await fetch(importUrl, {
    method: 'GET',
    headers: {
      accept: 'application/json',
      'user-agent': 'TennisTerminalCron/0.1',
    },
  });

  const body = await response.text();

  console.log(body);

  if (!response.ok) {
    throw new Error(`Cutoff import failed with status ${response.status}`);
  }

  console.log('Cutoff import finished');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
