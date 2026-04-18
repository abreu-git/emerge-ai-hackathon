// Echo — content script (thin)
// Watches the ChatGPT composer and notifies the side panel on submit.
// All UI lives in sidebar.html (native Chrome side panel).

(function () {
  if (window.__ECHO_INJECTED__) return;
  window.__ECHO_INJECTED__ = true;

  function findComposer() {
    return document.querySelector(
      'form textarea, form [contenteditable="true"]'
    );
  }

  function captureFromElement(el) {
    if (!el) return "";
    return (el.innerText || el.value || "").trim();
  }

  // Capture on Enter (without Shift) — matches ChatGPT's submit behavior.
  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key !== "Enter" || e.shiftKey || e.isComposing) return;
      const composer = findComposer();
      if (!composer || !composer.contains(e.target)) return;
      const prompt = captureFromElement(composer);
      if (!prompt) return;
      try {
        chrome.runtime.sendMessage({
          type: "ECHO_PROMPT_CAPTURED",
          prompt,
        });
      } catch (_e) {
        // Extension context may be invalidated on reload — ignore.
      }
    },
    true
  );

  // Also capture when the send button is clicked.
  document.addEventListener(
    "click",
    (e) => {
      const target = e.target;
      if (!(target instanceof Element)) return;
      const btn = target.closest('button[data-testid="send-button"], form button[type="submit"]');
      if (!btn) return;
      const composer = findComposer();
      const prompt = captureFromElement(composer);
      if (!prompt) return;
      try {
        chrome.runtime.sendMessage({
          type: "ECHO_PROMPT_CAPTURED",
          prompt,
        });
      } catch (_e) {}
    },
    true
  );

  console.log("[Echo] content script ready");
})();
