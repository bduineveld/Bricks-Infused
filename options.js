function getStorage(cb) {
  console.log("getStorage called");
  if (chrome && chrome.storage && chrome.storage.sync) {
    console.log("Using chrome.storage.sync");
    chrome.storage.sync.get(null, function(data) {
      console.log("chrome.storage.sync data received:", data);
      console.log("Data keys:", Object.keys(data));
      console.log("Data length:", Object.keys(data).length);
      if (data && Object.keys(data).length > 0) {
        console.log("Found stored data, using it");
        cb(data);
      } else {
        console.log("No stored data, getting defaults from background");
        chrome.runtime.sendMessage({ type: 'getDefaults' }, (resp) => {
          console.log("Background defaults received:", resp);
          cb(resp.defaultOptions);
        });
      }
    });
  } else {
    console.log("Using localStorage fallback");
    const data = JSON.parse(localStorage.getItem('bricksOptions') || '{}');
    console.log("localStorage data received:", data);
    console.log("localStorage keys:", Object.keys(data));
    console.log("localStorage length:", Object.keys(data).length);
    if (data && Object.keys(data).length > 0) {
      console.log("Found localStorage data, using it");
      cb(data);
    } else if (chrome && chrome.runtime && chrome.runtime.sendMessage) {
      console.log("No localStorage data, getting defaults from background");
      chrome.runtime.sendMessage({ type: 'getDefaults' }, (resp) => {
        console.log("Background defaults received (localStorage fallback):", resp);
        cb(resp.defaultOptions);
      });
    } else {
      console.log("No background script available, getting defaults from background");
      chrome.runtime.sendMessage({ type: 'getDefaults' }, (resp) => {
        console.log("Background defaults received (no storage fallback):", resp);
        cb(resp.defaultOptions);
      });
    }
  }
}
// --- Postverwerking brieven: typen, weg te laten blokken, extra kopjes ---------------------------
// Houd gelijk met PV_BRIEFTYPEN (type + blokken) in content_postverwerking_brief.js.
const PV_TYPEN_OPTIES = [
  { type: 'ZorgDomein-terugkoppeling', blokken: [] },
  { type: 'Specialistenbrief', blokken: ['Beleid', 'Advies huisarts'] },
  { type: 'Opname', blokken: ['Reden', 'Conclusie', 'Beleid'] },
  { type: 'Meedenkadvies', blokken: ['Vraag', 'Advies', 'Beleid'] },
  { type: 'Radiologie', blokken: [] },
  { type: 'Scopie', blokken: ['Indicatie', 'Conclusie', 'Advies'] },
  { type: 'Pathologie', blokken: [] },
  { type: 'Kweek', blokken: ['Resistentie', 'Advies lab'] },
  { type: 'Operatieverslag', blokken: ['Conclusie', 'Beleid'] },
  { type: 'Waarneembericht', blokken: ['(E)', '(P)'] },
  { type: 'GGZ', blokken: ['Recent', 'Beleid'] },
  { type: 'MDO', blokken: ['Reden', 'Conclusie', 'Advies'] },
  { type: 'Ergotherapie', blokken: ['Hulpvraag', 'Doelen'] },
  { type: 'JGZ', blokken: [] },
  { type: 'Ambulance', blokken: [] }
];
const PV_KOPJES_GROEPEN = [
  { groep: 'conclusie', label: 'Conclusie', voorbeeld: 'beoordeling, indruk, samenvatting' },
  { groep: 'beleid', label: 'Beleid', voorbeeld: 'plan, afspraken, vervolg' },
  { groep: 'advies', label: 'Advies aan huisarts', voorbeeld: 'aanbeveling, verzoek' },
  { groep: 'reden', label: 'Reden / vraag', voorbeeld: 'reden van consult, vraagstelling' },
  { groep: 'diagnose', label: 'Diagnose', voorbeeld: 'werkhypothese' }
];

function renderPostverwerkingOpties(data) {
  const uit = data.postTypenUit || [];
  const weg = data.postWeglaten || {};
  const kopjes = data.postKopjes || {};
  const lijst = document.getElementById('pv-typen-lijst');
  lijst.innerHTML = '';
  PV_TYPEN_OPTIES.forEach(({ type, blokken }) => {
    const rij = document.createElement('div');
    rij.style.cssText = 'display:flex;flex-wrap:wrap;align-items:center;gap:6px 14px;padding:4px 0;font-size:13px;color:#4a5568;';
    const aan = document.createElement('label');
    aan.style.cssText = 'min-width:150px;display:flex;align-items:center;gap:6px;font-weight:500;';
    aan.innerHTML = '<input type="checkbox" class="pv-type">';
    aan.querySelector('input').dataset.type = type;
    aan.querySelector('input').checked = !uit.includes(type);
    aan.appendChild(document.createTextNode(type));
    rij.appendChild(aan);
    if (blokken.length) {
      const span = document.createElement('span');
      span.textContent = 'laat weg:';
      span.style.color = '#a0aec0';
      rij.appendChild(span);
      blokken.forEach((blok) => {
        const l = document.createElement('label');
        l.style.cssText = 'display:flex;align-items:center;gap:4px;';
        l.innerHTML = '<input type="checkbox" class="pv-weg">';
        const cb = l.querySelector('input');
        cb.dataset.type = type;
        cb.dataset.blok = blok;
        cb.checked = (weg[type] || []).includes(blok);
        l.appendChild(document.createTextNode(blok));
        rij.appendChild(l);
      });
    }
    lijst.appendChild(rij);
  });

  const kl = document.getElementById('pv-kopjes-lijst');
  kl.innerHTML = '';
  PV_KOPJES_GROEPEN.forEach(({ groep, label, voorbeeld }) => {
    const rij = document.createElement('div');
    rij.style.cssText = 'display:flex;align-items:center;gap:10px;padding:3px 0;font-size:13px;color:#4a5568;';
    const l = document.createElement('span');
    l.textContent = label;
    l.style.minWidth = '150px';
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.className = 'pv-kopjes';
    inp.dataset.groep = groep;
    inp.placeholder = 'bijv. ' + voorbeeld;
    inp.value = (kopjes[groep] || []).join(', ');
    inp.style.cssText = 'flex:1;padding:4px 8px;border:1px solid #cbd5e0;border-radius:4px;font-size:13px;';
    rij.appendChild(l);
    rij.appendChild(inp);
    kl.appendChild(rij);
  });
}

