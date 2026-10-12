import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export const SITE = 'https://bortlesboat.github.io';
export const KEY = 'a77e11bccb857d1e58c283318cc9068f';
export const ENDPOINT = 'https://api.indexnow.org/indexnow';

// The sitemap is maintained by this deployment. Machine-readable feeds are
// useful discovery resources, but only public HTML pages belong in this batch.
export function createPayload(sitemap, keyFile) {
  if (keyFile.trim() !== KEY) throw new Error('Local IndexNow key file does not match.');
  const urls = [...sitemap.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/g)].map((match) => {
    const url = new URL(match[1]);
    if (url.origin !== SITE || url.username || url.password || url.search || url.hash) {
      throw new Error(`Sitemap URL is not a canonical production URL: ${url.href}`);
    }
    return url;
  });
  const urlList = [...new Set(urls
    .filter((url) => url.pathname.endsWith('/') || url.pathname.endsWith('.html'))
    .map((url) => url.href))];
  if (!urlList.length || urlList.length > 10000) {
    throw new Error('IndexNow requires between 1 and 10,000 HTML URLs in this batch.');
  }
  return { host: new URL(SITE).host, key: KEY, keyLocation: `${SITE}/${KEY}.txt`, urlList };
}

export async function submitPayload(payload, fetchImpl = fetch) {
  const proof = await fetchImpl(payload.keyLocation, {
    redirect: 'error',
    cache: 'no-store',
    signal: AbortSignal.timeout(15000),
  });
  if (proof.status !== 200 || (await proof.text()).trim() !== payload.key) {
    throw new Error(`Live IndexNow key is not ready (HTTP ${proof.status}); no URLs submitted.`);
  }

  // One bounded attempt. Do not automatically retry rejected or uncertain sends.
  const response = await fetchImpl(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    redirect: 'error',
    signal: AbortSignal.timeout(30000),
    body: JSON.stringify(payload),
  });
  if (response.status === 200) {
    return `IndexNow received ${payload.urlList.length} URLs (HTTP 200). Indexing is not guaranteed.`;
  }
  if (response.status === 202) {
    return `IndexNow received ${payload.urlList.length} URLs; key validation is pending (HTTP 202). Indexing is not guaranteed.`;
  }
  throw new Error(`IndexNow rejected the batch (HTTP ${response.status}); check the key, URLs, or rate limit before retrying.`);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some((arg) => !['--submit', '--dry-run'].includes(arg)) || args.length > 1) {
    throw new Error('Usage: node scripts/submit-indexnow.mjs [--dry-run | --submit]');
  }
  const [sitemap, keyFile] = await Promise.all([
    readFile(new URL('../public/sitemap.xml', import.meta.url), 'utf8'),
    readFile(new URL(`../public/${KEY}.txt`, import.meta.url), 'utf8'),
  ]);
  const payload = createPayload(sitemap, keyFile);
  if (args[0] !== '--submit') {
    console.log(JSON.stringify(payload, null, 2));
    console.log('Dry run only. Use --submit after the production deployment succeeds.');
    return;
  }
  console.log(await submitPayload(payload));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
