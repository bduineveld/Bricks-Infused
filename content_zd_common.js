// Content script voor Zorgdomein pagina's
// Dit script wordt uitgevoerd op verschillende Zorgdomein URL's

console.log('Zorgdomein common functions loaded');
console.log('Current URL:', window.location.href);
console.log('Script loaded at:', new Date().toISOString());

// Pending choose-product URL: sync localStorage + sync storage (snelle redirect eet async sync.set niet).
const BRICKS_ZD_LS_PENDING = 'bricks_zd_pending_choose_product_v1';
const CHOOSE_PRODUCT_LINK_CLASS = 'bricks-zd-choose-product-link';
/** Max leeftijd pending; daarna geen Snelkoppeling op transaction (patient-URL nooit gebruiken). */
const CHOOSE_PRODUCT_PENDING_MS = 120000;

function isChooseProductPathname(pathname) {
    return !!pathname && pathname.includes('choose-product') && !pathname.includes('/referral/transaction');
}

function persistPendingChooseProductPath(urlPath) {
    if (!urlPath || typeof urlPath !== 'string') return;
    if (urlPath.includes('/referral/transaction')) return;
    if (!urlPath.includes('choose-product')) return;
    const entry = { urlPath, ts: Date.now() };
    try { window.localStorage.setItem(BRICKS_ZD_LS_PENDING, JSON.stringify(entry)); } catch (e) {}
    try {
        chrome.storage.sync.set({
            pendingChooseProductUrl: urlPath,
            pendingChooseProductTimestamp: entry.ts
        });
    } catch (e) {}
}

function snapChooseProductFromCurrentLocation() {
    if (window.location.hostname !== 'www.zorgdomein.nl') return;
    const path = window.location.pathname + window.location.search;
    if (isChooseProductPathname(window.location.pathname)) {
        persistPendingChooseProductPath(path);
    }
}

function readLsPendingChooseProduct() {
    try {
        const raw = window.localStorage.getItem(BRICKS_ZD_LS_PENDING);
        if (!raw) return null;
        const o = JSON.parse(raw);
        if (!o || !o.urlPath || typeof o.ts !== 'number') return null;
        return { urlPath: o.urlPath, ts: o.ts };
    } catch (e) { return null; }
}

(function bricksZdInstallEarlyPendingCapture() {
    try {
        snapChooseProductFromCurrentLocation();
    } catch (e) {}

    function hrefToChooseProductPath(href) {
        try {
            const u = new URL(href, window.location.href);
            if (u.hostname !== 'www.zorgdomein.nl') return null;
            if (!isChooseProductPathname(u.pathname)) return null;
            return u.pathname + u.search;
        } catch (e) { return null; }
    }

    function onNavIntent(ev) {
        const a = ev.target && ev.target.closest && ev.target.closest('a[href]');
        if (!a) return;
        const path = hrefToChooseProductPath(a.getAttribute('href') || '');
        if (!path) return;
        persistPendingChooseProductPath(path);
    }
    window.addEventListener('click', onNavIntent, true);
    window.addEventListener('auxclick', onNavIntent, true);
})();

// SPA / client-side navigatie: elke URL-wijziging kan choose-product zijn zonder volledige reload
(function bricksZdWatchSpaForChooseProduct() {
    function tick() {
        try { snapChooseProductFromCurrentLocation(); } catch (e) {}
    }
    tick();
    ['pushState', 'replaceState'].forEach((method) => {
        const orig = history[method];
        history[method] = function () {
            const ret = orig.apply(this, arguments);
            queueMicrotask(tick);
            return ret;
        };
    });
    window.addEventListener('popstate', () => queueMicrotask(tick));
})();

// ZorgDomein-updates: balk is zd-menu-bar (class menu-bar) + rechterkant is zd-menu-bar-right.
function getZdMenuBarRight() {
    return document.querySelector('zd-focus-navigation-bar zd-menu-bar-right') ||
        document.querySelector('zd-focus-navigation-bar .menu-bar__right');
}

// True als knoop zelf of een descendant de focus-/menu-balk is (voor MutationObserver)
function isZorgdomeinNavRelevantNode(node) {
    if (node.nodeType !== Node.ELEMENT_NODE) return false;
    const tag = node.tagName;
    if (tag === 'ZD-FOCUS-NAVIGATION-BAR' || tag === 'ZD-MENU-BAR' ||
        tag === 'ZD-MENU-BAR-RIGHT' || tag === 'ZD-MENU-BAR-LEFT' || tag === 'ZD-MENU-BAR-CENTER') {
        return true;
    }
    return !!(node.querySelector && node.querySelector(
        'zd-focus-navigation-bar, zd-menu-bar, zd-menu-bar-right'));
}

