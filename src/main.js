import './style.css'
import projects from './data/projects.json'
import caseStudies from './data/caseStudies.json'
import proofMap from './data/proofMap.json'

const externalUrl = (url) => /^https?:\/\//.test(url)
const linkAttrs = (url) => externalUrl(url) ? 'target="_blank" rel="noopener"' : ''
const escapeHtml = (value) => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('\"', '&quot;')
  .replaceAll("'", '&#39;')

const projectsEl = document.getElementById('projects')
if (projectsEl) {
  projectsEl.innerHTML = projects
    .map((project, index) => `
      <a href="${escapeHtml(project.url)}" ${linkAttrs(project.url)} class="artifact-row">
        <span class="artifact-number">${String(index + 1).padStart(2, '0')}</span>
        <span class="artifact-copy">
          <strong>${escapeHtml(project.name)}</strong>
          <span>${escapeHtml(project.description)}</span>
        </span>
        <span class="artifact-tags">
          ${project.tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join('')}
        </span>
      </a>
    `)
    .join('')
}

const proofMapEl = document.getElementById('proof-map')
if (proofMapEl) {
  proofMapEl.innerHTML = proofMap
    .map((lane) => `
      <article class="proof-lane">
        <div class="proof-lane-copy">
          <p class="proof-lane-label">${escapeHtml(lane.lane)}</p>
          <h3>${escapeHtml(lane.title)}</h3>
          <p>${escapeHtml(lane.summary)}</p>
        </div>
        <div class="proof-links">
          ${lane.proofs.map((proof) => `
            <a href="${escapeHtml(proof.url)}" ${linkAttrs(proof.url)} class="proof-link">
              <strong>${escapeHtml(proof.label)}</strong>
              <span>${escapeHtml(proof.note)}</span>
            </a>
          `).join('')}
        </div>
      </article>
    `)
    .join('')
}

const caseStudyEl = document.getElementById('case-study-list')
if (caseStudyEl) {
  caseStudyEl.innerHTML = caseStudies
    .map((study, index) => `
      <a href="${escapeHtml(study.url)}" target="_blank" rel="noopener" class="case-row">
        <span class="case-index">${String(index + 1).padStart(2, '0')}</span>
        <span class="case-main">
          <strong>${escapeHtml(study.name)}</strong>
          <span class="case-problem">${escapeHtml(study.problem)}</span>
        </span>
        <span class="case-proof">${escapeHtml(study.proof)}</span>
        <span class="case-tags">${study.tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join('')}</span>
      </a>
    `)
    .join('')
}
