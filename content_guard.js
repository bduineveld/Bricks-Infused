/////////////////////////////// UPDATE-BEVEILIGING //////////////////////////////////////////////////////////////////
// Eerste content script (isolated world). Na een update van de extensie koppelt de browser de oude
// content scripts los, maar laat ze in open tabbladen draaien. background.js zet dan de nieuwe scripts
// opnieuw in die tabbladen (zonder verversen). Deze guard zorgt dat een losgekoppelde (oude) instantie
// zichzelf stillegt, zodat oud en nieuw niet tegelijk knoppen en kaarten tekenen.
//
// Werkt door MutationObserver en setInterval in deze isolated world te omhullen: zodra
// chrome.runtime.id weg is (extensiecontext ongeldig), stoppen observers en intervallen van deze
// instantie bij hun eerstvolgende tik.

(function bricksInfusedGuard() {
    'use strict';

    function actief() {
        try {
            return !!(chrome && chrome.runtime && chrome.runtime.id);
        } catch (e) {
            return false;
        }
    }
    window.infused_actief = actief;

    const OrigMO = window.MutationObserver;
    window.MutationObserver = class InfusedMutationObserver extends OrigMO {
        constructor(callback) {
            super(function (mutaties, observer) {
                if (!actief()) {
                    observer.disconnect();
                    return;
                }
                return callback.call(this, mutaties, observer);
            });
        }
    };

    const origSetInterval = window.setInterval.bind(window);
    const origClearInterval = window.clearInterval.bind(window);
    window.setInterval = function (fn, ms) {
        const rest = Array.prototype.slice.call(arguments, 2);
        const id = origSetInterval(function () {
            if (!actief()) {
                origClearInterval(id);
                return;
            }
            return typeof fn === 'function' ? fn.apply(this, rest) : undefined;
        }, ms);
        return id;
    };
})();
