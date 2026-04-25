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
function setStorage(data, cb) {
  if (chrome && chrome.storage && chrome.storage.sync) {
    chrome.storage.sync.set(data, cb);
  } else {
    localStorage.setItem('bricksOptions', JSON.stringify(data));
    if (cb) cb();
  }
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

  // Klik op het grijze blok (checkbox-item.has-expandable) klapt ook uit/in.
  // Uitzondering: klik op checkbox, label of pijltje behoudt het normale gedrag.
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
    document.getElementById('opt-medicijn').checked = data.medicijnMarkeringen !== false;
    document.getElementById('opt-pdf-export').checked = data.pdfExport !== false;
    document.getElementById('opt-zorgdomein').checked = data.zorgdomeinSnelkoppelingen !== false;
    document.getElementById('opt-zorgdomein-dashboard').checked = data.zorgdomeinDashboardLinks !== false;
    // Alleen renderen als er data bestaat
    if (data.btnLabels && data.btnLabels.length > 0) {
      console.log("btnLabels to render:", data.btnLabels);
      renderBtnLabels(data.btnLabels);
    }
    if (data.zorgdomeinLinks && data.zorgdomeinLinks.length > 0) {
      console.log("zorgdomeinLinks to render:", data.zorgdomeinLinks);
      renderZorgdomeinLinks(data.zorgdomeinLinks);
    }
    setupListDragContainer('btnlabels-list', 'btnlabel-row');
    setupListDragContainer('zorgdomein-links-list', 'zorgdomein-link-row');
  });

  document.getElementById('optionsForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const klantnummer = document.getElementById('opt-klantnummer').value.trim();
    const communicatieKnoppen = document.getElementById('opt-knoppen').checked;
    const journaalResizer = document.getElementById('opt-resizer').checked;
    const declarerenNietOpGebeurd = document.getElementById('opt-declareren').checked;
    const juvolyKnop = document.getElementById('opt-juvoly').checked;
    const medicijnMarkeringen = document.getElementById('opt-medicijn').checked;
    const pdfExport = document.getElementById('opt-pdf-export').checked;
    const zorgdomeinSnelkoppelingen = document.getElementById('opt-zorgdomein').checked;
    const zorgdomeinDashboardLinks = document.getElementById('opt-zorgdomein-dashboard').checked;
    const btnLabels = collectBtnLabels();
    const zorgdomeinLinks = collectZorgdomeinLinks();
    setStorage({ klantnummer, communicatieKnoppen, journaalResizer, declarerenNietOpGebeurd, juvolyKnop, medicijnMarkeringen, pdfExport, zorgdomeinSnelkoppelingen, zorgdomeinDashboardLinks, btnLabels, zorgdomeinLinks }, () => {
      document.getElementById('status').textContent = 'Opgeslagen!';
      setTimeout(() => document.getElementById('status').textContent = '', 1500);
    });
  });

  document.getElementById('addBtnLabel').addEventListener('click', () => {
    addBtnLabelRow({ label: '', value: '' });
  });
  document.getElementById('addZorgdomeinLink').addEventListener('click', () => {
    addZorgdomeinLinkRow({ name: '', link: '' });
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
      const maxPolls = 150; // 15 seconden (150 * 100ms) - export kan lang duren vanwege pagina navigatie
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
    const maxPolls = 150; // 15 seconden (150 * 100ms) - import kan lang duren vanwege pagina navigatie en dropdown interacties
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

function renderZorgdomeinLinks(zorgdomeinLinks) {
  const list = document.getElementById('zorgdomein-links-list');
  list.innerHTML = '';
  (zorgdomeinLinks || []).forEach((link, idx) => {
    addZorgdomeinLinkRow(link, idx);
  });
}

function addZorgdomeinLinkRow(link, idx) {
  const list = document.getElementById('zorgdomein-links-list');
  const row = document.createElement('div');
  row.className = 'zorgdomein-link-row';
  row.draggable = true;
  row.innerHTML = `
    <span class="drag-handle" title="Sleep om te verplaatsen" style="cursor: move; user-select: none; margin-right: 6px;">↕</span>
    <input type="text" placeholder="Naam" value="${link.name || ''}">
    <input type="text" placeholder="Pad (bijv. /supply-matcher/supply)" value="${link.link || ''}">
    <input type="checkbox" class="episodelijst-checkbox" style="display: none;" ${link.episodelijstNodig ? 'checked' : ''}>
    <span class="episodelijst-toggle" title="episodelijst wordt niet gevraagd, klik om te veranderen">⚕️</span>
    <span class="btn-remove" title="Verwijderen" style="margin-left:6px; cursor: pointer;">❌</span>
  `;
  row.querySelector('.btn-remove').onclick = () => {
    row.remove();
  };

  // Episodelijst toggle functionality
  const episodelijstToggle = row.querySelector('.episodelijst-toggle');
  const episodelijstCheckbox = row.querySelector('.episodelijst-checkbox');
  
  // Initialize display
  updateEpisodelijstDisplay(episodelijstToggle, episodelijstCheckbox);
  
  // Add click handler
  episodelijstToggle.addEventListener('click', () => {
    episodelijstCheckbox.checked = !episodelijstCheckbox.checked;
    updateEpisodelijstDisplay(episodelijstToggle, episodelijstCheckbox);
  });

  // Drag & drop reordering - gebruik dezelfde logica als btnlabel-row
  row.addEventListener('dragstart', (e) => {
    console.log('Drag start on zorgdomein-link-row');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', 'drag');
    row.classList.add('dragging');
    row.style.opacity = '0.5';
  });
  row.addEventListener('dragend', () => {
    console.log('Drag end on zorgdomein-link-row');
    row.classList.remove('dragging');
    row.style.opacity = '';
    const ph = getDragPlaceholder('zorgdomein-links-list');
    if (ph && ph.parentNode) ph.parentNode.removeChild(ph);
  });
  row.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (row.classList.contains('dragging')) return;
    const rect = row.getBoundingClientRect();
    const before = (e.clientY - rect.top) < rect.height / 2;
    const ph = getDragPlaceholder('zorgdomein-links-list');
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
  list.appendChild(row);
}

function collectZorgdomeinLinks() {
  const rows = document.querySelectorAll('.zorgdomein-link-row');
  return Array.from(rows).map(row => {
    const inputs = row.querySelectorAll('input');
    const episodelijstCheckbox = row.querySelector('.episodelijst-checkbox');
    return { 
      name: inputs[0].value.trim(), 
      link: inputs[1].value.trim(),
      episodelijstNodig: episodelijstCheckbox ? episodelijstCheckbox.checked : false
    };
  }).filter(link => link.name); // Only require name, link can be empty
}

function updateEpisodelijstDisplay(toggle, checkbox) {
  if (checkbox.checked) {
    toggle.classList.add('active');
    toggle.title = 'episodelijst wordt gevraagd, klik om te veranderen';
  } else {
    toggle.classList.remove('active');
    toggle.title = 'episodelijst wordt niet gevraagd, klik om te veranderen';
  }
}
