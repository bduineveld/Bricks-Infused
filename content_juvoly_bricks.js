/////////////////////////////// JUVOLY ↔ BRICKS /////////////////////////////////////////////////////
 // Horizontale knoppen in SOEP-toolbar:
 //   [Juvoly] [Opnemen|Pauze] [Samenvatten] [Overnemen]
 // Juvoly draait in aparte tab. Vereist juvolyKnop. Geladen ná content.js.

const JUVOLY_BG = 'bricks-infused-juvoly';
const JUVOLY_ATTR = 'data-bricks-infused-juvoly';

let juvolyModalEl = null;
let juvolyBusy = false;
let juvolyPollTimer = null;
let juvolyLastStatus = null; // { phase, hasSoep, ... } of null als geen tab
let juvolySuppressObserver = false;
let juvolyObserverTimer = null;

function juvoly_activePatientId() {
  const m = (location.pathname || '').match(/\/s\/consult\/(\d+)/i)
    || (location.pathname || '').match(/\/consult\/(\d+)/i);
  return m ? m[1] : null;
}

function juvoly_send(type, extra = {}) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ source: JUVOLY_BG, type, ...extra }, (resp) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }
      resolve(resp || { ok: false, error: 'no-response' });
    });
  });
}

function juvoly_toast(message, kind = 'info') {
  const colors = {
    info: { bg: '#ebf8ff', border: '#3182ce', text: '#2c5282' },
    warn: { bg: '#fffaf0', border: '#dd6b20', text: '#7b341e' },
    error: { bg: '#fff5f5', border: '#e53e3e', text: '#9b2c2c' },
    ok: { bg: '#f0fff4', border: '#38a169', text: '#22543d' }
  };
  const c = colors[kind] || colors.info;
  const el = document.createElement('div');
  el.style.cssText = `position:fixed;bottom:24px;right:24px;z-index:2147483647;max-width:380px;
    background:${c.bg};border-left:4px solid ${c.border};color:${c.text};padding:12px 14px;
    border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,0.15);font:13px/1.4 -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;`;
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3800);
}

function juvoly_closeModal() {
  if (juvolyModalEl) {
    juvolyModalEl.remove();
    juvolyModalEl = null;
  }
  document.removeEventListener('keydown', juvoly_onModalKey);
}

function juvoly_onModalKey(e) {
  if (e.key === 'Escape') juvoly_closeModal();
}

function juvoly_setTextareaValue(textarea, value) {
  if (!textarea) return false;
  const proto = window.HTMLTextAreaElement.prototype;
  const desc = Object.getOwnPropertyDescriptor(proto, 'value');
  if (desc && desc.set) desc.set.call(textarea, value);
  else textarea.value = value;
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
  textarea.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}

function juvoly_findSoepTextarea(letter, patientId) {
  const letterUp = String(letter || '').toUpperCase();
  let editors = [...document.querySelectorAll(`.intelli-editor[data-soep="${letterUp}"]`)];
  if (patientId) {
    const scoped = editors.filter((el) => el.getAttribute('data-patientid') === String(patientId));
    if (scoped.length) editors = scoped;
  }
  const visible = editors.find((el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  });
  const editor = visible || editors[0];
  return editor ? editor.querySelector('textarea') : null;
}

function juvoly_applySoep(soep, included) {
  const patientId = juvoly_activePatientId();
  const applied = [];
  ['S', 'O', 'E', 'P'].forEach((k) => {
    if (!included[k]) return;
    const text = (soep[k] || '').trim();
    if (!text) return;
    const ta = juvoly_findSoepTextarea(k, patientId);
    if (!ta) return;
    const existing = (ta.value || '').trim();
    const next = existing ? `${existing}\n${text}` : text;
    if (juvoly_setTextareaValue(ta, next)) applied.push(k);
  });
  return applied;
}

