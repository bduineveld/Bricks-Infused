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

let juvolyModalCancelCb = null;

function juvoly_closeModal() {
  if (juvolyModalEl) {
    juvolyModalEl.remove();
    juvolyModalEl = null;
  }
  document.removeEventListener('keydown', juvoly_onModalKey);
  const cb = juvolyModalCancelCb;
  juvolyModalCancelCb = null;
  if (cb) cb();
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

function juvoly_showReviewModal(soep, opts = {}) {
  juvoly_closeModal();
  juvolyModalCancelCb = opts.onCancel || null;

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
    <div class="juvoly-modal-title" style="font-size:1.15em;font-weight:600;flex:1;color:#c05600;"></div>
    <button type="button" class="juvoly-modal-close" aria-label="Sluiten" style="background:transparent;border:none;font-size:22px;cursor:pointer;color:#718096;line-height:1;">&times;</button>
  `;
  header.querySelector('.juvoly-modal-title').textContent = opts.title || 'Juvoly → SOEP';
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
  applyBtn.textContent = opts.applyLabel || 'Overnemen in SOEP';
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
    juvolyModalCancelCb = null;
    juvoly_closeModal();
    juvoly_toast(applied.length ? `Overgenomen: ${applied.join(', ')}` : 'SOEP-velden niet gevonden.', applied.length ? 'ok' : 'error');
    if (opts.onApplied) opts.onApplied(applied);
  });

  footer.appendChild(cancelBtn);
  footer.appendChild(applyBtn);
  modal.appendChild(footer);
  document.body.appendChild(overlay);
  juvolyModalEl = overlay;
  document.addEventListener('keydown', juvoly_onModalKey);
}

/** Nabouw van Juvoly's "Dit verslag opsplitsen": namen aanpassen, dan terugzetten in Juvoly. */
function juvoly_showSplitModal(items, onChoice) {
  juvoly_closeModal();

  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:2147483646;display:flex;align-items:center;justify-content:center;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;padding:16px;';
  overlay.addEventListener('click', (ev) => { if (ev.target === overlay) juvoly_closeModal(); });

  const modal = document.createElement('div');
  modal.style.cssText = 'background:#fff;border-radius:12px;box-shadow:0 20px 60px rgba(0,0,0,0.3);max-width:440px;width:100%;max-height:90vh;overflow:auto;color:#2d3748;';
  overlay.appendChild(modal);

  const header = document.createElement('div');
  header.style.cssText = 'display:flex;align-items:center;gap:12px;padding:16px 20px 4px;';
  const title = document.createElement('div');
  title.style.cssText = 'font-size:1.15em;font-weight:600;flex:1;color:#c05600;';
  title.textContent = 'Juvoly: verslag opsplitsen';
  const close = document.createElement('button');
  close.type = 'button';
  close.setAttribute('aria-label', 'Sluiten');
  close.textContent = '×';
  close.style.cssText = 'background:transparent;border:none;font-size:22px;cursor:pointer;color:#718096;line-height:1;';
  close.addEventListener('click', juvoly_closeModal);
  header.append(title, close);
  modal.appendChild(header);

  const hint = document.createElement('div');
  hint.style.cssText = 'padding:0 20px 12px;font-size:12px;color:#718096;';
  hint.textContent = 'Juvoly hoorde meerdere onderwerpen. Pas de namen aan en bevestig, of maak één verslag.';
  modal.appendChild(hint);

  const body = document.createElement('div');
  body.style.cssText = 'padding:0 20px 8px;';
  // Zoals Juvoly: prullenbak alleen zolang er meer dan twee onderwerpen over zijn
  const rows = items.map((item, index) => {
    const wrap = document.createElement('label');
    wrap.style.cssText = 'display:block;margin-bottom:10px;font-size:12px;color:#718096;';
    wrap.textContent = item.label;
    const line = document.createElement('div');
    line.style.cssText = 'display:flex;gap:6px;align-items:center;margin-top:4px;';
    const input = document.createElement('input');
    input.type = 'text';
    input.value = item.value;
    input.style.cssText = 'flex:1;min-width:0;box-sizing:border-box;padding:8px 10px;border:1px solid #e2e8f0;border-radius:6px;background:#f7fafc;font-size:13px;color:#2d3748;';
    const del = document.createElement('button');
    del.type = 'button';
    del.title = 'Onderwerp verwijderen';
    del.setAttribute('aria-label', 'Onderwerp verwijderen');
    del.textContent = '🗑';
    del.style.cssText = 'flex-shrink:0;width:32px;height:32px;border:1px solid #e2e8f0;border-radius:6px;background:#fff;cursor:pointer;font-size:14px;line-height:1;';
    line.append(input, del);
    wrap.appendChild(line);
    body.appendChild(wrap);
    const row = { index, wrap, input, del, removed: false };
    del.addEventListener('click', (ev) => {
      ev.preventDefault();
      row.removed = true;
      wrap.style.display = 'none';
      updateTrash();
    });
    return row;
  });
  const updateTrash = () => {
    const left = rows.filter((r) => !r.removed);
    left.forEach((r) => { r.del.style.display = left.length > 2 ? 'inline-block' : 'none'; });
  };
  updateTrash();
  modal.appendChild(body);

  const footer = document.createElement('div');
  footer.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;padding:14px 20px;border-top:1px solid #e2e8f0;background:#f7fafc;';
  const noSplit = document.createElement('button');
  noSplit.type = 'button';
  noSplit.textContent = 'Genereren zonder splitsen';
  noSplit.style.cssText = 'border:1px solid #cbd5e0;background:#fff;color:#2d3748;padding:8px 14px;border-radius:6px;font-size:13px;cursor:pointer;';
  noSplit.addEventListener('click', () => { juvoly_closeModal(); onChoice('nosplit', []); });
  const confirm = document.createElement('button');
  confirm.type = 'button';
  confirm.textContent = 'Bevestigen';
  confirm.style.cssText = 'border:none;background:#dd6b20;color:#fff;padding:8px 16px;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer;';
  confirm.addEventListener('click', () => {
    const left = rows.filter((r) => !r.removed);
    const values = left.map((r) => r.input.value.trim());
    if (values.some((v) => !v)) {
      juvoly_toast('Geef elk onderwerp een naam.', 'warn');
      return;
    }
    juvoly_closeModal();
    onChoice('confirm', values, rows.filter((r) => r.removed).map((r) => r.index));
  });
  footer.append(noSplit, confirm);
  modal.appendChild(footer);

  document.body.appendChild(overlay);
  juvolyModalEl = overlay;
  document.addEventListener('keydown', juvoly_onModalKey);
  if (rows[0]) rows[0].input.focus();
}

async function juvoly_openSplitChoice() {
  const info = await juvoly_send('juvoly.splitInfo');
  if (!info.ok || !info.items || !info.items.length) {
    juvoly_toast(info.error || 'Opsplits-vraag niet gevonden in Juvoly.', 'warn');
    return;
  }
  juvoly_showSplitModal(info.items, async (mode, values, removed) => {
    juvolyBusy = true;
    juvolySummarizing = true;
    juvoly_paintToolbar();
    try {
      const applied = await juvoly_send('juvoly.splitApply', { mode, values, removed: removed || [] });
      if (!applied.ok) {
        juvoly_toast(applied.error || 'Keuze doorgeven aan Juvoly mislukt.', 'error');
        return;
      }
      // Juvoly genereert nu het verslag; wachten tot het klaar is
      const resp = await juvoly_send('juvoly.summarize');
      if (resp.ok) juvoly_toast('Samenvatting klaar — u kunt overnemen.', 'ok');
      else if (!resp.splitPending) juvoly_toast(resp.error || 'Samenvatten mislukt.', 'error');
    } finally {
      juvolyBusy = false;
      juvolySummarizing = false;
      await juvoly_refreshStatus();
    }
  });
}

// --- Toolbar UI ---------------------------------------------------------------

let juvolyControlsUnlocked = false;
let juvolySummarizing = false;

function juvoly_ensureSpinnerStyle() {
  if (document.getElementById('bricks-infused-juvoly-style')) return;
  const style = document.createElement('style');
  style.id = 'bricks-infused-juvoly-style';
  style.textContent = `
    @keyframes bricksInfusedJuvolySpin { to { transform: rotate(360deg); } }
    [${JUVOLY_ATTR}] .bij-spinner {
      display: inline-block; width: 12px; height: 12px; box-sizing: border-box;
      border: 2px solid rgba(255,255,255,0.35); border-top-color: #fff; border-radius: 50%;
      animation: bricksInfusedJuvolySpin 0.8s linear infinite;
    }`;
  document.head.appendChild(style);
}

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
    const summarizing = juvolySummarizing || !!(st && st.processing);
    if (!summarizing && st && st.splitPending) {
      sumBtn.disabled = !!juvolyBusy;
      sumBtn.style.cssText = juvoly_btnStyle('summarize');
      sumBtn.textContent = '?';
      sumBtn.title = 'Juvoly vraagt of het verslag opgesplitst moet worden — klik om te kiezen';
    } else if (!summarizing && st && st.summaryFailed) {
      sumBtn.disabled = !!juvolyBusy;
      sumBtn.style.cssText = juvoly_btnStyle('summarize');
      sumBtn.textContent = '✕';
      sumBtn.title = 'Verslag kon niet worden gegenereerd — klik om naar Juvoly te gaan';
    } else if (summarizing) {
      juvoly_ensureSpinnerStyle();
      sumBtn.disabled = true;
      sumBtn.style.cssText = juvoly_btnStyle('summarize') + 'cursor:progress;';
      if (!sumBtn.querySelector('.bij-spinner')) {
        sumBtn.textContent = '';
        const spin = document.createElement('span');
        spin.className = 'bij-spinner';
        sumBtn.appendChild(spin);
      }
      sumBtn.title = 'Juvoly maakt de samenvatting…';
    } else {
      sumBtn.disabled = !!juvolyBusy || !canSum;
      sumBtn.style.cssText = juvoly_btnStyle(sumBtn.disabled ? 'muted' : 'summarize');
      sumBtn.textContent = juvoly_icon('summarize');
      sumBtn.title = 'Samenvatten';
    }

    // Pas na afronden: tijdens het (gestreamd) schrijven is de tekst nog onvolledig
    const canImport = phase === 'notes' && !!(st && st.notesReady && st.hasSoep);
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
    // Ook een Juvoly-tab die niet via de Juvoly-knop is geopend telt mee
    juvolyControlsUnlocked = juvoly_isUsablePhase(juvolyLastStatus.phase);
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
  if (juvolyLastStatus && juvolyLastStatus.splitPending) {
    await juvoly_openSplitChoice();
    return;
  }
  if (juvolyLastStatus && juvolyLastStatus.summaryFailed) {
    // Mislukte samenvatting: gebruiker kiest in Juvoly zelf (hervatten, context, leeg aanmaken)
    const resp = await juvoly_send('juvoly.openOrFocus', { ensureReady: false });
    if (!resp.ok) juvoly_toast(resp.error || 'Kon Juvoly-tab niet openen.', 'error');
    return;
  }
  juvolyBusy = true;
  juvolySummarizing = true;
  juvoly_paintToolbar();
  try {
    const resp = await juvoly_send('juvoly.summarize');
    if (resp.splitPending) {
      // Meteen de keuze tonen; de ?-knop opent hem later opnieuw
      juvolyBusy = false;
      juvolySummarizing = false;
      await juvoly_refreshStatus();
      await juvoly_openSplitChoice();
      return;
    }
    if (!resp.ok) {
      juvoly_toast(resp.error || 'Samenvatten mislukt.', 'error');
    } else {
      juvoly_toast('Samenvatting klaar — u kunt overnemen.', 'ok');
      juvolyLastStatus = resp.status || juvolyLastStatus;
    }
  } finally {
    juvolyBusy = false;
    juvolySummarizing = false;
    await juvoly_refreshStatus();
  }
}

// --- Meerdere verslagen → Bricks-contacten 1..5 -------------------------------

const JUVOLY_MAX_CONTACTS = 5;

function juvoly_activeSoepTop() {
  return [...document.querySelectorAll('.soep-content-top')].find((el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }) || null;
}

function juvoly_contactButton(n) {
  const top = juvoly_activeSoepTop();
  if (!top) return null;
  return [...top.querySelectorAll('.btn-numberedsetting')].find((b) => (b.innerText || '').trim() === String(n)) || null;
}

function juvoly_selectedContact() {
  const top = juvoly_activeSoepTop();
  const sel = top && top.querySelector('.btn-numberedsetting.selected');
  const n = sel ? parseInt((sel.innerText || '').trim(), 10) : NaN;
  return n > 0 ? n : 1;
}

async function juvoly_switchContact(n) {
  const btn = juvoly_contactButton(n);
  if (!btn) return false;
  if (!btn.classList.contains('selected')) {
    btn.click();
    for (let i = 0; i < 20 && !(juvoly_contactButton(n) || {}).classList?.contains('selected'); i++) {
      await new Promise((r) => setTimeout(r, 100));
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return juvoly_selectedContact() === n;
}

function juvoly_activeEditor(letter) {
  const patientId = juvoly_activePatientId();
  return [...document.querySelectorAll(`.intelli-editor[data-soep="${letter}"]`)].find((el) => {
    if (patientId && el.getAttribute('data-patientid') !== String(patientId)) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }) || null;
}

/** ICPC gekozen = badge (bijv. "S16") in het E-veld van het actieve contact. */
function juvoly_activeIcpc() {
  const ed = juvoly_activeEditor('E');
  const badge = ed && ed.querySelector('.icpc-badge .badge-text');
  return badge ? (badge.textContent || '').trim() : '';
}

/** Episodeveld boven de SOEP ("Geen episode" als placeholder) van het actieve contact. */
function juvoly_activeEpisodeText() {
  const top = juvoly_activeSoepTop();
  const input = top && top.querySelector('input[placeholder="Geen episode"]');
  return input ? (input.value || '').trim() : '';
}

function juvoly_bricksDialogOpen() {
  return [...document.querySelectorAll('#modalDialogs .modal, #modalDialogs [role="dialog"]')].some((el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  });
}

/**
 * Bricks koppelt na de ICPC-keuze nog async een episode (evt. dialoog "heropen episode",
 * storeEpisode). Wisselen van contact vóór dat klaar is geeft in Bricks
 * "Cannot read properties of null (reading 'Omschrijving')". Daarom: badge + episode +
 * geen dialoog, en dat moet even stabiel blijven.
 */
function juvoly_icpcSettled() {
  return !!juvoly_activeIcpc() && !!juvoly_activeEpisodeText() && !juvoly_bricksDialogOpen();
}

/** Bricks vraagt de ICPC bij het verlaten van het E-veld; dat nabootsen na invullen. */
function juvoly_triggerIcpcPrompt() {
  const ed = juvoly_activeEditor('E');
  const ta = ed && ed.querySelector('textarea');
  if (!ta) return;
  ta.focus();
  ta.setSelectionRange(ta.value.length, ta.value.length);
  ta.blur();
}

/** Zwevend paneel tijdens wachten op ICPC; resolve('icpc'|'skip'|'stop'). */
function juvoly_waitForIcpc(text) {
  return new Promise((resolve) => {
    const panel = document.createElement('div');
    panel.setAttribute(JUVOLY_ATTR, 'icpc-wait');
    panel.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:2147483645;max-width:360px;background:#fffaf0;border-left:4px solid #dd6b20;color:#7b341e;padding:12px 14px;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,0.15);font:13px/1.4 -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;';
    const msg = document.createElement('div');
    msg.textContent = text;
    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;margin-top:8px;';
    const mkBtn = (label, result) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.style.cssText = 'border:1px solid #dd6b20;background:#fff;color:#7b341e;border-radius:6px;padding:4px 10px;font-size:12px;cursor:pointer;';
      b.addEventListener('click', () => done(result));
      return b;
    };
    actions.append(mkBtn('Overslaan', 'skip'), mkBtn('Stoppen', 'stop'));
    panel.append(msg, actions);
    document.body.appendChild(panel);

    let settledSince = 0;
    const timer = setInterval(() => {
      if (!juvoly_icpcSettled()) { settledSince = 0; return; }
      if (!settledSince) settledSince = Date.now();
      else if (Date.now() - settledSince >= 800) done('icpc');
    }, 200);
    function done(result) {
      clearInterval(timer);
      panel.remove();
      resolve(result);
    }
  });
}

function juvoly_reviewOnce(soep, opts) {
  return new Promise((resolve) => {
    juvoly_showReviewModal(soep, {
      ...opts,
      onApplied: (applied) => resolve({ applied }),
      onCancel: () => resolve(null)
    });
  });
}

async function juvoly_importMany(notes) {
  const start = juvoly_selectedContact();
  const room = JUVOLY_MAX_CONTACTS - start + 1;
  if (notes.length > room) {
    juvoly_toast(`Juvoly heeft ${notes.length} verslagen, maar vanaf contact ${start} zijn er nog maar ${room} Bricks-contacten. De rest moet u handmatig overnemen.`, 'warn');
  }
  const count = Math.min(notes.length, room);
  for (let i = 0; i < count; i++) {
    const contact = start + i;
    if (!(await juvoly_switchContact(contact))) {
      juvoly_toast(`Kon niet naar contact ${contact} in Bricks.`, 'error');
      return;
    }
    const sel = await juvoly_send('juvoly.selectNote', { index: i });
    if (!sel.ok) {
      juvoly_toast(sel.error || `Verslag ${i + 1} niet beschikbaar.`, 'error');
      return;
    }
    const resp = await juvoly_send('juvoly.getSoep');
    if (!resp.ok) {
      juvoly_toast(resp.error || `Verslag ${i + 1} niet beschikbaar.`, 'error');
      return;
    }
    const result = await juvoly_reviewOnce(resp.soep || { S: '', O: '', E: '', P: '' }, {
      title: `Juvoly ${i + 1}/${count}: ${notes[i].name} → contact ${contact}`,
      applyLabel: i < count - 1 ? 'Overnemen, daarna ICPC kiezen' : 'Overnemen in SOEP'
    });
    if (!result) return; // geannuleerd
    if (!result.applied.includes('E')) continue;
    juvoly_triggerIcpcPrompt();
    if (i < count - 1 && !juvoly_activeIcpc()) {
      const next = notes[i + 1].name;
      const wait = await juvoly_waitForIcpc(`Kies de ICPC voor "${notes[i].name}". Daarna gaat Bricks door naar contact ${contact + 1} (${next}). Geen ICPC-vraag? Klik in het E-veld en weer erbuiten.`);
      if (wait === 'stop') return;
    }
  }
}

async function juvoly_onImport() {
  if (juvolyBusy || !juvolyControlsUnlocked) return;
  juvolyBusy = true;
  juvoly_paintToolbar();
  try {
    const list = await juvoly_send('juvoly.listNotes');
    if (list.ok && list.notes && list.notes.length > 1) {
      await juvoly_importMany(list.notes);
      return;
    }
    // Eén verslag: altijd vers ophalen, de gebruiker kan het in Juvoly nog aangepast hebben
    const resp = await juvoly_send('juvoly.getSoep');
    if (!resp.ok) {
      juvoly_toast(resp.error || 'Nog geen verslag om over te nemen.', 'warn');
      return;
    }
    const result = await juvoly_reviewOnce(resp.soep || { S: '', O: '', E: '', P: '' }, {});
    if (result && result.applied.includes('E')) juvoly_triggerIcpcPrompt();
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
  // Altijd pollen (pauzeert als het Bricks-tabblad verborgen is), zodat een al open Juvoly-tab gevonden wordt
  juvoly_startPolling();
});