function collectPostverwerkingOpties() {
  const postTypenUit = Array.from(document.querySelectorAll('.pv-type'))
    .filter((cb) => !cb.checked).map((cb) => cb.dataset.type);
  const postWeglaten = {};
  document.querySelectorAll('.pv-weg').forEach((cb) => {
    if (!cb.checked) return;
    (postWeglaten[cb.dataset.type] = postWeglaten[cb.dataset.type] || []).push(cb.dataset.blok);
  });
  const postKopjes = {};
  document.querySelectorAll('.pv-kopjes').forEach((inp) => {
    const woorden = inp.value.split(',').map((w) => w.trim()).filter(Boolean);
    if (woorden.length) postKopjes[inp.dataset.groep] = woorden;
  });
  return { postTypenUit, postWeglaten, postKopjes };
}

// --- Medicatiegroepen (autorisatielijst) -----------------------------------------------------
// Standaardgroepen (medicijn_groepen.js): alleen aan/uit; bij Hoogrisicomedicatie ook de woorden.
// Eigen groepen: naam, kleur en woorden vrij. Zie medicijn_groepenUitOpties voor de opslag.

function renderMedicijnGroepen(data) {
  const uit = data.medicijnGroepenUit || [];
  const rijLijst = document.getElementById('medicijn-rij-lijst');
  const std = document.getElementById('medicijn-standaard-lijst');
  rijLijst.innerHTML = '';
  std.innerHTML = '';
  // Rij-groepen in vaste volgorde; icoongroepen op alfabet (de volgorde voor het matchen blijft die van
  // MEDICIJN_STANDAARD_GROEPEN).
  const groepen = MEDICIJN_STANDAARD_GROEPEN.filter((g) => g.stijl === 'rij')
    .concat(MEDICIJN_STANDAARD_GROEPEN.filter((g) => g.stijl !== 'rij').sort((a, b) => a.naam.localeCompare(b.naam, 'nl')));
  groepen.forEach((g) => {
    const l = document.createElement('label');
    l.className = 'mg-standaard';
    l.innerHTML = '<input type="checkbox" class="mg-std-aan"><span class="mg-kleurvlak"></span><span class="mg-std-naam"></span>';
    const cb = l.querySelector('input');
    cb.dataset.id = g.id;
    cb.dataset.stijl = g.stijl;
    cb.checked = !uit.includes(g.id);
    l.querySelector('.mg-kleurvlak').style.background = g.kleur;
    l.querySelector('.mg-std-naam').textContent = g.naam;
    // Welke middelen eronder vallen (hoogrisico: zie het tekstveld eronder).
    if (!g.bewerkbaar) l.title = g.naam + ':\n' + g.woorden.map((w) => w.replace('+', ' + ')).join(', ');
    // Groepen met een watermerk tonen hun icoon i.p.v. het kleurvlakje.
    if (g.stijl === 'strook') l.querySelector('.mg-kleurvlak').replaceWith(maakIcoonBeeld(g.icoon, g.naam, g.kleurStrook || g.kleur, 18));
    if ((g.lab || []).length) {
      const lab = document.createElement('span');
      lab.className = 'mg-std-lab';
      lab.textContent = g.lab.map((k) => MEDICIJN_LABWAARDEN[k].label).join(', ') + (g.labAlleen ? " (DOAC's)" : '');
      l.appendChild(lab);
    }
    const werkBij = () => l.classList.toggle('uit', !cb.checked);
    cb.addEventListener('change', werkBij);
    werkBij();
    (g.stijl === 'rij' ? rijLijst : std).appendChild(l);
  });

  const hoog = MEDICIJN_STANDAARD_GROEPEN.find((g) => g.bewerkbaar);
  const hoogVeld = document.getElementById('medicijn-hoogrisico');
  hoogVeld.value = (Array.isArray(data.medicijnHoogrisico) ? data.medicijnHoogrisico : hoog.woorden).join(', ');
  hoogVeld.dataset.standaard = hoog.woorden.join(', ');

  const eigen = document.getElementById('medicijn-eigen-lijst');
  eigen.innerHTML = '';
  (data.medicijnEigenGroepen || []).forEach((g) => eigen.appendChild(maakEigenGroepRij(g)));
}

// "alles aan" / "alles uit" voor de groepen met een icoon.
function zetStrookGroepen(aan) {
  document.querySelectorAll('#medicijn-standaard-lijst .mg-std-aan').forEach((cb) => {
    cb.checked = aan;
    cb.dispatchEvent(new Event('change'));
  });
}

// Locatiefilter: keuzelijst met de werkgroepen uit het tekstvak; de keuze staat per computer in
// chrome.storage.local (zelfde sleutel als in content.js); standaard 'alle'.
const LOCATIEKEUZE_SLEUTEL = 'medicijnLocatieKeuze';

function vulLocatieKeuze(huidig) {
  const select = document.getElementById('opt-medicijn-locatiekeuze');
  const waarde = huidig != null ? huidig : select.value;
  const groepen = document.getElementById('opt-medicijn-locatiegroepen').value.split('\n')
    .map((r) => (r.match(/^\s*([^=]+?)\s*=/) || [])[1]).filter(Boolean);
  select.innerHTML = '';
  [['alle', 'Alle locaties']]
    .concat(groepen.map((g) => [g, g]))
    .forEach(([v, t]) => {
      const o = document.createElement('option');
      o.value = v;
      o.textContent = t;
      select.appendChild(o);
    });
  select.value = [...select.options].some((o) => o.value === waarde) ? waarde : 'alle';
}

