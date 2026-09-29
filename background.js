
const defaultOptions = {
  communicatieKnoppen: true,
  journaalResizer: true,
  declarerenNietOpGebeurd: true,
  juvolyKnop: false,
  uprevent: false,
  medicijnMarkeringen: true,
  pdfExport: true,
  zorgdomeinSnelkoppelingen: true,
  btnLabels: []
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

// =============================================================================
// Zorgdomein Infused bridge wiring (zie manifest.ids.md in Zorgdomein Infused).
// -----------------------------------------------------------------------------
// Snelkoppelingen + dashboard-doorsturen wonen sinds v2.3 in de losse extensie
// Zorgdomein Infused. Bricks vraagt de lijst op en meldt welke link na de
// SSO-start geopend moet worden. Zorgdomein Infused whitelist Bricks in
// manifest.json → externally_connectable.ids.
//
//   Zorgdomein Infused:
//     dickknaonoknjbjcfmoafmkimkldeaef  — dev (key in manifest) → ZORGDOMEIN_EXT_IDS_DEV
//     mehfpjeblkfbobhimioegkflielbcemk  — Edge store → ZORGDOMEIN_EXT_IDS_PROD
//
// Vóór Edge store-upload Bricks: ZORGDOMEIN_EXT_IDS_DEV = []
// =============================================================================
const ZORGDOMEIN_EXT_IDS_PROD = [
  "mehfpjeblkfbobhimioegkflielbcemk" // Zorgdomein Infused — Edge store
];
// === DEV-ONLY: maak deze array leeg (`[]`) vóór upload naar de Edge store ===
const ZORGDOMEIN_EXT_IDS_DEV = [
  "dickknaonoknjbjcfmoafmkimkldeaef" // Zorgdomein Infused — dev (key in manifest)
];
// ============================================================================
const ZORGDOMEIN_EXT_IDS = [...ZORGDOMEIN_EXT_IDS_PROD, ...ZORGDOMEIN_EXT_IDS_DEV];
const ZORGDOMEIN_INSTALL_URL =
  "https://microsoftedge.microsoft.com/addons/detail/zorgdomein-infused/mehfpjeblkfbobhimioegkflielbcemk";

// Juvoly draait in een aparte tab (geen iframe — Permissions-Policy blokkeert mic in Bricks).
const JUVOLY_HOME_URL = "https://tandem.juvoly.nl/";
const JUVOLY_SOURCE = "bricks-infused-juvoly";

let pendingResizerPercentages = {};
let resizerSaveTimer = null;

function isJuvolyUrl(url) {
  if (!url || typeof url !== "string") return false;
  try {
    const u = new URL(url);
    return /(^|\.)juvoly\.nl$/i.test(u.hostname);
  } catch (_) {
    return false;
  }
}

async function findJuvolyTab() {
  const tabs = await chrome.tabs.query({});
  const juvolyTabs = tabs.filter((t) => isJuvolyUrl(t.url));
  if (!juvolyTabs.length) return null;
  juvolyTabs.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
  const active = juvolyTabs.find((t) => t.active);
  return active || juvolyTabs[0];
}

function sendToJuvolyTab(tabId, type, extra = {}) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, { source: JUVOLY_SOURCE, type, ...extra }, (resp) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }
      resolve(resp || { ok: false, error: "no-response" });
    });
  });
}

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

/**
 * Eenmalig: oude zorgdomeinLinks uit Bricks-opslag naar Zorgdomein Infused kopiëren
 * (alleen als die nog leeg is). Oude data blijft staan als backup.
 */
function migrateZorgdomeinLinks(extId) {
  chrome.storage.sync.get(['zorgdomeinLinks', 'zorgdomeinLinksMigrated'], (data) => {
    if (data.zorgdomeinLinksMigrated) return;
    const legacy = Array.isArray(data.zorgdomeinLinks) ? data.zorgdomeinLinks : [];
    if (!legacy.length) {
      chrome.storage.sync.set({ zorgdomeinLinksMigrated: true });
      return;
    }
    chrome.runtime.sendMessage(extId, { type: 'zorgdomein.importLinks', links: legacy, onlyIfEmpty: true }, (resp) => {
      if (chrome.runtime.lastError || !resp || !resp.ok) return;
      chrome.storage.sync.set({ zorgdomeinLinksMigrated: true });
    });
  });
}

