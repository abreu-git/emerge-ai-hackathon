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
  let echoEnabled = true;

  // Load persisted on/off state.
  try {
    chrome.storage.local.get(["echo.enabled"], (res) => {
      if (typeof res["echo.enabled"] === "boolean") {
        echoEnabled = res["echo.enabled"];
        LOG("echoEnabled loaded:", echoEnabled);
        updateEchoButtonVisual();
      }
    });
  } catch (_e) {}

  function send(prompt, via) {
    if (!echoEnabled) {
      LOG(`capture skipped (Echo OFF) via ${via}`);
      return;
    }
    const now = Date.now();
    if (prompt === lastSent.prompt && now - lastSent.at < 3000) {
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
  const ECHO_STYLE_ID = "echo-composer-btn-style";

  function ensureEchoButtonStyles() {
    if (document.getElementById(ECHO_STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = ECHO_STYLE_ID;
    style.textContent = `
      #${ECHO_BTN_ID} { position: relative; isolation: isolate; }
      #${ECHO_BTN_ID}.is-on::before,
      #${ECHO_BTN_ID}.is-on::after {
        content: "";
        position: absolute;
        inset: 0;
        border-radius: 50%;
        border: 1.5px solid #A855F7;
        pointer-events: none;
        opacity: 0;
        transform-origin: center;
        animation: echo-composer-pulse 1.8s ease-out infinite;
        z-index: -1;
      }
      #${ECHO_BTN_ID}.is-on::after {
        animation-delay: 0.9s;
      }
      @keyframes echo-composer-pulse {
        0%   { transform: scale(0.55); opacity: 0.6; }
        80%  { opacity: 0; }
        100% { transform: scale(1.55); opacity: 0; }
      }
    `;
    document.head.appendChild(style);
  }

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
        <circle class="echo-btn-ring" cx="10" cy="10" r="7.5" fill="none" stroke="#A855F7" stroke-opacity="0.45" stroke-width="1"/>
        <circle class="echo-btn-dot" cx="10" cy="10" r="4" fill="#A855F7"/>
      </svg>
    `;
    btn.addEventListener("click", onEchoButtonClick);

    // Insert at start of row so it sits left of dictation + voice.
    ensureEchoButtonStyles();
    row.insertBefore(btn, row.firstChild);
    LOG("injected Echo button into composer");
    updateEchoButtonVisual();
  }

  function updateEchoButtonVisual() {
    const btn = document.getElementById(ECHO_BTN_ID);
    if (!btn) return;
    const ring = btn.querySelector(".echo-btn-ring");
    const dot = btn.querySelector(".echo-btn-dot");
    if (echoEnabled) {
      btn.classList.add("is-on");
      if (ring) { ring.setAttribute("stroke", "#A855F7"); ring.setAttribute("stroke-opacity", "0.45"); }
      if (dot) dot.setAttribute("fill", "#A855F7");
      btn.setAttribute("aria-pressed", "true");
      btn.title = "Echo is ON — click to pause capture";
    } else {
      btn.classList.remove("is-on");
      if (ring) { ring.setAttribute("stroke", "#6B6B6B"); ring.setAttribute("stroke-opacity", "0.3"); }
      if (dot) dot.setAttribute("fill", "#2A2A2A");
      btn.setAttribute("aria-pressed", "false");
      btn.title = "Echo is OFF — click to resume capture";
    }
  }

  function onEchoButtonClick(e) {
    e.preventDefault();
    e.stopPropagation();
    // Toggle on/off.
    echoEnabled = !echoEnabled;
    try {
      chrome.storage.local.set({ "echo.enabled": echoEnabled });
    } catch (_e) {}
    LOG("Echo toggled to:", echoEnabled ? "ON" : "OFF");
    updateEchoButtonVisual();
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
      const composer = findComposer();
      const prompt = captureFromElement(composer);
      if (!prompt) return;
      send(prompt, "send button");
    },
    true
  );

  // ---- Belt-and-suspenders: watch for new user messages in the transcript ----
  // No matter HOW the prompt was sent (voice, keyboard shortcut, paste + auto-
  // send, programmatic), ChatGPT always renders the user's message as a div
  // with data-message-author-role="user". Observing new ones appearing gives
  // us a reliable fallback that never misses. The 3s dedup prevents double
  // capture with the Enter / button paths.
  const seenUserMsgs = new WeakSet();
  const msgObs = new MutationObserver(() => {
    const msgs = document.querySelectorAll('[data-message-author-role="user"]');
    if (msgs.length === 0) return;
    const newest = msgs[msgs.length - 1];
    if (seenUserMsgs.has(newest)) return;
    seenUserMsgs.add(newest);
    const text = (newest.innerText || "").trim();
    if (!text) return;
    send(text, "transcript observer");
  });
  msgObs.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
  });

  LOG("content script ready on", location.hostname);
})();
