import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);

const [indexHtml, projectsJson, caseStudiesJson] = await Promise.all([
  read("index.html"),
  read("src/data/projects.json"),
  read("src/data/caseStudies.json"),
]);

const projects = JSON.parse(projectsJson);
const caseStudies = JSON.parse(caseStudiesJson);
const failures = [];

const launchUrl = "https://bortlesboat.github.io/x402-insights/launch.html";
const judgeIndexUrl = "https://bortlesboat.github.io/x402-insights/hackathon/judge-index.json";
const llmsUrl = "https://bortlesboat.github.io/x402-insights/llms.txt";

const project = projects.find((item) => item.name === "AgentOps Ledger");
if (!project) {
  failures.push("projects.json is missing AgentOps Ledger");
} else {
  if (project.url !== launchUrl) {
    failures.push(`AgentOps project should point at launch hub, found ${project.url}`);
  }
  for (const token of ["enterprise-agent", "hackathon", "Splunk"]) {
    if (!project.description.includes(token) && !project.tags.includes(token)) {
      failures.push(`AgentOps project is missing portfolio token: ${token}`);
    }
  }
}

const caseStudy = caseStudies.find((item) => item.name === "AgentOps Ledger");
if (!caseStudy) {
  failures.push("caseStudies.json is missing AgentOps Ledger");
} else {
  for (const token of ["launch page", "judge index", "Splunk HEC proof"]) {
    if (!caseStudy.proof.includes(token)) {
      failures.push(`AgentOps case-study proof is missing: ${token}`);
    }
  }
}

for (const token of [
  "AgentOps Ledger",
  launchUrl,
  "Enterprise agent flight recorder",
  "Splunk HEC proof",
]) {
  if (!indexHtml.includes(token)) {
    failures.push(`index.html is missing AgentOps homepage token: ${token}`);
  }
}

for (const [label, content] of [
  ["index.html", indexHtml],
  ["projects.json", projectsJson],
  ["caseStudies.json", caseStudiesJson],
]) {
  for (const banned of ["C:\\\\Users\\\\andre", "Devpost submitted", "finalist", "winner", "prize awarded"]) {
    if (content.includes(banned)) {
      failures.push(`${label} contains banned or overclaim token: ${banned}`);
    }
  }
}

const output = {
  ok: failures.length === 0,
  failures,
  checked: {
    projectUrl: project?.url ?? null,
    launchUrl,
    llmsUrl,
    judgeIndexUrl,
  },
};

console.log(JSON.stringify(output, null, 2));
process.exit(output.ok ? 0 : 1);

async function read(path) {
  return readFile(new URL(path, root), "utf8");
}
