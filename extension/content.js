// Echo — content script (thin)
// Watches the ChatGPT composer and notifies the side panel on submit.
// All UI lives in sidebar.html (native Chrome side panel).

(function () {
  if (window.__ECHO_INJECTED__) {
    console.log("[Echo/content] already injected, skipping");
    return;
  }
  window.__ECHO_INJECTED__ = true;

  const LOG = (...args) => console.log("[Echo/content]", ...args);

  function findComposer() {
    const el = document.querySelector(
      'form textarea, form [contenteditable="true"]'
    );
    if (!el) LOG("composer not found");
    return el;
  }

  function captureFromElement(el) {
    if (!el) return "";
    return (el.innerText || el.value || "").trim();
  }

  function send(prompt, via) {
    LOG(`captured via ${via} (${prompt.length} chars):`, prompt.slice(0, 80));
    try {
      chrome.runtime.sendMessage({ type: "ECHO_PROMPT_CAPTURED", prompt }, (ack) => {
        if (chrome.runtime.lastError) {
          LOG("sendMessage error:", chrome.runtime.lastError.message);
        } else {
          LOG("background ack:", ack);
        }
      });
    } catch (e) {
      LOG("sendMessage threw:", e.message);
    }
  }

  // Capture on Enter (without Shift) — matches ChatGPT's submit behavior.
  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key !== "Enter" || e.shiftKey || e.isComposing) return;
      const composer = findComposer();
      if (!composer) return;
      // Check if event target is inside the composer (for contenteditable)
      // or IS the composer (for textarea).
      const targetIsComposer =
        e.target === composer ||
        (composer.contains && composer.contains(e.target));
      if (!targetIsComposer) return;
      const prompt = captureFromElement(composer);
      if (!prompt) return;
      send(prompt, "Enter key");
    },
    true
  );

  // Also capture when the send button is clicked.
  document.addEventListener(
    "click",
    (e) => {
      const target = e.target;
      if (!(target instanceof Element)) return;
      const btn = target.closest(
        'button[data-testid="send-button"], button[aria-label*="end" i], form button[type="submit"]'
      );
      if (!btn) return;
      const composer = findComposer();
      const prompt = captureFromElement(composer);
      if (!prompt) return;
      send(prompt, "send button");
    },
    true
  );

  LOG("content script ready on", location.hostname);
})();