function juvoly_showReviewModal(soep) {
  juvoly_closeModal();

  const state = {};
  ['S', 'O', 'E', 'P'].forEach((k) => {
    const text = soep[k] || '';
    state[k] = { text, include: !!(text || '').trim() };
  });

  const labels = {
    S: 'Subjectief (S)',
    O: 'Objectief (O)',
    E: 'Evaluatie (E)',
    P: 'Plan (P)'
  };

  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:2147483646;display:flex;align-items:center;justify-content:center;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;padding:16px;';
  overlay.addEventListener('click', (ev) => { if (ev.target === overlay) juvoly_closeModal(); });

  const modal = document.createElement('div');
  modal.style.cssText = 'background:#fff;border-radius:12px;box-shadow:0 20px 60px rgba(0,0,0,0.3);max-width:640px;width:100%;max-height:90vh;overflow:auto;color:#2d3748;';
  overlay.appendChild(modal);

  const header = document.createElement('div');
  header.style.cssText = 'display:flex;align-items:center;gap:12px;padding:16px 20px;border-bottom:1px solid #e2e8f0;position:sticky;top:0;background:#fff;z-index:1;';
  header.innerHTML = `
    <div style="font-size:1.15em;font-weight:600;flex:1;color:#c05600;">Juvoly → SOEP</div>
    <button type="button" class="juvoly-modal-close" aria-label="Sluiten" style="background:transparent;border:none;font-size:22px;cursor:pointer;color:#718096;line-height:1;">&times;</button>
  `;
  header.querySelector('.juvoly-modal-close').addEventListener('click', juvoly_closeModal);
  modal.appendChild(header);

  const hint = document.createElement('div');
  hint.style.cssText = 'padding:10px 20px;font-size:12px;color:#718096;border-bottom:1px solid #edf2f7;';
  hint.textContent = 'Pas tekst aan per blok. Met × neemt u dat blok niet over.';
  modal.appendChild(hint);

  const body = document.createElement('div');
  body.style.cssText = 'padding:12px 20px 8px;';
  modal.appendChild(body);

  ['S', 'O', 'E', 'P'].forEach((k) => {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'margin-bottom:12px;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;';
    if (!state[k].include) wrap.style.opacity = '0.45';

    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:8px 10px;background:#f7fafc;border-bottom:1px solid #edf2f7;';
    row.innerHTML = `
      <div style="font-weight:600;font-size:13px;flex:1;">${labels[k]}</div>
      <span class="juvoly-skipped" style="font-size:11px;color:#c53030;display:${state[k].include ? 'none' : 'inline'};">overgeslagen</span>
      <button type="button" class="juvoly-skip" title="Dit blok niet overnemen" aria-label="Blok overslaan"
        style="background:#fff;border:1px solid #cbd5e0;border-radius:6px;width:28px;height:28px;cursor:pointer;color:#718096;font-size:16px;line-height:1;">&times;</button>
    `;
    wrap.appendChild(row);

    const ta = document.createElement('textarea');
    ta.rows = 3;
    ta.value = state[k].text;
    ta.disabled = !state[k].include;
    ta.style.cssText = 'width:100%;box-sizing:border-box;border:none;padding:10px 12px;font:13px/1.45 inherit;resize:vertical;outline:none;';
    ta.addEventListener('input', () => { state[k].text = ta.value; });
    wrap.appendChild(ta);

    row.querySelector('.juvoly-skip').addEventListener('click', () => {
      state[k].include = !state[k].include;
      ta.disabled = !state[k].include;
      wrap.style.opacity = state[k].include ? '1' : '0.45';
      row.querySelector('.juvoly-skipped').style.display = state[k].include ? 'none' : 'inline';
    });

    body.appendChild(wrap);
  });

  const footer = document.createElement('div');
  footer.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;padding:14px 20px;border-top:1px solid #e2e8f0;background:#f7fafc;position:sticky;bottom:0;';
  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.textContent = 'Annuleren';
  cancelBtn.style.cssText = 'border:none;background:transparent;color:#718096;padding:8px 14px;font-size:13px;cursor:pointer;';
  cancelBtn.addEventListener('click', juvoly_closeModal);

  const applyBtn = document.createElement('button');
  applyBtn.type = 'button';
  applyBtn.textContent = 'Overnemen in SOEP';
  applyBtn.style.cssText = 'border:none;background:#dd6b20;color:#fff;padding:8px 16px;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer;';
  applyBtn.addEventListener('click', () => {
    const payload = {};
    const included = {};
    ['S', 'O', 'E', 'P'].forEach((k) => {
      payload[k] = state[k].text;
      included[k] = !!state[k].include && !!(state[k].text || '').trim();
    });
    if (!Object.values(included).some(Boolean)) {
      juvoly_toast('Geen blokken geselecteerd.', 'warn');
      return;
    }
    const applied = juvoly_applySoep(payload, included);
    juvoly_closeModal();
    juvoly_toast(applied.length ? `Overgenomen: ${applied.join(', ')}` : 'SOEP-velden niet gevonden.', applied.length ? 'ok' : 'error');
  });

  footer.appendChild(cancelBtn);
  footer.appendChild(applyBtn);
  modal.appendChild(footer);
  document.body.appendChild(overlay);
  juvolyModalEl = overlay;
  document.addEventListener('keydown', juvoly_onModalKey);
}

