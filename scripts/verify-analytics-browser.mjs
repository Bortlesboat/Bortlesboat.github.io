import { chromium } from "playwright";

const targetUrl =
  process.argv[2] ?? "http://127.0.0.1:4190/agent-payments/signal-ledger/index.html";

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.addInitScript(() => {
    window.__bbAnalyticsEvents = [];
    window.addEventListener("bb:analytics", (event) => {
      window.__bbAnalyticsEvents.push(event.detail);
    });
  });

  await page.goto(targetUrl, { waitUntil: "networkidle" });
  await page.waitForFunction(() => Boolean(window.bbAnalytics));
  await page.locator(".source-link").first().waitFor();

  await clickWithoutNavigating(page, '[data-analytics-event="ledger_feed_opened"]');
  await clickWithoutNavigating(page, '.source-link[data-analytics-event="ledger_source_clicked"]');

  const result = await page.evaluate(() => {
    const eventNames = window.__bbAnalyticsEvents.map((event) => event.eventName);
    const sourceEvent = window.__bbAnalyticsEvents.find((event) => event.eventName === "ledger_source_clicked");
    return {
      eventNames,
      dataLayerLength: window.dataLayer?.length ?? 0,
      supportedEvents: window.bbAnalytics.supportedEvents,
      sourceEventProperties: sourceEvent?.properties ?? {},
    };
  });

  const failures = [];
  for (const eventName of ["page_viewed", "ledger_feed_opened", "ledger_source_clicked"]) {
    if (!result.eventNames.includes(eventName)) {
      failures.push(`missing browser analytics event: ${eventName}`);
    }
  }
  if (result.dataLayerLength < 3) {
    failures.push(`expected dataLayer to receive at least 3 events, saw ${result.dataLayerLength}`);
  }
  if (!result.supportedEvents?.includes("ledger_source_clicked")) {
    failures.push("window.bbAnalytics.supportedEvents is missing ledger_source_clicked");
  }
  if (!result.sourceEventProperties.source_id || !result.sourceEventProperties.proof_status) {
    failures.push("ledger_source_clicked must include source_id and proof_status");
  }

  const output = {
    ok: failures.length === 0,
    failures,
    checked: result,
  };
  console.log(JSON.stringify(output, null, 2));
  process.exit(output.ok ? 0 : 1);
} finally {
  await browser.close();
}

async function clickWithoutNavigating(page, selector) {
  await page.evaluate((targetSelector) => {
    const anchor = document.querySelector(targetSelector);
    if (!anchor) {
      throw new Error(`Missing analytics target: ${targetSelector}`);
    }
    anchor.addEventListener("click", (event) => event.preventDefault(), {
      capture: true,
      once: true,
    });
    anchor.dispatchEvent(new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      view: window,
    }));
  }, selector);
}
