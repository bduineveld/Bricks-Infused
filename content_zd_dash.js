// Content script voor Zorgdomein dashboard
// Dit script wordt uitgevoerd op https://www.zorgdomein.nl/dashboard
// (bij client-side navigatie blijft dit script in het tabblad; daarom: alleen actief op /dashboard)

console.log('Zorgdomein content script loaded');

function isZorgdomeinDashboardView() {
    const p = window.location.pathname;
    return p === '/dashboard' || p.startsWith('/dashboard/');
}

let isProcessing = false;
let checkTimeout = null;
let dashboardLinksRenderTimeout = null;
let dashboardRenderRetryInterval = null;
const DASHBOARD_LINKS_CONTAINER_ID = 'bricks-zd-dashboard-shortcuts';
let lastKnownDashboardUrl = window.location.href;

// Functie om de laatste geklikte link op te halen en actie uit te voeren
function handleLastClickedLink() {
    if (!isZorgdomeinDashboardView()) {
        return;
    }
    // Voorkom meerdere gelijktijdige checks
    if (isProcessing) {
        console.log('Already processing, skipping check');
        return;
    }
    
    console.log('Checking for last clicked link...');
    isProcessing = true;
    
    chrome.storage.sync.get(['lastClickedLink', 'lastClickedTimestamp'], (result) => {
        isProcessing = false;
        
        if (result.lastClickedLink && result.lastClickedTimestamp) {
            const timestamp = Date.now();
            const timeDiff = timestamp - result.lastClickedTimestamp;
            
            // Alleen actie ondernemen als de link recent geklikt is (binnen 60 seconden)
            if (timeDiff < 60000) {
                console.log('Recent link found:', result.lastClickedLink);
                console.log('Time difference:', timeDiff, 'ms');
                
                // Clear de storage VOORDAT we navigeren
                chrome.storage.sync.remove(['lastClickedLink', 'lastClickedTimestamp'], () => {
                    console.log('Storage cleared before navigation');
                    
                    // Voer hier de gewenste actie uit met de link
                    performActionWithLink(result.lastClickedLink);
                });
            } else {
                console.log('Link too old, ignoring:', timeDiff, 'ms ago');
            }
        } else {
            console.log('No recent link found');
        }
    });
}

// Debounced versie van handleLastClickedLink
function debouncedHandleLastClickedLink() {
    if (!isZorgdomeinDashboardView()) {
        return;
    }
    if (checkTimeout) {
        clearTimeout(checkTimeout);
    }
    checkTimeout = setTimeout(handleLastClickedLink, 1000); // 1 seconde delay
}

// Functie om actie uit te voeren met de ontvangen link
function performActionWithLink(linkUrl) {
    console.log('Performing action with link:', linkUrl);
    
    // Reconstruer de volledige URL als alleen het pad is opgeslagen
    let fullUrl = linkUrl;
    if (linkUrl && !linkUrl.startsWith('http')) {
        fullUrl = 'https://www.zorgdomein.nl' + (linkUrl.startsWith('/') ? linkUrl : '/' + linkUrl);
        console.log('Reconstructed full URL:', fullUrl);
    }
    
    // Navigeer naar de link in het huidige tabblad
    console.log('Navigating to:', fullUrl);
    window.location.href = fullUrl;
}

function getDirectNaarDiagnostiekHeaderContainer() {
    const headings = Array.from(document.querySelectorAll('zd-card h2'));
    const targetHeading = headings.find((heading) => heading.textContent && heading.textContent.trim() === 'Direct naar diagnostiek');
    if (!targetHeading) {
        return null;
    }

    const cardHeaderContainer = targetHeading.closest('.card__header-container');
    return cardHeaderContainer || null;
}

function buildZorgdomeinUrl(linkPath) {
    if (!linkPath) {
        return null;
    }
    if (linkPath.startsWith('http://') || linkPath.startsWith('https://')) {
        return linkPath;
    }
    return 'https://www.zorgdomein.nl' + (linkPath.startsWith('/') ? linkPath : '/' + linkPath);
}

