import './style.css'
import projects from './data/projects.json'
import caseStudies from './data/caseStudies.json'

const externalUrl = (url) => /^https?:\/\//.test(url)
const linkAttrs = (url) => externalUrl(url) ? 'target="_blank" rel="noopener"' : ''

const projectsEl = document.getElementById('projects')
if (projectsEl) {
  projectsEl.innerHTML = projects
    .map((project, index) => `
      <a href="${project.url}" ${linkAttrs(project.url)} class="artifact-row">
        <span class="artifact-number">${String(index + 1).padStart(2, '0')}</span>
        <span class="artifact-copy">
          <strong>${project.name}</strong>
          <span>${project.description}</span>
        </span>
        <span class="artifact-tags">
          ${project.tags.map((tag) => `<span>${tag}</span>`).join('')}
        </span>
      </a>
    `)
    .join('')
}

const caseStudyEl = document.getElementById('case-study-list')
if (caseStudyEl) {
  caseStudyEl.innerHTML = caseStudies
    .map((study, index) => `
      <a href="${study.url}" target="_blank" rel="noopener" class="case-row">
        <span class="case-index">${String(index + 1).padStart(2, '0')}</span>
        <span class="case-main">
          <strong>${study.name}</strong>
          <span class="case-problem">${study.problem}</span>
        </span>
        <span class="case-proof">${study.proof}</span>
        <span class="case-tags">${study.tags.map((tag) => `<span>${tag}</span>`).join('')}</span>
      </a>
    `)
    .join('')
}
