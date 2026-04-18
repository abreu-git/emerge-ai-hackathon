// Echo — background service worker (MV3)
// Bridges content script → side panel. Persists the last captured prompt so
// the panel picks it up even if opened after the prompt was sent.

const LOG = (...args) => console.log("[Echo/bg]", ...args);

const LAST_PROMPT_KEY = "echo.lastPrompt";

chrome.runtime.onInstalled.addListener(() => {
  // Disable the auto-open-on-action-click so WE handle the click and can
  // also nudge the content script to re-inject the composer button.
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: false })
    .then(() => LOG("sidePanel behavior set (manual click handling)"))
    .catch((e) => LOG("sidePanel behavior failed:", e.message));
  LOG("installed");
});

// Toolbar icon click — open panel AND re-activate the content script's
// composer button injection + observers in case ChatGPT blocked them.
chrome.action.onClicked.addListener((tab) => {
  if (!tab || !tab.id) return;
  LOG(`toolbar icon clicked, tab=${tab.id}, win=${tab.windowId}, url=${tab.url}`);

  // Open side panel for this tab. Gesture context is preserved because we
  // call these synchronously inside the onClicked handler.
  try {
    chrome.sidePanel.setOptions({
      tabId: tab.id,
      path: "sidebar.html",
      enabled: true,
    });
  } catch (e) {
    LOG("setOptions threw:", e.message);
  }
  chrome.sidePanel
    .open({ tabId: tab.id, windowId: tab.windowId })
    .then(() => LOG("panel opened from toolbar"))
    .catch((e) => LOG("panel open failed:", e.message));

  // Wake up / re-inject the content script's button if we're on ChatGPT.
  if (tab.url && /https:\/\/(chatgpt\.com|chat\.openai\.com)\//.test(tab.url)) {
    chrome.tabs.sendMessage(tab.id, { type: "ECHO_ACTIVATE" }, () => {
      const err = chrome.runtime.lastError;
      if (err) LOG("activate msg not delivered:", err.message);
      else LOG("ECHO_ACTIVATE acknowledged by content script");
    });
  } else {
    LOG("non-ChatGPT tab — skipped ECHO_ACTIVATE");
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg !== "object") {
    sendResponse({ ok: false, reason: "bad msg" });
    return;
  }

  if (msg.type === "ECHO_PROMPT_CAPTURED") {
    const prompt = String(msg.prompt || "");
    LOG(`prompt captured (${prompt.length} chars) from tab`, sender.tab?.id);

    // 1. Persist the prompt so a late-opened panel can still pick it up.
    const payload = {
      prompt,
      tabId: sender.tab?.id ?? null,
      capturedAt: Date.now(),
    };
    chrome.storage.local.set({ [LAST_PROMPT_KEY]: payload });

    // 2. Try to broadcast to any open side panel. Use a callback to swallow
    //    the "Receiving end does not exist" error when no panel is open.
    chrome.runtime.sendMessage(
      { type: "ECHO_PROMPT_FOR_PANEL", ...payload },
      () => {
        const err = chrome.runtime.lastError;
        if (err) {
          LOG("no panel listening yet (harmless):", err.message);
        } else {
          LOG("panel acknowledged");
        }
      }
    );

    sendResponse({ ok: true });
    return;
  }

  if (msg.type === "ECHO_GET_LAST_PROMPT") {
    chrome.storage.local.get([LAST_PROMPT_KEY], (res) => {
      sendResponse(res[LAST_PROMPT_KEY] || null);
    });
    return true; // keep the channel open for async response
  }

  if (msg.type === "ECHO_OPEN_PANEL") {
    const tabId = sender.tab?.id;
    const windowId = sender.tab?.windowId;
    LOG(`open panel: tab=${tabId}, win=${windowId}`);
    if (tabId == null) {
      sendResponse({ ok: false, reason: "no tab id" });
      return;
    }
    // CRITICAL: open() must be called synchronously in the message handler
    // to preserve the user-gesture context from the composer click. Do NOT
    // await setOptions — fire and forget.
    try {
      chrome.sidePanel.setOptions({
        tabId,
        path: "sidebar.html",
        enabled: true,
      });
    } catch (e) {
      LOG("setOptions threw:", e.message);
    }
    const openP =
      windowId != null
        ? chrome.sidePanel.open({ tabId, windowId })
        : chrome.sidePanel.open({ tabId });
    openP
      .then(() => LOG("sidePanel.open resolved"))
      .catch((err) => LOG("sidePanel.open rejected:", err.message));
    sendResponse({ ok: true });
    return;
  }

  if (msg.type === "ECHO_ASSISTANT_RESPONSE") {
    const response = String(msg.response || "");
    LOG(`assistant response relayed (${response.length} chars)`);
    chrome.runtime.sendMessage(
      { type: "ECHO_ASSISTANT_FOR_PANEL", response, capturedAt: Date.now() },
      () => {
        const err = chrome.runtime.lastError;
        if (err) LOG("panel not listening (harmless):", err.message);
      }
    );
    sendResponse({ ok: true });
    return;
  }

  if (msg.type === "ECHO_OPEN_PANEL_WITH_PROMPT") {
    const prompt = String(msg.prompt || "");
    const tabId = sender.tab?.id;
    LOG(`manual trigger from composer button (${prompt.length} chars), tab`, tabId);

    const payload = { prompt, tabId: tabId ?? null, capturedAt: Date.now() };
    chrome.storage.local.set({ [LAST_PROMPT_KEY]: payload });

    // Open the side panel for this tab (must happen within the user-gesture
    // window — the click that triggered this message).
    if (tabId != null) {
      chrome.sidePanel
        .open({ tabId })
        .then(() => LOG("sidePanel opened"))
        .catch((e) => LOG("sidePanel.open failed:", e.message));
    }

    // Broadcast to panel (if already open it picks up immediately; if not,
    // the panel reads pending prompt via ECHO_GET_LAST_PROMPT on load).
    chrome.runtime.sendMessage(
      { type: "ECHO_PROMPT_FOR_PANEL", ...payload },
      () => {
        const err = chrome.runtime.lastError;
        if (err) LOG("panel not listening yet (will pick up on open):", err.message);
      }
    );

    sendResponse({ ok: true });
    return;
  }

  sendResponse({ ok: false, reason: "unknown type" });
});
