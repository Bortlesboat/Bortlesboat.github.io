import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);

const [indexHtml, projectsJson, caseStudiesJson, proofMapJson, mainJs] = await Promise.all([
  read("index.html"),
  read("src/data/projects.json"),
  read("src/data/caseStudies.json"),
  read("src/data/proofMap.json"),
  read("src/main.js"),
]);

const projects = JSON.parse(projectsJson);
const caseStudies = JSON.parse(caseStudiesJson);
const proofMap = JSON.parse(proofMapJson);
const failures = [];

const launchUrl = "https://bortlesboat.github.io/x402-insights/launch.html";
const llmsUrl = "https://bortlesboat.github.io/x402-insights/llms.txt";

const project = projects.find((item) => item.name === "AgentOps Ledger");
if (!project) {
  failures.push("projects.json is missing AgentOps Ledger");
} else {
  if (project.url !== launchUrl) {
    failures.push(`AgentOps project should point at launch hub, found ${project.url}`);
  }
  for (const token of ["AI workflow", "x402", "Splunk"]) {
    if (!project.description.includes(token) && !project.tags.includes(token)) {
      failures.push(`AgentOps project is missing portfolio token: ${token}`);
    }
  }
}

const caseStudy = caseStudies.find((item) => item.name === "AgentOps Ledger");
if (!caseStudy) {
  failures.push("caseStudies.json is missing AgentOps Ledger");
} else {
  for (const token of ["launch hub", "hosted demo", "architecture", "Splunk HEC proof"]) {
    if (!caseStudy.proof.includes(token)) {
      failures.push(`AgentOps case-study proof is missing: ${token}`);
    }
  }
}

for (const token of [
  "AgentOps Ledger",
  launchUrl,
  "Splunk HEC proof",
  "proof-map",
]) {
  if (!indexHtml.includes(token)) {
    failures.push(`index.html is missing AgentOps homepage token: ${token}`);
  }
}


const proofMapLanes = proofMap.map((lane) => lane.lane);
for (const expectedLane of ["Tech FP&A", "AI workflow automation", "Bitcoin / x402", "Developer infrastructure"]) {
  if (!proofMapLanes.includes(expectedLane)) {
    failures.push(`proofMap.json is missing lane: ${expectedLane}`);
  }
}
if (!mainJs.includes("./data/proofMap.json") || !mainJs.includes("proof-map")) {
  failures.push("main.js does not render the proof map data");
}

for (const [label, content] of [
  ["index.html", indexHtml],
  ["projects.json", projectsJson],
  ["caseStudies.json", caseStudiesJson],
  ["proofMap.json", proofMapJson],
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
  },
};

console.log(JSON.stringify(output, null, 2));
process.exit(output.ok ? 0 : 1);

async function read(path) {
  return readFile(new URL(path, root), "utf8");
}
