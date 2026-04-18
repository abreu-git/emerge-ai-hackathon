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

  // Site detection — branches selectors between ChatGPT and Claude.
  const HOST = location.hostname;
  const IS_CLAUDE = /(^|\.)claude\.(ai|com)$/.test(HOST);
  const IS_CHATGPT = /(^|\.)(chatgpt\.com|chat\.openai\.com)$/.test(HOST);
  const IS_GEMINI = /(^|\.)gemini\.google\.com$/.test(HOST);
  LOG("host:", HOST, "— claude?", IS_CLAUDE, "chatgpt?", IS_CHATGPT, "gemini?", IS_GEMINI);

  // Composer selectors:
  //   ChatGPT → #prompt-textarea (ProseMirror contenteditable)
  //   Claude  → div.ProseMirror[contenteditable="true"], aria-label "Write your prompt..."
  function findComposer() {
    if (IS_CLAUDE) {
      return (
        document.querySelector('div.ProseMirror[contenteditable="true"]') ||
        document.querySelector('[contenteditable="true"][aria-label*="prompt" i]') ||
        document.querySelector('[contenteditable="true"][role="textbox"]')
      );
    }
    if (IS_GEMINI) {
      return (
        document.querySelector('rich-textarea .ql-editor[contenteditable="true"]') ||
        document.querySelector('div.ql-editor[contenteditable="true"]') ||
        document.querySelector('[contenteditable="true"][role="textbox"]')
      );
    }
    return (
      document.querySelector("#prompt-textarea") ||
      document.querySelector('[data-composer-surface="true"] [contenteditable="true"]') ||
      document.querySelector('textarea[name="prompt-textarea"]')
    );
  }

  function findSendButton() {
    if (IS_CLAUDE) {
      return (
        document.querySelector('button[aria-label="Send message" i]') ||
        document.querySelector('button[aria-label*="send" i]:not([aria-label*="stop" i])')
      );
    }
    if (IS_GEMINI) {
      return (
        document.querySelector('button.send-button') ||
        document.querySelector('button[aria-label*="Send" i]:not([aria-label*="stop" i])') ||
        document.querySelector('button[mattooltip*="Send" i]')
      );
    }
    return (
      document.querySelector("#composer-submit-button") ||
      document.querySelector('button[data-testid="send-button"]') ||
      document.querySelector('button[aria-label*="Send" i]') ||
      document.querySelector('button[aria-label*="message" i][type="button"]')
    );
  }

  // Message container selectors per site.
  const USER_MSG_SEL = IS_CLAUDE
    ? '[data-testid="user-message"], div[data-test-render-count]:not(.font-claude-message)'
    : IS_GEMINI
    ? 'user-query .query-text, user-query .query-content, .user-query-container'
    : '[data-message-author-role="user"]';
  const ASST_MSG_SEL = IS_CLAUDE
    ? '.font-claude-message, [data-is-streaming], div[data-test-render-count].font-claude-message'
    : IS_GEMINI
    ? '.markdown.markdown-main-panel'
    : '[data-message-author-role="assistant"]';

  function captureFromElement(el) {
    if (!el) return "";
    // ProseMirror uses contenteditable; use innerText for the rendered text,
    // falling back to .value for the hidden textarea case.
    const text = (el.innerText || el.value || "").trim();
    // Strip ChatGPT's placeholder text that sometimes gets picked up.
    if (
      text === "Ask anything" ||
      text === "Chat with ChatGPT" ||
      text === "Reply to Claude…" ||
      text === "Write your prompt to Claude" ||
      text === "How can I help you today?" ||
      text === "Ask Gemini" ||
      text === "Enter a prompt here"
    ) return "";
    return text;
  }

  let currentComposer = null;
  let lastSent = { prompt: "", at: 0 };
  // Capture is always on. `isPanelOpen` only controls the button visual —
  // background pushes this via ECHO_PANEL_STATE whenever the side panel
  // opens/closes (either from our clicks or user hitting the X).
  let isPanelOpen = false;

  function send(prompt, via) {
    // Capture is ALWAYS on — the button toggle only controls panel visibility,
    // never the capture pipeline. Side panel can decide whether to show or
    // ignore incoming prompts.
    // Gemini's DOM sometimes wraps the user query with an a11y label
    // ("Tú dijiste" / "You said") that gets picked up as a second, distinct
    // capture. Strip it so both capture paths produce the same string and
    // get dedup'd below.
    prompt = prompt
      .replace(/^(Tú dijiste|Tu dijiste|You said|Dijiste)[\s:]*\n+/i, "")
      .trim();
    if (!prompt) return;
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
      #${ECHO_BTN_ID} {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 36px;
        height: 36px;
        border-radius: 9999px;
        background: transparent;
        border: none;
        cursor: pointer;
        margin: 0 2px;
        padding: 0;
        box-sizing: border-box;
        vertical-align: middle;
        flex: 0 0 auto;
      }
      /* Gemini: sit the Echo icon in a 24x24 footprint, same visual weight
         as the "+" and mic icons. Disable pulse rings entirely — Gemini's
         material buttons already have their own hover ripple. */
      body .leading-actions-wrapper #${ECHO_BTN_ID} {
        width: 28px !important;
        height: 28px !important;
        min-width: 28px !important;
        min-height: 28px !important;
        max-width: 28px !important;
        max-height: 28px !important;
        line-height: 28px !important;
        font: inherit !important;
        letter-spacing: normal !important;
        text-transform: none !important;
        overflow: hidden !important;
        padding: 0 !important;
        margin: 0 4px !important;
      }
      body .leading-actions-wrapper #${ECHO_BTN_ID} .echo-logo-wrap {
        width: 18px;
        height: 18px;
      }
      body .leading-actions-wrapper #${ECHO_BTN_ID} .echo-logo-wrap svg {
        width: 18px;
        height: 18px;
      }
      body .leading-actions-wrapper #${ECHO_BTN_ID} .echo-pulse-ring {
        display: none !important;
        animation: none !important;
      }
      /* Gemini: no animations at all — just the static icon. */
      body .leading-actions-wrapper #${ECHO_BTN_ID},
      body .leading-actions-wrapper #${ECHO_BTN_ID} *,
      body .leading-actions-wrapper #${ECHO_BTN_ID} .echo-logo-wrap,
      body .leading-actions-wrapper #${ECHO_BTN_ID} .echo-btn-ring,
      body .leading-actions-wrapper #${ECHO_BTN_ID} .echo-btn-dot {
        animation: none !important;
        transition: none !important;
      }
      #${ECHO_BTN_ID}:hover {
        background: rgba(124, 58, 237, 0.08);
      }
      #${ECHO_BTN_ID} .echo-logo-wrap {
        position: relative;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 20px;
        height: 20px;
        line-height: 0;
      }
      #${ECHO_BTN_ID} .echo-logo-wrap svg { display: block; }
      #${ECHO_BTN_ID}.is-on .echo-pulse-ring {
        position: absolute;
        left: 50%;
        top: 50%;
        width: 20px;
        height: 20px;
        margin-left: -10px;
        margin-top: -10px;
        border-radius: 50%;
        border: 1.5px solid #7C3AED;
        pointer-events: none;
        opacity: 0;
        transform-origin: center;
        animation: echo-composer-pulse 1.8s ease-out infinite;
        z-index: 0;
      }
      #${ECHO_BTN_ID}.is-on .echo-pulse-ring.is-second {
        animation-delay: 0.9s;
      }
      /* Hide rings when OFF */
      #${ECHO_BTN_ID}:not(.is-on) .echo-pulse-ring { display: none; }
      @keyframes echo-composer-pulse {
        0%   { transform: scale(0.55); opacity: 0.55; }
        80%  { opacity: 0; }
        100% { transform: scale(1.55); opacity: 0; }
      }
    `;
    document.head.appendChild(style);
  }

  function injectEchoButton() {
    if (document.getElementById(ECHO_BTN_ID)) return; // already injected

    let anchor, row, insertAfter = null;
    if (IS_CLAUDE) {
      // Claude composer action row: contains "Toggle menu" (+) and
      // "Toggle plan mode" buttons on the left, then a flex-1 spacer, then
      // the model selector + submit on the right. We want Echo right after
      // Plan mode, before the spacer.
      // Order of preference: Plan mode → Toggle menu → Add files (regular chat).
      const planBtn = document.querySelector('button[aria-label="Toggle plan mode" i]');
      const menuBtn = document.querySelector('button[aria-label="Toggle menu" i]');
      const addBtn  = document.querySelector(
        'button[aria-label="Add files, connectors, and more" i], ' +
        'button[aria-label*="add files" i]'
      );
      anchor = planBtn || menuBtn || addBtn;
      if (!anchor) return;
      // For Plan mode / Toggle menu the parent IS the action row.
      // For Add files, the button is wrapped in an extra <div>, so climb once.
      row = anchor.parentElement;
      let afterNode = anchor;
      if (row && row.childElementCount === 1 && /flex/.test(row.parentElement?.className || "")) {
        // anchor is wrapped — climb one level and use the wrapper as the "after" node.
        afterNode = row;
        row = row.parentElement;
      }
      if (!row) return;
      insertAfter = afterNode;
    } else if (IS_GEMINI) {
      // Gemini: .leading-actions-wrapper holds [uploader (+)] [toolbox-drawer].
      // Anchor on the uploader container; insert Echo right after it, before
      // "Herramientas".
      const wrapper = document.querySelector('.leading-actions-wrapper');
      if (!wrapper) return;
      const uploader = wrapper.querySelector('.uploader-button-container, uploader');
      row = wrapper;
      insertAfter = uploader || wrapper.firstElementChild;
      anchor = insertAfter;
    } else {
      // ChatGPT: anchor on dictation button, climb to .ms-auto action row.
      anchor =
        document.querySelector('button[aria-label*="dictation" i]') ||
        document.querySelector('button[data-testid="composer-speech-button"]');
      if (!anchor) return;
      row =
        anchor.closest(".ms-auto") ||
        (anchor.parentElement && anchor.parentElement.parentElement);
    }
    if (!row) return;

    const btn = document.createElement("button");
    btn.id = ECHO_BTN_ID;
    btn.type = "button";
    // Only ChatGPT needs its Tailwind/composer classes. Claude + Gemini rely
    // on our own #echo-composer-btn styles so the button doesn't inherit the
    // host app's button theme and blow up visually.
    if (IS_CHATGPT) {
      btn.className = "composer-btn h-9 min-h-9 w-9 min-w-9";
    } else {
      btn.className = "";
    }
    btn.setAttribute("aria-label", "Analyze with Echo");
    btn.title = "Analyze with Echo — run 3 adversarial variants in parallel";
    btn.innerHTML = `
      <span class="echo-logo-wrap">
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
          <circle class="echo-btn-ring" cx="10" cy="10" r="7.5" fill="none" stroke="#7C3AED" stroke-opacity="0.45" stroke-width="1"/>
          <circle class="echo-btn-dot" cx="10" cy="10" r="4" fill="#7C3AED"/>
        </svg>
        <span class="echo-pulse-ring" aria-hidden="true"></span>
        <span class="echo-pulse-ring is-second" aria-hidden="true"></span>
      </span>
    `;
    btn.addEventListener("click", onEchoButtonClick);

    ensureEchoButtonStyles();
    if (insertAfter && insertAfter.parentElement === row) {
      // Claude: insert right after the anchor (Plan mode / Toggle menu).
      row.insertBefore(btn, insertAfter.nextSibling);
    } else {
      // ChatGPT: insert at the start of the action row.
      row.insertBefore(btn, row.firstChild);
    }
    LOG("injected Echo button into composer");
    updateEchoButtonVisual();
  }

  function updateEchoButtonVisual() {
    const btn = document.getElementById(ECHO_BTN_ID);
    if (!btn) return;
    const ring = btn.querySelector(".echo-btn-ring");
    const dot = btn.querySelector(".echo-btn-dot");
    if (isPanelOpen) {
      btn.classList.add("is-on");
      if (ring) {
        ring.setAttribute("stroke", "#7C3AED");
        ring.setAttribute("stroke-opacity", "0.45");
      }
      if (dot) dot.setAttribute("fill", "#7C3AED");
      btn.setAttribute("aria-pressed", "true");
      btn.title = "Echo panel open — click to close";
    } else {
      btn.classList.remove("is-on");
      if (ring) {
        ring.setAttribute("stroke", "#2A2A2A");
        ring.setAttribute("stroke-opacity", "0.4");
      }
      if (dot) dot.setAttribute("fill", "#2A2A2A");
      btn.setAttribute("aria-pressed", "false");
      btn.title = "Click to open Echo — analyze ChatGPT's response";
    }
  }

  function onEchoButtonClick(e) {
    e.preventDefault();
    e.stopPropagation();
    // Mirror the toolbar icon: clicking opens the side panel for this tab.
    // Capture pipeline runs independently; it's always listening.
    LOG("composer button clicked — opening side panel");
    try {
      chrome.runtime.sendMessage({ type: "ECHO_OPEN_PANEL" });
    } catch (err) {
      LOG("could not open panel:", err.message);
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
        '#composer-submit-button, button[data-testid="send-button"], button[aria-label*="Send" i], button[aria-label="Send message" i]'
      );
      if (!btn) return;
      const composer = findComposer();
      const prompt = captureFromElement(composer);
      if (!prompt) return;
      send(prompt, "send button");
    },
    true
  );

  // ---- Belt-and-suspenders: watch the transcript for new user + assistant
  // messages. User messages are a capture fallback. Assistant messages ARE
  // ChatGPT's live answer — we ship them to the panel as the ORIGINAL row.
  const seenUserMsgs = new WeakSet();
  const seenAsstMsgs = new WeakSet();
  const asstCaptureTimers = new WeakMap();
  let lastAsstSent = { text: "", at: 0 };

  function sendAssistant(el) {
    let text = (el.innerText || "").trim();
    // Gemini prepends "Tú dijiste: <user query>" / "You said: ..." as an a11y
    // label inside the response container. Strip it.
    text = text
      .replace(/^(Tú dijiste|Tu dijiste|You said|Dijiste)[\s:]*[^\n]*\n+/i, "")
      .trim();
    if (!text || text.length < 20) return; // ignore placeholders / blanks
    const now = Date.now();
    // Dedup: if same text was sent in the last 3s, skip
    if (text === lastAsstSent.text && now - lastAsstSent.at < 3000) return;
    lastAsstSent = { text, at: now };
    LOG(`assistant response captured (${text.length} chars):`, text.slice(0, 80));
    try {
      chrome.runtime.sendMessage({
        type: "ECHO_ASSISTANT_RESPONSE",
        response: text,
      });
    } catch (e) {
      LOG("sendAssistant failed:", e.message);
    }
  }

  function scheduleAsstCapture(el) {
    // Debounce: fire sendAssistant 1500ms after the LAST mutation to this
    // message's subtree. While the stream keeps adding tokens, the timer
    // resets. When streaming stops (no more mutations for 1.5s), fire.
    clearTimeout(asstCaptureTimers.get(el));
    const t = setTimeout(() => sendAssistant(el), 1500);
    asstCaptureTimers.set(el, t);
  }

  const transcriptObs = new MutationObserver((mutations) => {
    // 1) User messages — capture fallback for the prompt.
    const userMsgs = document.querySelectorAll(USER_MSG_SEL);
    if (userMsgs.length > 0) {
      const newest = userMsgs[userMsgs.length - 1];
      if (!seenUserMsgs.has(newest)) {
        seenUserMsgs.add(newest);
        const text = (newest.innerText || "").trim();
        if (text) send(text, "transcript observer");
      }
    }

    // 2) Assistant messages — watch the latest one and debounce capture.
    const asstMsgs = document.querySelectorAll(ASST_MSG_SEL);
    if (asstMsgs.length > 0) {
      const latest = asstMsgs[asstMsgs.length - 1];
      if (!seenAsstMsgs.has(latest)) {
        seenAsstMsgs.add(latest);
        LOG("new assistant message detected, watching for completion");
      }
      // Re-schedule on every mutation that might be inside this message.
      for (const m of mutations) {
        if (
          latest.contains(m.target) ||
          latest === m.target ||
          (m.target instanceof Element && latest.contains(m.target))
        ) {
          scheduleAsstCapture(latest);
          break;
        }
      }
      // If we haven't scheduled yet (first appearance), schedule.
      if (!asstCaptureTimers.has(latest)) scheduleAsstCapture(latest);
    }
  });
  transcriptObs.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
  });

  // ---- Activation ping from background (toolbar icon click) ----
  // The background asks us to re-verify our presence when the user opens
  // the side panel via the toolbar icon. We re-inject the composer button
  // if ChatGPT's DOM rebuilds have stripped it.
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || typeof msg !== "object") return;
    if (msg.type === "ECHO_ACTIVATE") {
      LOG("ECHO_ACTIVATE received — re-ensuring button + observers");
      try {
        ensureEchoButtonStyles();
        injectEchoButton();
        sendResponse({ ok: true, injected: !!document.getElementById(ECHO_BTN_ID) });
      } catch (e) {
        sendResponse({ ok: false, error: e.message });
      }
      return true;
    }
    if (msg.type === "ECHO_PANEL_STATE") {
      isPanelOpen = !!msg.isOpen;
      LOG("panel state from bg:", isPanelOpen ? "OPEN" : "CLOSED");
      updateEchoButtonVisual();
      sendResponse({ ok: true });
      return;
    }
  });

  LOG("content script ready on", location.hostname);
})();
