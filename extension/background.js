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

// Per-tab open/close state for the side panel. Chrome doesn't expose this
// directly, so we track it ourselves. Kept in sync by:
//  - setting true after we call sidePanel.open()
//  - setting false after setOptions({enabled:false})
//  - listening to ECHO_PANEL_CLOSING from the panel's pagehide/unload
const panelOpenState = new Map(); // tabId -> boolean

function notifyPanelState(tabId, isOpen) {
  chrome.tabs.sendMessage(
    tabId,
    { type: "ECHO_PANEL_STATE", isOpen },
    () => {
      // Silently swallow "no receiving end" if the tab isn't ChatGPT.
      const err = chrome.runtime.lastError;
      if (err) LOG(`panel state msg not delivered (harmless): ${err.message}`);
    }
  );
}

function openPanelForTab(tab) {
  if (!tab?.id) return;
  try {
    chrome.sidePanel.setOptions({
      tabId: tab.id,
      path: "sidebar.html",
      enabled: true,
    });
  } catch (e) {
    LOG("setOptions(open) threw:", e.message);
  }
  chrome.sidePanel
    .open({ tabId: tab.id, windowId: tab.windowId })
    .then(() => {
      panelOpenState.set(tab.id, true);
      LOG("panel opened, state=true for tab", tab.id);
      notifyPanelState(tab.id, true);
    })
    .catch((e) => LOG("panel open failed:", e.message));

  if (tab.url && /https:\/\/(chatgpt\.com|chat\.openai\.com|claude\.ai|claude\.com|gemini\.google\.com)\//.test(tab.url)) {
    chrome.tabs.sendMessage(tab.id, { type: "ECHO_ACTIVATE" }, () => {
      const err = chrome.runtime.lastError;
      if (err) LOG("activate msg not delivered:", err.message);
      else LOG("ECHO_ACTIVATE acknowledged");
    });
  }
}

function closePanelForTab(tabId) {
  chrome.sidePanel
    .setOptions({ tabId, enabled: false })
    .then(() => {
      panelOpenState.set(tabId, false);
      LOG("panel closed, state=false for tab", tabId);
      notifyPanelState(tabId, false);
    })
    .catch((e) => LOG("panel close failed:", e.message));
}

function togglePanelForTab(tab) {
  if (!tab?.id) return;
  const isOpen = panelOpenState.get(tab.id) === true;
  LOG(`toggle for tab ${tab.id}: currently ${isOpen ? "OPEN" : "CLOSED"}`);
  if (isOpen) closePanelForTab(tab.id);
  else openPanelForTab(tab);
}

// Toolbar icon click toggles panel for the active tab. Same behavior as
// the composer button (ECHO_OPEN_PANEL / ECHO_TOGGLE_PANEL).
chrome.action.onClicked.addListener((tab) => {
  if (!tab || !tab.id) return;
  LOG(`toolbar icon clicked, tab=${tab.id}, url=${tab.url}`);
  togglePanelForTab(tab);
});

// Clean up state when tab closes.
chrome.tabs.onRemoved.addListener((tabId) => {
  panelOpenState.delete(tabId);
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
    // Composer-button click — toggle same as toolbar icon.
    if (!sender.tab) {
      sendResponse({ ok: false, reason: "no tab in sender" });
      return;
    }
    togglePanelForTab(sender.tab);
    sendResponse({ ok: true });
    return;
  }

  if (msg.type === "ECHO_PANEL_CLOSING") {
    // Sent by the side panel's pagehide/unload so we know the user closed
    // it via the X button and can update our state accordingly.
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const active = tabs && tabs[0];
      if (active?.id) {
        panelOpenState.set(active.id, false);
        LOG(`panel closing signal — state=false for tab ${active.id}`);
        notifyPanelState(active.id, false);
      }
    });
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
