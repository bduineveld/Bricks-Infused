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
    // Tekst en aria-label los testen: Juvoly zet er verschillende teksten in
    // ("Consult starten" / "Een nieuw consult starten"), samengeplakt matcht ^…$ nooit.
    if (!re.test(juvoly_clean(b.innerText)) && !re.test(juvoly_clean(b.getAttribute('aria-label')))) return false;
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

/** Na herladen van een oud consult: "Geen ontmoeting gevonden" op een /medical-notes/-URL. */
function juvoly_isSessionGone() {
  return [...document.querySelectorAll('h1, h2, h3')].some((h) =>
    juvoly_isVisible(h) && /Geen ontmoeting gevonden/i.test(juvoly_clean(h.textContent)));
}

function juvoly_phase() {
  if (juvoly_isLoginPage()) return 'login';
  // Geen verslag om op te wachten; "Nieuw consult" staat er wel, dus behandelen als startpagina
  if (juvoly_isSessionGone()) return 'ready';
  if (juvoly_isNotesPage()) return 'notes';
  if (juvoly_isRecording()) return 'recording';
  if (juvoly_isPaused()) return 'paused';
  if (juvoly_hasStartConsult()) return 'ready';
  // Interactie-URL zonder duidelijke knoppen: nog aan het laden
  if (/\/interactions\//i.test(location.pathname)) return 'loading';
  return 'unknown';
}

const JUVOLY_SOEP_LABELS = { subjectief: 'S', objectief: 'O', evaluatie: 'E', plan: 'P' };

/**
 * Verslagpagina (2026-10): <li class="group/row"> met <label> (Subjectief, …) en
 * [class*="group/content"] met een contenteditable tekstblok. Labels bevatten soft hyphens.
 */
function juvoly_readSoepFromRows() {
  const out = { S: '', O: '', E: '', P: '' };
  const rows = [...document.querySelectorAll('li')].filter((li) =>
    li.querySelector(':scope > label') && li.querySelector(':scope > [class*="group/content"]'));
  rows.forEach((li) => {
    const key = JUVOLY_SOEP_LABELS[juvoly_clean(li.querySelector(':scope > label').textContent).toLowerCase()];
    if (!key || out[key]) return;
    const content = li.querySelector(':scope > [class*="group/content"]');
    const box = content.querySelector('[contenteditable="true"]') || content.querySelector('.w-full.grow') || content;
    out[key] = String(box.innerText || '').replace(/\u00ad/g, '').trim();
  });
  return out;
}

function juvoly_readSoepFromTextareas() {
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

function juvoly_readSoepFromDom() {
  const rows = juvoly_readSoepFromRows();
  if (juvoly_hasSoepText(rows)) return rows;
  return juvoly_readSoepFromTextareas();
}

/**
 * Verslag-tabbladen naast "Context" en "Transcript" (één bij een gewoon consult,
 * meerdere na opsplitsen). De codeer-tabs (Voorgesteld/Vastgezet) zitten elders.
 */
function juvoly_noteTabs() {
  const tabs = [...document.querySelectorAll('[role="tab"]')].filter(juvoly_isVisible);
  const transcript = tabs.find((t) => juvoly_clean(t.innerText) === 'Transcript');
  if (!transcript) return [];
  return tabs.filter((t) => t.parentElement === transcript.parentElement
    && !/^(Context|Transcript)$/i.test(juvoly_clean(t.innerText)));
}

function juvoly_listNotes() {
  const notes = juvoly_noteTabs().map((t) => ({
    name: juvoly_clean(t.innerText),
    selected: t.getAttribute('aria-selected') === 'true'
  }));
  return { ok: notes.length > 0, notes, error: notes.length ? undefined : 'Geen verslagen gevonden in Juvoly.' };
}

async function juvoly_selectNote(index) {
  const tab = juvoly_noteTabs()[index];
  if (!tab) return { ok: false, error: `Verslag ${index + 1} niet gevonden in Juvoly.`, status: juvoly_status() };
  if (tab.getAttribute('aria-selected') !== 'true') {
    juvoly_click(tab);
    await juvoly_waitFor(() => {
      const t = juvoly_noteTabs()[index];
      return t && t.getAttribute('aria-selected') === 'true';
    }, 5000, 100);
    await juvoly_sleep(300);
  }
  await juvoly_waitFor(() => juvoly_isNotesReady() || juvoly_isSummaryFailed(), 30000, 300);
  return { ok: juvoly_isNotesReady(), error: juvoly_isNotesReady() ? undefined : 'Verslag is nog niet klaar.', status: juvoly_status() };
}

/** Juvoly-dialoog "Dit verslag opsplitsen" (meerdere onderwerpen in één consult). */
function juvoly_splitDialog() {
  return [...document.querySelectorAll('[role="dialog"]')].find((d) =>
    juvoly_isVisible(d) && [...d.querySelectorAll('h1, h2, h3')].some((h) => /opsplitsen/i.test(juvoly_clean(h.textContent)))) || null;
}

function juvoly_splitInputs(dialog) {
  // Inputs hebben geen type-attribuut; elk staat naast zijn label ("Verslag 1", …)
  return [...dialog.querySelectorAll('input')].filter((i) =>
    !i.disabled && (!i.type || i.type === 'text') && i.parentElement && i.parentElement.querySelector('label'));
}

function juvoly_splitInfo() {
  const dialog = juvoly_splitDialog();
  if (!dialog) return { ok: false, error: 'Geen opsplits-vraag open in Juvoly.' };
  const items = juvoly_splitInputs(dialog).map((input) => ({
    label: juvoly_clean(input.parentElement.querySelector('label').textContent),
    value: input.value || ''
  }));
  return { ok: true, items };
}

/** React-gestuurde input: native setter + input-event, anders negeert Juvoly de waarde. */
function juvoly_setInputValue(input, value) {
  const desc = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
  desc.set.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

/** Prullenbak (aria "Verwijderen") in de rij van een onderwerp; alleen aanwezig bij 3+ onderwerpen. */
function juvoly_splitDeleteButton(input) {
  let row = input;
  while (row.parentElement && row.parentElement.querySelectorAll('input').length === 1) row = row.parentElement;
  return row.querySelector('button[aria-label="Verwijderen"]');
}

async function juvoly_splitApply(values, mode, removed) {
  const dialog = juvoly_splitDialog();
  if (!dialog) return { ok: false, error: 'Geen opsplits-vraag open in Juvoly.', status: juvoly_status() };
  if (mode === 'confirm') {
    // Hoogste index eerst, zodat lagere indexen blijven kloppen
    const toRemove = [...new Set(removed || [])].filter((i) => Number.isInteger(i)).sort((a, b) => b - a);
    for (const idx of toRemove) {
      const before = juvoly_splitInputs(dialog);
      if (before.length <= 2 || !before[idx]) break;
      const del = juvoly_splitDeleteButton(before[idx]);
      if (!juvoly_click(del)) {
        return { ok: false, error: 'Onderwerp verwijderen in Juvoly mislukt.', status: juvoly_status() };
      }
      await juvoly_waitFor(() => juvoly_splitInputs(dialog).length < before.length, 3000, 100);
    }
    const inputs = juvoly_splitInputs(dialog);
    (values || []).forEach((v, i) => {
      if (inputs[i] && typeof v === 'string' && v.trim() && inputs[i].value !== v) juvoly_setInputValue(inputs[i], v.trim());
    });
    await juvoly_sleep(150);
  }
  const re = mode === 'confirm' ? /^Bevestigen$/i : /^Genereren zonder splitsen$/i;
  const btn = [...dialog.querySelectorAll('button')].find((b) => re.test(juvoly_clean(b.innerText)));
  if (!juvoly_click(btn)) return { ok: false, error: 'Knop in de opsplits-vraag niet gevonden.', status: juvoly_status() };
  await juvoly_waitFor(() => !juvoly_splitDialog(), 5000);
  return { ok: true, action: mode, status: juvoly_status() };
}

/** Te kort/onvoldoende consult: Juvoly toont dan "Verslag kon niet worden gegenereerd" (h2). */
function juvoly_isSummaryFailed() {
  if (!juvoly_isNotesPage()) return false;
  return [...document.querySelectorAll('h1, h2, h3')].some((h) =>
    juvoly_isVisible(h) && /Verslag kon niet worden gegenereerd/i.test(juvoly_clean(h.textContent)));
}

/**
 * Juvoly schrijft het verslag gestreamd; "Kopiëren"/"Aanpassen" zijn dan disabled
 * en "Verwerken..." staat aria-busy. Pas klaar als dat voorbij is.
 */
function juvoly_isNotesReady() {
  if (!juvoly_isNotesPage()) return false;
  if (juvoly_allButtons().some((b) => b.getAttribute('aria-busy') === 'true' && juvoly_isVisible(b))) return false;
  const kopieren = juvoly_btnByText(/^Kopiëren$/i);
  return !!kopieren && !kopieren.disabled;
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
  const splitPending = !!juvoly_splitDialog();
  const summaryFailed = phase === 'notes' && juvoly_isSummaryFailed();
  const notesReady = phase === 'notes' && !summaryFailed && juvoly_isNotesReady();
  const soep = notesReady ? juvoly_readSoepFromDom() : null;
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
    notesReady,
    // Juvoly is aan het verwerken ("Verwerken...") of nog aan het schrijven
    processing: juvoly_allButtons().some((b) => b.getAttribute('aria-busy') === 'true' && juvoly_isVisible(b))
      || (phase === 'notes' && !notesReady && !summaryFailed && !splitPending),
    summaryFailed,
    splitPending,
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

async function juvoly_waitForSoep(timeoutMs = 90000) {
  await juvoly_waitFor(() => juvoly_isNotesReady() || juvoly_isSummaryFailed() || !!juvoly_splitDialog(), timeoutMs, 400);
  return juvoly_isNotesReady() ? juvoly_readSoepFromDom() : { S: '', O: '', E: '', P: '' };
}

/** Uitkomst na wachten op Juvoly: klaar, opsplits-vraag of mislukt. */
async function juvoly_summaryResult(action) {
  const soep = await juvoly_waitForSoep();
  if (juvoly_splitDialog()) {
    return {
      ok: false,
      splitPending: true,
      soep,
      status: juvoly_status(),
      error: 'Juvoly vraagt of het verslag opgesplitst moet worden.'
    };
  }
  const ready = juvoly_isNotesReady();
  const failed = juvoly_isSummaryFailed();
  return {
    ok: ready,
    action,
    soep,
    summaryFailed: failed,
    status: juvoly_status(),
    error: ready ? undefined : failed
      ? 'Verslag kon niet worden gegenereerd (consult te kort?). Zie het Juvoly-tabblad.'
      : 'Samenvatting niet klaar binnen de wachttijd.'
  };
}

async function juvoly_summarize() {
  if (juvoly_isNotesPage()) {
    return juvoly_summaryResult('already-notes');
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

  return juvoly_summaryResult('summarized');
}

async function juvoly_getSoep() {
  if (juvoly_isNotesReady()) {
    return { ok: true, soep: juvoly_readSoepFromDom(), url: location.href, status: juvoly_status() };
  }
  if (juvoly_isNotesPage()) {
    return { ok: false, error: 'Juvoly is de samenvatting nog aan het schrijven.', soep: { S: '', O: '', E: '', P: '' }, status: juvoly_status() };
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
        case 'juvoly.listNotes':
          sendResponse(juvoly_listNotes());
          break;
        case 'juvoly.selectNote':
          sendResponse(await juvoly_selectNote(message.index));
          break;
        case 'juvoly.splitInfo':
          sendResponse(juvoly_splitInfo());
          break;
        case 'juvoly.splitApply':
          sendResponse(await juvoly_splitApply(message.values, message.mode, message.removed));
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
