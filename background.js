

const defaultOptions = {
  communicatieKnoppen: true,
  journaalResizer: true,
  declarerenNietOpGebeurd: true,
  juvolyKnop: false,
  medicijnMarkeringen: true,
  pdfExport: true,
  zorgdomeinSnelkoppelingen: true,
  btnLabels: [],
  zorgdomeinLinks: []
};

let pendingResizerPercentages = {};
let resizerSaveTimer = null;

function flushResizerPercentages() {
  if (!Object.keys(pendingResizerPercentages).length) return;
  chrome.storage.sync.set(pendingResizerPercentages);
  pendingResizerPercentages = {};
  resizerSaveTimer = null;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.type === 'getDefaults') {
    sendResponse({ defaultOptions });
    return true;
  }
  if (message && message.type === 'openOptionsPage') {
    if (chrome.runtime.openOptionsPage) {
      chrome.runtime.openOptionsPage();
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
  
  // TEST FUNCTIES - MAKKELIJK TE VERWIJDEREN
  if (message && message.type === 'getSecretFromDokterBart') {
    // Haal tekst op uit dokterbart.nl/secret.txt
    fetch('https://dokterbart.nl/secret.txt', {
      method: 'GET',
      mode: 'cors',
      headers: {
        'Accept': 'text/plain',
        'Content-Type': 'text/plain'
      }
    }).then(response => {
      console.log('Response status:', response.status);
      if (response.ok) {
        return response.text();
      } else {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
    }).then(text => {
      console.log('Geheime tekst opgehaald uit dokterbart.nl/secret.txt:', text);
      sendResponse({ success: true, text: text });
    }).catch((error) => {
      console.log('Fout bij ophalen geheime tekst:', error);
      sendResponse({ success: false, error: error.message });
    });
    return true;
  }
}); 