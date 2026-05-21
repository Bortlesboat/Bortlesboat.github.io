# Analytics And Discoverability Setup

Last updated: 2026-05-21

## What Is Installed

- First-party browser event layer: `/analytics.js`
- Public tracking plan: `/analytics/tracking-plan.json`
- Root crawler map: `/llms.txt`
- Ledger crawler map: `/agent-payments/signal-ledger/llms.txt`
- Proof graph page and JSON: `/proof/` and `/proof/graph.json`
- Canonical signal feed: `/agent-payments/signal-ledger/feed.json`
- Ledger structured data: `WebPage`, `Dataset`, `BreadcrumbList`, `FAQPage`, and `ItemList`
- Proof graph structured data: `WebPage`, `Dataset`, `ItemList`, and `BreadcrumbList`
- Robots policy allows normal search and AI crawlers and points to the XML sitemap.

## Canonical Source Rules

- `/agent-payments/signal-ledger/feed.json` is the canonical machine-readable Agent Payment Signal Ledger feed.
- `/proof/agent-payments-signal-ledger/feed.json` remains a compatibility snapshot only and points back to the canonical feed.
- `/proof/graph.json`, `/llms.txt`, `robots.txt`, and `sitemap.xml` should all advertise the canonical feed, not the proof-local compatibility snapshot.
- HTTP `402 Payment Required` is a live response for x402-style paid endpoints; link checks treat it as reachable.

## Events

- `page_viewed`
- `ledger_feed_opened`
- `ledger_source_clicked`
- `proof_link_clicked`
- `outbound_link_clicked`
- `internal_link_clicked`

The event layer forwards to any installed `gtag`, `plausible`, `posthog`, or `umami` object and always pushes to `window.dataLayer`.

## External Account Steps

1. Cloudflare Web Analytics: create a site for `bortlesboat.github.io`, copy the beacon token, and add it to the site HTML or ask Codex to wire it.
2. Google Search Console: add a URL-prefix property for `https://bortlesboat.github.io/`, choose HTML tag or HTML file verification, then ask Codex to add the token/file.
3. Submit `https://bortlesboat.github.io/sitemap.xml` in Search Console.
4. Bing Webmaster Tools: import the Search Console property or add an HTML meta/file verification token.
5. Optional GA4: create a web stream for `https://bortlesboat.github.io/` and ask Codex to add the `G-...` measurement ID.

## Debugging

Open the site in a browser and run:

```js
localStorage.setItem("bb_debug_analytics", "true")
```

Reload and click links. Events print to the console and also dispatch a `bb:analytics` browser event.
