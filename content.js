///////////////////////////////// DEBUG-FLAG //////////////////////////////////////////////////////////////
// Bricks Infused content scripts loggen verbose tijdens development. Zet deze
// flag op `true` om alle console.log-output weer aan te zetten; `false` (default)
// stilt enkel console.log — console.warn en console.error blijven actief zodat
// echte fouten in de DevTools zichtbaar blijven. Werkt scoped in de isolated
// world van deze content script en raakt de pagina zelf niet.
const BRICKS_DEBUG = false;
if (!BRICKS_DEBUG && typeof console !== 'undefined') {
    console.log = function () { /* no-op (BRICKS_DEBUG=false) */ };
}

///////////////////////////////// GLOBAL OPTIONS CACHE //////////////////////////////////////////////////////////////
let globalOptions = null;
let optionsLoaded = false;
let optionsTimestamp = null;

// Instellingen delen via Bricks-account UISettings.Vars.BricksInfused
// (zelfde store als AppSettings/Widgets). Taken-omschrijving is te kort
// (lijst/preview knipt de JSON af). Oude taak blijft leesbaar bij import.

const SETTINGS_TAAK_NAAM = 'Bricks Infused Instellingen';
const SETTINGS_UI_VAR = 'BricksInfused';

function settings_sendStorageResponse(key, payload) {
  chrome.storage.local.set({ [key]: payload });
}

async function settings_requireBridge() {
  if (!window.bricksBridge) throw new Error('Bricks-bridge niet beschikbaar. Open een Bricks-pagina en herlaad.');
  if (typeof window.bricksBridge.waitUntilReady === 'function') {
    await window.bricksBridge.waitUntilReady(8000);
  }
}

async function settings_getMedewerkerId() {
  const me = await window.bricksBridge.whoAmI();
  const id = parseInt(me && (me.MedewerkerId || me.Id), 10);
  if (!(id > 0)) throw new Error('Kon huidige medewerker niet bepalen');
  return id;
}

function settings_taakList(res) {
  if (!res) return [];
  if (Array.isArray(res.ReturnValue)) return res.ReturnValue;
  if (Array.isArray(res)) return res;
  return [];
}

async function settings_findExistingTaak(medewerkerId) {
  const filters = [['Afgehandeld'], ['Open', 'Bezig']];
  for (const statusFilter of filters) {
    const res = await window.bricksBridge.takenGetByMedewerkerAndRol({
      medewerkerId,
      rol: 'ToegewezenAan',
      inclGroep: true,
      statusFilter,
      inclGesloten: true
    });
    const hit = settings_taakList(res).find((t) => (t.Naam || '').trim() === SETTINGS_TAAK_NAAM);
    if (hit && hit.Id > 0) {
      try {
        const full = await window.bricksBridge.takenGet(hit.Id);
        return (full && full.ReturnValue) || hit;
      } catch (e) {
        return hit;
      }
    }
  }
  return null;
}

function settings_stringify(settings) {
  return JSON.stringify(settings);
}

function settings_parseJson(raw) {
  if (!raw || typeof raw !== 'string') return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (e) {
    return null;
  }
}

function settings_uiData(res) {
  return (res && res.ReturnValue) || res || null;
}

async function settings_readFromUISettings() {
  const res = await window.bricksBridge.getUISettings();
  const data = settings_uiData(res);
  const raw = data && data.Vars && data.Vars[SETTINGS_UI_VAR];
  return settings_parseJson(raw);
}

async function settings_writeToUISettings(settings) {
  const res = await window.bricksBridge.getUISettings();
  const data = settings_uiData(res);
  if (!data || typeof data !== 'object') {
    throw new Error('Kon account-instellingen niet ophalen');
  }
  data.Vars = data.Vars && typeof data.Vars === 'object' ? data.Vars : {};
  const json = settings_stringify(settings || {});
  data.Vars[SETTINGS_UI_VAR] = json;
  await window.bricksBridge.setUISettings(data);
  const verify = await settings_readFromUISettings();
  if (!verify || Object.keys(verify).length < Object.keys(settings || {}).length) {
    throw new Error('Instellingen werden niet volledig opgeslagen in het account');
  }
}

async function settings_readFromTaakFallback() {
  const medewerkerId = await settings_getMedewerkerId();
  const taak = await settings_findExistingTaak(medewerkerId);
  if (!taak) return null;
  return settings_parseJson(taak.Omschrijving);
}

async function exportSettingsToBricks(settings, requestId) {
  try {
    await settings_requireBridge();
    await settings_writeToUISettings(settings || {});
    settings_sendStorageResponse('exportSettingsResponse', {
      requestId,
      success: true,
      handled: true
    });
  } catch (err) {
    console.warn('Settings-export via UISettings mislukt:', err);
    settings_sendStorageResponse('exportSettingsResponse', {
      requestId,
      success: false,
      handled: true,
      error: (err && err.message) || String(err)
    });
  }
}

async function importSettingsFromBricks(requestId) {
  try {
    await settings_requireBridge();
    let parsed = null;
    try {
      parsed = await settings_readFromUISettings();
    } catch (e) {
      console.warn('Settings-import UISettings mislukt, taak-fallback:', e);
    }
    if (!parsed) {
      parsed = await settings_readFromTaakFallback();
    }
    settings_sendStorageResponse('importSettingsResponse', {
      requestId,
      success: true,
      handled: true,
      settings: parsed
    });
  } catch (err) {
    console.warn('Settings-import mislukt:', err);
    settings_sendStorageResponse('importSettingsResponse', {
      requestId,
      success: false,
      handled: true,
      error: (err && err.message) || String(err)
    });
  }
}

let lastExportCheck = 0;
let lastImportCheck = 0;
setInterval(() => {
  chrome.storage.local.get('exportSettingsRequest', (data) => {
    if (!data.exportSettingsRequest) return;
    const request = data.exportSettingsRequest;
    if (window.location.hostname !== 'brickshuisarts.nl'
        || Date.now() - request.timestamp > 2000
        || request.timestamp <= lastExportCheck) {
      return;
    }
    lastExportCheck = request.timestamp;
    chrome.storage.local.remove('exportSettingsRequest');
    exportSettingsToBricks(request.settings, request.requestId);
  });

  chrome.storage.local.get('importSettingsRequest', (data) => {
    if (!data.importSettingsRequest) return;
    const request = data.importSettingsRequest;
    if (window.location.hostname !== 'brickshuisarts.nl'
        || Date.now() - request.timestamp > 2000
        || request.timestamp < lastImportCheck) {
      return;
    }
    lastImportCheck = request.timestamp;
    chrome.storage.local.remove('importSettingsRequest');
    importSettingsFromBricks(request.requestId);
  });
}, 400);

// Functie om klantnummer te detecteren en op te slaan
function detectAndSaveKlantnummer() {
    chrome.storage.sync.get(['klantnummer'], (result) => {
        if (!result.klantnummer) {
            // Probeer klantnummer te detecteren uit URL
            const url = window.location.href;
            const match = url.match(/https:\/\/brickshuisarts\.nl\/(\d+)(?:\/.*)?$/);
            if (match && match[1]) {
                const klantnummer = match[1];
                console.log('Klantnummer gedetecteerd:', klantnummer);
                chrome.storage.sync.set({ klantnummer }, () => {
                    console.log('Klantnummer opgeslagen:', klantnummer);
                });
            }
        }
    });
}

function loadGlobalOptions(callback) {
    // Check if options are cached and less than 10 seconds old
    if (optionsLoaded && globalOptions && optionsTimestamp) {
        const age = Date.now() - optionsTimestamp;
        if (age < 10000) { // 10 seconds
            callback(globalOptions);
            return;
        } else {
            // Reset cache to force reload
            optionsLoaded = false;
            globalOptions = null;
            optionsTimestamp = null;
        }
    }
    
    if (chrome && chrome.storage && chrome.storage.sync) {
        chrome.storage.sync.get(null, function(data) {
            if (data && Object.keys(data).length > 0) {
                globalOptions = data;
                optionsTimestamp = Date.now();
                optionsLoaded = true;
                callback(globalOptions);
            } else {
                chrome.runtime.sendMessage({ type: 'getDefaults' }, (resp) => {
                    globalOptions = resp.defaultOptions;
                    optionsTimestamp = Date.now();
                    optionsLoaded = true;
                    callback(globalOptions);
                });
                return;
            }
        });
    } else {
        chrome.runtime.sendMessage({ type: 'getDefaults' }, (resp) => {
            globalOptions = resp.defaultOptions;
            optionsTimestamp = Date.now();
            optionsLoaded = true;
            callback(globalOptions);
        });
    }
}