function sendToZorgdomeinInfused(payload, sendResponse) {
  if (!ZORGDOMEIN_EXT_IDS.length) {
    sendResponse({ ok: false, error: 'no-extension-id-configured' });
    return;
  }
  sendMessageToFirstAvailableExtension(ZORGDOMEIN_EXT_IDS, payload, (result) => {
    if (!result.ok || !result.resp) {
      sendResponse({ ok: false, error: result.error || 'no-response', installUrl: ZORGDOMEIN_INSTALL_URL });
      return;
    }
    sendResponse({ ...result.resp, extensionId: result.extId });
  });
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

  if (message && message.type === 'exportSettings') {
    chrome.storage.local.set({
      exportSettingsRequest: {
        timestamp: Date.now(),
        settings: message.settings,
        requestId: Math.random().toString(36).substr(2, 9)
      }
    }, () => {
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
    return true;
  }

  if (message && message.type === 'importSettings') {
    chrome.storage.local.set({
      importSettingsRequest: {
        timestamp: Date.now(),
        requestId: Math.random().toString(36).substr(2, 9)
      }
    }, () => {
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
    return true;
  }

  if (message && message.type === 'exportSettingsResponse') {
    chrome.storage.local.set({ exportSettingsResponse: message });
    return true;
  }

  if (message && message.type === 'importSettingsResponse') {
    chrome.storage.local.set({ importSettingsResponse: message });
    return true;
  }

  ///////////////////////////////// U-PREVENT INTEGRATIE //////////////////////////////////////////////////////////////
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

  ///////////////////////////////// ZORGDOMEIN INFUSED INTEGRATIE //////////////////////////////////////////////////////
  if (message && message.type === 'zorgdomein.ping') {
    sendToZorgdomeinInfused({ type: 'zorgdomein.ping' }, (resp) => {
      if (!resp.ok) {
        sendResponse({ installed: false, installUrl: ZORGDOMEIN_INSTALL_URL });
        return;
      }
      migrateZorgdomeinLinks(resp.extensionId);
      sendResponse({ installed: true, version: resp.version || null, extensionId: resp.extensionId });
    });
    return true;
  }

  if (message && message.type === 'zorgdomein.getLinks') {
    sendToZorgdomeinInfused({ type: 'zorgdomein.getLinks' }, (resp) => {
      if (resp.ok && resp.extensionId) migrateZorgdomeinLinks(resp.extensionId);
      sendResponse(resp);
    });
    return true;
  }

  if (message && message.type === 'zorgdomein.setPendingLink') {
    sendToZorgdomeinInfused({ type: 'zorgdomein.setPendingLink', link: message.link }, sendResponse);
    return true;
  }

  if (message && message.type === 'zorgdomein.openOptions') {
    sendToZorgdomeinInfused({ type: 'zorgdomein.openOptions', focusTarget: 'zorgdomein' }, sendResponse);
    return true;
  }

  ///////////////////////////////// JUVOLY TAB BRIDGE //////////////////////////////////////////////////////////////
  if (message && message.source === JUVOLY_SOURCE) {
    const reply = (payload) => {
      try { sendResponse(payload); } catch (_) { /* channel closed */ }
    };

    const waitMs = (ms) => new Promise((r) => setTimeout(r, ms));

    async function ensureJuvolyTab(opts = {}) {
      let tab = await findJuvolyTab();
      let created = false;
      if (!tab) {
        const createOpts = { url: JUVOLY_HOME_URL, active: !opts.stayInBackground };
        if (sender && sender.tab && typeof sender.tab.index === 'number') {
          createOpts.index = sender.tab.index + 1;
          if (sender.tab.windowId != null) createOpts.windowId = sender.tab.windowId;
        }
        tab = await chrome.tabs.create(createOpts);
        created = true;
        // Wacht tot tab klaar is (max ~8s), niet blind 1.2s
        for (let i = 0; i < 16; i++) {
          try {
            const fresh = await chrome.tabs.get(tab.id);
            if (fresh && fresh.status === 'complete') break;
          } catch (_) { break; }
          await waitMs(500);
        }
        await waitMs(400);
      } else if (!opts.stayInBackground) {
        await chrome.tabs.update(tab.id, { active: true });
        if (tab.windowId != null) {
          try { await chrome.windows.update(tab.windowId, { focused: true }); } catch (_) { /* ignore */ }
        }
      }
      return { tab, created };
    }

    async function callJuvoly(tabId, type, retries = 2) {
      let resp = await sendToJuvolyTab(tabId, type);
      for (let i = 0; i < retries; i++) {
        if (resp && resp.ok) return resp;
        if (resp && resp.error && !/Receiving end does not exist|no-response/i.test(resp.error)) {
          return resp;
        }
        await waitMs(700);
        resp = await sendToJuvolyTab(tabId, type);
      }
      return resp || { ok: false, error: 'no-response' };
    }

    if (message.type === 'juvoly.openOrFocus') {
      (async () => {
        try {
          const { tab, created } = await ensureJuvolyTab({
            stayInBackground: !!message.stayInBackground
          });
          // Max ~6s op content-script status
          for (let i = 0; i < 12; i++) {
            const st = await callJuvoly(tab.id, 'juvoly.status', 0);
            if (st && st.ok && st.phase && st.phase !== 'unknown' && st.phase !== 'loading') {
              if (st.phase === 'login') {
                await chrome.tabs.update(tab.id, { active: true });
                reply({
                  ok: false,
                  needsLogin: true,
                  created,
                  tabId: tab.id,
                  status: st,
                  error: 'Log eerst in op Juvoly.'
                });
                return;
              }
              if (message.ensureReady) {
                const ready = await callJuvoly(tab.id, 'juvoly.ensureReady');
                reply({
                  ok: !!ready.ok,
                  created,
                  tabId: tab.id,
                  status: ready.status || st,
                  error: ready.error,
                  needsLogin: ready.status && ready.status.phase === 'login'
                });
                return;
              }
              reply({ ok: true, created, tabId: tab.id, status: st });
              return;
            }
            await waitMs(500);
          }
          const last = await callJuvoly(tab.id, 'juvoly.status');
          reply({
            ok: true,
            created,
            tabId: tab.id,
            status: last.ok ? last : { phase: 'loading', noTab: false },
            warning: 'Juvoly-tab is geopend, maar nog niet klaar. Log in of wacht tot de startpagina geladen is.'
          });
        } catch (err) {
          reply({ ok: false, error: String(err && err.message || err) });
        }
      })();
      return true;
    }

    const actionTypes = [
      'juvoly.status',
      'juvoly.ensureReady',
      'juvoly.start',
      'juvoly.pause',
      'juvoly.resume',
      'juvoly.summarize',
      'juvoly.getSoep',
      'juvoly.stop'
    ];

    if (actionTypes.includes(message.type)) {
      (async () => {
        try {
          let tab = await findJuvolyTab();
          if (!tab) {
            if (message.type === 'juvoly.status') {
              reply({ ok: false, noTab: true, error: 'Geen Juvoly-tab' });
              return;
            }
            if (message.type === 'juvoly.start' || message.type === 'juvoly.ensureReady') {
              const opened = await ensureJuvolyTab({ stayInBackground: true });
              tab = opened.tab;
              await waitMs(800);
            } else {
              reply({ ok: false, error: 'Geen Juvoly-tab gevonden. Klik eerst op Juvoly.' });
              return;
            }
          }
          const resp = await callJuvoly(tab.id, message.type);
          reply(resp);
        } catch (err) {
          reply({ ok: false, error: String(err && err.message || err) });
        }
      })();
      return true;
    }
  }

});
