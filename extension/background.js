// Echo — background service worker (MV3)
// Bridges content script → side panel. Persists the last captured prompt so
// the panel picks it up even if opened after the prompt was sent.

const LOG = (...args) => console.log("[Echo/bg]", ...args);

const LAST_PROMPT_KEY = "echo.lastPrompt";

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .then(() => LOG("sidePanel behavior set (openPanelOnActionClick)"))
    .catch((e) => LOG("sidePanel behavior failed:", e.message));
  LOG("installed");
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

  if (msg.type === "ECHO_TOGGLE_PANEL") {
    const tabId = sender.tab?.id;
    const windowId = sender.tab?.windowId;
    const enable = !!msg.enable;
    LOG(`toggle panel: enable=${enable}, tab=${tabId}, win=${windowId}`);
    if (tabId == null) {
      sendResponse({ ok: false, reason: "no tab id" });
      return;
    }
    if (enable) {
      // CRITICAL: open() must be called synchronously on the user-gesture
      // message to preserve gesture context. Fire setOptions without await.
      try {
        chrome.sidePanel.setOptions({
          tabId,
          path: "sidebar.html",
          enabled: true,
        });
      } catch (e) {
        LOG("setOptions(enable) threw:", e.message);
      }
      // open() returns a Promise — chain only for logging, don't await.
      const openP = windowId != null
        ? chrome.sidePanel.open({ tabId, windowId })
        : chrome.sidePanel.open({ tabId });
      openP
        .then(() => LOG("sidePanel.open resolved"))
        .catch((err) => LOG("sidePanel.open rejected:", err.message));
    } else {
      chrome.sidePanel
        .setOptions({ tabId, enabled: false })
        .then(() => LOG("sidePanel disabled (closed)"))
        .catch((err) => LOG("sidePanel disable failed:", err.message));
    }
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