// Voorkom parallelle async-pogingen (meerdere setTimeouts + storage-callback = dubbele knoppen)
let zorgdomeinShortcutAttachBusy = false;

let zorgdomeinNavMutationObserver = null;

/** Volledige https-URL naar choose-product; alleen gezet op /referral/transaction/ met geldige pending. Ook de URL voor Snelkoppeling (geen transaction-URL). */
let pendingChooseProductBackUrl = null;

/** Op /referral/transaction/: alleen recente choose-product-URL; nooit de patient-specifieke transaction-URL. */
function getBricksZdShortcutFormUrl() {
    if (isZorgdomeinTransactionReferralPage()) {
        return pendingChooseProductBackUrl || null;
    }
    return window.location.href;
}

function isZorgdomeinTransactionReferralPage() {
    return window.location.pathname.includes('/referral/transaction');
}

function dedupeChooseProductLinks(menuBarRight) {
    const links = menuBarRight.querySelectorAll('a.' + CHOOSE_PRODUCT_LINK_CLASS);
    for (let i = 1; i < links.length; i++) {
        links[i].remove();
    }
}

/** Echte link naar de tussenliggende choose-product-pagina (alleen transaction-referral). */
function attachChooseProductBackLinkSingle(fullChooseProductUrl) {
    if (!fullChooseProductUrl || !isZorgdomeinTransactionReferralPage()) return;
    const menuBarRight = getZdMenuBarRight();
    if (!menuBarRight) return;
    dedupeChooseProductLinks(menuBarRight);
    let a = menuBarRight.querySelector('a.' + CHOOSE_PRODUCT_LINK_CLASS);
    if (!a) {
        a = document.createElement('a');
        a.className = CHOOSE_PRODUCT_LINK_CLASS;
        a.textContent = 'Productkeuze';
        a.title = 'Open de productkeuze-pagina opnieuw';
        a.rel = 'noopener';
        a.style.cssText = [
            'display:inline-flex', 'align-items:center', 'margin-right:8px',
            'padding:6px 10px', 'border-radius:4px', 'font-size:13px', 'font-weight:500',
            'text-decoration:none', 'color:#fff', 'background:#0d6efd', 'border:1px solid #0a58ca',
            'white-space:nowrap'
        ].join(';');
        a.addEventListener('mouseenter', () => { a.style.background = '#0b5ed7'; });
        a.addEventListener('mouseleave', () => { a.style.background = '#0d6efd'; });
        menuBarRight.insertBefore(a, menuBarRight.firstChild);
    }
    a.href = fullChooseProductUrl;
}

function scheduleChooseProductBackLink(fullChooseProductUrl) {
    if (!fullChooseProductUrl || !isZorgdomeinTransactionReferralPage()) return;
    const run = () => attachChooseProductBackLinkSingle(fullChooseProductUrl);
    run();
    setTimeout(run, 500);
    setTimeout(run, 1500);
    setTimeout(run, 4000);
}

function removeChooseProductBackLinks() {
    try {
        document.querySelectorAll('a.' + CHOOSE_PRODUCT_LINK_CLASS).forEach((el) => el.remove());
    } catch (e) {}
}

function dedupeBricksShortcutButtons(menuBarRight) {
    const buttons = menuBarRight.querySelectorAll('.bricks-shortcut-btn');
    for (let i = 1; i < buttons.length; i++) {
        buttons[i].remove();
    }
}