///////////////////////////////// COMMUNICATIE KNOPPEN TOEVOEGEN //////////////////////////////////////////////////////////////
function communicatie_getOptionsFromStorage(cb) {
    console.log("communicatie_getOptionsFromStorage called");
    loadGlobalOptions(function(options) {
        console.log("Global options received:", options);
        cb({
            communicatieKnoppen: options.communicatieKnoppen !== false,
            btnLabels: options.btnLabels || []
        });
    });
}

function communicatie_add_contact_button(type) {
    console.log("communicatie_add_contact_button called");
    
    // Controleer eerst of er al knoppen bestaan
    const existingButtons = document.querySelector('.contact-buttons');
    if (existingButtons) {
        console.log("Contact buttons already exist, skipping add_contact_button");
        return;
    }
    
    communicatie_getOptionsFromStorage(function(opts) {
        console.log("Options received in add_contact_button:", opts);
        if (!opts.communicatieKnoppen) {
            console.log("Communicatie knoppen disabled, returning");
            return;
        }
        console.log("Communicatie knoppen enabled, proceeding");
        const labelDiv = document.querySelector('.koppelinfo-header .koppelinfo-contact .font-semibold');
        console.log("labelDiv found:", !!labelDiv);
        console.log("labelDiv element:", labelDiv);
        
        if (labelDiv) {
            const btnLabels = opts.btnLabels;
            console.log("btnLabels to use:", btnLabels);
            const btnContainer = document.createElement('div');
            btnContainer.className = 'contact-buttons';
            btnContainer.style.display = 'inline-flex';
            btnContainer.style.gap = '4px';
            btnLabels.forEach(btn => {
                const button = document.createElement('button');
                button.textContent = btn.label;
                button.style.borderRadius = '12px';
                button.style.padding = '2px 10px';
                button.style.border = '1px solid #ccc';
                button.style.background = '#f5f5f5';
                button.style.cursor = 'pointer';
                button.style.fontSize = '0.9em';
                button.addEventListener('click', () => communicatie_changeContact(btn.value));
                btnContainer.appendChild(button);
            });
			// Voeg tekst-links toe: Instellingen en Vernieuwen (geen button-look)
			const settingsLink = document.createElement('span');
			settingsLink.title = 'Instellingen';
			settingsLink.textContent = '⚙️';
			settingsLink.style.cursor = 'pointer';
			settingsLink.style.textDecoration = 'none';
			settingsLink.style.color = '#0077cc';
			settingsLink.style.fontSize = '1.2em';
			settingsLink.style.marginTop = '2px';   
			settingsLink.addEventListener('click', () => communicatie_openOptions());
			btnContainer.appendChild(settingsLink);

			const refreshLink = document.createElement('span');
			refreshLink.title = 'Vernieuwen';
			refreshLink.textContent = '🔄';
			refreshLink.style.cursor = 'pointer';
			refreshLink.style.textDecoration = 'none';
			refreshLink.style.color = '#0077cc';
			refreshLink.style.fontSize = '1.2em';
			refreshLink.style.marginTop = '2px';   
			refreshLink.addEventListener('click', () => communicatie_refreshButtons());
			btnContainer.appendChild(refreshLink);
            console.log("Adding contact buttons to DOM");
            labelDiv.parentNode.insertBefore(btnContainer, labelDiv.nextSibling);
            console.log("Contact buttons added successfully");
        } else {
            console.log("Not adding buttons - labelDiv:", !!labelDiv, "existingButtons:", !!existingButtons);
        }
        
    });
}

// Open de extensie-optiespagina
function communicatie_openOptions() {
	try {
		chrome.runtime.sendMessage({ type: 'openOptionsPage', focusTarget: 'communicatie' });
	} catch (e) {
		console.error('Kon opties niet openen:', e);
	}
}

// Vernieuw de communicatie-knoppen en laad opties opnieuw
function communicatie_refreshButtons() {
	try {
		// Reset cache zodat opties opnieuw worden ingelezen
		optionsLoaded = false;
		globalOptions = null;
		optionsTimestamp = null;
		// Verwijder bestaande knoppen
		const existing = document.querySelector('.contact-buttons');
		if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
		// Voeg opnieuw toe
		communicatie_add_contact_button();
		console.log('Communicatie-knoppen vernieuwd');
	} catch (e) {
		console.error('Fout bij vernieuwen communicatie-knoppen:', e);
	}
}

function communicatie_changeContact(value) {
    console.log("Contact wijzigen naar:", value);
    const searchBtn = document.querySelector('.koppelinfo-header .koppelinfo-contact .picker-icon span.fa-search');
    if (!searchBtn) return false;
    searchBtn.click();
    setTimeout(() => {
        const input = document.querySelector('.area-zoekcontact .simpleinput.bordered input');
        if (!input) return false;
        input.value = value;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        function trySelectFirstItem(retries = 10) {
            const firstItem = document.querySelector('.item-list .item');
            if (firstItem) {
                firstItem.click();
                function tryClickSelecteer(retries = 10) {
                    const footer = document.querySelector('.modal-footer .footer-buttons .right');
                    if (!footer) return false;
                    const buttons = Array.from(footer.querySelectorAll('button'));
                    const selecteerBtn = buttons.find(btn => btn.textContent.trim() === "Selecteer");
                    if (selecteerBtn && !selecteerBtn.disabled) {
                        selecteerBtn.click();
                    } else if (retries > 0) {
                        setTimeout(() => tryClickSelecteer(retries - 1), 100);
                    }
                }
                setTimeout(() => tryClickSelecteer(), 100);
            } else if (retries > 0) {
                setTimeout(() => trySelectFirstItem(retries - 1), 100);
            }
        }
        trySelectFirstItem();
    }, 100);
}

function communicatie_checkForKoppelinfoHeader() {
    //console.log("communicatie_checkForKoppelinfoHeader called");
    
    // Controleer eerst of de header bestaat
    const header = document.querySelector('.koppelinfo-header');
    //console.log("Header found:", !!header);
    
    if (!header) {
        return;
    }
    
    // Controleer of er al knoppen bestaan
    const existingButtons = document.querySelector('.contact-buttons');
    if (existingButtons) {
        //console.log("Contact buttons already exist, skipping");
        return;
    }
    
    // Alleen als de header bestaat en er geen knoppen zijn, haal dan de opties op
    console.log("Header found and no buttons exist, checking options");
    communicatie_getOptionsFromStorage(function(opts) {
        console.log("Options received in checkForKoppelinfoHeader:", opts);
        if (!opts.communicatieKnoppen) {
            console.log("Communicatie knoppen disabled in checkForKoppelinfoHeader, returning");
            return;
        }
        console.log("Communicatie knoppen enabled, adding contact button");
        communicatie_add_contact_button();
    });
}

const communicatie_koppelInfoObserver = new MutationObserver(() => {
    communicatie_checkForKoppelinfoHeader();
});
communicatie_koppelInfoObserver.observe(document.body, { childList: true, subtree: true });
communicatie_checkForKoppelinfoHeader();

//-------------------------------- maak favorieten knop ------------------------------------------------------------

