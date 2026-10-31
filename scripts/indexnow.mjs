// Tell the IndexNow search engines (Bing — which also feeds DuckDuckGo and
// ChatGPT search — plus Yandex, Seznam, Naver) which tenniscuts.com pages
// exist or changed, without waiting for them to recrawl.
//
//   node scripts/indexnow.mjs                 every URL in the live sitemap
//   node scripts/indexnow.mjs <url> [<url>…]  just these
//
// The key proves we own the site: it must match public/<key>.txt, which is
// served at https://tenniscuts.com/<key>.txt. Google doesn't use IndexNow;
// it reads the sitemap submitted in Search Console instead.

const HOST = 'tenniscuts.com';
const KEY = 'b39d4ddcd9f57741d4d54946db2516cd';

async function sitemapUrls() {
  const xml = await (await fetch(`https://${HOST}/sitemap.xml`)).text();
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
}

const urls = process.argv.length > 2 ? process.argv.slice(2) : await sitemapUrls();
if (urls.length === 0) {
  console.error('No URLs to submit.');
  process.exit(1);
}

// IndexNow takes up to 10,000 URLs per request.
for (let i = 0; i < urls.length; i += 10000) {
  const urlList = urls.slice(i, i + 10000);
  const response = await fetch('https://api.indexnow.org/indexnow', {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ host: HOST, key: KEY, keyLocation: `https://${HOST}/${KEY}.txt`, urlList }),
  });
  console.log(`Submitted ${urlList.length} URLs: HTTP ${response.status} ${await response.text()}`);
}