function werkLocatieKaartBij() {
  document.getElementById('mg-locatie-instellingen').classList.toggle('uit', !document.getElementById('opt-medicijn-locatie').checked);
}

// Klein icoon (of letter) als <span> met inline SVG, voor de opties.
function maakIcoonBeeld(icoon, naam, kleur, maat) {
  const sp = document.createElement('span');
  sp.className = 'mg-icoon';
  sp.style.cssText = `display:inline-flex;width:${maat}px;height:${maat}px;flex:0 0 ${maat}px;`;
  sp.innerHTML = medicijn_icoonSvg(icoon, naam, kleur, 1);
  sp.firstChild.setAttribute('width', maat);
  sp.firstChild.setAttribute('height', maat);
  return sp;
}

// Iconenkiezer: raster met alle iconen uit medicijn_iconen.js, plus "letter" (geen icoon).
function maakIcoonKiezer(rij) {
  const kiezer = document.createElement('div');
  kiezer.className = 'mg-kiezer';
  kiezer.style.cssText = 'display:none;flex-wrap:wrap;gap:4px;margin-top:6px;padding:6px;border:1px solid #e2e8f0;border-radius:6px;background:#fff;';
  const kleur = () => rij.querySelector('.mg-kleur').value;
  const kies = (icoon) => {
    rij.dataset.icoon = icoon || '';
    werkIcoonKnopBij(rij);
    kiezer.style.display = 'none';
  };
  const knop = (icoon, titel) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.title = titel;
    b.style.cssText = 'width:34px;height:34px;padding:4px;border:1px solid #e2e8f0;border-radius:6px;background:#f7fafc;cursor:pointer;display:flex;align-items:center;justify-content:center;';
    b.appendChild(maakIcoonBeeld(icoon, rij.querySelector('.mg-naam').value || '?', '#4a5568', 22));
    b.addEventListener('click', () => kies(icoon));
    return b;
  };
  kiezer.appendChild(knop('', 'Geen icoon: eerste letter van de naam'));
  Object.keys(MEDICIJN_ICONEN).forEach((k) => kiezer.appendChild(knop(k, MEDICIJN_ICONEN[k].naam)));
  return kiezer;
}

function werkIcoonKnopBij(rij) {
  const knop = rij.querySelector('.mg-icoon-knop');
  if (!knop) return;
  knop.innerHTML = '';
  knop.appendChild(maakIcoonBeeld(rij.dataset.icoon, rij.querySelector('.mg-naam').value || '?', medicijnDonker(rij.querySelector('.mg-kleur').value), 20));
  knop.title = rij.dataset.icoon && MEDICIJN_ICONEN[rij.dataset.icoon] ? 'Icoon: ' + MEDICIJN_ICONEN[rij.dataset.icoon].naam + ' (klik om te wijzigen)' : 'Icoon kiezen (nu: eerste letter)';
}