// Functie om de snelkoppeling knop toe te voegen
function addBricksShortcutButton() {
    console.log('Adding Bricks shortcut button...');

    const shortcutTargetUrl = getBricksZdShortcutFormUrl();
    if (shortcutTargetUrl === null) {
        console.log('Geen Snelkoppeling: transaction-pagina zonder recente choose-product pending (patient-URL wordt nooit opgeslagen)');
        return;
    }
    
    const menuBarRight = getZdMenuBarRight();
    if (!menuBarRight) {
        console.log('Menu bar right not found (zd-menu-bar-right / .menu-bar__right)');
        return;
    }
    dedupeBricksShortcutButtons(menuBarRight);
    if (menuBarRight.querySelector('.bricks-shortcut-btn')) {
        console.log('Bricks shortcut button already exists');
        return;
    }
    if (zorgdomeinShortcutAttachBusy) {
        return;
    }
    zorgdomeinShortcutAttachBusy = true;
    
    // Op transaction met pending: check choose-product-URL, niet de transaction-URL (anders wint de verkeerde knop-race)
    checkIfUrlExistsAsShortcut(shortcutTargetUrl, (exists) => {
        try {
            if (exists) {
                console.log('Shortcut target URL already exists as shortcut, not adding button:', shortcutTargetUrl);
                return;
            }
            if (!menuBarRight.isConnected) {
                return;
            }
            dedupeBricksShortcutButtons(menuBarRight);
            if (menuBarRight.querySelector('.bricks-shortcut-btn')) {
                return;
            }
        
        // Maak de knop
        const shortcutButton = document.createElement('button');
        shortcutButton.className = 'bricks-shortcut-btn';
        shortcutButton.innerHTML = `
            <zd-icon class="icon icon--medium">
                <div class="icon__content">
                    <img src="${chrome.runtime.getURL('bricks-infused.svg')}" alt="Bricks" style="width: 20px; height: 20px;">
                </div>
            </zd-icon>
            <span class="show-for-medium" style="margin-left: 8px;">Snelkoppeling</span>
        `;
        
        // Styling voor de knop
        shortcutButton.style.cssText = `
            background: #007bff;
            color: white;
            border: none;
            border-radius: 4px;
            padding: 8px 12px;
            cursor: pointer;
            display: flex;
            align-items: center;
            font-size: 14px;
            font-weight: 500;
            transition: background-color 0.2s;
        `;
        
        // Hover effect
        shortcutButton.addEventListener('mouseenter', () => {
            shortcutButton.style.backgroundColor = '#0056b3';
        });
        
        shortcutButton.addEventListener('mouseleave', () => {
            shortcutButton.style.backgroundColor = '#007bff';
        });
        
        // Click handler
        shortcutButton.addEventListener('click', () => {
            console.log('Bricks shortcut button clicked, target URL:', getBricksZdShortcutFormUrl());
            createBricksShortcut();
        });
        
            // Voeg de knop toe aan de rechterkant
            menuBarRight.appendChild(shortcutButton);
            console.log('Bricks shortcut button added successfully');
        } finally {
            zorgdomeinShortcutAttachBusy = false;
        }
    });
}

// Functie om te controleren of de huidige pagina al als snelkoppeling bestaat
function checkIfPageExistsAsShortcut(callback) {
    const currentUrl = window.location.href;
    console.log('Checking if current URL exists as shortcut:', currentUrl);
    
    // Converteer huidige URL naar pad voor vergelijking
    let currentPath = currentUrl;
    if (currentUrl.startsWith('https://www.zorgdomein.nl/')) {
        currentPath = currentUrl.replace('https://www.zorgdomein.nl', '');
    }
    
    chrome.storage.sync.get(['zorgdomeinLinks'], (result) => {
        const existingLinks = result.zorgdomeinLinks || [];
        
        // Controleer of de huidige URL al bestaat (vergelijk met pad)
        const exists = existingLinks.some(link => link.link === currentPath);
        
        console.log('Page exists as shortcut:', exists);
        callback(exists);
    });
}

// Functie om een snelkoppeling in Bricks te maken
function createBricksShortcut() {
    console.log('Creating Bricks shortcut...');
    const targetUrl = getBricksZdShortcutFormUrl();
    if (targetUrl === null) {
        console.log('Geen formulier: geen recente choose-product-URL voor deze transaction-pagina');
        return;
    }
    console.log('Shortcut form URL:', targetUrl);
    showShortcutForm(targetUrl);
}

