

const defaultOptions = {
  communicatieKnoppen: true,
  journaalResizer: true,
  declarerenNietOpGebeurd: true,
  juvolyKnop: false,
  uprevent: false,
  medicijnMarkeringen: true,
  pdfExport: true,
  zorgdomeinSnelkoppelingen: true,
  zorgdomeinDashboardLinks: true,
  btnLabels: [],
  zorgdomeinLinks: []
};

// =============================================================================
// U-Prevent Infused bridge wiring (zie ook manifest.ids.md in beide mappen).
// -----------------------------------------------------------------------------
// Extensie-ID's (JSON-manifests ondersteunen geen comments — zie manifest.ids.md):
//
//   Bricks Infused (deze extensie):
//     mogkemhemedhcmoopdlfdjklgjlhgmnp  — dev (unpacked + key in manifest.json)
//     ebannlcfcakhaekmbeogkphbijghepbe  — Edge store
//
//   U-Prevent Infused (doel van messaging hieronder):
//     hdneeeaikfhphigcmjcfppkclpoglhfb  — dev → UPREVENT_EXT_IDS_DEV
//     pmlakmbpemkfccbhkdmcofagpipfchio  — store → UPREVENT_EXT_IDS_PROD
//
// U-Prevent whitelist voor Bricks: manifest.json → externally_connectable.ids
//
// Vóór Edge store-upload Bricks: UPREVENT_EXT_IDS_DEV = []
// =============================================================================
const UPREVENT_EXT_IDS_PROD = [
  "pmlakmbpemkfccbhkdmcofagpipfchio" // U-Prevent Infused — Edge store
];
// === DEV-ONLY: maak deze array leeg (`[]`) vóór upload naar de Edge store ===
const UPREVENT_EXT_IDS_DEV = [
  "hdneeeaikfhphigcmjcfppkclpoglhfb" // U-Prevent Infused — dev (key in manifest)
];
// ============================================================================
const UPREVENT_EXT_IDS = [...UPREVENT_EXT_IDS_PROD, ...UPREVENT_EXT_IDS_DEV];
const UPREVENT_INSTALL_URL =
  "https://microsoftedge.microsoft.com/addons/detail/uprevent-infused/pmlakmbpemkfccbhkdmcofagpipfchio";

let pendingResizerPercentages = {};
let resizerSaveTimer = null;

function flushResizerPercentages() {
  if (!Object.keys(pendingResizerPercentages).length) return;
  chrome.storage.sync.set(pendingResizerPercentages);
  pendingResizerPercentages = {};
  resizerSaveTimer = null;
}