function removeDashboardShortcutLinks() {
    const existing = document.getElementById(DASHBOARD_LINKS_CONTAINER_ID);
    if (existing && existing.parentNode) {
        existing.parentNode.removeChild(existing);
    }
}

function openBricksInfusedOptionsPage() {
    try {
        chrome.runtime.sendMessage({ type: 'openOptionsPage', focusTarget: 'zorgdomein' });
    } catch (error) {
        console.error('Kon optiespagina niet openen:', error);
    }
}

function renderDashboardShortcutLinks() {
    if (!isZorgdomeinDashboardView()) {
        return;
    }

    chrome.storage.sync.get(['zorgdomeinDashboardLinks', 'zorgdomeinSnelkoppelingen', 'zorgdomeinLinks'], (result) => {
        const dashboardEnabled = result.zorgdomeinDashboardLinks !== false;
        const shortcutsEnabled = result.zorgdomeinSnelkoppelingen !== false;
        const links = (result.zorgdomeinLinks || [])
            .filter((link) => link && link.name)
            .map((link) => ({ name: link.name, href: buildZorgdomeinUrl(link.link) }))
            .filter((link) => !!link.href);

        removeDashboardShortcutLinks();

        if (!dashboardEnabled || !shortcutsEnabled || links.length === 0) {
            return;
        }

        const headerContainer = getDirectNaarDiagnostiekHeaderContainer();
        if (!headerContainer) {
            console.log('Dashboard card header not found yet, retry will continue');
            return;
        }

        const linksContainer = document.createElement('div');
        linksContainer.id = DASHBOARD_LINKS_CONTAINER_ID;
        linksContainer.style.margin = '6px 0 0 0';
        linksContainer.style.fontSize = '14px';
        linksContainer.style.lineHeight = '1.4';
        linksContainer.style.display = 'flex';
        linksContainer.style.alignItems = 'center';
        linksContainer.style.gap = '8px';

        const logo = document.createElement('img');
        logo.src = chrome.runtime.getURL('bricks-infused.svg');
        logo.alt = 'Bricks Infused';
        logo.style.width = '16px';
        logo.style.height = '16px';
        logo.style.flex = '0 0 auto';
        linksContainer.appendChild(logo);

        const textLinks = document.createElement('span');
        textLinks.style.display = 'inline-block';

        links.forEach((link, index) => {
            const anchor = document.createElement('a');
            anchor.href = link.href;
            anchor.textContent = link.name;
            anchor.style.textDecoration = 'underline';
            anchor.style.cursor = 'pointer';
            textLinks.appendChild(anchor);

            if (index < links.length - 1) {
                textLinks.appendChild(document.createTextNode(' | '));
            }
        });

        if (!textLinks.childNodes.length) {
            return;
        }
        linksContainer.appendChild(textLinks);

        const settingsButton = document.createElement('button');
        settingsButton.type = 'button';
        settingsButton.title = 'Open Bricks Infused instellingen';
        settingsButton.textContent = '⚙️';
        settingsButton.style.border = 'none';
        settingsButton.style.background = 'transparent';
        settingsButton.style.cursor = 'pointer';
        settingsButton.style.padding = '0';
        settingsButton.style.fontSize = '15px';
        settingsButton.style.lineHeight = '1';
        settingsButton.style.flex = '0 0 auto';
        settingsButton.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            openBricksInfusedOptionsPage();
        });
        linksContainer.appendChild(settingsButton);

        headerContainer.appendChild(linksContainer);
        stopDashboardRenderRetryLoop();
    });
}

function debouncedRenderDashboardShortcutLinks() {
    if (!isZorgdomeinDashboardView()) {
        return;
    }
    if (dashboardLinksRenderTimeout) {
        clearTimeout(dashboardLinksRenderTimeout);
    }
    dashboardLinksRenderTimeout = setTimeout(renderDashboardShortcutLinks, 250);
}

