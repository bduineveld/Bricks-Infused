// Content script voor Zorgdomein dashboard
// Dit script wordt uitgevoerd op https://www.zorgdomein.nl/zd/dashboard

console.log('Zorgdomein content script loaded');

let isProcessing = false;
let checkTimeout = null;

// Functie om de laatste geklikte link op te halen en actie uit te voeren
function handleLastClickedLink() {
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

// Wacht tot de pagina volledig geladen is
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        setTimeout(handleLastClickedLink, 2000); // 2 seconden na DOM ready
    });
} else {
    setTimeout(handleLastClickedLink, 2000); // 2 seconden na script load
}

// Ook luisteren naar storage changes voor real-time updates (maar debounced)
chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'sync' && changes.lastClickedLink) {
        console.log('Storage changed, new link detected:', changes.lastClickedLink.newValue);
        debouncedHandleLastClickedLink();
    }
});

// Observer voor dynamische content changes (maar veel minder agressief)
const observer = new MutationObserver((mutations) => {
    // Alleen checken bij significante changes, niet bij elke kleine wijziging
    const hasSignificantChanges = mutations.some(mutation => 
        mutation.type === 'childList' && 
        mutation.addedNodes.length > 0 &&
        Array.from(mutation.addedNodes).some(node => 
            node.nodeType === Node.ELEMENT_NODE && 
            (node.tagName === 'FORM' || node.tagName === 'INPUT' || node.tagName === 'BUTTON')
        )
    );
    
    if (hasSignificantChanges) {
        console.log('Significant DOM changes detected, checking for links');
        debouncedHandleLastClickedLink();
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
