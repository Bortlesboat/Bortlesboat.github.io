import './style.css'
import stats from '../public/stats.json'
import oss from './data/ossHighlights.json'

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
const fmt = (n) => Number(n).toLocaleString('en-US')

// ── live stats (stats.json is refreshed from the GitHub API on every deploy) ──
for (const el of document.querySelectorAll('[data-stat]')) {
  const key = el.dataset.stat
  if (key === 'fetched_at') el.textContent = stats.fetched_at.slice(0, 10)
  else if (Number.isFinite(stats[key])) el.textContent = fmt(stats[key])
}
for (const el of document.querySelectorAll('[data-repo-count]')) {
  const n = stats.items.filter((item) => item.repo === el.dataset.repoCount).length
  if (n) el.textContent = n
}
const yearEl = document.getElementById('year')
if (yearEl) yearEl.textContent = new Date().getFullYear()

// ── verified open-source highlights (dated snapshot: src/data/ossHighlights.json) ──
const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const kStars = (n) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n))
for (const el of document.querySelectorAll('[data-oss]')) el.textContent = fmt(oss.substantive20k[el.dataset.oss])
const namesEl = document.getElementById('oss-names')
if (namesEl) {
  namesEl.innerHTML = oss.names
    .map((n) => `<li><a href="${esc(n.url)}" target="_blank" rel="noopener">${esc(n.name)}</a></li>`)
    .join('')
}
const featuredEl = document.getElementById('oss-featured')
if (featuredEl) {
  featuredEl.innerHTML = oss.featured
    .map((f) => `
      <a class="pr" href="${esc(f.url)}" target="_blank" rel="noopener">
        <span class="pr-project">${esc(f.project)}<small>★ ${kStars(f.stars)}</small></span>
        <strong>${esc(f.title)}</strong>
        <span class="pr-by">${f.mergedBy ? `@${esc(f.mergedBy)}` : 'maintainers'}</span>
      </a>`)
    .join('')
}
const methodEl = document.getElementById('oss-method')
if (methodEl) methodEl.textContent = `Stars and substantive counts as of ${oss.asOf}. ${oss.method}`

// ── merged PRs per month (from the first active month through now) ──
const chartEl = document.getElementById('merge-chart')
if (chartEl && stats.items.length) {
  const counts = new Map()
  for (const item of stats.items) {
    const month = item.merged_at.slice(0, 7)
    counts.set(month, (counts.get(month) || 0) + 1)
  }
  const first = [...counts.keys()].sort()[0]
  const months = []
  const cursor = new Date(`${first}-01T00:00:00Z`)
  const end = new Date(`${stats.window.end}T00:00:00Z`)
  while (cursor <= end) {
    months.push(cursor.toISOString().slice(0, 7))
    cursor.setUTCMonth(cursor.getUTCMonth() + 1)
  }
  const data = months.map((m) => ({ m, n: counts.get(m) || 0 }))
  const max = Math.max(...data.map((d) => d.n))
  const W = 560, H = 330, top = 22, bottom = 26, gap = 10
  const bw = (W - gap * (data.length - 1)) / data.length
  const y = (n) => top + (H - top - bottom) * (1 - n / max)
  const label = (m) => new Date(`${m}-01T00:00:00Z`).toLocaleString('en-US', { month: 'short', timeZone: 'UTC' })
  chartEl.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}">
      <defs>
        <linearGradient id="bar-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#ffb35c" />
          <stop offset="1" stop-color="#f7931a" stop-opacity="0.35" />
        </linearGradient>
      </defs>
      <line class="grid" x1="0" x2="${W}" y1="${H - bottom}" y2="${H - bottom}" />
      ${data.map((d, i) => {
        const x = i * (bw + gap)
        return `
          <rect class="bar" style="--d:${(i * 0.06).toFixed(2)}s" x="${x}" y="${y(d.n)}" width="${bw}" height="${Math.max(0, H - bottom - y(d.n))}" rx="4" />
          <text class="val" x="${x + bw / 2}" y="${y(d.n) - 7}">${d.n || ''}</text>
          <text class="lbl" x="${x + bw / 2}" y="${H - 6}">${label(d.m)}</text>`
      }).join('')}
    </svg>`
  chartEl.setAttribute('aria-label', `Merged pull requests per month: ${data.map((d) => `${label(d.m)} ${d.n}`).join(', ')}`)
}

// ── scroll reveals ──
const revealEls = document.querySelectorAll('.reveal, .chart')
if (reduceMotion || !('IntersectionObserver' in window)) {
  revealEls.forEach((el) => el.classList.add('in'))
} else {
  document.querySelectorAll('.bento .card').forEach((el, i) => el.style.setProperty('--d', `${(i % 4) * 0.07}s`))
  const io = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        entry.target.classList.add('in')
        io.unobserve(entry.target)
      }
    }
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.12 })
  revealEls.forEach((el) => io.observe(el))
}

// ── count-up for the stat row ──
const countEls = document.querySelectorAll('[data-count]')
if (!reduceMotion && countEls.length && 'IntersectionObserver' in window) {
  const io = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue
      io.unobserve(entry.target)
      const el = entry.target
      const target = Number(el.textContent.replace(/,/g, ''))
      const t0 = performance.now()
      const tick = (now) => {
        const p = Math.min(1, (now - t0) / 1200)
        el.textContent = fmt(Math.round(target * (1 - Math.pow(1 - p, 3))))
        if (p < 1) requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    }
  }, { threshold: 0.6 })
  countEls.forEach((el) => io.observe(el))
}

// ── nav border once scrolled ──
const nav = document.querySelector('.nav')
if (nav) {
  const onScroll = () => nav.classList.toggle('scrolled', window.scrollY > 8)
  window.addEventListener('scroll', onScroll, { passive: true })
  onScroll()
}

// ── hero reel: autoplay muted while on screen; sound toggle restarts it ──
const motionVideo = document.getElementById('motion-video')
const motionSound = document.getElementById('motion-sound')
if (motionVideo && motionSound) {
  let userPaused = reduceMotion

  new IntersectionObserver(([entry]) => {
    if (entry.isIntersecting && !userPaused) motionVideo.play().catch(() => {})
    else motionVideo.pause()
  }, { threshold: 0.35 }).observe(motionVideo)

  motionSound.addEventListener('click', () => {
    const unmute = motionVideo.muted
    motionVideo.muted = !unmute
    if (unmute) {
      userPaused = false
      motionVideo.currentTime = 0
      motionVideo.play().catch(() => {})
    }
    motionSound.textContent = unmute ? 'Sound off' : 'Sound on'
    motionSound.setAttribute('aria-pressed', String(unmute))
  })
}