// --- Toolbar UI ---------------------------------------------------------------

let juvolyControlsUnlocked = false;

function juvoly_btnStyle(kind) {
  const base = 'display:inline-flex;align-items:center;justify-content:center;height:28px;width:28px;padding:0;border-radius:6px;font-size:13px;font-weight:700;border:1px solid transparent;cursor:pointer;margin-left:4px;line-height:1;flex-shrink:0;';
  const styles = {
    juvoly: 'display:inline-flex;align-items:center;justify-content:center;height:28px;padding:0 10px;border-radius:6px;font-size:11px;font-weight:700;letter-spacing:0.02em;border:1px solid #c05600;cursor:pointer;white-space:nowrap;margin-left:6px;background:#dd6b20;color:#fff;',
    juvolyReady: 'display:inline-flex;align-items:center;justify-content:center;height:28px;padding:0 10px;border-radius:6px;font-size:11px;font-weight:700;letter-spacing:0.02em;border:1px solid #9c4221;cursor:pointer;white-space:nowrap;margin-left:6px;background:#c05600;color:#fff;',
    record: base + 'background:#e53e3e;color:#fff;border-color:#c53030;',
    pause: base + 'background:#744210;color:#fefcbf;border-color:#975a16;',
    summarize: base + 'background:#2b6cb0;color:#fff;border-color:#2c5282;',
    import: base + 'background:#276749;color:#fff;border-color:#22543d;',
    muted: base + 'background:#edf2f7;color:#a0aec0;border-color:#e2e8f0;cursor:default;'
  };
  return styles[kind] || styles.muted;
}

function juvoly_icon(name) {
  // Compacte unicode-iconen (geen externe font nodig)
  const map = {
    record: '●',
    pause: '⏸',
    resume: '▶',
    summarize: '☰',
    import: '⇩'
  };
  return map[name] || '•';
}

function juvoly_getToolbarRoot() {
  return document.querySelector(`[${JUVOLY_ATTR}="bar"]`);
}

function juvoly_isUsablePhase(phase) {
  return phase === 'ready' || phase === 'recording' || phase === 'paused' || phase === 'notes';
}

