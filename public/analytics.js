(() => {
  const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"];
  const SESSION_KEY = "bb_attribution";
  const DEBUG_KEY = "bb_debug_analytics";
  const SUPPORTED_EVENTS = [
    "page_viewed",
    "ledger_feed_opened",
    "ledger_source_clicked",
    "proof_link_clicked",
    "outbound_link_clicked",
    "internal_link_clicked",
  ];

  const attribution = captureAttribution();

  function captureAttribution() {
    const params = new URLSearchParams(window.location.search);
    const current = {};
    for (const key of UTM_KEYS) {
      const value = params.get(key);
      if (value) current[key] = value;
    }

    if (Object.keys(current).length > 0) {
      writeSession(SESSION_KEY, current);
      return current;
    }

    return readSession(SESSION_KEY);
  }

  function track(eventName, properties = {}) {
    const payload = {
      page_title: document.title,
      page_location: window.location.href,
      page_path: window.location.pathname,
      page_referrer: document.referrer || "",
      ...attribution,
      ...properties,
    };

    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({ event: eventName, ...payload });

    if (typeof window.gtag === "function") {
      window.gtag("event", eventName, payload);
    }

    if (typeof window.plausible === "function") {
      window.plausible(eventName, { props: payload });
    }

    if (window.posthog && typeof window.posthog.capture === "function") {
      window.posthog.capture(eventName, payload);
    }

    if (window.umami && typeof window.umami.track === "function") {
      window.umami.track(eventName, payload);
    }

    window.dispatchEvent(new CustomEvent("bb:analytics", {
      detail: { eventName, properties: payload },
    }));

    if (window.localStorage?.getItem(DEBUG_KEY) === "true") {
      console.info("[bb analytics]", eventName, payload);
    }
  }

  function classifyLink(anchor) {
    const href = anchor.getAttribute("href") || "";
    const url = safeUrl(anchor.href);
    const explicitEvent = anchor.dataset.analyticsEvent;
    if (explicitEvent) return explicitEvent;
    if (href.endsWith("feed.json")) return "ledger_feed_opened";
    if (href.includes("/proof/")) return "proof_link_clicked";
    if (url && url.origin !== window.location.origin) return "outbound_link_clicked";
    return "internal_link_clicked";
  }

  function linkProperties(anchor) {
    const url = safeUrl(anchor.href);
    return {
      link_url: anchor.href,
      link_text: normalizedText(anchor.textContent),
      link_domain: url?.hostname || "",
      link_type: anchor.dataset.analyticsType || (url?.origin === window.location.origin ? "internal" : "outbound"),
      link_location: anchor.dataset.analyticsLocation || closestSection(anchor),
      source_id: anchor.dataset.sourceId || "",
      proof_status: anchor.dataset.proofStatus || "",
    };
  }

  function bindClicks() {
    document.addEventListener("click", (event) => {
      const anchor = event.target.closest?.("a[href]");
      if (!anchor) return;
      track(classifyLink(anchor), linkProperties(anchor));
    });
  }

  function pageType() {
    if (window.location.pathname.includes("/agent-payments/signal-ledger/")) {
      return "agent_payment_signal_ledger";
    }
    if (window.location.pathname.includes("/proof/")) {
      return "proof_graph";
    }
    if (window.location.pathname === "/") {
      return "portfolio_home";
    }
    return "portfolio_page";
  }

  function closestSection(element) {
    const section = element.closest?.("section, header, footer, nav, main");
    return section?.id || section?.getAttribute?.("aria-label") || section?.className || "";
  }

  function normalizedText(value) {
    return String(value || "").replace(/\s+/g, " ").trim().slice(0, 140);
  }

  function safeUrl(value) {
    try {
      return new URL(value, window.location.href);
    } catch {
      return null;
    }
  }

  function readSession(key) {
    try {
      return JSON.parse(window.sessionStorage.getItem(key) || "{}");
    } catch {
      return {};
    }
  }

  function writeSession(key, value) {
    try {
      window.sessionStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Session storage may be unavailable in privacy-hardened contexts.
    }
  }

  window.bbAnalytics = { track };
  window.bbAnalytics.supportedEvents = SUPPORTED_EVENTS;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      bindClicks();
      track("page_viewed", { page_type: pageType() });
    }, { once: true });
  } else {
    bindClicks();
    track("page_viewed", { page_type: pageType() });
  }
})();
