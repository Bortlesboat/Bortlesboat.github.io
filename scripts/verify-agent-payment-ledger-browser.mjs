import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const targetUrl =
  process.argv[2] ?? "http://127.0.0.1:4185/agent-payments/signal-ledger/";
const outputDir = new URL("../output/playwright/", import.meta.url);

await mkdir(outputDir, { recursive: true });

const browser = await chromium.launch();
try {
  await verifyViewport({
    browser,
    name: "desktop",
    viewport: { width: 1440, height: 1100 },
  });
  await verifyViewport({
    browser,
    name: "mobile",
    viewport: { width: 390, height: 900 },
  });
} finally {
  await browser.close();
}

console.log(
  "agent-payment-signal-ledger browser verifier ok: return brief renders and links rows",
);

async function verifyViewport({ browser, name, viewport }) {
  const page = await browser.newPage({ viewport });
  await page.goto(targetUrl, { waitUntil: "networkidle" });
  await page.locator("#return-brief").getByText("Check first").waitFor();
  await page.locator("#return-brief").getByText("Why return").waitFor();
  await page.locator("#return-brief").getByText("Next safe action").waitFor();
  await page.locator("#return-brief").getByText("Delta since last refresh").waitFor();
  await page.locator("#return-brief-rows a").first().waitFor();
  await page.locator("#return-brief-delta-rows a").first().waitFor();

  const linkCount = await page.locator("#return-brief-rows a").count();
  if (linkCount < 3) {
    throw new Error(`expected at least 3 return brief row links, saw ${linkCount}`);
  }

  const deltaLinkCount = await page.locator("#return-brief-delta-rows a").count();
  if (deltaLinkCount < 3) {
    throw new Error(`expected at least 3 refresh delta row links, saw ${deltaLinkCount}`);
  }

  const firstHref = await page.locator("#return-brief-rows a").first().getAttribute("href");
  if (!firstHref?.startsWith("#row-")) {
    throw new Error(`expected first watch-row link to target a row id, saw ${firstHref}`);
  }

  await page.locator("#return-brief-rows a").first().click();
  const targetRow = page.locator(firstHref).first();
  await targetRow.waitFor();

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  if (overflow) {
    const offenders = await page.evaluate(() =>
      Array.from(document.querySelectorAll("body *"))
        .map((element) => {
          const rect = element.getBoundingClientRect();
          return {
            tag: element.tagName.toLowerCase(),
            className: element.className,
            id: element.id,
            width: Math.round(rect.width),
            left: Math.round(rect.left),
            right: Math.round(rect.right),
            scrollWidth: element.scrollWidth,
          };
        })
        .filter((item) => item.right > window.innerWidth + 1 || item.left < -1 || item.scrollWidth > item.width + 1)
        .slice(0, 8),
    );
    throw new Error(`${name} viewport has horizontal overflow: ${JSON.stringify(offenders)}`);
  }

  await page.screenshot({
    fullPage: true,
    path: fileURLToPath(new URL(`agent-payment-signal-ledger-return-brief-${name}.png`, outputDir)),
  });
  await page.close();
}