function juvoly_paintToolbar() {
  const bar = juvoly_getToolbarRoot();
  if (!bar) return;

  const st = juvolyLastStatus;
  const phase = st && !st.noTab ? st.phase : null;
  const openBtn = bar.querySelector(`[${JUVOLY_ATTR}="open"]`);
  const controls = bar.querySelector(`[${JUVOLY_ATTR}="controls"]`);
  const recBtn = bar.querySelector(`[${JUVOLY_ATTR}="record"]`);
  const sumBtn = bar.querySelector(`[${JUVOLY_ATTR}="summarize"]`);
  const impBtn = bar.querySelector(`[${JUVOLY_ATTR}="import"]`);
  if (!openBtn || !controls || !recBtn || !sumBtn || !impBtn) return;

  const showControls = juvolyControlsUnlocked && juvoly_isUsablePhase(phase);

  juvolySuppressObserver = true;
  try {
    openBtn.disabled = !!juvolyBusy;
    openBtn.style.cssText = juvoly_btnStyle(showControls ? 'juvolyReady' : 'juvoly');
    openBtn.textContent = 'Juvoly';
    openBtn.title = showControls
      ? 'Naar Juvoly-tab'
      : 'Juvoly openen in nieuw tabblad';

    controls.style.display = showControls ? 'inline-flex' : 'none';

    if (!showControls) {
      recBtn.disabled = true;
      sumBtn.disabled = true;
      impBtn.disabled = true;
      return;
    }

    if (phase === 'recording') {
      recBtn.disabled = !!juvolyBusy;
      recBtn.style.cssText = juvoly_btnStyle('pause');
      recBtn.textContent = juvoly_icon('pause');
      recBtn.title = 'Pauze';
    } else if (phase === 'paused') {
      recBtn.disabled = !!juvolyBusy;
      recBtn.style.cssText = juvoly_btnStyle('record');
      recBtn.textContent = juvoly_icon('resume');
      recBtn.title = 'Verder opnemen';
    } else {
      recBtn.disabled = !!juvolyBusy;
      recBtn.style.cssText = juvoly_btnStyle(recBtn.disabled ? 'muted' : 'record');
      recBtn.textContent = juvoly_icon('record');
      recBtn.title = 'Opnemen';
    }

    const canSum = phase === 'recording' || phase === 'paused' || phase === 'notes';
    sumBtn.disabled = !!juvolyBusy || !canSum;
    sumBtn.style.cssText = juvoly_btnStyle(sumBtn.disabled ? 'muted' : 'summarize');
    sumBtn.textContent = juvoly_icon('summarize');
    sumBtn.title = 'Samenvatten';

    const canImport = phase === 'notes' || !!(st && st.hasSoep);
    impBtn.disabled = !!juvolyBusy || !canImport;
    impBtn.style.cssText = juvoly_btnStyle(impBtn.disabled ? 'muted' : 'import');
    impBtn.textContent = juvoly_icon('import');
    impBtn.title = 'Overnemen naar SOEP';
  } finally {
    void Promise.resolve().then(() => { juvolySuppressObserver = false; });
  }
}

async function juvoly_refreshStatus() {
  const resp = await juvoly_send('juvoly.status');
  if (!resp || !resp.ok) {
    juvolyLastStatus = { noTab: true, phase: null };
    if (juvolyControlsUnlocked) {
      // Tab weg → controls weer verbergen
      juvolyControlsUnlocked = false;
    }
  } else {
    juvolyLastStatus = resp.status || resp;
    if (juvolyLastStatus.phase === 'login') {
      juvolyControlsUnlocked = false;
    }
  }
  juvoly_paintToolbar();
}

function juvoly_startPolling() {
  if (juvolyPollTimer) return;
  juvoly_refreshStatus();
  juvolyPollTimer = setInterval(() => {
    if (document.hidden) return;
    juvoly_refreshStatus();
  }, 2000);
}

function juvoly_stopPolling() {
  if (juvolyPollTimer) {
    clearInterval(juvolyPollTimer);
    juvolyPollTimer = null;
  }
}

async function juvoly_onOpen() {
  if (juvolyBusy) return;
  juvolyBusy = true;
  juvoly_paintToolbar();
  try {
    // Als controls al open zijn: alleen naar Juvoly-tab springen
    if (juvolyControlsUnlocked && juvoly_isUsablePhase(juvolyLastStatus && juvolyLastStatus.phase)) {
      const resp = await juvoly_send('juvoly.openOrFocus', { ensureReady: false });
      if (!resp.ok) {
        juvoly_toast(resp.error || 'Kon Juvoly-tab niet openen.', 'error');
      }
      if (resp.status) juvolyLastStatus = resp.status;
      return;
    }

    const resp = await juvoly_send('juvoly.openOrFocus', { ensureReady: true });
    if (resp && resp.status) juvolyLastStatus = resp.status;
    else await juvoly_refreshStatus();

    const phase = juvolyLastStatus && juvolyLastStatus.phase;

    if (resp.needsLogin || phase === 'login') {
      juvolyControlsUnlocked = false;
      juvoly_toast('Log eerst in op Juvoly.', 'warn');
      juvoly_stopPolling();
      return;
    }

    if (!resp.ok) {
      juvolyControlsUnlocked = false;
      juvoly_toast(resp.error || 'Juvoly openen mislukt.', 'error');
      return;
    }

    if (juvoly_isUsablePhase(phase)) {
      juvolyControlsUnlocked = true;
      juvoly_startPolling();
      juvoly_toast(resp.created
        ? 'Juvoly geopend — controls zijn beschikbaar.'
        : 'Juvoly verbonden — controls zijn beschikbaar.', 'ok');
    } else {
      juvolyControlsUnlocked = false;
      juvoly_toast(resp.warning || 'Juvoly is geopend, maar nog niet klaar. Ga naar de startpagina of log in.', 'warn');
    }
  } catch (err) {
    juvoly_toast('Juvoly openen mislukt: ' + (err && err.message || err), 'error');
  } finally {
    juvolyBusy = false;
    juvoly_paintToolbar();
  }
}

