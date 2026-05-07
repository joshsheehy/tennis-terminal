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
    throw new Error('APP_URL or RAILWAY_PUBLIC_DOMAIN is required for scheduled data sync');
  }

  const syncUrl = `${baseUrl}/api/sync-all`;

  console.log(`Starting full Tennis Terminal data sync from ${syncUrl}`);

  const response = await fetch(syncUrl, {
    method: 'GET',
    headers: {
      accept: 'application/json',
      'user-agent': 'TennisTerminalCron/0.2',
    },
  });

  const body = await response.text();

  console.log(body);

  if (!response.ok) {
    throw new Error(`Data sync failed with status ${response.status}`);
  }

  console.log('Full Tennis Terminal data sync finished');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
