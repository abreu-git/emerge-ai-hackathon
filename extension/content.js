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

  // ---- Echo button injection into ChatGPT's composer action row ----
  const ECHO_BTN_ID = "echo-composer-btn";

  function injectEchoButton() {
    if (document.getElementById(ECHO_BTN_ID)) return; // already injected

    // Anchor: the dictation button. Its container is the action row we want.
    const anchor =
      document.querySelector('button[aria-label*="dictation" i]') ||
      document.querySelector('button[data-testid="composer-speech-button"]');
    if (!anchor) return;

    // Climb to the button row. ChatGPT wraps each button in a <span>, and
    // all of them sit in a flex container with "ms-auto" or similar.
    const row =
      anchor.closest(".ms-auto") ||
      (anchor.parentElement && anchor.parentElement.parentElement);
    if (!row) return;

    const btn = document.createElement("button");
    btn.id = ECHO_BTN_ID;
    btn.type = "button";
    btn.className = "composer-btn h-9 min-h-9 w-9 min-w-9";
    btn.setAttribute("aria-label", "Analyze with Echo");
    btn.title = "Analyze with Echo — run 3 adversarial variants in parallel";
    btn.innerHTML = `
      <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
        <circle cx="10" cy="10" r="7.5" fill="none" stroke="#A855F7" stroke-opacity="0.45" stroke-width="1"/>
        <circle cx="10" cy="10" r="4" fill="#A855F7"/>
      </svg>
    `;
    btn.addEventListener("click", onEchoButtonClick);

    // Insert at start of row so it sits left of dictation + voice.
    row.insertBefore(btn, row.firstChild);
    LOG("injected Echo button into composer");
  }

  function onEchoButtonClick(e) {
    e.preventDefault();
    e.stopPropagation();
    const composer = findComposer();
    const prompt = captureFromElement(composer);
    if (!prompt) {
      LOG("Echo button clicked but composer is empty");
      return;
    }
    LOG(`Echo button clicked, capturing: "${prompt.slice(0, 60)}..."`);
    // Ask background to open the side panel (requires user-gesture routing).
    try {
      chrome.runtime.sendMessage({
        type: "ECHO_OPEN_PANEL_WITH_PROMPT",
        prompt,
      });
    } catch (err) {
      LOG("could not message background:", err.message);
    }
  }

  // MutationObserver — ChatGPT is an SPA; the composer and its action row
  // get remounted when navigating between chats. Re-find and re-inject.
  const obs = new MutationObserver(() => {
    const composer = findComposer();
    if (composer && composer !== currentComposer) {
      currentComposer = composer;
      LOG("composer mounted/remounted");
    }
    injectEchoButton();
  });
  obs.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });

  // Initial find
  currentComposer = findComposer();
  if (currentComposer) LOG("composer found on init");
  else LOG("composer not found on init; MutationObserver will catch it");
  injectEchoButton();

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