async function juvoly_onRecord() {
  if (juvolyBusy || !juvolyControlsUnlocked) return;
  const phase = juvolyLastStatus && juvolyLastStatus.phase;
  juvolyBusy = true;
  juvoly_paintToolbar();
  try {
    if (phase === 'recording') {
      const resp = await juvoly_send('juvoly.pause');
      if (!resp.ok) juvoly_toast(resp.error || 'Pauzeren mislukt.', 'error');
      else juvoly_toast('Opname gepauzeerd.', 'ok');
      juvolyLastStatus = resp.status || juvolyLastStatus;
    } else if (phase === 'paused') {
      const resp = await juvoly_send('juvoly.resume');
      if (!resp.ok) {
        juvoly_toast(resp.error || 'Hervatten mislukt.', 'error');
        juvolyLastStatus = resp.status || juvolyLastStatus;
      } else {
        juvoly_toast('Opname hervat.', 'ok');
        juvolyLastStatus = resp.status || juvolyLastStatus;
      }
    } else {
      const resp = await juvoly_send('juvoly.start');
      if (!resp.ok) juvoly_toast(resp.error || 'Opname starten mislukt.', 'error');
      else juvoly_toast('Opname gestart in Juvoly.', 'ok');
      juvolyLastStatus = resp.status || juvolyLastStatus;
    }
  } finally {
    juvolyBusy = false;
    await juvoly_refreshStatus();
  }
}

async function juvoly_onSummarize() {
  if (juvolyBusy || !juvolyControlsUnlocked) return;
  juvolyBusy = true;
  juvoly_paintToolbar();
  juvoly_toast('Samenvatting maken…', 'info');
  try {
    const resp = await juvoly_send('juvoly.summarize');
    if (!resp.ok) {
      juvoly_toast(resp.error || 'Samenvatten mislukt.', 'error');
    } else {
      juvoly_toast('Samenvatting klaar — u kunt overnemen.', 'ok');
      juvolyLastStatus = resp.status || juvolyLastStatus;
      if (resp.soep) {
        juvolyLastStatus = { ...(juvolyLastStatus || {}), phase: 'notes', hasSoep: true, soep: resp.soep };
      }
    }
  } finally {
    juvolyBusy = false;
    await juvoly_refreshStatus();
  }
}

async function juvoly_onImport() {
  if (juvolyBusy || !juvolyControlsUnlocked) return;
  juvolyBusy = true;
  juvoly_paintToolbar();
  try {
    let soep = juvolyLastStatus && juvolyLastStatus.soep;
    if (!soep || !(soep.S || soep.O || soep.E || soep.P)) {
      const resp = await juvoly_send('juvoly.getSoep');
      if (!resp.ok) {
        juvoly_toast(resp.error || 'Nog geen verslag om over te nemen.', 'warn');
        return;
      }
      soep = resp.soep || { S: '', O: '', E: '', P: '' };
    }
    juvoly_showReviewModal(soep);
  } finally {
    juvolyBusy = false;
    juvoly_paintToolbar();
  }
}

