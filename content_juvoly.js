/////////////////////////////// JUVOLY PAGE (tandem / app) //////////////////////////////////////////
 // Content script op *.juvoly.nl. Status + acties voor Bricks Infused.
 // Fasen: login → ready (Consult starten) → recording → paused → notes (SOEP).

const JUVOLY_SOURCE = 'bricks-infused-juvoly';

function juvoly_clean(s) {
  return String(s || '')
    .replace(/\u00ad/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function juvoly_allButtons() {
  return [...document.querySelectorAll('button, [role="button"], a')];
}

function juvoly_btnByText(re, { visibleOnly = true } = {}) {
  return juvoly_allButtons().find((b) => {
    const t = juvoly_clean(b.innerText) + ' ' + juvoly_clean(b.getAttribute('aria-label'));
    if (!re.test(t)) return false;
    if (visibleOnly && b.offsetParent === null && getComputedStyle(b).display === 'none') return false;
    if (visibleOnly) {
      const r = b.getBoundingClientRect();
      if (r.width < 1 && r.height < 1) return false;
    }
    return true;
  });
}

function juvoly_btnByAria(re, { visibleOnly = false } = {}) {
  return juvoly_allButtons().find((b) => {
    const t = juvoly_clean(b.getAttribute('aria-label') || b.innerText);
    if (!re.test(t)) return false;
    if (visibleOnly) {
      const r = b.getBoundingClientRect();
      if (r.width < 1 && r.height < 1) return false;
    }
    return true;
  });
}

function juvoly_click(btn) {
  if (!btn) return false;
  try {
    btn.click();
    return true;
  } catch (_) {
    return false;
  }
}

function juvoly_isLoginPage() {
  if (/\/login/i.test(location.pathname)) return true;
  const pass = document.querySelector('input[type="password"]');
  if (pass && pass.offsetParent !== null) return true;
  const body = juvoly_clean(document.body?.innerText || '').slice(0, 500);
  return /inloggen|log in|wachtwoord/i.test(body) && !!pass;
}

function juvoly_hasStartConsult() {
  return !!(
    juvoly_btnByText(/^(Consult starten|Een nieuw consult starten)$/i)
    || juvoly_btnByText(/^Nieuw consult$/i)
    || juvoly_btnByText(/^Nieuw starten$/i)
  );
}

function juvoly_isVisible(el) {
  if (!el) return false;
  const r = el.getBoundingClientRect();
  return r.width >= 1 || r.height >= 1;
}

function juvoly_pauseButton() {
  return juvoly_btnByAria(/^Pauze$/i, { visibleOnly: true });
}

/**
 * Hervat-knop na pauze. Juvoly's knoptekst varieert ("Juvoly hervatten", "Hervatten", …),
 * dus niet-verankerd matchen; laatste redmiddel is de klikbare knop rond de opname-orb
 * (svg met gradient op --recording-blur-color-*).
 */
function juvoly_resumeButton() {
  const byLabel = juvoly_allButtons().find((b) => {
    if (!juvoly_isVisible(b)) return false;
    const t = [b.innerText, b.getAttribute('aria-label'), b.getAttribute('title')]
      .map(juvoly_clean).join(' ');
    return /hervat|resume|doorgaan/i.test(t) && !/pauze/i.test(t);
  });
  if (byLabel) return byLabel;
  if (juvoly_pauseButton()) return null;
  const stop = document.querySelector('stop[stop-color*="--recording-blur-color"]');
  const orbButton = stop && stop.closest('button, [role="button"]');
  return juvoly_isVisible(orbButton) ? orbButton : null;
}

function juvoly_isRecording() {
  if (juvoly_pauseButton()) return true;
  return /\/encounter\/?$/i.test(location.pathname)
    && /Luisteren/i.test(document.body?.innerText || '')
    && !juvoly_resumeButton();
}

function juvoly_isPaused() {
  if (juvoly_pauseButton()) return false;
  if (juvoly_resumeButton()) return true;
  return /\/encounter\/?$/i.test(location.pathname)
    && /gepauzeerd|pauze/i.test(document.body?.innerText || '');
}

function juvoly_isNotesPage() {
  return /\/medical-notes\//i.test(location.pathname)
    || !!document.querySelector('textarea.note-entry-row, textarea[aria-label="Invoerinhoud"]');
}

function juvoly_phase() {
  if (juvoly_isLoginPage()) return 'login';
  if (juvoly_isNotesPage()) return 'notes';
  if (juvoly_isRecording()) return 'recording';
  if (juvoly_isPaused()) return 'paused';
  if (juvoly_hasStartConsult()) return 'ready';
  // Interactie-URL zonder duidelijke knoppen: nog aan het laden
  if (/\/interactions\//i.test(location.pathname)) return 'loading';
  return 'unknown';
}

function juvoly_readSoepFromDom() {
  const labels = ['Subjectief', 'Objectief', 'Evaluatie', 'Plan'];
  const keys = ['S', 'O', 'E', 'P'];
  const out = { S: '', O: '', E: '', P: '' };

  const rows = [...document.querySelectorAll('li, [class*="note-entry"], [class*="group/row"]')];
  for (let i = 0; i < labels.length; i++) {
    const lab = labels[i];
    const row = rows.find((el) => {
      const t = juvoly_clean(el.innerText);
      return new RegExp('^' + lab, 'i').test(t) && el.querySelector('textarea');
    });
    if (row) {
      const ta = row.querySelector('textarea.note-entry-row, textarea[aria-label="Invoerinhoud"], textarea');
      if (ta) out[keys[i]] = (ta.value || '').trim();
    }
  }

  if (!out.S && !out.O && !out.E && !out.P) {
    const tas = [...document.querySelectorAll('textarea.note-entry-row, textarea[aria-label="Invoerinhoud"]')];
    if (tas.length >= 4) {
      keys.forEach((k, i) => { out[k] = (tas[i].value || '').trim(); });
    }
  }
  return out;
}

function juvoly_hasSoepText(soep) {
  return !!(soep && (soep.S || soep.O || soep.E || soep.P));
}

function juvoly_sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function juvoly_waitFor(predicate, timeoutMs = 20000, step = 300) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return true;
    await juvoly_sleep(step);
  }
  return predicate();
}

function juvoly_status() {
  const phase = juvoly_phase();
  const soep = phase === 'notes' ? juvoly_readSoepFromDom() : null;
  return {
    ok: true,
    url: location.href,
    title: document.title,
    phase,
    loggedIn: phase !== 'login',
    ready: phase === 'ready' || phase === 'recording' || phase === 'paused' || phase === 'notes',
    recording: phase === 'recording',
    paused: phase === 'paused',
    notes: phase === 'notes',
    canStart: juvoly_hasStartConsult(),
    canPause: !!juvoly_btnByAria(/^Pauze$/i, { visibleOnly: true }),
    canResume: !!juvoly_resumeButton(),
    canSummarize: !!(juvoly_btnByText(/^Samenvatting maken$/i)
      || [...document.querySelectorAll('button')].some((b) =>
        /Beëindigen en verslag maken/i.test(juvoly_clean(b.innerText)))),
    soep,
    hasSoep: juvoly_hasSoepText(soep)
  };
}

/** Zorg dat we op een opname-klare home zitten (niet automatisch starten). */
async function juvoly_ensureReady() {
  const st = juvoly_status();
  if (st.phase === 'login') {
    return {
      ok: false,
      error: 'Niet ingelogd in Juvoly. Log in in het Juvoly-tabblad en probeer opnieuw.',
      status: st
    };
  }
  if (st.phase === 'ready' || st.phase === 'recording' || st.phase === 'paused' || st.phase === 'notes') {
    return { ok: true, status: st };
  }
  // Wacht kort op laden
  await juvoly_waitFor(() => {
    const p = juvoly_phase();
    return p === 'ready' || p === 'recording' || p === 'paused' || p === 'notes' || p === 'login';
  }, 12000);
  const again = juvoly_status();
  if (again.phase === 'login') {
    return {
      ok: false,
      error: 'Niet ingelogd in Juvoly. Log in in het Juvoly-tabblad.',
      status: again
    };
  }
  if (again.phase === 'ready' || again.phase === 'recording' || again.phase === 'paused' || again.phase === 'notes') {
    return { ok: true, status: again };
  }
  return {
    ok: false,
    error: 'Juvoly is geopend, maar nog niet klaar om op te nemen. Ga naar de startpagina (Consult starten).',
    status: again
  };
}

/** Start een nieuw consult / opname. */
async function juvoly_startRecording() {
  let st = juvoly_status();
  if (st.phase === 'login') {
    return { ok: false, error: 'Niet ingelogd in Juvoly.', status: st };
  }
  if (st.phase === 'recording') {
    return { ok: true, action: 'already-recording', status: st };
  }
  if (st.phase === 'paused') {
    // Gepauzeerd consult nooit vervangen door een nieuw consult
    return juvoly_resume();
  }
  const findStart = () => juvoly_btnByText(/^(Consult starten|Een nieuw consult starten)$/i)
    || juvoly_btnByText(/^Nieuw starten$/i);
  // Na samenvatten (verslagpagina) staat er alleen "Nieuw consult" (split-knop linksboven);
  // niet afhankelijk van phase === 'notes', want de verslag-URL/layout kan wijzigen.
  let start = findStart();
  if (!start) {
    const nieuw = juvoly_btnByText(/^Nieuw consult$/i);
    if (juvoly_click(nieuw)) {
      await juvoly_waitFor(() => {
        const p = juvoly_phase();
        return p === 'recording' || p === 'paused' || !!findStart();
      }, 12000);
      st = juvoly_status();
      if (st.phase === 'recording' || st.phase === 'paused') {
        return { ok: true, action: 'started', status: st };
      }
      start = findStart();
    }
  }
  if (!start) {
    return {
      ok: false,
      error: 'Geen “Consult starten” of “Nieuw consult” gevonden. Open de Juvoly-startpagina.',
      status: juvoly_status()
    };
  }
  juvoly_click(start);
  await juvoly_waitFor(() => juvoly_phase() === 'recording' || juvoly_phase() === 'paused', 20000);
  st = juvoly_status();
  if (st.phase === 'recording' || st.phase === 'paused') {
    return { ok: true, action: 'started', status: st };
  }
  return {
    ok: false,
    error: 'Consult starten lukte niet (of microfoon-toestemming nodig in Juvoly-tab).',
    status: st
  };
}

function juvoly_pause() {
  const btn = juvoly_btnByAria(/^Pauze$/i, { visibleOnly: true })
    || juvoly_btnByAria(/^Pauze$/i);
  if (!juvoly_click(btn)) {
    return { ok: false, error: 'Geen pauzeknop gevonden', status: juvoly_status() };
  }
  return { ok: true, action: 'pause', status: juvoly_status() };
}

async function juvoly_resume() {
  if (!juvoly_click(juvoly_resumeButton())) {
    return { ok: false, error: 'Geen hervat-knop gevonden in Juvoly. Klik in het Juvoly-tabblad op hervatten.', status: juvoly_status() };
  }
  await juvoly_waitFor(() => juvoly_phase() === 'recording', 8000);
  return { ok: true, action: 'resume', status: juvoly_status() };
}

async function juvoly_waitForSoep(timeoutMs = 45000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (juvoly_isNotesPage()) {
      const soep = juvoly_readSoepFromDom();
      if (juvoly_hasSoepText(soep) || Date.now() - start > 6000) return soep;
    }
    await juvoly_sleep(400);
  }
  return juvoly_readSoepFromDom();
}