function favorieten_addButton() {
    const modalContent = document.querySelector('.modal-dialog .zoek-contact-content');
    if (!modalContent) return;
    
    const footerRight = document.querySelector('.modal-dialog .footer-buttons .right');
    if (!footerRight || footerRight.querySelector('.btn-favoriet')) return;
    
    const selecteerBtn = Array.from(footerRight.querySelectorAll('button')).find(btn => 
        btn.textContent.includes('Selecteer')
    );
    if (!selecteerBtn) return;
    
    const favorietBtn = document.createElement('button');
    favorietBtn.className = 'btn btn-modal btn-secondary btn-favoriet';
    favorietBtn.setAttribute('data-focus', 'false');
    favorietBtn.id = 'bricks-infused-favorieten-btn';
    favorietBtn.innerHTML = '<span class="">⭐ Snelkoppeling</span>';
    favorietBtn.addEventListener('click', favorieten_addToFavorites);
    
    // Voeg toe vóór de Selecteer knop
    footerRight.insertBefore(favorietBtn, selecteerBtn);
    
    // Voeg tekstveld en OK knop toe op nieuwe regel (verborgen)
    const inputContainer = document.createElement('div');
    inputContainer.style.display = 'none'; // Verborgen standaard
    inputContainer.style.alignItems = 'center';
    inputContainer.style.justifyContent = 'flex-end';
    inputContainer.style.marginTop = '8px';
    inputContainer.style.paddingBottom = '20px';
    inputContainer.style.paddingRight = '20px';
    inputContainer.style.gap = '8px';
    inputContainer.id = 'bricks-infused-input-container';
    
    const naamInput = document.createElement('input');
    naamInput.type = 'text';
    naamInput.placeholder = 'Korte naam snelkoppeling';
    naamInput.style.padding = '4px 8px';
    naamInput.style.border = '1px solid #ccc';
    naamInput.style.borderRadius = '4px';
    naamInput.style.fontSize = '14px';
    naamInput.id = 'bricks-infused-naam-input';
    
    const okBtn = document.createElement('button');
    okBtn.className = 'btn btn-modal btn-secondary';
    okBtn.innerHTML = '💾 Opslaan';
    okBtn.id = 'bricks-infused-ok-btn';
    okBtn.addEventListener('click', () => {
        const korteNaam = naamInput.value.trim();
        const contactName = getContactName();
        
        if (korteNaam && contactName) {
            // Voeg toe aan btnLabels
            chrome.storage.sync.get(['btnLabels'], (result) => {
                const btnLabels = result.btnLabels || [];
                
                // Voeg nieuwe snelkoppeling toe
                btnLabels.push({
                    label: korteNaam,
                    value: contactName
                });
                
                // Sla op
                chrome.storage.sync.set({ btnLabels }, () => {
                    console.log('Snelkoppeling opgeslagen:', { label: korteNaam, value: contactName });
                    
                    // Verander snelkoppeling knop naar disabled met vinkje
                    const favorietBtn = document.getElementById('bricks-infused-favorieten-btn');
                    if (favorietBtn) {
                        favorietBtn.disabled = true;
                        favorietBtn.innerHTML = '<span class="">✅ Snelkoppeling</span>';
                    }
                    
                    // Verberg input velden
                    const inputContainer = document.getElementById('bricks-infused-input-container');
                    if (inputContainer) {
                        inputContainer.style.display = 'none';
                    }
                    
                    // Update de communicatie knoppen
                    communicatie_refreshButtons();
                });
            });
        } else if (!korteNaam) {
            alert('Voer een korte naam in');
        } else if (!contactName) {
            alert('Geen contact geselecteerd');
        }
    });
    
    inputContainer.appendChild(naamInput);
    inputContainer.appendChild(okBtn);
    
    // Voeg toe na de footer-buttons div (op nieuwe regel)
    const footerButtons = document.querySelector('.modal-dialog .footer-buttons');
    if (footerButtons && footerButtons.parentNode) {
        footerButtons.parentNode.insertBefore(inputContainer, footerButtons.nextSibling);
    }
}

// Helper functie om contact naam op te halen
function getContactName() {
    const naamLabel = Array.from(document.querySelectorAll('.modal-dialog .area-contactgegevens .form-textbox label div'))
        .find(div => div.textContent.trim() === 'Naam');
    
    if (!naamLabel) {
        console.log('Geen naam label gevonden');
        return null;
    }
    
    const labelFor = naamLabel.parentElement.getAttribute('for');
    if (!labelFor) {
        console.log('Geen for attribuut gevonden');
        return null;
    }
    
    const naamInput = document.getElementById(labelFor);
    if (!naamInput) {
        console.log('Geen input gevonden');
        return null;
    }
    
    const contactName = naamInput.value.trim();
    if (!contactName) {
        console.log('Geen contact naam gevonden');
        return null;
    }
    
    return contactName;
}

function favorieten_addToFavorites() {
    // Toggle zichtbaarheid van input velden
    const inputContainer = document.getElementById('bricks-infused-input-container');
    if (inputContainer) {
        const isVisible = inputContainer.style.display !== 'none';
        inputContainer.style.display = isVisible ? 'none' : 'flex';
        
        // Als we de velden tonen, controleer of er een contact naam is
        if (!isVisible) {
            const contactName = getContactName();
            if (contactName) {
                // Sla contact naam op in data attribuut voor later gebruik
                inputContainer.setAttribute('data-contact-name', contactName);
                // Leeg het input veld en focus erop
                const bricksInput = document.getElementById('bricks-infused-naam-input');
                if (bricksInput) {
                    bricksInput.value = '';
                    // Focus op het input veld na een korte delay om ervoor te zorgen dat het zichtbaar is
                    setTimeout(() => {
                        bricksInput.focus();
                    }, 100);
                }
            } else {
                // Geen contact naam gevonden, verberg velden weer
                inputContainer.style.display = 'none';
            }
        }
    }
}

// Observer voor favorieten knop
const favorieten_observer = new MutationObserver(() => {
    favorieten_addButton();
});
favorieten_observer.observe(document.body, { childList: true, subtree: true }); 


///////////////////////////////// BRIEF EXPORT ALS PDF //////////////////////////////////////////////////////////////

function redactBsnInText(text) {
    if (!text) return text;
    return String(text)
        // Label + waarde (zelfde regel of gesplitst over whitespace/newlines)
        .replace(/BSN\s*:?\s*\d{9}/gi, 'BSN: *********')
        .replace(/\b\d{4}\.\d{2}\.\d{3}\b/g, '****.**.***')
        // Uit voorzorg: losse 9-cijferige getallen (BSN-lengte); header zet label/waarde vaak apart
        .replace(/\b\d{9}\b/g, '*********');
}

/** Header-velden: label "BSN" en cijfers staan in aparte cellen. */
function redactBsnField(label, value) {
    const lab = (label || '').trim();
    let val = value == null ? '' : String(value);
    if (/^BSN:?$/i.test(lab)) {
        val = val
            .replace(/\b\d{4}\.\d{2}\.\d{3}\b/g, '****.**.***')
            .replace(/\b\d{9}\b/g, '*********');
        return { label: lab, value: val };
    }
    return { label: redactBsnInText(lab), value: redactBsnInText(val) };
}

function findBriefExportAnchor(modalFooter) {
    const rightDiv = modalFooter.querySelector('.right') || modalFooter;
    const buttons = rightDiv.querySelectorAll('button');
    let anchorBtn = null;
    buttons.forEach((btn) => {
        if (btn.classList.contains('btn-pdf-export') || btn.classList.contains('btn-pdf-export-caret')) return;
        const label = (btn.querySelector('span')?.textContent || btn.textContent || '').trim().toLowerCase();
        if (label === 'export' || label === 'exporteren' || label === 'exporteer') {
            anchorBtn = btn;
        }
    });
    if (!anchorBtn) {
        buttons.forEach((btn) => {
            if (btn.classList.contains('btn-pdf-export') || btn.classList.contains('btn-pdf-export-caret')) return;
            const label = (btn.querySelector('span')?.textContent || btn.textContent || '').trim().toLowerCase();
            if (label === 'afdrukken' || label === 'print') anchorBtn = btn;
        });
    }
    return { rightDiv, anchorBtn };
}

function closePdfExportMenu() {
    document.querySelectorAll('.bricks-infused-pdf-export-menu').forEach((el) => el.remove());
    document.removeEventListener('click', pdfExportMenuOutsideClick, true);
    document.removeEventListener('keydown', pdfExportMenuEscape, true);
}

function pdfExportMenuOutsideClick(ev) {
    const menu = document.querySelector('.bricks-infused-pdf-export-menu');
    const caret = document.querySelector('.btn-pdf-export-caret');
    if (!menu) return;
    if (menu.contains(ev.target) || (caret && caret.contains(ev.target))) return;
    closePdfExportMenu();
}

function pdfExportMenuEscape(ev) {
    if (ev.key === 'Escape') closePdfExportMenu();
}

