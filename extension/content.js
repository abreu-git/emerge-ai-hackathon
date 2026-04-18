// Echo — content script
// Captures prompts from ChatGPT's native composer and forwards to the side
// panel via chrome.runtime messaging. No DOM injection (side panel holds UI).

(function () {
  const LOG = (...args) => console.log("[Echo/content]", ...args);

  // Defensive cleanup: remove any stale DOM left over from an older version.
  for (const id of ["echo-sidebar-root", "echo-toggle-btn"]) {
    const el = document.getElementById(id);
    if (el) {
      LOG("removing stale element:", id);
      el.remove();
    }
  }

  if (window.__ECHO_INJECTED__) {
    LOG("already injected, skipping handlers");
    return;
  }
  window.__ECHO_INJECTED__ = true;

  // Correct selectors — ChatGPT's composer is a ProseMirror contenteditable
  // at #prompt-textarea, wrapped by a div with data-composer-surface="true".
  // There is NO <form> around it, which is why the previous selector failed.
  function findComposer() {
    return (
      document.querySelector("#prompt-textarea") ||
      document.querySelector(
        '[data-composer-surface="true"] [contenteditable="true"]'
      ) ||
      document.querySelector('textarea[name="prompt-textarea"]')
    );
  }

  function findSendButton() {
    return (
      document.querySelector("#composer-submit-button") ||
      document.querySelector('button[data-testid="send-button"]') ||
      document.querySelector('button[aria-label*="Send" i]') ||
      document.querySelector('button[aria-label*="message" i][type="button"]')
    );
  }

  function captureFromElement(el) {
    if (!el) return "";
    // ProseMirror uses contenteditable; use innerText for the rendered text,
    // falling back to .value for the hidden textarea case.
    const text = (el.innerText || el.value || "").trim();
    // Strip ChatGPT's placeholder text that sometimes gets picked up.
    if (text === "Ask anything" || text === "Chat with ChatGPT") return "";
    return text;
  }

  let currentComposer = null;
  let lastSent = { prompt: "", at: 0 };

  function send(prompt, via) {
    const now = Date.now();
    // Deduplicate: ignore if we just sent the same prompt within the last 2s
    // (catches Enter + send-button double fires).
    if (prompt === lastSent.prompt && now - lastSent.at < 2000) {
      LOG(`dedup: already sent "${prompt.slice(0, 40)}..." ${now - lastSent.at}ms ago`);
      return;
    }
    lastSent = { prompt, at: now };
    LOG(`captured via ${via} (${prompt.length} chars):`, prompt.slice(0, 80));
    try {
      chrome.runtime.sendMessage(
        { type: "ECHO_PROMPT_CAPTURED", prompt },
        (ack) => {
          if (chrome.runtime.lastError) {
            LOG("sendMessage error:", chrome.runtime.lastError.message);
          } else {
            LOG("background ack:", ack);
          }
        }
      );
    } catch (e) {
      LOG("sendMessage threw:", e.message);
    }
  }

  // MutationObserver — ChatGPT is an SPA; the composer gets remounted when
  // navigating between chats. Re-find on DOM changes.
  const obs = new MutationObserver(() => {
    const composer = findComposer();
    if (composer && composer !== currentComposer) {
      currentComposer = composer;
      LOG("composer mounted/remounted");
    }
  });
  obs.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });

  // Initial find
  currentComposer = findComposer();
  if (currentComposer) LOG("composer found on init");
  else LOG("composer not found on init; MutationObserver will catch it");

  // ---- Submit detection — Enter key ----
  // Capture phase so we read the text BEFORE ChatGPT's handler clears it.
  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key !== "Enter" || e.shiftKey || e.isComposing) return;
      const composer = findComposer();
      if (!composer) return;
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

  // ---- Submit detection — Send button click ----
  document.addEventListener(
    "click",
    (e) => {
      const target = e.target;
      if (!(target instanceof Element)) return;
      const btn = target.closest(
        '#composer-submit-button, button[data-testid="send-button"], button[aria-label*="Send" i]'
      );
      if (!btn) return;
      // Read the composer text BEFORE ChatGPT clears it.
      const composer = findComposer();
      const prompt = captureFromElement(composer);
      if (!prompt) return;
      send(prompt, "send button");
    },
    true
  );

  LOG("content script ready on", location.hostname);
})();
