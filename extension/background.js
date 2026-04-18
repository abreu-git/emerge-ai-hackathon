// Echo — background service worker (MV3)
// Wires the Chrome side panel to the extension action + bridges content → side panel.

chrome.runtime.onInstalled.addListener(() => {
  // Clicking the toolbar icon opens the native side panel.
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((e) => console.warn("[Echo] sidePanel behavior:", e));
  console.log("[Echo] installed");
});

// Relay prompt-capture events from content scripts to any open side panel.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg !== "object") return;
  if (msg.type === "ECHO_PROMPT_CAPTURED") {
    // Forward to all contexts (the side panel subscribes to runtime messages).
    chrome.runtime.sendMessage({
      type: "ECHO_PROMPT_FOR_PANEL",
      prompt: msg.prompt,
      tabId: sender.tab?.id ?? null,
      url: sender.tab?.url ?? null,
    }).catch(() => {
      // No side panel listener — harmless.
    });
  }
});