// Zelfde donkere variant als in de autorisatielijst (content.js → medicijn_donker).
function medicijnDonker(hex) {
  const m = String(hex).match(/^#([0-9a-f]{6})$/i);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const d = (v) => Math.round(v * 0.55).toString(16).padStart(2, '0');
  return '#' + d(n >> 16) + d((n >> 8) & 255) + d(n & 255);
}

function maakEigenGroepRij(g) {
  const rij = document.createElement('div');
  rij.className = 'medicijn-groep';
  rij.dataset.id = g.id;
  const kop = document.createElement('div');
  kop.className = 'medicijn-groep-kop';
  kop.innerHTML = '<input type="checkbox" class="mg-aan" title="Groep aan/uit">'
    + '<input type="color" class="mg-kleur" title="Kleur">'
    + '<button type="button" class="mg-icoon-knop"></button>'
    + '<input type="text" class="mg-naam" placeholder="Naam van de groep">'
    + '<button type="button" class="mg-weg" title="Groep verwijderen">✕</button>';
  rij.dataset.icoon = g.icoon || '';
  kop.querySelector('.mg-aan').checked = g.aan !== false;
  kop.querySelector('.mg-kleur').value = g.kleur || '#fde68a';
  kop.querySelector('.mg-naam').value = g.naam || '';
  const woorden = document.createElement('textarea');
  woorden.className = 'mg-woorden';
  woorden.rows = 2;
  woorden.placeholder = 'medicijnnamen, gescheiden door komma\'s';
  woorden.value = (g.woorden || []).join(', ');
  kop.querySelector('.mg-weg').addEventListener('click', () => {
    if (confirm('Groep "' + (kop.querySelector('.mg-naam').value || 'zonder naam') + '" verwijderen?')) rij.remove();
  });
  rij.appendChild(kop);
  const kiezer = maakIcoonKiezer(rij);
  rij.appendChild(kiezer);
  rij.appendChild(woorden);
  kop.querySelector('.mg-icoon-knop').addEventListener('click', () => {
    kiezer.style.display = kiezer.style.display === 'none' ? 'flex' : 'none';
  });
  kop.querySelector('.mg-kleur').addEventListener('input', () => werkIcoonKnopBij(rij));
  kop.querySelector('.mg-naam').addEventListener('input', () => werkIcoonKnopBij(rij));
  werkIcoonKnopBij(rij);
  return rij;
}

function collectMedicijnGroepen() {
  const lijst = (tekst) => tekst.split(',').map((w) => w.trim()).filter(Boolean);
  const medicijnGroepenUit = Array.from(document.querySelectorAll('.mg-std-aan'))
    .filter((cb) => !cb.checked).map((cb) => cb.dataset.id);
  const hoogVeld = document.getElementById('medicijn-hoogrisico');
  const hoog = lijst(hoogVeld.value);
  // Gelijk aan de standaard = null, zodat latere uitbreidingen van de standaard doorkomen.
  const medicijnHoogrisico = hoog.join(', ') === hoogVeld.dataset.standaard ? null : hoog;
  const medicijnEigenGroepen = Array.from(document.querySelectorAll('#medicijn-eigen-lijst .medicijn-groep')).map((rij) => ({
    id: rij.dataset.id,
    naam: rij.querySelector('.mg-naam').value.trim() || 'Eigen groep',
    kleur: rij.querySelector('.mg-kleur').value,
    aan: rij.querySelector('.mg-aan').checked,
    icoon: rij.dataset.icoon || '',
    woorden: lijst(rij.querySelector('.mg-woorden').value)
  })).filter((g) => g.woorden.length || g.naam !== 'Eigen groep');
  return { medicijnGroepenUit, medicijnHoogrisico, medicijnEigenGroepen };
}

function setStorage(data, cb) {
  if (chrome && chrome.storage && chrome.storage.sync) {
    chrome.storage.sync.set(data, cb);
  } else {
    localStorage.setItem('bricksOptions', JSON.stringify(data));
    if (cb) cb();
  }
}

function updateUpreventInstallStatus() {
  const installedEl = document.getElementById('uprevent-installed-msg');
  const missingBlock = document.getElementById('uprevent-missing-block');
  const installLink = document.getElementById('uprevent-install-link');
  if (!installedEl || !missingBlock) return;

  if (!chrome?.runtime?.sendMessage) {
    missingBlock.style.display = 'block';
    return;
  }

  chrome.runtime.sendMessage({ type: 'uprevent.ping' }, (resp) => {
    if (chrome.runtime.lastError || !resp || !resp.installed) {
      installedEl.style.display = 'none';
      missingBlock.style.display = 'block';
      if (installLink && resp?.installUrl) installLink.href = resp.installUrl;
      return;
    }
    const versionSuffix = resp.version ? ` (v${resp.version})` : '';
    installedEl.textContent = `U-Prevent Infused is geïnstalleerd${versionSuffix}.`;
    installedEl.style.display = 'block';
    missingBlock.style.display = 'none';
  });
}

function updateZorgdomeinInstallStatus() {
  const installedEl = document.getElementById('zorgdomein-installed-msg');
  const manageBtn = document.getElementById('zorgdomein-manage');
  const missingBlock = document.getElementById('zorgdomein-missing-block');
  const installLink = document.getElementById('zorgdomein-install-link');
  if (!installedEl || !missingBlock) return;

  chrome.runtime.sendMessage({ type: 'zorgdomein.ping' }, (resp) => {
    if (chrome.runtime.lastError || !resp || !resp.installed) {
      installedEl.style.display = 'none';
      manageBtn.style.display = 'none';
      missingBlock.style.display = 'block';
      if (installLink && resp?.installUrl) {
        installLink.href = resp.installUrl;
        installLink.style.display = 'inline';
      }
      return;
    }
    const versionSuffix = resp.version ? ` (v${resp.version})` : '';
    installedEl.textContent = `Zorgdomein Infused is geïnstalleerd${versionSuffix}.`;
    installedEl.style.display = 'block';
    manageBtn.style.display = 'inline-block';
    missingBlock.style.display = 'none';
  });
}

// Drag & drop helpers
let dragPlaceholder = null;
function getDragPlaceholder(containerId) {
  const className = containerId === 'zorgdomein-links-list' ? 'zorgdomein-drop-placeholder' : 'btnlabel-drop-placeholder';
  
  if (!dragPlaceholder || dragPlaceholder.className !== className) {
    if (dragPlaceholder && dragPlaceholder.parentNode) {
      dragPlaceholder.parentNode.removeChild(dragPlaceholder);
    }
    dragPlaceholder = document.createElement('div');
    dragPlaceholder.className = className;
    dragPlaceholder.style.height = '36px';
    dragPlaceholder.style.border = '2px dashed #99b';
    dragPlaceholder.style.borderRadius = '6px';
    dragPlaceholder.style.margin = '4px 0';
    dragPlaceholder.style.background = '#f0f6ff';
    dragPlaceholder.style.pointerEvents = 'auto';
    // Keep placeholder in place when hovered/dropped on
    dragPlaceholder.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    dragPlaceholder.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const list = document.getElementById(containerId || 'btnlabels-list');
      const dragging = list && list.querySelector(`.${containerId === 'zorgdomein-links-list' ? 'zorgdomein-link-row' : 'btnlabel-row'}.dragging`);
      if (dragging && dragPlaceholder.parentNode === list) {
        list.insertBefore(dragging, dragPlaceholder);
      }
    });
  }
  return dragPlaceholder;
}
function setupListDragContainer(listId, rowClass) {
  const list = document.getElementById(listId);
  if (!list) {
    console.log(`List ${listId} not found`);
    return;
  }
  if (list.dataset.dragSetup) {
    console.log(`List ${listId} already has drag setup`);
    return;
  }
  console.log(`Setting up drag container for ${listId} with class ${rowClass}`);
  list.dataset.dragSetup = '1';
  list.addEventListener('dragover', (e) => {
    e.preventDefault();
    console.log(`Dragover on ${listId}`);
            const ph = getDragPlaceholder(listId);
    // If hovering placeholder itself, keep it where it is
    if (e.target === ph || (ph && ph.contains(e.target))) return;

    // Find the closest row index based on cursor Y to avoid gaps
    const rows = Array.from(list.querySelectorAll(`.${rowClass}`));
    if (rows.length === 0) {
      if (ph.parentNode !== list) list.appendChild(ph);
      return;
    }
    const y = e.clientY;
    let insertBeforeNode = null;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (r.classList.contains('dragging')) continue;
      const rect = r.getBoundingClientRect();
      const midpoint = rect.top + rect.height / 2;
      if (y < midpoint) {
        insertBeforeNode = r;
        break;
      }
    }
    if (insertBeforeNode) {
      if (ph !== insertBeforeNode.previousSibling) {
        list.insertBefore(ph, insertBeforeNode);
      }
    } else {
      if (ph.parentNode !== list || ph !== list.lastChild) {
        list.appendChild(ph);
      }
    }
  });
  
  // Drop listener voor beide lijsten
  list.addEventListener('drop', (e) => {
    e.preventDefault();
    console.log(`Drop on ${listId}`);
    const dragging = list.querySelector(`.${rowClass}.dragging`);
            const ph = getDragPlaceholder(listId);
    console.log('Dragging element:', dragging);
    console.log('Placeholder:', ph);
    console.log('Placeholder parent:', ph?.parentNode);
    if (dragging && ph && ph.parentNode === list) {
      console.log('Inserting dragging element before placeholder');
      list.insertBefore(dragging, ph);
    }
    if (ph && ph.parentNode) ph.parentNode.removeChild(ph);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  console.log("Options page loaded");
  updateUpreventInstallStatus();
  updateZorgdomeinInstallStatus();
  
  function expandSectionByTarget(targetId) {
    const section = document.getElementById(targetId);
    const toggle = document.querySelector(`[data-target="${targetId}"]`);
    if (section) {
      section.classList.remove('collapsed');
      section.classList.add('expanded');
    }
    if (toggle) {
      toggle.classList.remove('collapsed');
      toggle.classList.add('expanded');
    }
  }

  function applyFocusHighlight(focusTarget) {
    const focusMap = {
      communicatie: { itemId: 'comm-settings-item', sectionId: 'comm-knoppen-section' },
      zorgdomein: { itemId: 'zorgdomein-settings-item', sectionId: 'zorgdomein-section' }
    };
    const conf = focusMap[focusTarget];
    if (!conf) return;
    const item = document.getElementById(conf.itemId);
    if (!item) return;

    expandSectionByTarget(conf.sectionId);
    item.classList.add('focus-highlight');
    item.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => item.classList.remove('focus-highlight'), 3000);
  }

  const queryFocusTarget = new URLSearchParams(window.location.search).get('focus');
  if (queryFocusTarget) {
    applyFocusHighlight(queryFocusTarget);
  } else if (chrome && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get(['optionsFocusTarget'], (result) => {
      const focusTarget = result.optionsFocusTarget;
      if (!focusTarget) return;
      chrome.storage.local.remove('optionsFocusTarget');
      applyFocusHighlight(focusTarget);
    });
  }
  
  // Uitklapbare secties functionaliteit
  console.log('🔧 DOM loaded, initializing expandable sections...');
  
  // Functie om een sectie uit/in te klappen
  function toggleSection(targetId, toggle) {
    const targetSection = document.getElementById(targetId);
    
    if (!targetSection) {
      console.error('❌ Target section not found:', targetId);
      return;
    }
    
    if (targetSection.classList.contains('collapsed')) {
      // Uitklappen
      console.log('⬇️ Expanding section:', targetId);
      targetSection.classList.remove('collapsed');
      targetSection.classList.add('expanded');
      if (toggle) {
        toggle.classList.remove('collapsed');
        toggle.classList.add('expanded');
      }
    } else {
      // Invouwen
      console.log('⬆️ Collapsing section:', targetId);
      targetSection.classList.remove('expanded');
      targetSection.classList.add('collapsed');
      if (toggle) {
        toggle.classList.remove('expanded');
        toggle.classList.add('collapsed');
      }
    }
  }
  
  const expandToggles = document.querySelectorAll('.expand-toggle');
  console.log('🔍 Found expand toggles:', expandToggles.length);
  
  expandToggles.forEach((toggle, index) => {
    console.log(`🔧 Setting up toggle ${index}:`, toggle);
    console.log(`   - Target: ${toggle.getAttribute('data-target')}`);
    console.log(`   - Classes: ${toggle.className}`);
    
    toggle.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      
      console.log('🖱️ Toggle clicked:', this);
      const targetId = this.getAttribute('data-target');
      toggleSection(targetId, this);
    });
  });

  // Alleen de schakelaar zelf zet een optie om; klik op de tekst niet. Bij een uitklapbaar item klapt
  // een klik op de tekst (of het grijze blok) de instellingen uit/in.
  document.querySelectorAll('.checkbox-item > label, label.mg-optie').forEach((label) => {
    label.addEventListener('click', function(e) {
      if (e.target.closest('input, select, textarea, a, button')) return;
      e.preventDefault();
      const toggle = label.closest('.checkbox-item.has-expandable')?.querySelector('.expand-toggle');
      if (toggle && toggle.getAttribute('data-target')) {
        e.stopPropagation();
        toggleSection(toggle.getAttribute('data-target'), toggle);
      }
    });
  });

  // Klik op het grijze blok (checkbox-item.has-expandable) klapt ook uit/in.
  // Uitzondering: checkbox, label (hierboven) en pijltje hebben hun eigen afhandeling.
  const expandableCheckboxItems = document.querySelectorAll('.checkbox-item.has-expandable');
  expandableCheckboxItems.forEach((item) => {
    const toggle = item.querySelector('.expand-toggle');
    if (!toggle) return;
    const targetId = toggle.getAttribute('data-target');
    if (!targetId) return;

    item.addEventListener('click', function(e) {
      if (e.target.closest('.expand-toggle') || e.target.closest('input') || e.target.closest('label')) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      console.log('🖱️ Expandable checkbox-item clicked:', targetId);
      toggleSection(targetId, toggle);
    });
  });
  
  // Voeg ook event listeners toe aan expandable-header divs
  const expandableHeaders = document.querySelectorAll('.expandable-header');
  console.log('🔍 Found expandable headers:', expandableHeaders.length);
  
  expandableHeaders.forEach((header) => {
    const toggle = header.querySelector('.expand-toggle');
    if (toggle) {
      const targetId = toggle.getAttribute('data-target');
      header.addEventListener('click', function(e) {
        // Als er op de toggle zelf geklikt wordt, laat die het afhandelen
        if (e.target === toggle || toggle.contains(e.target)) {
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        console.log('🖱️ Header clicked:', this);
        toggleSection(targetId, toggle);
      });
    }
  });
  
  // Automatisch uitklappen wanneer checkbox wordt aangevinkt
  const commCheckbox = document.getElementById('opt-knoppen');
  const zorgdomeinCheckbox = document.getElementById('opt-zorgdomein');
  
  console.log('🔍 Found checkboxes:', {
    comm: !!commCheckbox,
    zorgdomein: !!zorgdomeinCheckbox
  });
  
  if (commCheckbox) {
    commCheckbox.addEventListener('change', function() {
      console.log('☑️ Comm checkbox changed:', this.checked);
      const section = document.getElementById('comm-knoppen-section');
      const toggle = document.querySelector('[data-target="comm-knoppen-section"]');
      
      console.log('🔍 Comm elements:', {
        section: !!section,
        toggle: !!toggle
      });
      
      if (this.checked && section && toggle) {
        console.log('⬇️ Auto-expanding comm section');
        section.classList.remove('collapsed');
        section.classList.add('expanded');
        toggle.classList.remove('collapsed');
        toggle.classList.add('expanded');
        console.log('✅ Comm section auto-expanded');
      }
    });
  }
  
  if (zorgdomeinCheckbox) {
    zorgdomeinCheckbox.addEventListener('change', function() {
      console.log('☑️ Zorgdomein checkbox changed:', this.checked);
      const section = document.getElementById('zorgdomein-section');
      const toggle = document.querySelector('[data-target="zorgdomein-section"]');
      
      console.log('🔍 Zorgdomein elements:', {
        section: !!section,
        toggle: !!toggle
      });
      
      if (this.checked && section && toggle) {
        console.log('⬇️ Auto-expanding zorgdomein section');
        section.classList.remove('collapsed');
        section.classList.add('expanded');
        toggle.classList.remove('collapsed');
        toggle.classList.add('expanded');
        console.log('✅ Zorgdomein section auto-expanded');
      }
    });
  }
  
  console.log('✅ Expandable sections initialized');
  
  // Extra debug: check initial state
  setTimeout(() => {
    console.log('🔍 Initial state check:');
    expandToggles.forEach((toggle, index) => {
      const targetId = toggle.getAttribute('data-target');
      const section = document.getElementById(targetId);
      console.log(`   Toggle ${index}:`, {
        toggleClasses: toggle.className,
        sectionClasses: section ? section.className : 'NOT FOUND',
        targetId: targetId
      });
    });
  }, 100);
  
  getStorage((data) => {
    console.log("Storage data received:", data);
 
    document.getElementById('opt-klantnummer').value = data.klantnummer || '';
    document.getElementById('opt-knoppen').checked = data.communicatieKnoppen !== false;
    document.getElementById('opt-resizer').checked = data.journaalResizer !== false;
    document.getElementById('opt-declareren').checked = data.declarerenNietOpGebeurd !== false;
    document.getElementById('opt-juvoly').checked = !!data.juvolyKnop;
    document.getElementById('opt-uprevent').checked = !!data.uprevent;
    document.getElementById('opt-medicijn').checked = data.medicijnMarkeringen !== false;
    document.getElementById('opt-pdf-export').checked = data.pdfExport !== false;
    document.getElementById('opt-postverwerking-lab').checked = data.postverwerkingLab !== false;
    document.getElementById('opt-postverwerking-brief').checked = data.postverwerkingBrief !== false;
    renderPostverwerkingOpties(data);
    document.getElementById('opt-zd-contact').value = data.postZdContact != null ? data.postZdContact : '!Huisartsenpraktijk Broekpolder';
    renderMedicijnGroepen(data);
    document.getElementById('opt-medicijn-lab').checked = data.medicijnLabwaarden !== false;
    document.getElementById('opt-medicijn-locatie').checked = data.medicijnLocaties !== false;
    // Zelfde standaard als in background.js (oudere opslag heeft de sleutel nog niet).
    document.getElementById('opt-medicijn-locatiegroepen').value = data.medicijnLocatieGroepen != null
      ? data.medicijnLocatieGroepen : 'Plantage = Locatie Plantage\nCitadel + Prinsenhof = Locatie Citadel, Locatie Prinsenhof';
    chrome.storage.local.get(LOCATIEKEUZE_SLEUTEL, (d) => vulLocatieKeuze((d && d[LOCATIEKEUZE_SLEUTEL]) || 'alle'));
    document.getElementById('opt-medicijn-locatiegroepen').addEventListener('input', () => vulLocatieKeuze());
    document.getElementById('opt-medicijn-locatie').addEventListener('change', werkLocatieKaartBij);
    werkLocatieKaartBij();
    document.getElementById('mg-strook-alles-aan').addEventListener('click', () => zetStrookGroepen(true));
    document.getElementById('mg-strook-alles-uit').addEventListener('click', () => zetStrookGroepen(false));
    document.getElementById('opt-zorgdomein').checked = data.zorgdomeinSnelkoppelingen !== false;
    // Alleen renderen als er data bestaat
    if (data.btnLabels && data.btnLabels.length > 0) {
      console.log("btnLabels to render:", data.btnLabels);
      renderBtnLabels(data.btnLabels);
    }
    setupListDragContainer('btnlabels-list', 'btnlabel-row');
  });

  document.getElementById('optionsForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const klantnummer = document.getElementById('opt-klantnummer').value.trim();
    const communicatieKnoppen = document.getElementById('opt-knoppen').checked;
    const journaalResizer = document.getElementById('opt-resizer').checked;
    const declarerenNietOpGebeurd = document.getElementById('opt-declareren').checked;
    const juvolyKnop = document.getElementById('opt-juvoly').checked;
    const uprevent = document.getElementById('opt-uprevent').checked;
    const medicijnMarkeringen = document.getElementById('opt-medicijn').checked;
    const pdfExport = document.getElementById('opt-pdf-export').checked;
    const postverwerkingLab = document.getElementById('opt-postverwerking-lab').checked;
    const postverwerkingBrief = document.getElementById('opt-postverwerking-brief').checked;
    const zorgdomeinSnelkoppelingen = document.getElementById('opt-zorgdomein').checked;
    const btnLabels = collectBtnLabels();
    const { postTypenUit, postWeglaten, postKopjes } = collectPostverwerkingOpties();
    const postZdContact = document.getElementById('opt-zd-contact').value.trim();
    const { medicijnGroepenUit, medicijnHoogrisico, medicijnEigenGroepen } = collectMedicijnGroepen();
    const medicijnLabwaarden = document.getElementById('opt-medicijn-lab').checked;
    const medicijnLocaties = document.getElementById('opt-medicijn-locatie').checked;
    const medicijnLocatieGroepen = document.getElementById('opt-medicijn-locatiegroepen').value.trim();
    chrome.storage.local.set({ [LOCATIEKEUZE_SLEUTEL]: document.getElementById('opt-medicijn-locatiekeuze').value });
    setStorage({ postTypenUit, postWeglaten, postKopjes, postZdContact, medicijnLabwaarden, medicijnLocaties, medicijnLocatieGroepen, medicijnGroepenUit, medicijnHoogrisico, medicijnEigenGroepen, klantnummer, communicatieKnoppen, journaalResizer, declarerenNietOpGebeurd, juvolyKnop, uprevent, medicijnMarkeringen, pdfExport, postverwerkingLab, postverwerkingBrief, zorgdomeinSnelkoppelingen, btnLabels }, () => {
      document.getElementById('status').textContent = 'Opgeslagen!';
      setTimeout(() => document.getElementById('status').textContent = '', 1500);
    });
  });

  document.getElementById('medicijn-groep-toevoegen').addEventListener('click', () => {
    const rij = maakEigenGroepRij({ id: 'eigen-' + Date.now().toString(36), naam: '', kleur: '#fde68a', aan: true, woorden: [] });
    document.getElementById('medicijn-eigen-lijst').appendChild(rij);
    rij.querySelector('.mg-naam').focus();
  });

  document.getElementById('addBtnLabel').addEventListener('click', () => {
    addBtnLabelRow({ label: '', value: '' });
  });
  document.getElementById('zorgdomein-manage').addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'zorgdomein.openOptions' });
  });
  document.getElementById('closeOptions').addEventListener('click', () => {
    window.close();
  });
  
  // Klantnummer edit functionaliteit
  const klantnummerInput = document.getElementById('opt-klantnummer');
  const editKlantnummerBtn = document.getElementById('edit-klantnummer');
  
  editKlantnummerBtn.addEventListener('click', () => {
    // Enable editing and hide the edit button
    klantnummerInput.disabled = false;
    klantnummerInput.focus();
    editKlantnummerBtn.style.display = 'none';
  });
  
  // Show edit button again when form is submitted (after save)
  document.getElementById('optionsForm').addEventListener('submit', () => {
    // Re-enable the edit button after form submission
    setTimeout(() => {
      klantnummerInput.disabled = true;
      editKlantnummerBtn.style.display = 'inline-block';
    }, 100);
  });
  
  // Instellingen in- en exporteren functionaliteit
  document.getElementById('export-settings').addEventListener('click', () => {
    console.log('📤 Export instellingen naar Bricks account');
    
    // Haal alle instellingen op
    chrome.storage.sync.get(null, (settings) => {
      const requestId = Math.random().toString(36).substr(2, 9);
      const timestamp = Date.now();
      
      // Zet request in storage
      chrome.storage.local.set({
        exportSettingsRequest: {
          timestamp: timestamp,
          settings: settings,
          requestId: requestId
        }
      });
      
      // Toon "bezig" status
      document.getElementById('status').textContent = 'Export bezig...';
      
      // Poll voor response
      let pollCount = 0;
      const maxPolls = 80; // 8s — export gaat via Taken-API, geen pagina-navigatie
      const pollInterval = setInterval(() => {
        pollCount++;
        chrome.storage.local.get(['exportSettingsResponse', 'exportSettingsRequest'], (data) => {
          const response = data.exportSettingsResponse;
          const request = data.exportSettingsRequest;
          
          // Check of dit response voor deze request is (of request is weg = verwerkt)
          if (response && response.requestId === requestId) {
            clearInterval(pollInterval);
            chrome.storage.local.remove('exportSettingsResponse');
            
            if (response.success) {
              console.log('✅ Instellingen geëxporteerd');
              document.getElementById('status').textContent = 'Instellingen geëxporteerd!';
              setTimeout(() => document.getElementById('status').textContent = '', 2000);
            } else {
              console.log('❌ Export mislukt:', response.error);
              document.getElementById('status').textContent = response.error || 'Export mislukt';
              setTimeout(() => document.getElementById('status').textContent = '', 3000);
            }
          } else if (!request || request.requestId !== requestId) {
            // Request is verwijderd maar geen response = waarschijnlijk verwerkt
            clearInterval(pollInterval);
            console.log('✅ Export verzoek verwerkt');
            document.getElementById('status').textContent = 'Instellingen geëxporteerd!';
            setTimeout(() => document.getElementById('status').textContent = '', 2000);
          } else if (pollCount >= maxPolls) {
            // Timeout
            clearInterval(pollInterval);
            console.log('❌ Export timeout');
            document.getElementById('status').textContent = 'Geen Bricks pagina gevonden. Open eerst een Bricks pagina.';
            setTimeout(() => document.getElementById('status').textContent = '', 3000);
          }
        });
      }, 100); // Check elke 100ms
    });
  });
  
  document.getElementById('import-settings').addEventListener('click', () => {
    console.log('📥 Import instellingen uit Bricks account');
    
    const requestId = Math.random().toString(36).substr(2, 9);
    const timestamp = Date.now();
    
    // Zet request in storage
    chrome.storage.local.set({
      importSettingsRequest: {
        timestamp: timestamp,
        requestId: requestId
      }
    });
    
    // Toon "bezig" status
    document.getElementById('status').textContent = 'Import bezig...';
    
    // Poll voor response
    let pollCount = 0;
    const maxPolls = 80; // 8s — import gaat via Taken-API
    const pollInterval = setInterval(() => {
      pollCount++;
      chrome.storage.local.get(['importSettingsResponse', 'importSettingsRequest'], (data) => {
        const response = data.importSettingsResponse;
        const request = data.importSettingsRequest;
        
        // Check of dit response voor deze request is
        if (response && response.requestId === requestId) {
          clearInterval(pollInterval);
          chrome.storage.local.remove('importSettingsResponse');
          
          if (response.success) {
            console.log('✅ Instellingen geïmporteerd');
            if (response.settings) {
              // Sla de geïmporteerde instellingen op
              chrome.storage.sync.set(response.settings, () => {
                document.getElementById('status').textContent = 'Instellingen geïmporteerd! Herlaad de pagina om ze te zien.';
                setTimeout(() => {
                  document.getElementById('status').textContent = '';
                  // Optioneel: herlaad de pagina automatisch
                  // window.location.reload();
                }, 3000);
              });
            } else {
              document.getElementById('status').textContent = 'Geen instellingen gevonden in Bricks account.';
              setTimeout(() => document.getElementById('status').textContent = '', 3000);
            }
          } else {
            console.log('❌ Import mislukt:', response.error);
            document.getElementById('status').textContent = response.error || 'Import mislukt';
            setTimeout(() => document.getElementById('status').textContent = '', 3000);
          }
        } else if (pollCount >= maxPolls) {
          // Timeout
          clearInterval(pollInterval);
          console.log('❌ Import timeout');
          document.getElementById('status').textContent = 'Geen Bricks pagina gevonden. Open eerst een Bricks pagina.';
          setTimeout(() => document.getElementById('status').textContent = '', 3000);
        }
      });
    }, 100); // Check elke 100ms
  });
});

