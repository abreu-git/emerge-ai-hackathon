// Echo — background service worker
// MV3 requires a service worker even if empty. We'll proxy API calls here later
// so the content script never handles API keys.

chrome.runtime.onInstalled.addListener(() => {
  console.log("[Echo] installed");
});

chrome.action.onClicked.addListener((tab) => {
  if (tab.id) {
    chrome.tabs.sendMessage(tab.id, { type: "ECHO_TOGGLE_SIDEBAR" });
  }
});