function runBriefPdfExport(modalDialog, berichtdetails, options) {
    const opts = options || {};
    const berichtContainer = modalDialog.querySelector('.berichtsoort-med-container')
        || document.querySelector('.berichtsoort-med-container');

    const finish = (target) => {
        exportBerichtAsPdf(target, { redactBsn: !!opts.redactBsn });
    };

    if (!berichtContainer) {
        finish(berichtdetails);
        return;
    }

    const headerContainer = berichtContainer.querySelector('.berichtsoort-med-kop-container');
    if (headerContainer) {
        finish(berichtContainer);
        return;
    }

    const chevronDown = modalDialog.querySelector('.berichtsoort-med-smallkop-container .fa-chevron-down')
        || document.querySelector('.berichtsoort-med-smallkop-container .fa-chevron-down');
    if (!chevronDown) {
        finish(berichtContainer);
        return;
    }

    chevronDown.click();
    let exportExecuted = false;
    let checkContainer = null;
    let timeoutId = null;

    timeoutId = setTimeout(() => {
        if (!exportExecuted) {
            exportExecuted = true;
            if (checkContainer) clearInterval(checkContainer);
            finish(berichtContainer);
        }
    }, 2000);

    checkContainer = setInterval(() => {
        const newHeaderContainer = berichtContainer.querySelector('.berichtsoort-med-kop-container');
        if (newHeaderContainer && !exportExecuted) {
            exportExecuted = true;
            clearInterval(checkContainer);
            if (timeoutId) clearTimeout(timeoutId);
            finish(berichtContainer);
        }
    }, 100);
}

function openPdfExportMenu(caretBtn, modalDialog, berichtdetails, exportAnchorBtn) {
    closePdfExportMenu();

    const menu = document.createElement('div');
    menu.className = 'bricks-infused-pdf-export-menu';
    menu.style.cssText = [
        'position:absolute',
        'z-index:10000',
        'min-width:160px',
        'background:#fff',
        'border:1px solid #cbd5e0',
        'border-radius:4px',
        'box-shadow:0 4px 12px rgba(0,0,0,0.12)',
        'padding:4px 0',
        'font-size:13px'
    ].join(';');

    const items = [
        { id: 'export', label: 'Export' },
        { id: 'pdf', label: 'PDF' },
        { id: 'pdf-no-bsn', label: 'PDF zonder BSN' }
    ];

    items.forEach((item) => {
        const row = document.createElement('button');
        row.type = 'button';
        row.textContent = item.label;
        row.style.cssText = [
            'display:block',
            'width:100%',
            'text-align:left',
            'padding:6px 12px',
            'border:0',
            'background:transparent',
            'cursor:pointer'
        ].join(';');
        row.addEventListener('mouseenter', () => { row.style.background = '#edf2f7'; });
        row.addEventListener('mouseleave', () => { row.style.background = 'transparent'; });
        row.addEventListener('click', (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            closePdfExportMenu();
            if (item.id === 'export') {
                if (exportAnchorBtn) exportAnchorBtn.click();
                return;
            }
            if (caretBtn.dataset.exporting === 'true') return;
            caretBtn.dataset.exporting = 'true';
            try {
                runBriefPdfExport(modalDialog, berichtdetails, {
                    redactBsn: item.id === 'pdf-no-bsn'
                });
            } finally {
                setTimeout(() => { caretBtn.dataset.exporting = 'false'; }, 500);
            }
        });
        menu.appendChild(row);
    });

    document.body.appendChild(menu);
    const rect = caretBtn.getBoundingClientRect();
    menu.style.left = Math.max(8, rect.right - menu.offsetWidth) + 'px';
    menu.style.top = (rect.bottom + 4) + 'px';

    setTimeout(() => {
        document.addEventListener('click', pdfExportMenuOutsideClick, true);
        document.addEventListener('keydown', pdfExportMenuEscape, true);
    }, 0);
}

function addPdfExportButton() {
    //te doen:
    //- tabellen zoals bij labwaarden maken
    //- tiff afbeeldingen samenvoegen als pdf

    const modalDialog = document.querySelector('.modal-dialog.nopadding')
        || document.querySelector('.modal-dialog .toon-bericht-container')?.closest('.modal-dialog');
    if (!modalDialog) return;

    loadGlobalOptions(function (options) {
        if (!options.pdfExport) {
            console.log('PDF export disabled, skipping');
            return;
        }

        const toonBerichtContainer = modalDialog.querySelector('.toon-bericht-container');
        const berichtdetails = modalDialog.querySelector('.berichtsoort-med-container .bericht-html')
            || document.querySelector('.berichtsoort-med-container .bericht-html')
            || modalDialog.querySelector('.bericht-html');
        const modalFooter = modalDialog.querySelector('.modal-footer');

        if (!toonBerichtContainer || !modalFooter) return;
        // Bericht-body kan iets later laden dan de modal shell
        if (!berichtdetails) {
            console.log('PDF export: bericht-html nog niet aanwezig, later opnieuw');
            return;
        }

        // Oude losse PDF-knop opruimen
        modalFooter.querySelectorAll('.btn-pdf-export').forEach((el) => el.remove());
        if (modalFooter.querySelector('.btn-pdf-export-caret')) return;

        const { rightDiv, anchorBtn } = findBriefExportAnchor(modalFooter);
        if (!anchorBtn) {
            console.log('PDF export: Export-knop niet gevonden');
            return;
        }

        const caretBtn = document.createElement('button');
        caretBtn.type = 'button';
        caretBtn.className = 'btn btn-modal btn-secondary-light btn-pdf-export-caret';
        caretBtn.setAttribute('data-icon', '');
        caretBtn.setAttribute('data-focus', 'false');
        caretBtn.title = 'Export-opties (Bricks Infused)';
        caretBtn.style.cssText = 'min-width:28px;padding-left:6px;padding-right:6px;margin-left:2px;';
        caretBtn.innerHTML = '<span class="fas fa-caret-down" aria-hidden="true"></span>';

        caretBtn.addEventListener('click', (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            const existing = document.querySelector('.bricks-infused-pdf-export-menu');
            if (existing) {
                closePdfExportMenu();
                return;
            }
            openPdfExportMenu(caretBtn, modalDialog, berichtdetails, anchorBtn);
        });

        if (anchorBtn.parentNode) {
            anchorBtn.parentNode.insertBefore(caretBtn, anchorBtn.nextSibling);
        } else {
            rightDiv.appendChild(caretBtn);
        }

        console.log('PDF export-dropdown toegevoegd naast Export');
    });
}