function startDashboardRenderRetryLoop() {
    if (!isZorgdomeinDashboardView()) {
        return;
    }
    if (dashboardRenderRetryInterval) {
        return;
    }

    const startTs = Date.now();
    dashboardRenderRetryInterval = setInterval(() => {
        // Stop na 30s om onnodig werk te voorkomen.
        if (Date.now() - startTs > 30000) {
            stopDashboardRenderRetryLoop();
            return;
        }
        renderDashboardShortcutLinks();
    }, 1000);
}

function stopDashboardRenderRetryLoop() {
    if (!dashboardRenderRetryInterval) {
        return;
    }
    clearInterval(dashboardRenderRetryInterval);
    dashboardRenderRetryInterval = null;
}

function handleDashboardRouteOrVisibilityChange() {
    if (!isZorgdomeinDashboardView()) {
        stopDashboardRenderRetryLoop();
        return;
    }
    renderDashboardShortcutLinks();
    startDashboardRenderRetryLoop();
    debouncedHandleLastClickedLink();
}

function installDashboardNavigationListeners() {
    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;

    history.pushState = function () {
        const result = originalPushState.apply(this, arguments);
        queueMicrotask(handleDashboardRouteOrVisibilityChange);
        return result;
    };
    history.replaceState = function () {
        const result = originalReplaceState.apply(this, arguments);
        queueMicrotask(handleDashboardRouteOrVisibilityChange);
        return result;
    };

    window.addEventListener('popstate', handleDashboardRouteOrVisibilityChange);
    window.addEventListener('pageshow', handleDashboardRouteOrVisibilityChange);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            handleDashboardRouteOrVisibilityChange();
        }
    });

    // Extra vangnet voor SPA's die history niet gebruiken zoals verwacht.
    setInterval(() => {
        const currentUrl = window.location.href;
        if (currentUrl === lastKnownDashboardUrl) {
            return;
        }
        lastKnownDashboardUrl = currentUrl;
        handleDashboardRouteOrVisibilityChange();
    }, 500);
}

// Wacht tot de pagina volledig geladen is
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        setTimeout(() => { if (isZorgdomeinDashboardView()) handleLastClickedLink(); }, 2000);
        setTimeout(() => {
            if (isZorgdomeinDashboardView()) {
                renderDashboardShortcutLinks();
                startDashboardRenderRetryLoop();
            }
        }, 2000);
    });
} else {
    setTimeout(() => { if (isZorgdomeinDashboardView()) handleLastClickedLink(); }, 2000);
    setTimeout(() => {
        if (isZorgdomeinDashboardView()) {
            renderDashboardShortcutLinks();
            startDashboardRenderRetryLoop();
        }
    }, 2000);
}

installDashboardNavigationListeners();

// Ook luisteren naar storage changes voor real-time updates (maar debounced)
chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace !== 'sync') {
        return;
    }
    if (changes.lastClickedLink) {
        console.log('Storage changed, new link detected:', changes.lastClickedLink.newValue);
        debouncedHandleLastClickedLink();
    }
    if (changes.zorgdomeinDashboardLinks || changes.zorgdomeinLinks || changes.zorgdomeinSnelkoppelingen) {
        debouncedRenderDashboardShortcutLinks();
        startDashboardRenderRetryLoop();
    }
});

// Observer voor dynamische content changes (maar veel minder agressief)
const observer = new MutationObserver((mutations) => {
    if (!isZorgdomeinDashboardView()) {
        return;
    }
    // Dashboard content laadt vaak asynchroon; elke childList toevoeging kan relevant zijn.
    const hasSignificantChanges = mutations.some((mutation) =>
        mutation.type === 'childList' && mutation.addedNodes.length > 0
    );
    
    if (hasSignificantChanges) {
        console.log('Significant DOM changes detected, checking for links');
        debouncedHandleLastClickedLink();
        debouncedRenderDashboardShortcutLinks();
        startDashboardRenderRetryLoop();
    }
});

// Start observer met meer specifieke configuratie
observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: false, // Geen attribute changes observeren
    characterData: false // Geen text changes observeren
});

console.log('Zorgdomein content script initialized');
