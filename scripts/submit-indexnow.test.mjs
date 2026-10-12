import assert from 'node:assert/strict';
import test from 'node:test';
import { createPayload, submitPayload, ENDPOINT, KEY, SITE } from './submit-indexnow.mjs';

const sitemap = (...urls) => `<urlset>${urls.map((url) => `<url><loc>${url}</loc></url>`).join('')}</urlset>`;
const payload = createPayload(sitemap(`${SITE}/`), KEY);

test('only canonical same-host HTML URLs are included, with duplicates removed', () => {
  const result = createPayload(sitemap(
    `${SITE}/`, `${SITE}/proof/`, `${SITE}/page.html`, `${SITE}/proof/`,
    `${SITE}/proof/graph.json`, `${SITE}/llms.txt`, `${SITE}/image.png`,
  ), `${KEY}\n`);
  assert.deepEqual(result.urlList, [`${SITE}/`, `${SITE}/proof/`, `${SITE}/page.html`]);
  for (const url of ['https://preview.example/', `http://bortlesboat.github.io/`, `${SITE}/?x=1`, `${SITE}/#proof`]) {
    assert.throws(() => createPayload(sitemap(url), KEY), /canonical production URL/);
  }
  assert.throws(() => createPayload(sitemap(`${SITE}/`), 'wrong-key'), /key file/);
  assert.throws(() => createPayload(sitemap(`${SITE}/feed.json`), KEY), /between 1 and 10,000/);
});

test('a missing, mismatched, or redirected live key prevents submission', async () => {
  for (const [status, body] of [[404, 'missing'], [200, '<html>fallback page</html>'], [302, KEY]]) {
    let calls = 0;
    await assert.rejects(submitPayload(payload, async (url, options) => {
      calls++;
      assert.equal(url, payload.keyLocation);
      assert.equal(options.redirect, 'error');
      return new Response(body, { status });
    }), /no URLs submitted/);
    assert.equal(calls, 1);
  }
});

test('the verified key precedes a single POST and 200 differs from pending 202', async () => {
  for (const status of [200, 202]) {
    const calls = [];
    const message = await submitPayload(payload, async (url, options) => {
      calls.push(url);
      if (calls.length === 1) return new Response(`${KEY}\n`);
      assert.equal(url, ENDPOINT);
      assert.equal(options.method, 'POST');
      assert.deepEqual(JSON.parse(options.body), payload);
      return new Response('', { status });
    });
    assert.deepEqual(calls, [payload.keyLocation, ENDPOINT]);
    assert.equal(message.includes('validation is pending'), status === 202);
    assert.match(message, /Indexing is not guaranteed/);
  }
});

test('rejected and uncertain submissions fail without automatic retry', async () => {
  for (const status of [400, 403, 422, 429, 500, null]) {
    let calls = 0;
    await assert.rejects(submitPayload(payload, async () => {
      calls++;
      if (calls === 1) return new Response(KEY);
      if (status === null) throw new Error('network timeout');
      return new Response('', { status });
    }), status === null ? /network timeout/ : new RegExp(`HTTP ${status}`));
    assert.equal(calls, 2);
  }
});