function exportBerichtAsPdf(berichtContainer, options) {
    const opts = options || {};
    const maybeRedact = (t) => (opts.redactBsn ? redactBsnInText(t) : t);

    try {
        // Maak nieuw PDF document
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();
        
        // Pagina afmetingen
        const pageHeight = doc.internal.pageSize.height;
        const pageWidth = doc.internal.pageSize.width;
        const marginTop = 20;
        const marginBottom = 20;
        const marginLeft = 20;
        const marginRight = 20;
        const lineHeight = 5.5; // Kleinere line height voor brief tekst (9pt font)
        const headerLineHeight = 4.5; // Kleinere afstand tussen regels in header
        
        let currentY = marginTop;
        
        // Haal de header tabel op (berichtsoort-med-kop-container)
        const headerContainer = berichtContainer.querySelector
            ? berichtContainer.querySelector('.berichtsoort-med-kop-container')
            : null;
        if (headerContainer) {
            const headerColumns = headerContainer.querySelectorAll('.berichtsoort-med-kop');
            
            if (headerColumns.length > 0) {
                // Bepaal kolombreedtes (6 kolommen: 3 secties met elk label + waarde)
                const sectionWidth = (pageWidth - marginLeft - marginRight) / 3;
                const labelWidth = sectionWidth * 0.35; // Label is 35% van sectie
                const valueWidth = sectionWidth * 0.65; // Waarde is 65% van sectie
                
                // Tekst voor elke kolom verzamelen
                const columnData = [];
                headerColumns.forEach((col) => {
                    const title = maybeRedact(col.querySelector('.title')?.textContent?.trim() || '');
                    const data = [];
                    
                    // Verzamel alle label-waarde paren
                    const col1s = col.querySelectorAll('.col1');
                    col1s.forEach((col1) => {
                        const label = maybeRedact(col1.textContent?.trim() || '');
                        const nextSibling = col1.nextElementSibling;
                        if (nextSibling && !nextSibling.classList.contains('col1')) {
                            let value = '';
                            // Als het een flex-col is, combineer de regels
                            if (nextSibling.classList.contains('flex') && nextSibling.classList.contains('flex-col')) {
                                const divs = nextSibling.querySelectorAll('div');
                                value = Array.from(divs).map(d => d.textContent?.trim()).filter(t => t).join('\n');
                            } else {
                                value = nextSibling.textContent?.trim() || '';
                            }
                            value = maybeRedact(value);
                            if (label && value) {
                                data.push({ label, value });
                            }
                        }
                    });
                    
                    columnData.push({ title, data });
                });
                
                // Voeg header tabel toe aan PDF
                doc.setFontSize(11);
                doc.setFont(undefined, 'bold');
                
                // Teken kolomtitels in lichtgrijs
                columnData.forEach((col, colIndex) => {
                    const x = marginLeft + (colIndex * sectionWidth);
                    // Lichtgrijs: RGB(160, 174, 192) of hex #a0aec0
                    doc.setTextColor(160, 174, 192);
                    doc.text(col.title, x, currentY);
                });
                
                // Reset tekstkleur naar zwart
                doc.setTextColor(0, 0, 0);
                
                currentY += headerLineHeight * 1.5;
                doc.setFont(undefined, 'normal');
                doc.setFontSize(8); // Kleinere tekst voor de rest van de header
                
                // Render elke sectie onafhankelijk
                const sectionYPositions = [];
                columnData.forEach((col, colIndex) => {
                    const sectionX = marginLeft + (colIndex * sectionWidth);
                    const labelX = sectionX;
                    const valueX = sectionX + labelWidth + 2; // Kleine ruimte tussen label en waarde
                    let sectionY = currentY;
                    
                    col.data.forEach((item) => {
                        // Controleer of nieuwe pagina nodig is
                        if (sectionY + (headerLineHeight * 2) > pageHeight - marginBottom) {
                            doc.addPage();
                            sectionY = marginTop + headerLineHeight * 1.5;
                            // Teken kolomtitel opnieuw op nieuwe pagina
                            doc.setFontSize(11);
                            doc.setFont(undefined, 'bold');
                            doc.setTextColor(160, 174, 192);
                            doc.text(col.title, sectionX, marginTop);
                            doc.setTextColor(0, 0, 0);
                            doc.setFont(undefined, 'normal');
                            doc.setFontSize(8);
                        }
                        
                        // Label naast waarde (niet eronder)
                        doc.setFont(undefined, 'bold');
                        const labelText = item.label + ':';
                        doc.text(labelText, labelX, sectionY);
                        
                        // Waarde naast label
                        doc.setFont(undefined, 'normal');
                        const valueLines = doc.splitTextToSize(item.value, valueWidth - 4);
                        doc.text(valueLines, valueX, sectionY);
                        
                        // Bereken hoogte voor deze regel (label hoogte of waarde hoogte, wat groter is)
                        const labelHeight = headerLineHeight;
                        const valueHeight = valueLines.length * headerLineHeight;
                        sectionY += Math.max(labelHeight, valueHeight) + 0.5; // Kleinere ruimte tussen items
                    });
                    
                    sectionYPositions.push(sectionY);
                });
                
                // Bepaal de hoogste Y positie voor de volgende sectie
                currentY = Math.max(...sectionYPositions);
                currentY -= 0.5*headerLineHeight; // Minder ruimte na header tabel (lijn hoger)
                
                // Teken lichtgrijze horizontale balk onder de header
                doc.setDrawColor(160, 174, 192); // Zelfde kleur als kopjes
                doc.setLineWidth(0.25); // Helft dunner (was 0.5)
                doc.line(marginLeft, currentY, pageWidth - marginRight, currentY);
                currentY += headerLineHeight*1.5; // Ruimte na de lijn
                
                doc.setFontSize(9); // Brief tekst nog een punt kleiner (was 10, nu 9)
                doc.setTextColor(0, 0, 0); // Zorg dat tekstkleur weer zwart is
            }
        }
        
        // Haal de bericht-html op
        const berichtHtml = berichtContainer.querySelector
            ? berichtContainer.querySelector('.bericht-html')
            : (berichtContainer.classList && berichtContainer.classList.contains('bericht-html')
                ? berichtContainer
                : null);
        if (berichtHtml) {
            // Haal de tekst op uit bericht-html (optioneel BSN redactie alleen in export-string)
            const text = maybeRedact(berichtHtml.innerText || berichtHtml.textContent || '');
            
            // Zorg dat font size 9 is voor de brief tekst
            doc.setFontSize(9);
            
            // Voeg tekst toe aan PDF (max 180 karakters per regel)
            const lines = doc.splitTextToSize(text, pageWidth - marginLeft - marginRight);
            
            for (let i = 0; i < lines.length; i++) {
                // Controleer of er nog ruimte is op de huidige pagina
                if (currentY + lineHeight > pageHeight - marginBottom) {
                    // Voeg nieuwe pagina toe
                    doc.addPage();
                    currentY = marginTop;
                }
                
                // Voeg regel toe aan PDF
                doc.text(lines[i], marginLeft, currentY);
                currentY += lineHeight;
            }
        }
        
        // Genereer en download PDF
        const suffix = opts.redactBsn ? '_geen_bsn' : '';
        const fileName = `brief_${new Date().toISOString().slice(0, 10)}${suffix}.pdf`;
        doc.save(fileName);
        
        console.log('Brief geëxporteerd als PDF:', fileName);
        
    } catch (error) {
        console.error('Fout bij PDF export:', error);
        alert('Er is een fout opgetreden bij het exporteren van de PDF: ' + error.message);
    }
}

// Observer voor brief modals (ook als bericht-html later verschijnt)
const briefModalObserver = new MutationObserver((mutations) => {
    let shouldTry = false;
    mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
            if (node.nodeType !== 1) return;
            if (
                (node.classList && (
                    node.classList.contains('modal-dialog') ||
                    node.classList.contains('toon-bericht-container') ||
                    node.classList.contains('bericht-html') ||
                    node.classList.contains('berichtsoort-med-container')
                )) ||
                (node.querySelector && node.querySelector(
                    '.modal-dialog, .toon-bericht-container, .bericht-html, .berichtsoort-med-container'
                ))
            ) {
                shouldTry = true;
            }
        });
    });
    if (shouldTry) {
        setTimeout(addPdfExportButton, 100);
        setTimeout(addPdfExportButton, 500);
    }
});

// Start observer
briefModalObserver.observe(document.body, { childList: true, subtree: true });


///////////////////////////////// JOURNAAL RESIZER (native Bricks layout) ////////////////////////////////////////
// Oude Infused-sleepbalken braken na DOM-wijzigingen. Bricks heeft zelf layout.resize.toggle
// (CTRL+SPACE → H hoofdmenu → L widget aanpassen). Infused zet dunne hit-zones op de grijze
// tussenstroken; 1× klik togglet die native mode. Maten slaat Bricks op in P.settings.layout.

const JOURNAAL_GAP_HIT_CLASS = 'bricks-infused-layout-gap-hit';
let journaalResizer_observer = null;
let journaalResizer_ro = null;
let journaalResizer_refreshTimer = null;

function journaalResizer_getOptionsFromStorage(cb) {
    loadGlobalOptions(function (options) {
        cb(options.journaalResizer !== false);
    });
}

function journaalResizer_activePatientId() {
    const m = (window.location.pathname || '').match(/\/s\/consult\/(\d+)/i)
        || (window.location.pathname || '').match(/\/consult\/(\d+)/i);
    return m ? m[1] : null;
}

function journaalResizer_findActiveShell() {
    const patientId = journaalResizer_activePatientId();
    const renderers = Array.from(document.querySelectorAll('.layout-renderer.layout-grid'));
    if (!renderers.length) return null;

    if (!patientId) {
        return renderers.find((el) => el.querySelector('.journaal')) || renderers[0];
    }

    // Prefer layout that belongs to the active consult route / sidebar item.
    const scoped = renderers.find((el) => {
        if (!el.querySelector('.journaal')) return false;
        const host = el.closest('[class*="consult"], .sidebar-item, .consult-content, .page-content') || el.parentElement;
        if (!host) return true;
        const hrefHit = host.querySelector(
            `a[href*="/consult/${patientId}"], a[href*="/s/consult/${patientId}"]`
        );
        if (hrefHit) return true;
        // Visible journaal while URL already points at this patient.
        return el.offsetParent !== null;
    });
    return scoped || renderers.find((el) => el.querySelector('.journaal') && el.offsetParent !== null) || null;
}

