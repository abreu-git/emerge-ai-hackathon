// Echo — background service worker
// MV3 requires a service worker even if empty. We'll proxy API calls here later
// so the content script never handles API keys.

chrome.runtime.onInstalled.addListener(() => {
  console.log("[Echo] installed");
});

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id || !tab.url) return;
  const onChatGPT = /^https:\/\/(chatgpt\.com|chat\.openai\.com)\//.test(tab.url);
  if (!onChatGPT) {
    // Open ChatGPT if clicked elsewhere, so Echo has somewhere to live.
    await chrome.tabs.create({ url: "https://chatgpt.com/" });
    return;
  }
  try {
    await chrome.tabs.sendMessage(tab.id, { type: "ECHO_TOGGLE_SIDEBAR" });
  } catch (_e) {
    // Content script not injected yet (page loaded before the extension).
    // Reload the tab so the content script attaches.
    await chrome.tabs.reload(tab.id);
  }
});
