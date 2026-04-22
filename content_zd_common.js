// Content script voor Zorgdomein pagina's
// Dit script wordt uitgevoerd op verschillende Zorgdomein URL's

console.log('Zorgdomein common functions loaded');
console.log('Current URL:', window.location.href);
console.log('Script loaded at:', new Date().toISOString());

// Functie om de snelkoppeling knop toe te voegen
function addBricksShortcutButton() {
    console.log('Adding Bricks shortcut button...');
    
    // Zoek de navigation bar
    const navigationBar = document.querySelector('zd-focus-navigation-bar .menu-bar');
    if (!navigationBar) {
        console.log('Navigation bar not found');
        return;
    }
    
    // Zoek de rechterkant van de menu bar
    const menuBarRight = navigationBar.querySelector('.menu-bar__right');
    if (!menuBarRight) {
        console.log('Menu bar right not found');
        return;
    }
    
    // Controleer of de knop al bestaat
    if (menuBarRight.querySelector('.bricks-shortcut-btn')) {
        console.log('Bricks shortcut button already exists');
        return;
    }
    
    // Controleer of de huidige pagina al als snelkoppeling bestaat
    checkIfPageExistsAsShortcut((exists) => {
        if (exists) {
            console.log('Current page already exists as shortcut, not adding button');
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
            console.log('Bricks shortcut button clicked');
            createBricksShortcut();
        });
        
        // Voeg de knop toe aan de rechterkant
        menuBarRight.appendChild(shortcutButton);
        console.log('Bricks shortcut button added successfully');
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
    
    // Haal de huidige URL op
    const currentUrl = window.location.href;
    console.log('Current URL:', currentUrl);
    
    // Toon het invoer formulier
    showShortcutForm(currentUrl);
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
    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                // Check of de navigation bar is toegevoegd
                const hasNavigationBar = Array.from(mutation.addedNodes).some(node => 
                    node.nodeType === Node.ELEMENT_NODE && 
                    node.querySelector && 
                    node.querySelector('zd-focus-navigation-bar')
                );
                
                if (hasNavigationBar) {
                    console.log('Navigation bar detected, adding shortcut button');
                    setTimeout(addBricksShortcutButton, 500);
                }
            }
        });
    });

    // Start observer
    observer.observe(document.body, {
        childList: true,
        subtree: true
    });
}

// Functie om pagina te verwerken
function processPage() {
    const currentUrl = window.location.href;
    console.log('Zorgdomein page detected:', currentUrl);

    if (currentUrl.includes('/choose-product/')) {
        console.log('Choose-product page detected, saving URL for later use');
        // Converteer URL naar pad voor opslag
        let urlPath = currentUrl;
        if (currentUrl.startsWith('https://www.zorgdomein.nl/')) {
            urlPath = currentUrl.replace('https://www.zorgdomein.nl', '');
        }
        // Sla de choose-product URL op voor later gebruik
        chrome.storage.sync.set({ 
            pendingChooseProductUrl: urlPath,
            pendingChooseProductTimestamp: Date.now()
        }, () => {
            console.log('Choose-product URL saved:', urlPath);
        });
    } else if (currentUrl.includes('/referral/')) {
        console.log('Referral page detected, checking for pending choose-product URL');
        // Controleer of er een opgeslagen choose-product URL is
        chrome.storage.sync.get(['pendingChooseProductUrl', 'pendingChooseProductTimestamp'], (result) => {
            if (result.pendingChooseProductUrl && result.pendingChooseProductTimestamp) {
                const timeDiff = Date.now() - result.pendingChooseProductTimestamp;
                // Alleen gebruiken als de URL recent is (binnen 5 minuten)
                if (timeDiff < 300000) {
                    console.log('Using pending choose-product URL:', result.pendingChooseProductUrl);
                    // Reconstruer volledige URL en initialiseer
                    let fullUrl = result.pendingChooseProductUrl;
                    if (!fullUrl.startsWith('http')) {
                        fullUrl = 'https://www.zorgdomein.nl' + (fullUrl.startsWith('/') ? fullUrl : '/' + fullUrl);
                    }
                    initializeWithPendingUrl(fullUrl);
                } else {
                    console.log('Pending URL too old, ignoring');
                    chrome.storage.sync.remove(['pendingChooseProductUrl', 'pendingChooseProductTimestamp']);
                }
            } else {
                console.log('No pending choose-product URL found');
            }
        });
    } else {
        console.log('Standard Zorgdomein page, initializing normally');
        // Normale initialisatie voor supply-matcher en protocol pagina's
        initializeZorgdomeinPage();
    }
}

// Verwerk de huidige pagina
processPage();

// Eenvoudige interval-based URL monitoring
let lastProcessedUrl = window.location.href;
let urlCheckInterval = setInterval(() => {
    const currentUrl = window.location.href;
    if (currentUrl !== lastProcessedUrl) {
        console.log('URL changed from', lastProcessedUrl, 'to', currentUrl);
        lastProcessedUrl = currentUrl;
        
        // Kleine delay en verwerk de nieuwe pagina
        setTimeout(() => {
            processPage();
        }, 1000);
    }
}, 1000); // Check elke seconde


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
    // Wacht tot de pagina volledig geladen is
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            setTimeout(() => addBricksShortcutButtonWithUrl(savedUrl), 1000);
        });
    } else {
        setTimeout(() => addBricksShortcutButtonWithUrl(savedUrl), 1000);
    }
    
    // Start observer
    startZorgdomeinObserver();
}

// Functie om de snelkoppeling knop toe te voegen met een specifieke URL
function addBricksShortcutButtonWithUrl(targetUrl) {
    console.log('Adding Bricks shortcut button with specific URL:', targetUrl);
    
    // Zoek de navigation bar
    const navigationBar = document.querySelector('zd-focus-navigation-bar .menu-bar');
    if (!navigationBar) {
        console.log('Navigation bar not found');
        return;
    }
    
    // Zoek de rechterkant van de menu bar
    const menuBarRight = navigationBar.querySelector('.menu-bar__right');
    if (!menuBarRight) {
        console.log('Menu bar right not found');
        return;
    }
    
    // Controleer of de knop al bestaat
    if (menuBarRight.querySelector('.bricks-shortcut-btn')) {
        console.log('Bricks shortcut button already exists');
        return;
    }
    
    // Controleer of de target URL al als snelkoppeling bestaat
    checkIfUrlExistsAsShortcut(targetUrl, (exists) => {
        if (exists) {
            console.log('Target URL already exists as shortcut, not adding button');
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
        
        // Voeg de knop toe aan de rechterkant
        menuBarRight.appendChild(shortcutButton);
        console.log('Bricks shortcut button added successfully with URL:', targetUrl);
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
    
    // Wacht tot de pagina volledig geladen is
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            setTimeout(addBricksShortcutButton, 1000);
        });
    } else {
        setTimeout(addBricksShortcutButton, 1000);
    }
    
    // Start observer
    startZorgdomeinObserver();
}