function journaalResizer_clearHits(root) {
    const scope = root || document;
    scope.querySelectorAll('.' + JOURNAAL_GAP_HIT_CLASS).forEach((n) => n.remove());
}

function journaalResizer_onGapClick(ev) {
    ev.preventDefault();
    ev.stopPropagation();
    if (!window.bricksBridge || typeof window.bricksBridge.toggleLayoutResize !== 'function') {
        console.warn('Layout resize: bridge niet beschikbaar');
        return;
    }
    window.bricksBridge.toggleLayoutResize().then((result) => {
        console.log('Layout resize toggle:', result);
    }).catch((err) => {
        console.warn('Layout resize toggle mislukt:', err);
    });
}

function journaalResizer_placeGapHitsForGrid(grid) {
    if (!grid || grid.offsetParent === null) return;
    const cs = getComputedStyle(grid);
    if (cs.display !== 'grid' && cs.display !== 'inline-grid') return;

    const colGap = parseFloat(cs.columnGap) || 0;
    const rowGap = parseFloat(cs.rowGap) || 0;
    if (colGap < 2 && rowGap < 2) return;

    const gridRect = grid.getBoundingClientRect();
    const kids = Array.from(grid.children).filter((el) => {
        if (el.classList && el.classList.contains(JOURNAAL_GAP_HIT_CLASS)) return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
    });
    if (kids.length < 2) return;

    if (getComputedStyle(grid).position === 'static') {
        grid.style.position = 'relative';
    }

    const hitMin = 8;

    for (let i = 0; i < kids.length - 1; i++) {
        const a = kids[i].getBoundingClientRect();
        const b = kids[i + 1].getBoundingClientRect();

        // Vertical gap between columns (side-by-side)
        if (colGap >= 2 && b.left > a.right - 1) {
            const gapLeft = a.right - gridRect.left;
            const gapWidth = Math.max(colGap, b.left - a.right);
            const hit = document.createElement('div');
            hit.className = JOURNAAL_GAP_HIT_CLASS;
            hit.title = 'Klik om widget-grootte aan te passen (CTRL+SPACE, H, L)';
            hit.setAttribute('data-gap', 'col');
            hit.style.cssText = [
                'position:absolute',
                `left:${gapLeft}px`,
                `width:${Math.max(gapWidth, hitMin)}px`,
                'top:0',
                'bottom:0',
                'cursor:col-resize',
                'z-index:20',
                'background:transparent'
            ].join(';');
            hit.addEventListener('mouseenter', () => {
                hit.style.background = 'rgba(0,0,0,0.06)';
            });
            hit.addEventListener('mouseleave', () => {
                hit.style.background = 'transparent';
            });
            hit.addEventListener('click', journaalResizer_onGapClick);
            grid.appendChild(hit);
        }

        // Horizontal gap between rows (stacked)
        if (rowGap >= 2 && b.top > a.bottom - 1) {
            const gapTop = a.bottom - gridRect.top;
            const gapHeight = Math.max(rowGap, b.top - a.bottom);
            const hit = document.createElement('div');
            hit.className = JOURNAAL_GAP_HIT_CLASS;
            hit.title = 'Klik om widget-grootte aan te passen (CTRL+SPACE, H, L)';
            hit.setAttribute('data-gap', 'row');
            hit.style.cssText = [
                'position:absolute',
                `top:${gapTop}px`,
                `height:${Math.max(gapHeight, hitMin)}px`,
                'left:0',
                'right:0',
                'cursor:row-resize',
                'z-index:20',
                'background:transparent'
            ].join(';');
            hit.addEventListener('mouseenter', () => {
                hit.style.background = 'rgba(0,0,0,0.06)';
            });
            hit.addEventListener('mouseleave', () => {
                hit.style.background = 'transparent';
            });
            hit.addEventListener('click', journaalResizer_onGapClick);
            grid.appendChild(hit);
        }
    }
}

function journaalResizer_refreshHits() {
    journaalResizer_getOptionsFromStorage(function (enabled) {
        if (!enabled) {
            journaalResizer_clearHits(document);
            return;
        }
        const shell = journaalResizer_findActiveShell();
        journaalResizer_clearHits(document);
        if (!shell) return;

        // Native handles when already resizing — geen extra hit-zones nodig.
        if (shell.classList.contains('resize-active') || document.querySelector('.layout-renderer.resize-active')) {
            return;
        }

        const grids = [shell].concat(
            Array.from(shell.querySelectorAll('.layout-grid, .layout-flex.layout-flex-column'))
        );
        const seen = new Set();
        grids.forEach((g) => {
            if (!g || seen.has(g)) return;
            seen.add(g);
            journaalResizer_placeGapHitsForGrid(g);
        });
    });
}

function journaalResizer_scheduleRefresh() {
    if (journaalResizer_refreshTimer) clearTimeout(journaalResizer_refreshTimer);
    journaalResizer_refreshTimer = setTimeout(() => {
        journaalResizer_refreshTimer = null;
        journaalResizer_refreshHits();
    }, 120);
}

function journaalResizer_setup() {
    journaalResizer_getOptionsFromStorage(function (enabled) {
        if (!enabled) {
            journaalResizer_clearHits(document);
            return;
        }
        if (journaalResizer_observer) journaalResizer_observer.disconnect();
        journaalResizer_observer = new MutationObserver((mutations) => {
            // Ignore our own hit-zone DOM noise
            const relevant = mutations.some((m) => {
                const nodes = []
                    .concat(Array.from(m.addedNodes || []))
                    .concat(Array.from(m.removedNodes || []));
                if (!nodes.length && m.type === 'attributes') return true;
                return nodes.some((n) => !(n.classList && n.classList.contains(JOURNAAL_GAP_HIT_CLASS)));
            });
            if (relevant) journaalResizer_scheduleRefresh();
        });
        journaalResizer_observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['class', 'style']
        });

        if (journaalResizer_ro) {
            try { journaalResizer_ro.disconnect(); } catch (e) { /* ignore */ }
        }
        journaalResizer_ro = new ResizeObserver(() => journaalResizer_scheduleRefresh());
        journaalResizer_ro.observe(document.body);

        journaalResizer_scheduleRefresh();
    });
}

journaalResizer_setup();

///////////////////////////////// DECLAREREN NIET METEEEN OP GEBEURD ZETTEN //////////////////////////////////////////////////////////////

let declareer_opGebeurdCheckbox = null;

function declareer_nietMeteenOpGebeurdZetten(headerDiv) {
    console.log("declareer_nietMeteenOpGebeurdZetten");
    headerDiv.textContent = 'Declareren :)'; //om te laten zien dat het werkt, en dan vindt declereer_observer hem niet meer voor nu
    // zoeken naar de checkbox met de label "Op gebeurd zetten afspraak 00:00" en zet deze uit
    document.querySelectorAll('.form-checkbox[disabled="false"]').forEach(cb => {
        const label = cb.textContent.trim();
        if (label.includes('Op gebeurd zetten afspraak')) {
            declareer_opGebeurdCheckbox = cb;
            const input = cb.querySelector('input[type="checkbox"]');
            if (input && input.checked) {
                input.checked = false;
                input.dispatchEvent(new Event('change', { bubbles: true }));
            }
        }
    });
    // knop toevoegen "einde consult en afhandelen"
    const btnbarRight = document.querySelector('.declaratie-content-container .widget-btnbar .buttonbar .right');
    if (btnbarRight && !btnbarRight.querySelector('.btn-einde-consult')) {
        const btn = document.createElement('button');
        btn.setAttribute('data-button', 'true');
        btn.className = 'btn btn-widget btn-secondary btn-einde-consult';
        btn.textContent = '';
        btn.appendChild(document.createTextNode('✅ '));
        btn.appendChild(document.createTextNode('Einde consult en afhandelen'));
        btn.addEventListener('click', function() {
            //zet weer op consult afgehandeld
            if (declareer_opGebeurdCheckbox) {
                const input = declareer_opGebeurdCheckbox.querySelector('input[type="checkbox"]');
                if (input) {
                    input.checked = true;
                    input.dispatchEvent(new Event('change', { bubbles: true }));
                }
            }
            // Zoek en klik de knop 'Einde consult' in btnbarRight
            const eindeConsultBtn = Array.from(btnbarRight.querySelectorAll('button')).find(b => b.textContent.trim() === 'Einde consult');
            if (eindeConsultBtn) {
                eindeConsultBtn.click();
            }
        });
        btnbarRight.appendChild(btn);
    }
    
}

