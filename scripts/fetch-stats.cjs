#!/usr/bin/env node
// Fetches GitHub stats for Bortlesboat and writes to public/stats.json
// Run: node scripts/fetch-stats.js
// Uses GITHUB_TOKEN env var if available (5000 req/hr vs 60 req/hr)

const fs = require('fs')
const path = require('path')

const USERNAME = 'Bortlesboat'
const OUTPUT = path.join(__dirname, '..', 'public', 'stats.json')

const headers = { 'User-Agent': 'bortlesboat-site' }
if (process.env.GITHUB_TOKEN) {
  headers['Authorization'] = `Bearer ${process.env.GITHUB_TOKEN}`
}

async function fetchJSON(url) {
  const res = await fetch(url, { headers })
  if (!res.ok) throw new Error(`${url}: ${res.status} ${res.statusText}`)
  return res.json()
}

async function main() {
  console.log('Fetching GitHub stats...')

  const [user, prsAll, prsMerged] = await Promise.all([
    fetchJSON(`https://api.github.com/users/${USERNAME}`),
    fetchJSON(
      `https://api.github.com/search/issues?q=author:${USERNAME}+type:pr&per_page=1`
    ),
    fetchJSON(
      `https://api.github.com/search/issues?q=author:${USERNAME}+type:pr+is:merged&per_page=1`
    ),
  ])

  // Count unique repos contributed to from recent PRs
  let reposContributed = '60+'
  try {
    const recentPRs = await fetchJSON(
      `https://api.github.com/search/issues?q=author:${USERNAME}+type:pr&per_page=100&sort=created&order=desc`
    )
    const uniqueRepos = new Set(
      recentPRs.items.map((pr) => pr.repository_url)
    )
    reposContributed = `${Math.max(uniqueRepos.size, 60)}+`
  } catch {
    // Fallback to hardcoded
  }

  const stats = {
    total_prs: `${prsAll.total_count}`,
    merged_prs: `${prsMerged.total_count}`,
    public_repos: `${user.public_repos}`,
    repos_contributed_to: reposContributed,
    fetched_at: new Date().toISOString(),
  }

  fs.writeFileSync(OUTPUT, JSON.stringify(stats, null, 2))
  console.log('Stats written to', OUTPUT)
  console.log(stats)
}

main().catch((err) => {
  console.error('Failed to fetch stats:', err.message)
  console.log('Using fallback values...')
  const fallback = {
    total_prs: '280+',
    merged_prs: '62+',
    public_repos: '107',
    repos_contributed_to: '60+',
    fetched_at: new Date().toISOString(),
    error: err.message,
  }
  fs.writeFileSync(OUTPUT, JSON.stringify(fallback, null, 2))
})