function juvoly_addToolbarControls() {
  const tops = document.querySelectorAll('.soep-content-top .flex.items-center');
  let insertedThisCall = 0;
  tops.forEach((row) => {
    if (!row.querySelector('button[title="Start opname"], button[data-icon="microphone-alt"]')) return;
    if (row.querySelector(`[${JUVOLY_ATTR}="bar"]`)) return;

    const bar = document.createElement('div');
    bar.setAttribute(JUVOLY_ATTR, 'bar');
    bar.style.cssText = 'display:inline-flex;align-items:center;flex-wrap:nowrap;margin-left:4px;';

    const mk = (attr, label, onClick, opts = {}) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute(JUVOLY_ATTR, attr);
      b.textContent = label;
      b.title = opts.title || label;
      b.disabled = !!opts.disabled;
      b.style.cssText = opts.style || juvoly_btnStyle(opts.kind || 'muted');
      b.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (b.disabled) return;
        onClick();
      });
      return b;
    };

    bar.appendChild(mk('open', 'Juvoly', juvoly_onOpen, {
      kind: 'juvoly',
      title: 'Juvoly openen in nieuw tabblad'
    }));

    const controls = document.createElement('div');
    controls.setAttribute(JUVOLY_ATTR, 'controls');
    controls.style.cssText = 'display:none;align-items:center;';
    controls.appendChild(mk('record', juvoly_icon('record'), juvoly_onRecord, {
      kind: 'muted', disabled: true, title: 'Opnemen'
    }));
    controls.appendChild(mk('summarize', juvoly_icon('summarize'), juvoly_onSummarize, {
      kind: 'muted', disabled: true, title: 'Samenvatten'
    }));
    controls.appendChild(mk('import', juvoly_icon('import'), juvoly_onImport, {
      kind: 'muted', disabled: true, title: 'Overnemen naar SOEP'
    }));
    bar.appendChild(controls);

    const mic = row.querySelector('button[title="Start opname"], button[data-icon="microphone-alt"]');
    juvolySuppressObserver = true;
    try {
      if (mic && mic.parentNode) {
        mic.parentNode.insertBefore(bar, mic.nextSibling);
      } else {
        row.appendChild(bar);
      }
    } finally {
      void Promise.resolve().then(() => { juvolySuppressObserver = false; });
    }
    insertedThisCall += 1;
  });

  if (insertedThisCall > 0) {
    juvolySuppressObserver = true;
    try {
      juvoly_paintToolbar();
    } finally {
      void Promise.resolve().then(() => { juvolySuppressObserver = false; });
    }
  }
}

function juvoly_scheduleAddToolbar() {
  if (juvolyObserverTimer != null) return;
  juvolyObserverTimer = setTimeout(() => {
    juvolyObserverTimer = null;
    juvoly_addToolbarControls();
  }, 150);
}

function juvoly_mutationIsOurs(mutations) {
  for (const m of mutations) {
    const t = m.target;
    if (t && t.nodeType === 1 && t.closest && t.closest(`[${JUVOLY_ATTR}]`)) continue;
    if (t && t.nodeType === 3 && t.parentElement && t.parentElement.closest(`[${JUVOLY_ATTR}]`)) continue;
    const nodes = [...(m.addedNodes || []), ...(m.removedNodes || [])];
    const allOurs = nodes.length > 0 && nodes.every((n) =>
      n.nodeType === 1 && n.matches?.(`[${JUVOLY_ATTR}], [${JUVOLY_ATTR}] *`)
      || n.nodeType === 1 && n.getAttribute?.(JUVOLY_ATTR) != null
      || (n.nodeType === 1 && n.closest?.(`[${JUVOLY_ATTR}]`))
      || n.nodeType === 3
    );
    if (nodes.length && allOurs) continue;
    return false;
  }
  return true;
}

loadGlobalOptions(function (options) {
  if (!options.juvolyKnop) {
    console.log('Juvoly knop disabled');
    return;
  }
  const observer = new MutationObserver((mutations) => {
    if (juvolySuppressObserver) return;
    if (juvoly_mutationIsOurs(mutations)) return;
    juvoly_scheduleAddToolbar();
  });
  observer.observe(document.body, { childList: true, subtree: true });
  juvoly_addToolbarControls();
});
