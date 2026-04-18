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

  sendResponse({ ok: false, reason: "unknown type" });
});