// Functie om het snelkoppeling formulier te tonen
function showShortcutForm(currentUrl) {
    // Verwijder bestaand formulier als het er is
    const existingForm = document.querySelector('.bricks-shortcut-form');
    if (existingForm) {
        existingForm.remove();
    }
    
    // Maak het formulier
    const form = document.createElement('div');
    form.className = 'bricks-shortcut-form';
    form.innerHTML = `
        <div class="form-content">
            <h3>Snelkoppeling toevoegen</h3>
            <div class="form-group">
                <label for="shortcut-name">Naam:</label>
                <input type="text" id="shortcut-name" placeholder="Bijv. Lab, Radiologie, etc." maxlength="50">
            </div>
            <div class="form-group">
                <label class="checkbox-label">
                    <input type="checkbox" id="episodelijst-nodig">
                    <span class="checkbox-custom"></span>
                    Episodelijst nodig
                </label>
            </div>
            <div class="form-actions">
                <button type="button" class="btn-cancel">Annuleren</button>
                <button type="button" class="btn-confirm">Toevoegen</button>
            </div>
        </div>
    `;
    
    // Styling voor het formulier
    form.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: white;
        border-radius: 8px;
        box-shadow: 0 4px 20px rgba(0,0,0,0.3);
        z-index: 10001;
        padding: 20px;
        min-width: 300px;
        font-family: Arial, sans-serif;
    `;
    
    // Styling voor form content
    const style = document.createElement('style');
    style.textContent = `
        .bricks-shortcut-form .form-content h3 {
            margin: 0 0 16px 0;
            color: #333;
            font-size: 18px;
        }
        .bricks-shortcut-form .form-group {
            margin-bottom: 16px;
        }
        .bricks-shortcut-form label {
            display: block;
            margin-bottom: 4px;
            color: #555;
            font-weight: 500;
        }
        .bricks-shortcut-form input[type="text"] {
            width: 100%;
            padding: 8px 12px;
            border: 1px solid #ddd;
            border-radius: 4px;
            font-size: 14px;
            box-sizing: border-box;
        }
        .bricks-shortcut-form input[type="text"]:focus {
            outline: none;
            border-color: #007bff;
            box-shadow: 0 0 0 2px rgba(0,123,255,0.25);
        }
        .bricks-shortcut-form .checkbox-label {
            display: flex !important;
            align-items: center;
            cursor: pointer;
            margin-bottom: 0 !important;
        }
        .bricks-shortcut-form .checkbox-label input[type="checkbox"] {
            display: none;
        }
        .bricks-shortcut-form .checkbox-custom {
            width: 20px;
            height: 20px;
            border: 2px solid #ddd;
            border-radius: 4px;
            margin-right: 8px;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.2s;
            position: relative;
        }
        .bricks-shortcut-form .checkbox-custom::after {
            content: '✓';
            color: white;
            font-size: 14px;
            font-weight: bold;
            opacity: 0;
            transition: opacity 0.2s;
        }
        .bricks-shortcut-form .checkbox-label input[type="checkbox"]:checked + .checkbox-custom {
            background: #007bff;
            border-color: #007bff;
        }
        .bricks-shortcut-form .checkbox-label input[type="checkbox"]:checked + .checkbox-custom::after {
            opacity: 1;
        }
        .bricks-shortcut-form .form-actions {
            display: flex;
            gap: 8px;
            justify-content: flex-end;
            margin-top: 20px;
        }
        .bricks-shortcut-form .btn-cancel,
        .bricks-shortcut-form .btn-confirm {
            padding: 8px 16px;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 14px;
            font-weight: 500;
        }
        .bricks-shortcut-form .btn-cancel {
            background: #6c757d;
            color: white;
        }
        .bricks-shortcut-form .btn-cancel:hover {
            background: #5a6268;
        }
        .bricks-shortcut-form .btn-confirm {
            background: #007bff;
            color: white;
        }
        .bricks-shortcut-form .btn-confirm:hover {
            background: #0056b3;
        }
        .bricks-shortcut-form .btn-confirm:disabled {
            background: #ccc;
            cursor: not-allowed;
        }
    `;
    document.head.appendChild(style);
    
    // Voeg het formulier toe aan de pagina
    document.body.appendChild(form);
    
    // Event listeners
    const nameInput = form.querySelector('#shortcut-name');
    const episodelijstCheckbox = form.querySelector('#episodelijst-nodig');
    const cancelBtn = form.querySelector('.btn-cancel');
    const confirmBtn = form.querySelector('.btn-confirm');
    
    // Annuleren
    cancelBtn.addEventListener('click', () => {
        form.remove();
        style.remove();
    });
    
    // Bevestigen
    confirmBtn.addEventListener('click', () => {
        const name = nameInput.value.trim();
        if (!name) {
            nameInput.focus();
            return;
        }
        
        const episodelijstNodig = episodelijstCheckbox.checked;
        
        // Sla de snelkoppeling op
        saveShortcutToStorage(name, currentUrl, episodelijstNodig);
        
        // Verwijder het formulier
        form.remove();
        style.remove();
    });
    
    // Enter toets voor bevestigen
    nameInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            confirmBtn.click();
        }
    });
    
    // Focus op het naam veld
    setTimeout(() => nameInput.focus(), 100);
}

// Functie om de snelkoppeling op te slaan in storage
function saveShortcutToStorage(name, url, episodelijstNodig) {
    console.log('Saving shortcut:', { name, url, episodelijstNodig });
    
    // Converteer URL naar pad (verwijder https://www.zorgdomein.nl)
    let linkPath = url;
    if (url && url.startsWith('https://www.zorgdomein.nl/')) {
        linkPath = url.replace('https://www.zorgdomein.nl', '');
    }
    
    // Haal bestaande zorgdomeinLinks op
    chrome.storage.sync.get(['zorgdomeinLinks'], (result) => {
        const existingLinks = result.zorgdomeinLinks || [];
        
        // Maak nieuwe link object
        const newLink = {
            episodelijstNodig: episodelijstNodig,
            link: linkPath,
            name: name
        };
        
        // Voeg toe aan bestaande links
        const updatedLinks = [...existingLinks, newLink];
        
        // Sla op in storage
        chrome.storage.sync.set({ 
            zorgdomeinLinks: updatedLinks
        }, () => {
            console.log('Zorgdomein links updated:', updatedLinks);
            
            // Toon bevestiging
            showNotification(`Snelkoppeling "${name}" toegevoegd!`);
        });
    });
}

// Functie om een notificatie te tonen
function showNotification(message) {
    // Maak een tijdelijke notificatie
    const notification = document.createElement('div');
    notification.textContent = message;
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: #28a745;
        color: white;
        padding: 12px 20px;
        border-radius: 4px;
        z-index: 10000;
        font-size: 14px;
        box-shadow: 0 2px 10px rgba(0,0,0,0.2);
    `;
    
    document.body.appendChild(notification);
    
    // Verwijder na 3 seconden
    setTimeout(() => {
        if (notification.parentNode) {
            notification.parentNode.removeChild(notification);
        }
    }, 3000);
}