async function juvoly_summarize() {
  if (juvoly_isNotesPage()) {
    return { ok: true, action: 'already-notes', soep: juvoly_readSoepFromDom(), status: juvoly_status() };
  }

  const summarize = juvoly_btnByText(/^Samenvatting maken$/i);
  const end = [...document.querySelectorAll('button')].find((b) =>
    /Beëindigen en verslag maken/i.test(juvoly_clean(b.innerText)));

  if (summarize) {
    juvoly_click(summarize);
  } else if (end) {
    end.click();
  } else {
    return {
      ok: false,
      error: 'Geen “Samenvatting maken” gevonden. Start eerst een opname.',
      status: juvoly_status()
    };
  }

  const soep = await juvoly_waitForSoep();
  return {
    ok: juvoly_isNotesPage() || juvoly_hasSoepText(soep),
    action: 'summarized',
    soep,
    status: juvoly_status(),
    error: juvoly_isNotesPage() || juvoly_hasSoepText(soep)
      ? undefined
      : 'Samenvatting niet ontvangen binnen de wachttijd.'
  };
}

async function juvoly_getSoep() {
  if (juvoly_isNotesPage()) {
    return { ok: true, soep: juvoly_readSoepFromDom(), url: location.href, status: juvoly_status() };
  }
  // Niet automatisch samenvatten bij get — Bricks triggert summarize apart
  return {
    ok: false,
    error: 'Nog geen verslag. Klik eerst op Samenvatten.',
    soep: { S: '', O: '', E: '', P: '' },
    status: juvoly_status()
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.source !== JUVOLY_SOURCE) return;

  (async () => {
    try {
      switch (message.type) {
        case 'juvoly.status':
          sendResponse(juvoly_status());
          break;
        case 'juvoly.ensureReady':
          sendResponse(await juvoly_ensureReady());
          break;
        case 'juvoly.start':
          sendResponse(await juvoly_startRecording());
          break;
        case 'juvoly.pause':
          sendResponse(juvoly_pause());
          break;
        case 'juvoly.resume':
          sendResponse(await juvoly_resume());
          break;
        case 'juvoly.summarize':
          sendResponse(await juvoly_summarize());
          break;
        case 'juvoly.getSoep':
          sendResponse(await juvoly_getSoep());
          break;
        case 'juvoly.stop':
          // legacy: beëindigen
          {
            const end = [...document.querySelectorAll('button')].find((b) =>
              /Beëindigen en verslag maken/i.test(juvoly_clean(b.innerText)));
            if (end) {
              end.click();
              sendResponse({ ok: true, action: 'end', status: juvoly_status() });
            } else {
              sendResponse(juvoly_pause());
            }
          }
          break;
        default:
          sendResponse({ ok: false, error: 'unknown-type' });
      }
    } catch (err) {
      sendResponse({ ok: false, error: String(err && err.message || err) });
    }
  })();

  return true;
});