function sendMessageToFirstAvailableExtension(extensionIds, payload, callback) {
  if (!Array.isArray(extensionIds) || extensionIds.length === 0) {
    callback({ ok: false, error: "no-extension-id-configured" });
    return;
  }

  let idx = 0;
  const tryNext = () => {
    if (idx >= extensionIds.length) {
      callback({ ok: false, error: "extension-not-found" });
      return;
    }
    const extId = extensionIds[idx++];
    chrome.runtime.sendMessage(extId, payload, (resp) => {
      if (chrome.runtime.lastError || !resp) {
        tryNext();
        return;
      }
      callback({ ok: true, extId, resp });
    });
  };
  tryNext();
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.type === 'getDefaults') {
    sendResponse({ defaultOptions });
    return true;
  }
  if (message && message.type === 'openOptionsPage') {
    const openOptions = () => {
      if (chrome.runtime.openOptionsPage) {
        chrome.runtime.openOptionsPage();
      }
    };
    if (message.focusTarget && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ optionsFocusTarget: message.focusTarget }, () => {
        openOptions();
      });
    } else {
      openOptions();
    }
    sendResponse({ ok: true });
    return true;
  }
  if (message && message.type === 'saveResizerPercentages') {
    const { resizer1, resizer2, resizer3 } = message;
    if (resizer1) pendingResizerPercentages.resizer1 = resizer1;
    if (resizer2) pendingResizerPercentages.resizer2 = resizer2;
    if (resizer3) pendingResizerPercentages.resizer3 = resizer3;
    if (resizerSaveTimer) clearTimeout(resizerSaveTimer);
    resizerSaveTimer = setTimeout(flushResizerPercentages, 250);
    sendResponse({ ok: true });
    return true;
  }
  if (message && message.type === 'getResizerPercentages') {
    chrome.storage.sync.get(['resizer1', 'resizer2', 'resizer3'], (data) => {
      sendResponse({
        resizer1: data.resizer1,
        resizer2: data.resizer2,
        resizer3: data.resizer3
      });
    });
    return true;
  }
  
  // Export/Import instellingen functionaliteit
  if (message && message.type === 'exportSettings') {
    // Zet een signaal in storage dat content scripts kunnen oppikken
    chrome.storage.local.set({
      exportSettingsRequest: {
        timestamp: Date.now(),
        settings: message.settings,
        requestId: Math.random().toString(36).substr(2, 9)
      }
    }, () => {
      // Wacht kort en check of er een response is
      setTimeout(() => {
        chrome.storage.local.get('exportSettingsResponse', (data) => {
          const response = data.exportSettingsResponse;
          if (response && response.success) {
            chrome.storage.local.remove('exportSettingsResponse');
            sendResponse({ success: true });
          } else {
            sendResponse({ success: false });
          }
        });
      }, 500);
    });
    return true; // Asynchronous response
  }
  
  if (message && message.type === 'importSettings') {
    // Zet een signaal in storage dat content scripts kunnen oppikken
    chrome.storage.local.set({
      importSettingsRequest: {
        timestamp: Date.now(),
        requestId: Math.random().toString(36).substr(2, 9)
      }
    }, () => {
      // Wacht kort en check of er een response is
      setTimeout(() => {
        chrome.storage.local.get('importSettingsResponse', (data) => {
          const response = data.importSettingsResponse;
          if (response && response.success) {
            chrome.storage.local.remove('importSettingsResponse');
            sendResponse(response);
          } else {
            sendResponse({ success: false });
          }
        });
      }, 500);
    });
    return true; // Asynchronous response
  }
  
  // Handlers voor responses van content scripts
  if (message && message.type === 'exportSettingsResponse') {
    chrome.storage.local.set({ exportSettingsResponse: message });
    return true;
  }
  
  if (message && message.type === 'importSettingsResponse') {
    chrome.storage.local.set({ importSettingsResponse: message });
    return true;
  }
  
  ///////////////////////////////// U-PREVENT INTEGRATIE //////////////////////////////////////////////////////////////
  // Ping U-Prevent Infused to check if it is installed and reachable.
  if (message && message.type === 'uprevent.ping') {
    if (!UPREVENT_EXT_IDS.length) {
      sendResponse({ installed: false, reason: 'no-extension-id-configured', installUrl: UPREVENT_INSTALL_URL });
      return true;
    }
    try {
      sendMessageToFirstAvailableExtension(UPREVENT_EXT_IDS, { type: 'uprevent.ping' }, (result) => {
        if (!result.ok || !result.resp || !result.resp.ok) {
          sendResponse({ installed: false, installUrl: UPREVENT_INSTALL_URL });
          return;
        }
        sendResponse({
          installed: true,
          version: result.resp.version || null,
          extensionId: result.extId
        });
      });
    } catch (err) {
      sendResponse({ installed: false, error: String(err && err.message || err), installUrl: UPREVENT_INSTALL_URL });
    }
    return true;
  }

  // Relay an open + prefill request to U-Prevent Infused.
  if (message && message.type === 'uprevent.openAndFill') {
    if (!UPREVENT_EXT_IDS.length) {
      sendResponse({ ok: false, error: 'no-extension-id-configured' });
      return true;
    }
    try {
      sendMessageToFirstAvailableExtension(UPREVENT_EXT_IDS, {
        type: 'uprevent.openAndFill',
        calculatorPath: message.calculatorPath,
        text: message.text || ''
      }, (result) => {
        if (!result.ok || !result.resp) {
          sendResponse({ ok: false, error: result.error || 'no-response' });
          return;
        }
        sendResponse(result.resp);
      });
    } catch (err) {
      sendResponse({ ok: false, error: String(err && err.message || err) });
    }
    return true;
  }

});