// Functie om de observer te starten
function startZorgdomeinObserver() {
    if (zorgdomeinNavMutationObserver) {
        return;
    }
    const attachObserver = () => {
        if (!document.body) return;
        if (zorgdomeinNavMutationObserver) return;
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                    const hasNavChunk = Array.from(mutation.addedNodes).some(isZorgdomeinNavRelevantNode);
                    if (hasNavChunk) {
                        console.log('ZorgDomein nav chunk detected, trying shortcut button');
                        setTimeout(() => {
                            addBricksShortcutButton();
                            if (pendingChooseProductBackUrl) {
                                attachChooseProductBackLinkSingle(pendingChooseProductBackUrl);
                            }
                        }, 500);
                    }
                }
            });
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
        zorgdomeinNavMutationObserver = observer;
    };

    if (document.body) {
        attachObserver();
    } else {
        document.addEventListener('DOMContentLoaded', attachObserver);
    }
}

// Functie om pagina te verwerken
function processPage() {
    const currentUrl = window.location.href;
    console.log('Zorgdomein page detected:', currentUrl);

    // Dashboard: alleen vroege klik-capture (IIFE); geen knop hier — dat doet content_zd_dash.js
    if (currentUrl.indexOf('zorgdomein.nl/dashboard') !== -1) {
        console.log('Dashboard: pending-capture actief, geen common-knop op dashboard');
        return;
    }

    if (isChooseProductPathname(window.location.pathname)) {
        pendingChooseProductBackUrl = null;
        console.log('Choose-product page detected, saving URL for later use');
        // Converteer URL naar pad voor opslag
        let urlPath = currentUrl;
        if (currentUrl.startsWith('https://www.zorgdomein.nl/')) {
            urlPath = currentUrl.replace('https://www.zorgdomein.nl', '');
        }
        persistPendingChooseProductPath(urlPath);
        chrome.storage.sync.set({
            pendingChooseProductUrl: urlPath,
            pendingChooseProductTimestamp: Date.now()
        }, () => {
            console.log('Choose-product URL saved:', urlPath);
        });
    } else if (currentUrl.includes('/referral/')) {
        console.log('Referral page detected, checking for pending choose-product URL');
        const lsPending = readLsPendingChooseProduct();
        chrome.storage.sync.get(['pendingChooseProductUrl', 'pendingChooseProductTimestamp'], (result) => {
            const syncPending = (result.pendingChooseProductUrl && result.pendingChooseProductTimestamp)
                ? { urlPath: result.pendingChooseProductUrl, ts: result.pendingChooseProductTimestamp }
                : null;
            let chosen = null;
            if (lsPending && syncPending) {
                chosen = lsPending.ts >= syncPending.ts ? lsPending : syncPending;
            } else {
                chosen = lsPending || syncPending;
            }
            const timeDiff = chosen ? (Date.now() - chosen.ts) : Infinity;

            if (chosen && timeDiff < CHOOSE_PRODUCT_PENDING_MS) {
                let fullUrl = chosen.urlPath;
                if (!fullUrl.startsWith('http')) {
                    fullUrl = 'https://www.zorgdomein.nl' + (fullUrl.startsWith('/') ? fullUrl : '/' + fullUrl);
                }
                console.log('Using pending choose-product URL:', fullUrl);
                if (isZorgdomeinTransactionReferralPage()) {
                    pendingChooseProductBackUrl = fullUrl;
                    scheduleChooseProductBackLink(fullUrl);
                    // Geen initializeWithPendingUrl: die tweede knop-race zorgde dat Snelkoppeling de transaction-URL pakte.
                    // Eén knop via initializeZorgdomeinPage + getBricksZdShortcutFormUrl() → choose-product-URL in het formulier.
                    initializeZorgdomeinPage();
                } else {
                    pendingChooseProductBackUrl = null;
                    initializeWithPendingUrl(fullUrl);
                }
            } else {
                if (chosen) {
                    console.log('Pending URL too old, ignoring');
                    try { window.localStorage.removeItem(BRICKS_ZD_LS_PENDING); } catch (e) {}
                    chrome.storage.sync.remove(['pendingChooseProductUrl', 'pendingChooseProductTimestamp']);
                } else {
                    console.log('No pending choose-product URL found');
                }
                pendingChooseProductBackUrl = null;
                removeChooseProductBackLinks();
                initializeZorgdomeinPage();
            }
        });
    } else {
        console.log('Standard Zorgdomein page, initializing normally');
        pendingChooseProductBackUrl = null;
        removeChooseProductBackLinks();
        // Normale initialisatie voor supply-matcher en protocol pagina's
        initializeZorgdomeinPage();
    }
}