let declareer_observer = new MutationObserver(() => {
    const headerDiv = document.querySelector('.modal-dialog.nopadding div.modal-header');
    if (headerDiv && headerDiv.textContent == 'Declareren') {
        declareer_nietMeteenOpGebeurdZetten(headerDiv);
    }
});

declareer_observer.observe(document.body, { childList: true, subtree: true });

/////////////////////////////// JUVOLY //////////////////////////////////////////////////////////////
// Oude iframe-aanpak verwijderd (Permissions-Policy blokkeert microfoon in Bricks).
// Nieuwe tab-integratie: content_juvoly_bricks.js + content_juvoly.js + background bridge.

///////////////////////////////// MEDICIJN MARKERINGEN //////////////////////////////////////////////////////////////
// Autorisatielijst: arceer risico-medicatie. Bricks DOM wisselt containers; match op
// stabiele classes (.rapport44-recept-regel + title) en normaliseer diakritische
// tekens (codeïne vs CODEINE). Geen API — puur DOM.

const MEDICIJN_MARK_ATTR = 'data-bricks-infused-medicijn';

const MEDICIJN_CATEGORIES = [
    {
        id: 'opiaat',
        className: 'medicijn-opiaat',
        color: '#ffe4cc',
        keywords: [
            'morfine', 'oxycodon', 'fentanyl', 'codeine', 'codeïne', 'tramadol',
            'buprenorfine', 'methadon', 'hydromorfon', 'pethidine', 'diamorfine'
        ]
    },
    {
        id: 'benzodiazepine',
        className: 'medicijn-benzodiazepine',
        color: '#fff2cc',
        keywords: [
            'oxazepam', 'temazepam', 'bromazepam', 'lorazepam', 'diazepam', 'alprazolam',
            'clonazepam', 'midazolam', 'nitrazepam', 'flunitrazepam', 'triazolam',
            'zolpidem', 'zopiclon'
        ]
    },
    {
        id: 'adhd',
        className: 'medicijn-adhd',
        color: '#f0f8cc',
        keywords: [
            'methylfenidaat', 'dexamfetamine', 'lisdexamfetamine', 'atomoxetine', 'guanfacine',
            'clonidine', 'concerta', 'ritalin', 'medikinet', 'equasym', 'focalin', 'adderall',
            'vyvanse', 'strattera', 'intuniv', 'kapvay'
        ]
    },
    {
        id: 'methotrexaat',
        className: 'medicijn-methotrexaat',
        color: '#ffcccc',
        keywords: ['methotrexaat', 'amiodaron']
    }
];

const MEDICIJN_ALL_CLASSES = MEDICIJN_CATEGORIES.map((c) => c.className);

