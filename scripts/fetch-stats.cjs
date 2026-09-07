#!/usr/bin/env node
// A failed refresh preserves the last successful snapshot and exits with an error.
const fs = require('node:fs')
const path = require('node:path')
const USERNAME = 'Bortlesboat'
const OUTPUT = path.join(__dirname, '..', 'public', 'stats.json')

function contributionWindow(now) {
  const year = now.getUTCFullYear() - 1
  const month = now.getUTCMonth()
  const day = Math.min(now.getUTCDate(), new Date(Date.UTC(year, month + 1, 0)).getUTCDate())
  return {
    start: new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10),
    end: now.toISOString().slice(0, 10),
  }
}

async function fetchJSON(url) {
  const headers = { 'User-Agent': 'bortlesboat-site', Accept: 'application/vnd.github+json' }
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(30000) })
  if (!response.ok) throw new Error(`GitHub returned HTTP ${response.status}`)
  return response.json()
}

async function collectStats({ getJSON = fetchJSON, now = new Date() } = {}) {
  const window = contributionWindow(now)
  const query = `author:${USERNAME} is:pr is:merged is:public -user:${USERNAME} merged:${window.start}..${window.end}`
  const items = []
  let expected
  for (let page = 1; ; page += 1) {
    const params = new URLSearchParams({ q: query, per_page: '100', page: String(page), sort: 'created', order: 'asc' })
    const data = await getJSON(`https://api.github.com/search/issues?${params}`)
    if (data.incomplete_results !== false || !Number.isInteger(data.total_count) || data.total_count < 0 || !Array.isArray(data.items)) {
      throw new Error('GitHub search did not return a complete result')
    }
    if (data.total_count > 1000) throw new Error('Search exceeds the 1,000-result limit; split the date range before publishing')
    expected ??= data.total_count
    if (data.total_count !== expected) throw new Error('Search changed during pagination; retry the refresh')
    items.push(...data.items)
    if (items.length === expected) break
    if (items.length > expected || data.items.length < 100 || page >= 10) throw new Error('Search pagination was incomplete')
  }

  const urls = new Set()
  const contributions = items.map((item) => {
    const match = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/\d+$/.exec(item.html_url)
    const mergedAt = item.pull_request?.merged_at
    if (!match || item.user?.login?.toLowerCase() !== USERNAME.toLowerCase() ||
        match[1].split('/')[0].toLowerCase() === USERNAME.toLowerCase() ||
        typeof mergedAt !== 'string' || !Number.isFinite(Date.parse(mergedAt)) ||
        mergedAt.slice(0, 10) < window.start || mergedAt.slice(0, 10) > window.end ||
        typeof item.title !== 'string' || urls.has(item.html_url)) {
      throw new Error('Search contained duplicate or out-of-scope contribution evidence')
    }
    urls.add(item.html_url)
    return { title: item.title, url: item.html_url, repo: match[1], merged_at: mergedAt }
  }).sort((a, b) => a.merged_at.localeCompare(b.merged_at) || a.url.localeCompare(b.url))

  const monthly = {}
  const cursor = new Date(`${window.start.slice(0, 7)}-01T00:00:00Z`)
  while (cursor.toISOString().slice(0, 7) <= window.end.slice(0, 7)) {
    monthly[cursor.toISOString().slice(0, 7)] = 0
    cursor.setUTCMonth(cursor.getUTCMonth() + 1)
  }
  const repos = new Map()
  for (const item of contributions) {
    monthly[item.merged_at.slice(0, 7)] += 1
    const key = item.repo.toLowerCase()
    repos.set(key, (repos.get(key) || 0) + 1)
  }
  return {
    username: USERNAME,
    scope: 'Authored, merged pull requests in public repositories outside Bortlesboat, by merge date',
    window,
    query,
    source_url: `https://github.com/search?q=${encodeURIComponent(query)}&type=pullrequests`,
    fetched_at: now.toISOString(),
    merged_prs: contributions.length,
    repos_contributed_to: repos.size,
    repeat_repositories: [...repos.values()].filter((count) => count > 1).length,
    monthly,
    items: contributions,
  }
}

async function refreshStats({ output = OUTPUT, ...options } = {}) {
  const stats = await collectStats(options)
  fs.writeFileSync(output, `${JSON.stringify(stats, null, 2)}\n`)
  return stats
}

if (require.main === module) {
  refreshStats().then((stats) => {
    console.log(`Verified ${stats.merged_prs} merged PRs across ${stats.repos_contributed_to} external repositories (${stats.window.start} to ${stats.window.end})`)
  }).catch((error) => {
    console.error(`Stats refresh failed; previous snapshot preserved: ${error.message}`)
    process.exitCode = 1
  })
}
module.exports = { contributionWindow, collectStats, refreshStats }