// Verwerk de huidige pagina
processPage();

// Eenvoudige interval-based URL monitoring
let lastProcessedUrl = window.location.href;
let urlCheckInterval = setInterval(() => {
    try { snapChooseProductFromCurrentLocation(); } catch (e) {}
    const currentUrl = window.location.href;
    if (currentUrl !== lastProcessedUrl) {
        console.log('URL changed from', lastProcessedUrl, 'to', currentUrl);
        lastProcessedUrl = currentUrl;
        
        // Kleine delay en verwerk de nieuwe pagina
        setTimeout(() => {
            processPage();
        }, 1000);
    }
}, 500);


console.log('Debug functie beschikbaar: window.debugZorgdomein()');

// Debug functie - roep deze aan in de console om te testen
window.debugZorgdomein = function() {
    console.log('=== ZORGDOMEIN DEBUG ===');
    console.log('Current URL:', window.location.href);
    console.log('URL contains choose-product:', window.location.href.includes('/choose-product/'));
    console.log('URL contains referral:', window.location.href.includes('/referral/'));
    
    chrome.storage.sync.get(['pendingChooseProductUrl', 'pendingChooseProductTimestamp'], (result) => {
        console.log('Stored pending URL:', result.pendingChooseProductUrl);
        console.log('Stored timestamp:', result.pendingChooseProductTimestamp);
        if (result.pendingChooseProductTimestamp) {
            const timeDiff = Date.now() - result.pendingChooseProductTimestamp;
            console.log('Time difference:', timeDiff, 'ms');
        }
    });
    
    console.log('=== END DEBUG ===');
};

// Functie om te initialiseren met een opgeslagen URL
function initializeWithPendingUrl(savedUrl) {
    const scheduleTry = () => {
        addBricksShortcutButtonWithUrl(savedUrl);
        setTimeout(() => addBricksShortcutButtonWithUrl(savedUrl), 1500);
        setTimeout(() => addBricksShortcutButtonWithUrl(savedUrl), 4000);
    };
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', scheduleTry);
    } else {
        scheduleTry();
    }
    startZorgdomeinObserver();
}