function medicijn_normalize(text) {
    return String(text || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
}

function medicijn_findRapportRoot() {
    // Oude selector (pre-2026): .autorisatieview.controls .area-rapportdetails
    const legacy = document.querySelector('.autorisatieview.controls .area-rapportdetails');
    if (legacy && legacy.offsetParent !== null) return legacy;

    const scroll = document.querySelector('.rapport-nothtml-content-scroll');
    if (scroll && scroll.offsetParent !== null) return scroll;

    const container = document.querySelector('.rapport-nothtml-container');
    if (container && container.offsetParent !== null) return container;

    // Laatste redmiddel op autorisatie-route: elk zichtbaar recept-blok
    if ((window.location.pathname || '').includes('/autorisatie')) {
        const any = document.querySelector('.rapport44-recept');
        if (any) return any.closest('.widget-content, .rapport-nothtml-container, main, body') || document.body;
    }
    return null;
}

function medicijn_findNameEl(receptRegel) {
    return (
        receptRegel.querySelector('.cursor-pointer[title="Bekijk voorschrijfgeschiedenis"]') ||
        receptRegel.querySelector('[title="Bekijk voorschrijfgeschiedenis"]') ||
        receptRegel.querySelector('.cursor-pointer')
    );
}

function medicijn_clearRegel(receptRegel) {
    receptRegel.style.backgroundColor = '';
    receptRegel.classList.remove(...MEDICIJN_ALL_CLASSES);
    receptRegel.removeAttribute(MEDICIJN_MARK_ATTR);
}

function medicijn_markeringen() {
    console.log('medicijn_markeringen called');

    loadGlobalOptions(function (options) {
        if (!options.medicijnMarkeringen) {
            console.log('Medicijn markeringen disabled, skipping');
            return;
        }

        const root = medicijn_findRapportRoot();
        if (!root) {
            console.log('Rapport/recept root not found, skipping medicijn markeringen');
            return;
        }

        const recepten = root.querySelectorAll('.rapport44-recept');
        console.log(`Found ${recepten.length} recepten to process`);
        if (!recepten.length) return;

        recepten.forEach((recept) => {
            const receptRegels = recept.querySelectorAll('.rapport44-recept-regel');
            receptRegels.forEach((receptRegel) => {
                medicijn_clearRegel(receptRegel);

                const medicijnDiv = medicijn_findNameEl(receptRegel);
                if (!medicijnDiv) return;

                const medicijnNaam = medicijnDiv.textContent.trim();
                const naamNorm = medicijn_normalize(medicijnNaam);

                for (const cat of MEDICIJN_CATEGORIES) {
                    const hit = cat.keywords.some((kw) => naamNorm.includes(medicijn_normalize(kw)));
                    if (!hit) continue;
                    console.log(`${cat.id} gevonden: ${medicijnNaam}`);
                    receptRegel.style.backgroundColor = cat.color;
                    receptRegel.classList.add(cat.className);
                    receptRegel.setAttribute(MEDICIJN_MARK_ATTR, cat.id);
                    break; // één categorie per regel (opiaat > benzo > …)
                }

                // "1 herhalingen" accent (exacte tekst zoals Bricks toont)
                const herhalingenDiv = receptRegel.querySelector('.flex-grow');
                if (herhalingenDiv && herhalingenDiv.textContent.trim() === '1 herhalingen') {
                    herhalingenDiv.style.backgroundColor = '#ff8c00';
                    herhalingenDiv.style.padding = '2px 4px';
                    herhalingenDiv.style.borderRadius = '3px';
                }
            });
        });
    });
}

function medicijn_scheduleMarkeringen(delayMs) {
    const wait = delayMs != null ? delayMs : 200;
    clearTimeout(medicijn_scheduleMarkeringen._timer);
    medicijn_scheduleMarkeringen._timer = setTimeout(() => medicijn_markeringen(), wait);
}

function addToonResultaatListener() {
    const buttons = document.querySelectorAll('button');
    let toonResultaatBtn = null;
    buttons.forEach((button) => {
        // Breder dan oude .autorisatieview.controls .area-rapportselectie
        if (button.textContent && button.textContent.includes('Toon resultaat')) {
            toonResultaatBtn = button;
        }
    });

    if (toonResultaatBtn && !toonResultaatBtn.hasAttribute('data-medicijn-listener')) {
        console.log('Toon resultaat knop gevonden, voeg listener toe');
        toonResultaatBtn.setAttribute('data-medicijn-listener', 'true');
        toonResultaatBtn.addEventListener('click', function () {
            console.log('Toon resultaat knop geklikt, plan medicijn markeringen');
            medicijn_scheduleMarkeringen(400);
            medicijn_scheduleMarkeringen(1200);
        });
    }
}

// Observer: knop + wanneer receptregels in de DOM komen/wijzigen
const toonResultaat_observer = new MutationObserver((mutations) => {
    addToonResultaatListener();
    const relevant = mutations.some((m) => {
        const nodes = []
            .concat(Array.from(m.addedNodes || []))
            .concat(Array.from(m.removedNodes || []));
        return nodes.some((n) => {
            if (!n || n.nodeType !== 1) return false;
            const el = n;
            return (
                (el.classList && (
                    el.classList.contains('rapport44-recept') ||
                    el.classList.contains('rapport44-recept-regel') ||
                    el.classList.contains('rapport-nothtml-content-scroll')
                )) ||
                (el.querySelector && el.querySelector('.rapport44-recept-regel, .rapport44-recept'))
            );
        });
    });
    if (relevant) medicijn_scheduleMarkeringen(250);
});

toonResultaat_observer.observe(document.body, {
    childList: true,
    subtree: true
});

addToonResultaatListener();
medicijn_scheduleMarkeringen(500);

///////////////////////////////// ZORGDOMEIN CUSTOM //////////////////////////////////////////////////////////////

function zorgdomein_addLabformOption() {
    const contextMenuVars = document.querySelector('.contextmenuvars');
    if (!contextMenuVars) return;
    
    const zorgdomeinItem = contextMenuVars.querySelector('.context-menu-item[title="ZorgDomein"]');
    if (!zorgdomeinItem) return;
    
    // Check if custom options already exist to prevent infinite loop
    const existingCustomOptions = contextMenuVars.querySelectorAll('.context-menu-item[data-custom-zorgdomein="true"]');
    if (existingCustomOptions.length > 0) return; // Already added, skip
    
    // Get zorgdomeinLinks from options
    loadGlobalOptions((options) => {
        const zorgdomeinLinks = options.zorgdomeinLinks || [];
        
        // Reverse the array so items appear in correct order when inserted
        zorgdomeinLinks.slice().reverse().forEach((link, index) => {
            if (!link.name) return; // Skip if no name
            
            // Create option item
            const optionItem = document.createElement('li');
            optionItem.setAttribute('data-v-7d356a63', '');
            optionItem.className = 'context-menu-item';
            optionItem.title = link.name;
            optionItem.setAttribute('data-custom-zorgdomein', 'true');
            optionItem.setAttribute('data-link-index', index);
            
            const optionCaption = document.createElement('div');
            optionCaption.setAttribute('data-v-7d356a63', '');
            optionCaption.className = 'caption';
            optionCaption.style.display = 'flex';
            optionCaption.style.justifyContent = 'space-between';
            optionCaption.style.alignItems = 'center';
            optionCaption.style.width = '100%';
            
            const optionText = document.createElement('span');
            optionText.textContent = `• ${link.name}`;
            optionText.style.fontSize = '0.9em';
            
            // Add episodelijst indicator if needed
            // if (link.episodelijstNodig) {
            //     const episodelijstSpan = document.createElement('span');
            //     episodelijstSpan.innerHTML = ' ⚕️';
            //     episodelijstSpan.style.fontSize = '0.8em';
            //     episodelijstSpan.title = 'Episodelijst nodig';
            //     optionText.appendChild(episodelijstSpan);
            // }
            
            // Add settings button
            const settingsSpan = document.createElement('span');
            settingsSpan.innerHTML = '⚙️';
            settingsSpan.style.cursor = 'pointer';
            settingsSpan.style.fontSize = '12px';
            settingsSpan.title = `${link.name} instellingen`;
            settingsSpan.addEventListener('click', (e) => {
                e.stopPropagation(); // Prevent triggering the parent li click
                console.log(`${link.name} settings clicked`);
                
                // Open plugin settings page
                chrome.runtime.sendMessage({ type: 'openOptionsPage', focusTarget: 'zorgdomein' });
            });
            
            optionCaption.appendChild(optionText);
            optionCaption.appendChild(settingsSpan);
            optionItem.appendChild(optionCaption);
            
            // Add after ZorgDomein item
            const ul = zorgdomeinItem.parentNode;
            ul.insertBefore(optionItem, zorgdomeinItem.nextSibling);
            
            // Add click handler — always bind to ACTIVE patient (multi-dossier safe)
            optionItem.addEventListener('click', async () => {
                const timestamp = Date.now();
                let linkPath = link.link;
                if (linkPath && linkPath.startsWith('https://www.zorgdomein.nl/')) {
                    linkPath = linkPath.replace('https://www.zorgdomein.nl', '');
                }
                chrome.storage.sync.set({
                    lastClickedLink: linkPath,
                    lastClickedTimestamp: timestamp
                }, () => {
                    console.log('Last clicked link saved:', link.link, 'at', timestamp);
                });

                // Direct API for the active consult — never querySelectorAll the first
                // "Nieuwe verwijzing maken" (that hits the first open patient in the DOM).
                if (window.bricksBridge) {
                    try {
                        const ctx = await window.bricksBridge.getActiveContext();
                        console.log('ZorgDomein shortcut for active context:', ctx);
                        if (!(ctx && ctx.patientId > 0)) {
                            console.warn('Geen actieve patiënt in URL/context; ZorgDomein afgebroken');
                            return;
                        }
                        const result = await window.bricksBridge.startZorgdomeinVerwijzing({
                            patientId: ctx.patientId,
                            contactId: ctx.contactId,
                            episodelijstNodig: !!link.episodelijstNodig
                        });
                        console.log('ZorgDomein bridge result:', result);
                        return;
                    } catch (err) {
                        console.warn('ZorgDomein bridge mislukt, DOM fallback (scoped):', err);
                    }
                }

                zorgdomein_startViaDomFallback(link, contextMenuVars);
            });
        });
    });
}

/**
 * Last-resort ZorgDomein start. Prefer bridge API.
 * Scopes button search to the active consult panel when possible to avoid
 * starting a verwijzing for the wrong open patient.
 */
function zorgdomein_startViaDomFallback(link, contextMenuVars) {
    const patientId = (function () {
        const m = (window.location.pathname || '').match(/\/s\/consult\/(\d+)/i)
            || (window.location.pathname || '').match(/\/consult\/(\d+)/i);
        return m ? m[1] : null;
    })();

    const zorgdomeinButton = contextMenuVars.querySelector('.context-menu-item[title="ZorgDomein"]');
    if (!zorgdomeinButton) {
        console.log('ZorgDomein button not found');
        return;
    }
    zorgdomeinButton.click();
    console.log('ZorgDomein button clicked (DOM fallback)');

    setTimeout(() => {
        let root = document;
        if (patientId) {
            // Prefer the consult shell that matches the active patient route.
            const candidates = Array.from(document.querySelectorAll('[class*="consult"], .sidebar-content, .layout-content, main'));
            const scoped = candidates.find((el) =>
                el.querySelector && el.querySelector(`a[href*="/consult/${patientId}"], [href*="/s/consult/${patientId}"]`)
            );
            if (scoped) root = scoped;
        }

        const buttons = root.querySelectorAll
            ? root.querySelectorAll('.widget-content.widget-hpadding.overflow-tetra button')
            : document.querySelectorAll('.widget-content.widget-hpadding.overflow-tetra button');
        const nieuweVerwijzingButton = Array.from(buttons).find((btn) =>
            btn.textContent.includes('Nieuwe verwijzing maken')
        );
        if (!nieuweVerwijzingButton) {
            console.log('Nieuwe verwijzing maken button not found');
            return;
        }
        nieuweVerwijzingButton.click();
        console.log('Nieuwe verwijzing maken button clicked (DOM fallback)');

        if (!link.episodelijstNodig) {
            setTimeout(() => {
                const modalButtons = document.querySelectorAll('#modalDialogs .modal-footer button');
                const doorgaanBtn = Array.from(modalButtons).find((btn) =>
                    btn.textContent.includes('Doorgaan')
                );
                if (doorgaanBtn) {
                    doorgaanBtn.click();
                    console.log('Doorgaan button clicked');
                } else {
                    console.log('No Doorgaan button found - modal probably not shown');
                }
            }, 300);
        } else {
            console.log('Episodelijst nodig - skipping Doorgaan button click');
        }
    }, 200);
}

// Observer for context menu changes
const zorgdomein_observer = new MutationObserver(() => {
    // Only run if zorgdomeinSnelkoppelingen option is enabled
    loadGlobalOptions((options) => {
        if (options.zorgdomeinSnelkoppelingen !== false) {
            zorgdomein_addLabformOption();
        }
    });
});

zorgdomein_observer.observe(document.body, { childList: true, subtree: true });

// Detecteer en sla klantnummer op bij het laden van de pagina
detectAndSaveKlantnummer();





