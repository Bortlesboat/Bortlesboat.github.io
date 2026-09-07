const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { contributionWindow, collectStats, refreshStats } = require('./fetch-stats.cjs')
const now = new Date('2026-09-07T12:00:00Z')
const pr = (number, repo = 'example/project') => ({
  html_url: `https://github.com/${repo}/pull/${number}`,
  title: `Fix ${number}`,
  user: { login: 'Bortlesboat' },
  closed_at: '2026-08-01T00:00:00Z',
  pull_request: { merged_at: '2026-07-10T12:00:00Z' },
})
const page = (items, total = items.length) => ({ items, total_count: total, incomplete_results: false })

test('counts actual repositories and merge dates, retaining zero-activity months', async () => {
  const stats = await collectStats({ now, getJSON: async (url) => {
    assert.equal(new URL(url).searchParams.get('q'), 'author:Bortlesboat is:pr is:merged is:public -user:Bortlesboat merged:2025-09-07..2026-09-07')
    return page([pr(1), pr(2), pr(3, 'another/repo')])
  } })
  assert.equal(stats.merged_prs, 3)
  assert.equal(stats.repos_contributed_to, 2)
  assert.equal(stats.repeat_repositories, 1)
  assert.equal(stats.monthly['2026-07'], 3)
  assert.equal(stats.monthly['2026-08'], 0)
  assert.equal(stats.monthly['2025-09'], 0)
  assert.equal(stats.fetched_at, now.toISOString())
})

test('collects all search pages', async () => {
  const requested = []
  const stats = await collectStats({ now, getJSON: async (url) => {
    const number = Number(new URL(url).searchParams.get('page'))
    requested.push(number)
    return number === 1 ? page(Array.from({ length: 100 }, (_, i) => pr(i + 1)), 101) : page([pr(101)], 101)
  } })
  assert.deepEqual(requested, [1, 2])
  assert.equal(stats.merged_prs, 101)
})

test('rejects incomplete, truncated, duplicate, and out-of-scope results', async () => {
  for (const data of [
    { ...page([]), incomplete_results: true },
    page([], 1001), page([pr(1)], 2), page([pr(1), pr(1)]),
    page([pr(1, 'bortlesboat/own-repo')]),
    page([{ ...pr(1), user: { login: 'someone-else' } }]),
    page([{ ...pr(1), pull_request: { merged_at: null } }]),
    page([{ ...pr(1), pull_request: { merged_at: '2024-01-01T00:00:00Z' } }]),
  ]) await assert.rejects(collectStats({ now, getJSON: async () => data }))
})

test('rejects a changed total during pagination', async () => {
  let calls = 0
  await assert.rejects(collectStats({ now, getJSON: async () => ++calls === 1
    ? page(Array.from({ length: 100 }, (_, i) => pr(i)), 101)
    : page([pr(101)], 102)
  }), /changed during pagination/)
})

test('failed refresh preserves prior counts and timestamp byte for byte', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'oss-stats-'))
  const output = path.join(directory, 'stats.json')
  t.after(() => { fs.unlinkSync(output); fs.rmdirSync(directory) })
  const previous = '{"merged_prs":7,"fetched_at":"2026-05-01T00:00:00Z"}\n'
  fs.writeFileSync(output, previous)
  await assert.rejects(refreshStats({ output, now, getJSON: async () => { throw new Error('HTTP 403') } }))
  assert.equal(fs.readFileSync(output, 'utf8'), previous)
})

test('supports empty results and clamps leap-day calendar windows', async () => {
  const stats = await collectStats({ now, getJSON: async () => page([]) })
  assert.equal(stats.merged_prs, 0)
  assert.equal(stats.repos_contributed_to, 0)
  assert.deepEqual(contributionWindow(new Date('2024-02-29T12:00:00Z')), { start: '2023-02-28', end: '2024-02-29' })
})