// Functie om de snelkoppeling knop toe te voegen met een specifieke URL
function addBricksShortcutButtonWithUrl(targetUrl) {
    console.log('Adding Bricks shortcut button with specific URL:', targetUrl);
    
    const menuBarRight = getZdMenuBarRight();
    if (!menuBarRight) {
        console.log('Menu bar right not found (zd-menu-bar-right / .menu-bar__right)');
        return;
    }
    dedupeBricksShortcutButtons(menuBarRight);
    if (menuBarRight.querySelector('.bricks-shortcut-btn')) {
        console.log('Bricks shortcut button already exists');
        return;
    }
    if (zorgdomeinShortcutAttachBusy) {
        return;
    }
    zorgdomeinShortcutAttachBusy = true;
    
    // Controleer of de target URL al als snelkoppeling bestaat
    checkIfUrlExistsAsShortcut(targetUrl, (exists) => {
        try {
            if (exists) {
                console.log('Target URL already exists as shortcut, not adding button');
                return;
            }
            if (!menuBarRight.isConnected) {
                return;
            }
            dedupeBricksShortcutButtons(menuBarRight);
            if (menuBarRight.querySelector('.bricks-shortcut-btn')) {
                return;
            }
        
        // Maak de knop
        const shortcutButton = document.createElement('button');
        shortcutButton.className = 'bricks-shortcut-btn';
        shortcutButton.innerHTML = `
            <zd-icon class="icon icon--medium">
                <div class="icon__content">
                    <img src="${chrome.runtime.getURL('bricks-infused.svg')}" alt="Bricks" style="width: 20px; height: 20px;">
                </div>
            </zd-icon>
            <span class="show-for-medium" style="margin-left: 8px;">Snelkoppeling</span>
        `;
        
        // Styling voor de knop
        shortcutButton.style.cssText = `
            background: #007bff;
            color: white;
            border: none;
            border-radius: 4px;
            padding: 8px 12px;
            cursor: pointer;
            display: flex;
            align-items: center;
            font-size: 14px;
            font-weight: 500;
            transition: background-color 0.2s;
        `;
        
        // Hover effect
        shortcutButton.addEventListener('mouseenter', () => {
            shortcutButton.style.backgroundColor = '#0056b3';
        });
        
        shortcutButton.addEventListener('mouseleave', () => {
            shortcutButton.style.backgroundColor = '#007bff';
        });
        
        // Click handler met specifieke URL
        shortcutButton.addEventListener('click', () => {
            console.log('Bricks shortcut button clicked with URL:', targetUrl);
            createBricksShortcutWithUrl(targetUrl);
        });
        
            menuBarRight.appendChild(shortcutButton);
            console.log('Bricks shortcut button added successfully with URL:', targetUrl);
        } finally {
            zorgdomeinShortcutAttachBusy = false;
        }
    });
}

// Functie om te controleren of een specifieke URL al als snelkoppeling bestaat
function checkIfUrlExistsAsShortcut(url, callback) {
    console.log('Checking if URL exists as shortcut:', url);
    
    // Converteer URL naar pad voor vergelijking
    let urlPath = url;
    if (url && url.startsWith('https://www.zorgdomein.nl/')) {
        urlPath = url.replace('https://www.zorgdomein.nl', '');
    }
    
    chrome.storage.sync.get(['zorgdomeinLinks'], (result) => {
        const existingLinks = result.zorgdomeinLinks || [];
        
        // Controleer of de URL al bestaat (vergelijk met pad)
        const exists = existingLinks.some(link => link.link === urlPath);
        
        console.log('URL exists as shortcut:', exists);
        callback(exists);
    });
}

// Functie om een snelkoppeling te maken met een specifieke URL
function createBricksShortcutWithUrl(targetUrl) {
    console.log('Creating Bricks shortcut with URL:', targetUrl);
    
    // Toon het invoer formulier met de specifieke URL
    showShortcutForm(targetUrl);
}

// Functie om de pagina te initialiseren (voor normale pagina's)
function initializeZorgdomeinPage() {
    console.log('Initializing Zorgdomein page...');
    
    const scheduleTry = () => {
        addBricksShortcutButton();
        setTimeout(addBricksShortcutButton, 1500);
        setTimeout(addBricksShortcutButton, 4000);
    };
    
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', scheduleTry);
    } else {
        scheduleTry();
    }
    
    // Start observer
    startZorgdomeinObserver();
}
