import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const url = process.env.TRIAGE_URL ?? "http://127.0.0.1:5178/variance-memo/index.html";
const outputDir = new URL("../output/playwright/", import.meta.url);

await mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
try {
  await verifyViewport({
    browser,
    name: "desktop",
    viewport: { width: 1440, height: 1100 },
  });
  await verifyViewport({
    browser,
    name: "mobile",
    viewport: { width: 390, height: 1100 },
  });
} finally {
  await browser.close();
}

console.log("finance-file-triage browser verifier ok: diagnostic mode renders on desktop and mobile");

async function verifyViewport({ browser, name, viewport }) {
  const page = await browser.newPage({ viewport });
  await page.goto(url, { waitUntil: "networkidle" });
  await page.locator("#sampleButton").click();
  await page.locator("#diagnosticModeOutput").getByText("Rows to use next").waitFor();
  await page.locator("#diagnosticModeOutput").getByText("Safe advisory call agenda").waitFor();
  await page.locator("#memoOutput").getByText("90-minute review agenda").waitFor();

  const hasOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  if (hasOverflow) {
    throw new Error(`${name} layout has horizontal overflow`);
  }

  await page.screenshot({
    path: fileURLToPath(new URL(`finance-file-triage-diagnostic-${name}.png`, outputDir)),
    fullPage: true,
  });
  await page.close();
}