function renderBtnLabels(btnLabels) {
  const list = document.getElementById('btnlabels-list');
  list.innerHTML = '';
  (btnLabels || []).forEach((btn, idx) => {
    addBtnLabelRow(btn, idx);
  });
}

function addBtnLabelRow(btn, idx) {
  const list = document.getElementById('btnlabels-list');
  const row = document.createElement('div');
  row.className = 'btnlabel-row';
  row.draggable = true;
  row.innerHTML = `
    <span class="drag-handle" title="Sleep om te verplaatsen" style="cursor: move; user-select: none; margin-right: 6px;">↕</span>
    <input type="text" placeholder="Label" value="${btn.label || ''}">
    <input type="text" placeholder="Waarde" value="${btn.value || ''}">
    <span class="btn-remove" title="Verwijderen" style="margin-left:6px; cursor: pointer;">❌</span>
  `;
  row.querySelector('.btn-remove').onclick = () => {
    row.remove();
  };

  // Drag & drop reordering
  row.addEventListener('dragstart', (e) => {
    e.dataTransfer.effectAllowed = 'move';
    // Some browsers require data to be set
    e.dataTransfer.setData('text/plain', 'drag');
    row.classList.add('dragging');
    row.style.opacity = '0.5';
  });
  row.addEventListener('dragend', () => {
    console.log('Drag end on zorgdomein-link-row');
    row.classList.remove('dragging');
    row.style.opacity = '';
    const ph = getDragPlaceholder(listId);
    if (ph && ph.parentNode) ph.parentNode.removeChild(ph);
  });
  row.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    // Ignore when hovering over the row that's currently dragging
    if (row.classList.contains('dragging')) return;
    const rect = row.getBoundingClientRect();
    const before = (e.clientY - rect.top) < rect.height / 2;
            const ph = getDragPlaceholder(listId);
    if (before) {
      if (ph !== row.previousSibling) {
        list.insertBefore(ph, row);
      }
    } else {
      if (ph !== row.nextSibling) {
        list.insertBefore(ph, row.nextSibling);
      }
    }
  });
  row.addEventListener('drop', (e) => {
    e.preventDefault();
    const dragging = list.querySelector('.btnlabel-row.dragging');
            const ph = getDragPlaceholder(listId);
    if (!dragging || dragging === row) return;
    // Insert the dragging row at the placeholder position
    if (ph && ph.parentNode === list) {
      list.insertBefore(dragging, ph);
    }
    if (ph && ph.parentNode) ph.parentNode.removeChild(ph);
  });
  list.appendChild(row);
}

function collectBtnLabels() {
  const rows = document.querySelectorAll('.btnlabel-row');
  return Array.from(rows).map(row => {
    const inputs = row.querySelectorAll('input');
    return { label: inputs[0].value.trim(), value: inputs[1].value.trim() };
  }).filter(btn => btn.label && btn.value);
}
