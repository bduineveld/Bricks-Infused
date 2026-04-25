///////////////////////////////// GLOBAL OPTIONS CACHE //////////////////////////////////////////////////////////////
let globalOptions = null;
let optionsLoaded = false;
let optionsTimestamp = null;

// Gemeenschappelijke functie om Taken pagina te openen en filter op Afgehandeld te zetten
function openTakenAndSetFilter(callback) {
  // Klik op de "Taken" knop in de navbar
  const takenLink = Array.from(document.querySelectorAll('.navbar-links a')).find(link => {
    const span = link.querySelector('span');
    return span && span.textContent.trim() === 'Taken';
  });
  
  if (!takenLink) {
    console.log('❌ Taken knop niet gevonden');
    if (callback) callback(false, 'Taken knop niet gevonden');
    return;
  }
  
  console.log('📤 Klikken op Taken knop');
  takenLink.click();
  
  // Wacht tot de pagina geladen is en zet filter op "Afgehandeld"
  let checkCount = 0;
  const maxChecks = 50; // 5 seconden
  const checkInterval = setInterval(() => {
    checkCount++;
    
    if (window.location.pathname.includes('/taken')) {
      clearInterval(checkInterval);
      
      // Wacht even voor DOM update
      setTimeout(() => {
        // Zoek de "Toon" dropdown en zet op "Afgehandeld"
        const toonDivs = Array.from(document.querySelectorAll('.widget-topbar .font-semibold'));
        const toonDiv = toonDivs.find(div => div.textContent.trim() === 'Toon');
        
        if (!toonDiv) {
          console.log('❌ "Toon" div niet gevonden');
          if (callback) callback(false, 'Toon div niet gevonden');
          return;
        }
        
        const formDropdown = toonDiv.nextElementSibling;
        if (!formDropdown || !formDropdown.classList.contains('form-dropdown')) {
          console.log('❌ Form dropdown niet gevonden na Toon');
          if (callback) callback(false, 'Form dropdown niet gevonden');
          return;
        }
        
        const dropdownBtn = formDropdown.querySelector('.dropdownBtn');
        if (!dropdownBtn) {
          console.log('❌ Dropdown knop niet gevonden');
          if (callback) callback(false, 'Dropdown knop niet gevonden');
          return;
        }
        
        // Check huidige waarde
        const input = formDropdown.querySelector('input.form-input.dropdown');
        const currentValue = input ? input.value : '';
        
        if (currentValue === 'Afgehandeld') {
          // Al op Afgehandeld, direct callback
          if (callback) callback(true, currentValue);
        } else {
          // Klik op dropdown en zet op "Afgehandeld"
          console.log('📤 Zet filter op "Afgehandeld"');
          dropdownBtn.click();
          
          // Wacht tot dropdown open is
          let dropdownCheckCount = 0;
          const maxDropdownChecks = 20;
          const dropdownCheckInterval = setInterval(() => {
            dropdownCheckCount++;
            
            if (dropdownCheckCount >= maxDropdownChecks) {
              clearInterval(dropdownCheckInterval);
              if (callback) callback(false, 'Dropdown niet geopend');
              return;
            }
            
            const dropdownItems = document.querySelector('.dropdown-items');
            if (!dropdownItems || !dropdownItems.querySelector('ul')) {
              return; // Nog niet open
            }
            
            clearInterval(dropdownCheckInterval);
            
            // Vind "Afgehandeld" item
            const afgehandeldItem = Array.from(dropdownItems.querySelectorAll('li')).find(li => {
              const span = li.querySelector('span');
              return span && span.textContent.trim() === 'Afgehandeld';
            });
            
            if (!afgehandeldItem) {
              if (callback) callback(false, 'Afgehandeld item niet gevonden');
              return;
            }
            
            console.log('📤 Klikken op "Afgehandeld" in dropdown');
            afgehandeldItem.click();
            
            // Wacht tot dropdown gesloten is
            setTimeout(() => {
              if (callback) callback(true, currentValue);
            }, 500);
          }, 100);
        }
      }, 300);
    } else if (checkCount >= maxChecks) {
      clearInterval(checkInterval);
      if (callback) callback(false, 'Taken pagina niet geladen');
    }
  }, 100);
}

// Check periodiek of er export/import requests zijn via storage
let lastExportCheck = 0;
let lastImportCheck = 0;
setInterval(() => {
  // Check export request
  chrome.storage.local.get('exportSettingsRequest', (data) => {
    if (!data.exportSettingsRequest) { return; }
    const request = data.exportSettingsRequest;
    // Alleen als request nieuw is (binnen laatste 2 seconden) en we op Bricks zijn
    if (window.location.hostname !== 'brickshuisarts.nl' || 
        Date.now() - request.timestamp > 2000 || 
        request.timestamp <= lastExportCheck) {
      return;
    }
    lastExportCheck = request.timestamp;
    console.log('📤 Export instellingen verzoek ontvangen via storage:', request.settings);
    
    // Verwijder het request
    chrome.storage.local.remove('exportSettingsRequest');
    
    // Open Taken pagina en zet filter op Afgehandeld
    openTakenAndSetFilter((success, originalFilter) => {
      if (!success) {
        chrome.storage.local.set({
          exportSettingsResponse: {
            requestId: request.requestId,
            success: false,
            handled: true,
            error: originalFilter
          }
        });
        return;
      }
      
      // Export de instellingen
      exportSettingsToBricks(request.settings, request.requestId, originalFilter);
    });
  });
  
  // Check import request
  chrome.storage.local.get('importSettingsRequest', (data) => {
    if (!data.importSettingsRequest) { return false; }
    const request = data.importSettingsRequest;
    // Alleen als request nieuw is (binnen laatste 2 seconden) en we op Bricks zijn
    if (window.location.hostname !== 'brickshuisarts.nl' || Date.now() - request.timestamp > 2000 || request.timestamp < lastImportCheck) {
        return false;
    }
    lastImportCheck = request.timestamp;
    console.log('📥 Import instellingen verzoek ontvangen via storage');
    
    // Verwijder het request
    chrome.storage.local.remove('importSettingsRequest');
    
    // Open Taken pagina en zet filter op Afgehandeld
    openTakenAndSetFilter((success, originalFilter) => {
      if (!success) {
        chrome.storage.local.set({
          importSettingsResponse: {
            requestId: request.requestId,
            success: false,
            handled: true,
            error: originalFilter
          }
        });
        return;
      }
      
      // Lees de huidige waarde voor later terugzetten
      const toonDivs = Array.from(document.querySelectorAll('.widget-topbar .font-semibold'));
      const toonDiv = toonDivs.find(div => div.textContent.trim() === 'Toon');
      const formDropdown = toonDiv ? toonDiv.nextElementSibling : null;
      const input = formDropdown ? formDropdown.querySelector('input.form-input.dropdown') : null;
      const type_taak = input ? input.value : '';
      
      // Flag om te voorkomen dat callback meerdere keren wordt uitgevoerd
      let callbackExecuted = false;
      
      // Functie om response te sturen (alleen eenmaal)
      const sendResponse = (settingsContent) => {
        if (callbackExecuted) return;
        callbackExecuted = true;
        chrome.storage.local.set({ 
          importSettingsResponse: { 
            requestId: request.requestId, 
            success: true, 
            handled: true, 
            settings: settingsContent 
          } 
        });
      };
      
      // Functie om terug te zetten (alleen eenmaal)
      const resetTypeTaak = (settingsContent) => {
        if (type_taak !== 'Afgehandeld' && formDropdown) {
          const dropdownBtn = formDropdown.querySelector('.dropdownBtn');
          if (dropdownBtn) {
            // Klik opnieuw op dropdown
            dropdownBtn.click();
            
            // Wacht en klik op originele waarde
            setTimeout(() => {
              const dropdownItems2 = document.querySelector('.dropdown-items');
              if (!dropdownItems2) {
                sendResponse(settingsContent);
                return;
              }
              
              const originalItem = Array.from(dropdownItems2.querySelectorAll('li')).find(li => {
                const span = li.querySelector('span');
                return span && span.textContent.trim() === type_taak;
              });
              
              if (originalItem) {
                console.log('📥 Type taak teruggezet op:', type_taak);
                originalItem.click();
              }
              
              sendResponse(settingsContent);
            }, 300);
          } else {
            sendResponse(settingsContent);
          }
        } else {
          sendResponse(settingsContent);
        }
      };
      
      // Wacht even en lees instellingen
      setTimeout(() => {
        console.log('📥 Type taak tijdelijk op "Afgehandeld" gezet');
        readSettingsFromBricks((settingsContent) => {
          resetTypeTaak(settingsContent);
        });
      }, 500);
    });
  });
}, 200); // Check elke 200ms

// Placeholder functie voor het uitlezen van instellingen uit Bricks
function readSettingsFromBricks(callback) {
  console.log('📥 Instellingen uitlezen uit Bricks');
  
  let checkCount = 0;
  const maxChecks = 10; // 10 * 250ms = 2.5 seconden
  const checkInterval = 250; // Check elke 250ms
  let intervalId = null;
  let callbackExecuted = false; // Voorkom dubbele callback
  
  const tryReadSettings = () => {
    checkCount++;
    
    // Als callback al is uitgevoerd, stop
    if (callbackExecuted) {
      if (intervalId) clearInterval(intervalId);
      return;
    }
    
    // Zoek naar de taak "Bricks Infused Instellingen"
    const taakItems = document.querySelectorAll('.taak-list .taak-item');
    let settingsContent = null;
    
    for (const taakItem of taakItems) {
      // Zoek de titel div
      const titleDiv = taakItem.querySelector('.nowrap.font-semibold');
      if (titleDiv && titleDiv.textContent.trim() === 'Bricks Infused Instellingen') {
        // Vind de inhoud div (direct na de titleDiv in dezelfde parent)
        const contentDiv = titleDiv.parentElement.querySelector('.flex');
        if (contentDiv) {
          settingsContent = contentDiv.textContent.trim();
          if (settingsContent) {
            console.log('📥 Instellingen gevonden:', settingsContent);
            callbackExecuted = true;
            if (intervalId) clearInterval(intervalId);
            if (callback) callback(settingsContent);
            return;
          }
        }
      }
    }
    
    // Als niet gevonden en timeout bereikt
    if (checkCount >= maxChecks && !callbackExecuted) {
      callbackExecuted = true;
      if (intervalId) clearInterval(intervalId);
      console.log('📥 Instellingen niet gevonden na', (maxChecks * checkInterval), 'ms');
      if (callback) callback(null);
    }
  };
  
  // Start direct een check
  tryReadSettings();
  
  // Continueer met checks elke 250ms
  intervalId = setInterval(tryReadSettings, checkInterval);
}

// Functie om filter terug te zetten naar originele waarde
function resetFilter(originalFilter, callback) {
  if (originalFilter === 'Afgehandeld') {
    if (callback) callback();
    return;
  }
  
  const toonDivs = Array.from(document.querySelectorAll('.widget-topbar .font-semibold'));
  const toonDiv = toonDivs.find(div => div.textContent.trim() === 'Toon');
  if (!toonDiv) {
    if (callback) callback();
    return;
  }
  
  const formDropdown = toonDiv.nextElementSibling;
  if (!formDropdown || !formDropdown.classList.contains('form-dropdown')) {
    if (callback) callback();
    return;
  }
  
  const dropdownBtn = formDropdown.querySelector('.dropdownBtn');
  if (!dropdownBtn) {
    if (callback) callback();
    return;
  }
  
  console.log('📤 Filter terugzetten op:', originalFilter);
  dropdownBtn.click();
  
  // Wacht tot dropdown open is
  let dropdownCheckCount = 0;
  const maxDropdownChecks = 20;
  const dropdownCheckInterval = setInterval(() => {
    dropdownCheckCount++;
    
    if (dropdownCheckCount >= maxDropdownChecks) {
      clearInterval(dropdownCheckInterval);
      if (callback) callback();
      return;
    }
    
    const dropdownItems = document.querySelector('.dropdown-items');
    if (!dropdownItems || !dropdownItems.querySelector('ul')) {
      return; // Nog niet open
    }
    
    clearInterval(dropdownCheckInterval);
    
    // Vind originele item
    const originalItem = Array.from(dropdownItems.querySelectorAll('li')).find(li => {
      const span = li.querySelector('span');
      return span && span.textContent.trim() === originalFilter;
    });
    
    if (originalItem) {
      originalItem.click();
    }
    
    if (callback) callback();
  }, 100);
}

// Functie om instellingen naar Bricks te exporteren
function exportSettingsToBricks(settings, requestId, originalFilter) {
  console.log('📤 Export instellingen naar Bricks');
  
  // Zet instellingen om naar JSON
  const settingsJson = JSON.stringify(settings, null, 2);
  
  // Functie om response te sturen
  const sendResponse = (success, error) => {
    chrome.storage.local.set({
      exportSettingsResponse: {
        requestId: requestId,
        success: success,
        handled: true,
        error: error
      }
    });
  };
  
  // Functie om filter terug te zetten en response te sturen
  const finishExport = (success, error) => {
    resetFilter(originalFilter, () => {
      sendResponse(success, error);
    });
  };
  
  // Zoek naar "Bricks Infused Instellingen" taak
  let checkCount = 0;
  const maxChecks = 10;
  const checkInterval = setInterval(() => {
    checkCount++;
    
    const taakItems = document.querySelectorAll('.taak-list .taak-item');
    let foundTask = null;
    
    for (const taakItem of taakItems) {
      const titleDiv = taakItem.querySelector('.nowrap.font-semibold');
      if (titleDiv && titleDiv.textContent.trim() === 'Bricks Infused Instellingen') {
        foundTask = taakItem;
        break;
      }
    }
    
    if (foundTask) {
      clearInterval(checkInterval);
      console.log('📤 Bestaande taak gevonden, klik erop');
      
      // Klik op de taak
      foundTask.click();
      
      // Wacht tot dialoog open is
      let dialogCheckCount = 0;
      const maxDialogChecks = 20;
      const dialogCheckInterval = setInterval(() => {
        dialogCheckCount++;
        
        if (dialogCheckCount >= maxDialogChecks) {
          clearInterval(dialogCheckInterval);
          finishExport(false, 'Dialoog niet geopend');
          return;
        }
        
        const textarea = document.querySelector('.taak-dialoog-content .form-textbox textarea');
        if (!textarea) {
          return; // Nog niet open
        }
        
        clearInterval(dialogCheckInterval);
        
        // Vul omschrijving in
        console.log('📤 Vul omschrijving in');
        textarea.value = settingsJson;
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        textarea.dispatchEvent(new Event('change', { bubbles: true }));
        
        // Wacht even en klik opslaan
        setTimeout(() => {
          const saveButton = document.querySelector('.modal-dialog .footer-buttons .right button.btn-secondary');
          if (!saveButton) {
            finishExport(false, 'Opslaan knop niet gevonden');
            return;
          }
          
          console.log('📤 Klik op opslaan');
          saveButton.click();
          
          // Wacht even en zet filter terug
          setTimeout(() => {
            finishExport(true);
          }, 500);
        }, 300);
      }, 100);
      
      return;
    }
    
    // Als niet gevonden en timeout bereikt, maak nieuwe taak
    if (checkCount >= maxChecks) {
      clearInterval(checkInterval);
      console.log('📤 Taak niet gevonden, maak nieuwe taak');
      
      // Klik op nieuwe taak button
      const newTaskButton = document.querySelector('.takenview .area-taakbuttons .buttonbar .right button');
      if (!newTaskButton) {
        finishExport(false, 'Nieuwe taak knop niet gevonden');
        return;
      }
      
      newTaskButton.click();
      
      // Wacht tot dialoog open is
      let dialogCheckCount = 0;
      const maxDialogChecks = 20;
      const dialogCheckInterval = setInterval(() => {
        dialogCheckCount++;
        
        if (dialogCheckCount >= maxDialogChecks) {
          clearInterval(dialogCheckInterval);
          finishExport(false, 'Dialoog niet geopend');
          return;
        }
        
        // Check of dialoog open is door te zoeken naar Status dropdown
        const statusLabels = Array.from(document.querySelectorAll('.taak-dialoog-content .title'));
        const statusLabel = statusLabels.find(label => label.textContent.trim() === 'Status');
        if (!statusLabel) {
          return; // Nog niet open
        }
        
        const statusContainer = statusLabel.parentElement;
        const statusDropdown = statusContainer ? statusContainer.querySelector('.form-dropdown input.form-input.dropdown') : null;
        if (!statusDropdown) {
          return; // Nog niet open
        }
        
        clearInterval(dialogCheckInterval);
        
        // Eerst: Vul titel in
        console.log('📤 Vul titel in');
        const titleLabels = Array.from(document.querySelectorAll('.taak-dialoog-content .title'));
        const titleLabel = titleLabels.find(label => label.textContent.trim() === 'Titel');
        let titleInput = null;
        if (titleLabel) {
          const titleContainer = titleLabel.parentElement;
          titleInput = titleContainer ? titleContainer.querySelector('input.form-input') : null;
        }
        // Fallback: zoek naar input in grid
        if (!titleInput) {
          titleInput = document.querySelector('.taak-dialoog-content .grid input.form-input');
        }
        if (titleInput) {
          titleInput.value = 'Bricks Infused Instellingen';
          titleInput.dispatchEvent(new Event('input', { bubbles: true }));
          titleInput.dispatchEvent(new Event('change', { bubbles: true }));
        }
        
        // Dan: Vul omschrijving in
        console.log('📤 Vul omschrijving in');
        const textarea = document.querySelector('.taak-dialoog-content .form-textbox textarea');
        if (textarea) {
          textarea.value = settingsJson;
          textarea.dispatchEvent(new Event('input', { bubbles: true }));
          textarea.dispatchEvent(new Event('change', { bubbles: true }));
        }
        
        // Dan: Klik "Mezelf" button
        setTimeout(() => {
          console.log('📤 Klik op "Mezelf"');
          // Zoek naar "Toekennen aan" sectie en klik op "Mezelf" button
          const toekennenLabels = Array.from(document.querySelectorAll('.taak-dialoog-content .title'));
          const toekennenLabel = toekennenLabels.find(label => label.textContent.includes('Toekennen aan'));
          let mezelfButton = null;
          if (toekennenLabel) {
            const toekennenContainer = toekennenLabel.parentElement;
            const buttons = toekennenContainer ? toekennenContainer.querySelectorAll('button.btn-secondary') : [];
            mezelfButton = Array.from(buttons).find(btn => btn.textContent.trim() === 'Mezelf');
          }
          // Fallback: zoek naar alle buttons met "Mezelf" tekst
          if (!mezelfButton) {
            const allButtons = Array.from(document.querySelectorAll('.taak-dialoog-content button.btn-secondary'));
            mezelfButton = allButtons.find(btn => btn.textContent.trim() === 'Mezelf');
          }
          
          if (mezelfButton) {
            mezelfButton.click();
          }
          
          // Dan: Zet status op "Afgehandeld"
          setTimeout(() => {
            console.log('📤 Zet status op "Afgehandeld"');
            const statusDropdownBtn = statusDropdown.parentElement.querySelector('.dropdownBtn');
            if (!statusDropdownBtn) {
              finishExport(false, 'Status dropdown knop niet gevonden');
              return;
            }
            
            statusDropdownBtn.click();
            
            // Wacht tot dropdown open is met polling
            let statusDropdownCheckCount = 0;
            const maxStatusDropdownChecks = 20;
            const statusDropdownCheckInterval = setInterval(() => {
              statusDropdownCheckCount++;
              
              if (statusDropdownCheckCount >= maxStatusDropdownChecks) {
                clearInterval(statusDropdownCheckInterval);
                finishExport(false, 'Status dropdown niet geopend');
                return;
              }
              
              // Zoek naar de juiste dropdown - de status dropdown heeft "Open" als eerste item en 3 items totaal
              const allDropdowns = document.querySelectorAll('.dropdown-items');
              let dropdownItems = null;
              
              for (const dropdown of allDropdowns) {
                const items = dropdown.querySelectorAll('li');
                if (items.length === 3) {
                  // Check of eerste item "Open" is
                  const firstItem = items[0];
                  const firstSpan = firstItem ? firstItem.querySelector('span') : null;
                  if (firstSpan && firstSpan.textContent.trim() === 'Open') {
                    dropdownItems = dropdown;
                    break;
                  }
                }
              }
              
              if (!dropdownItems || !dropdownItems.querySelector('ul')) {
                return; // Status dropdown nog niet open, blijf wachten
              }
              
              clearInterval(statusDropdownCheckInterval);
              
              // Wacht even tot items volledig gerenderd zijn
              setTimeout(() => {
                // Vind "Afgehandeld" item - zoek in de dropdown items
                const allItems = dropdownItems.querySelectorAll('li');
                console.log('📤 Aantal dropdown items gevonden in status dropdown:', allItems.length);
                
                let afgehandeldItem = null;
                for (const li of allItems) {
                  const span = li.querySelector('span');
                  if (span) {
                    const text = span.textContent.trim();
                    console.log('📤 Status dropdown item tekst:', text);
                    if (text === 'Afgehandeld') {
                      afgehandeldItem = li;
                      break;
                    }
                  }
                }
                
                if (!afgehandeldItem) {
                  console.log('❌ Afgehandeld item niet gevonden');
                  finishExport(false, 'Afgehandeld item niet gevonden in status dropdown');
                  return;
                }
                
                console.log('📤 Klik op "Afgehandeld" in status dropdown');
                
                // Creëer een MouseEvent en klik op het li element
                const clickEvent = new MouseEvent('click', {
                  bubbles: true,
                  cancelable: true,
                  view: window
                });
                
                // Probeer meerdere manieren om te klikken
                afgehandeldItem.dispatchEvent(clickEvent);
                afgehandeldItem.click();
                
                // Functie om status te checken en op opslaan te klikken
                const startStatusCheckAndSave = () => {
                  // Wacht even voordat we beginnen met checken (geef dropdown tijd om te sluiten)
                  setTimeout(() => {
                    // Wacht tot dropdown gesloten is en status op "Afgehandeld" is gezet
                    let statusCheckCount = 0;
                    const maxStatusChecks = 30;
                    const statusCheckInterval = setInterval(() => {
                      statusCheckCount++;
                      
                      if (statusCheckCount >= maxStatusChecks) {
                        clearInterval(statusCheckInterval);
                        console.log('❌ Status check timeout');
                        finishExport(false, 'Status niet op Afgehandeld gezet');
                        return;
                      }
                      
                      // Check of status dropdown nog open is - ALLEEN binnen de modal
                      const modal = document.querySelector('.modal-dialog');
                      if (!modal) {
                        console.log('❌ Modal niet gevonden');
                        clearInterval(statusCheckInterval);
                        finishExport(false, 'Modal niet gevonden');
                        return;
                      }
                      
                      // Zoek alleen dropdowns binnen de modal
                      const modalDropdowns = modal.querySelectorAll('.dropdown-items');
                      let statusDropdownOpen = false;
                      for (const dropdown of modalDropdowns) {
                        const items = dropdown.querySelectorAll('li');
                        if (items.length === 3) {
                          const firstItem = items[0];
                          const firstSpan = firstItem ? firstItem.querySelector('span') : null;
                          if (firstSpan && firstSpan.textContent.trim() === 'Open') {
                            statusDropdownOpen = true;
                            break;
                          }
                        }
                      }
                      
                      if (statusDropdownOpen) {
                        console.log('📤 Status dropdown nog open, wacht...');
                        return;
                      }
                      
                      // Dropdown is gesloten, check of status op "Afgehandeld" is gezet
                      const statusLabels = Array.from(modal.querySelectorAll('.taak-dialoog-content .title'));
                      const statusLabel = statusLabels.find(label => label.textContent.trim() === 'Status');
                      const statusContainer = statusLabel ? statusLabel.parentElement : null;
                      const statusInput = statusContainer ? statusContainer.querySelector('.form-dropdown input.form-input.dropdown') : null;
                      
                      console.log('📤 Check status waarde:', statusInput ? statusInput.value : 'statusInput niet gevonden');
                      
                      if (statusInput && statusInput.value === 'Afgehandeld') {
                        clearInterval(statusCheckInterval);
                        console.log('📤 Status is correct op "Afgehandeld", ga naar opslaan');
                        
                        setTimeout(() => {
                          console.log('📤 Zoek naar opslaan knop...');
                          
                          // Probeer verschillende selectors
                          let saveButton = modal.querySelector('.footer-buttons .right button.btn-secondary');
                          if (!saveButton) {
                            console.log('📤 Probeer selector zonder .right');
                            saveButton = modal.querySelector('.footer-buttons button.btn-secondary');
                          }
                          if (!saveButton) {
                            console.log('📤 Probeer alle buttons in footer');
                            const footerButtons = modal.querySelectorAll('.footer-buttons button');
                            console.log('📤 Aantal buttons gevonden:', footerButtons.length);
                            for (let i = 0; i < footerButtons.length; i++) {
                              const btn = footerButtons[i];
                              console.log('📤 Button', i, ':', btn.className, btn.textContent.trim());
                              if (btn.textContent.trim().toLowerCase().includes('opslaan') || btn.textContent.trim().toLowerCase().includes('save')) {
                                saveButton = btn;
                                break;
                              }
                            }
                          }
                          if (!saveButton) {
                            // Probeer de laatste button in footer
                            const footerButtons = modal.querySelectorAll('.footer-buttons button');
                            if (footerButtons.length > 0) {
                              saveButton = footerButtons[footerButtons.length - 1];
                              console.log('📤 Gebruik laatste button in footer');
                            }
                          }
                          
                          if (!saveButton) {
                            console.log('❌ Opslaan knop niet gevonden');
                            finishExport(false, 'Opslaan knop niet gevonden');
                            return;
                          }
                          
                          console.log('📤 Opslaan knop gevonden:', saveButton.className, saveButton.textContent.trim());
                          saveButton.click();
                          setTimeout(() => finishExport(true), 500);
                        }, 100);
                      } else {
                        console.log('📤 Status nog niet correct, blijf wachten... (check', statusCheckCount, 'van', maxStatusChecks, ')');
                      }
                    }, 150);
                  }, 300); // Wacht 300ms voordat we beginnen met checken
                };
                
                // Als dat niet werkt, probeer dan op de span of div te klikken
                setTimeout(() => {
                  // Check of de status dropdown nog open is (betekent dat klik niet werkte)
                  const allDropdownsCheck = document.querySelectorAll('.dropdown-items');
                  let stillOpen = false;
                  for (const dropdown of allDropdownsCheck) {
                    const items = dropdown.querySelectorAll('li');
                    if (items.length === 3) {
                      const firstItem = items[0];
                      const firstSpan = firstItem ? firstItem.querySelector('span') : null;
                      if (firstSpan && firstSpan.textContent.trim() === 'Open') {
                        stillOpen = true;
                        break;
                      }
                    }
                  }
                  
                  if (stillOpen) {
                    console.log('📤 Dropdown nog open, probeer alternatieve klik');
                    // Probeer op de div met class "split-text" te klikken
                    const splitTextDiv = afgehandeldItem.querySelector('.split-text');
                    if (splitTextDiv) {
                      const altClickEvent = new MouseEvent('click', {
                        bubbles: true,
                        cancelable: true,
                        view: window
                      });
                      splitTextDiv.click();
                      splitTextDiv.dispatchEvent(altClickEvent);
                    }
                    // Probeer ook op de span
                    const span = afgehandeldItem.querySelector('span');
                    if (span) {
                      const spanClickEvent = new MouseEvent('click', {
                        bubbles: true,
                        cancelable: true,
                        view: window
                      });
                      span.click();
                      span.dispatchEvent(spanClickEvent);
                    }
                    
                    // Wacht iets langer na alternatieve klik
                    setTimeout(startStatusCheckAndSave, 200);
                  } else {
                    // Dropdown was al gesloten, start direct status check
                    startStatusCheckAndSave();
                  }
                }, 100);
              }, 100);
            }, 100);
          }, 300);
        }, 300);
      }, 100);
    }
  }, 250);
}

// Functie om klantnummer te detecteren en op te slaan
function detectAndSaveKlantnummer() {
    chrome.storage.sync.get(['klantnummer'], (result) => {
        if (!result.klantnummer) {
            // Probeer klantnummer te detecteren uit URL
            const url = window.location.href;
            const match = url.match(/https:\/\/brickshuisarts\.nl\/(\d+)(?:\/.*)?$/);
            if (match && match[1]) {
                const klantnummer = match[1];
                console.log('Klantnummer gedetecteerd:', klantnummer);
                chrome.storage.sync.set({ klantnummer }, () => {
                    console.log('Klantnummer opgeslagen:', klantnummer);
                });
            }
        }
    });
}

function loadGlobalOptions(callback) {
    // Check if options are cached and less than 10 seconds old
    if (optionsLoaded && globalOptions && optionsTimestamp) {
        const age = Date.now() - optionsTimestamp;
        if (age < 10000) { // 10 seconds
            callback(globalOptions);
            return;
        } else {
            // Reset cache to force reload
            optionsLoaded = false;
            globalOptions = null;
            optionsTimestamp = null;
        }
    }
    
    if (chrome && chrome.storage && chrome.storage.sync) {
        chrome.storage.sync.get(null, function(data) {
            if (data && Object.keys(data).length > 0) {
                globalOptions = data;
                optionsTimestamp = Date.now();
                optionsLoaded = true;
                callback(globalOptions);
            } else {
                chrome.runtime.sendMessage({ type: 'getDefaults' }, (resp) => {
                    globalOptions = resp.defaultOptions;
                    optionsTimestamp = Date.now();
                    optionsLoaded = true;
                    callback(globalOptions);
                });
                return;
            }
        });
    } else {
        chrome.runtime.sendMessage({ type: 'getDefaults' }, (resp) => {
            globalOptions = resp.defaultOptions;
            optionsTimestamp = Date.now();
            optionsLoaded = true;
            callback(globalOptions);
        });
    }
}

///////////////////////////////// COMMUNICATIE KNOPPEN TOEVOEGEN //////////////////////////////////////////////////////////////
function communicatie_getOptionsFromStorage(cb) {
    console.log("communicatie_getOptionsFromStorage called");
    loadGlobalOptions(function(options) {
        console.log("Global options received:", options);
        cb({
            communicatieKnoppen: options.communicatieKnoppen !== false,
            btnLabels: options.btnLabels || []
        });
    });
}

function communicatie_add_contact_button(type) {
    console.log("communicatie_add_contact_button called");
    
    // Controleer eerst of er al knoppen bestaan
    const existingButtons = document.querySelector('.contact-buttons');
    if (existingButtons) {
        console.log("Contact buttons already exist, skipping add_contact_button");
        return;
    }
    
    communicatie_getOptionsFromStorage(function(opts) {
        console.log("Options received in add_contact_button:", opts);
        if (!opts.communicatieKnoppen) {
            console.log("Communicatie knoppen disabled, returning");
            return;
        }
        console.log("Communicatie knoppen enabled, proceeding");
        const labelDiv = document.querySelector('.koppelinfo-header .koppelinfo-contact .font-semibold');
        console.log("labelDiv found:", !!labelDiv);
        console.log("labelDiv element:", labelDiv);
        
        if (labelDiv) {
            const btnLabels = opts.btnLabels;
            console.log("btnLabels to use:", btnLabels);
            const btnContainer = document.createElement('div');
            btnContainer.className = 'contact-buttons';
            btnContainer.style.display = 'inline-flex';
            btnContainer.style.gap = '4px';
            btnLabels.forEach(btn => {
                const button = document.createElement('button');
                button.textContent = btn.label;
                button.style.borderRadius = '12px';
                button.style.padding = '2px 10px';
                button.style.border = '1px solid #ccc';
                button.style.background = '#f5f5f5';
                button.style.cursor = 'pointer';
                button.style.fontSize = '0.9em';
                button.addEventListener('click', () => communicatie_changeContact(btn.value));
                btnContainer.appendChild(button);
            });
			// Voeg tekst-links toe: Instellingen en Vernieuwen (geen button-look)
			const settingsLink = document.createElement('span');
			settingsLink.title = 'Instellingen';
			settingsLink.textContent = '⚙️';
			settingsLink.style.cursor = 'pointer';
			settingsLink.style.textDecoration = 'none';
			settingsLink.style.color = '#0077cc';
			settingsLink.style.fontSize = '1.2em';
			settingsLink.style.marginTop = '2px';   
			settingsLink.addEventListener('click', () => communicatie_openOptions());
			btnContainer.appendChild(settingsLink);

			const refreshLink = document.createElement('span');
			refreshLink.title = 'Vernieuwen';
			refreshLink.textContent = '🔄';
			refreshLink.style.cursor = 'pointer';
			refreshLink.style.textDecoration = 'none';
			refreshLink.style.color = '#0077cc';
			refreshLink.style.fontSize = '1.2em';
			refreshLink.style.marginTop = '2px';   
			refreshLink.addEventListener('click', () => communicatie_refreshButtons());
			btnContainer.appendChild(refreshLink);
            console.log("Adding contact buttons to DOM");
            labelDiv.parentNode.insertBefore(btnContainer, labelDiv.nextSibling);
            console.log("Contact buttons added successfully");
        } else {
            console.log("Not adding buttons - labelDiv:", !!labelDiv, "existingButtons:", !!existingButtons);
        }
        
    });
}

// Open de extensie-optiespagina
function communicatie_openOptions() {
	try {
		chrome.runtime.sendMessage({ type: 'openOptionsPage', focusTarget: 'communicatie' });
	} catch (e) {
		console.error('Kon opties niet openen:', e);
	}
}

// Vernieuw de communicatie-knoppen en laad opties opnieuw
function communicatie_refreshButtons() {
	try {
		// Reset cache zodat opties opnieuw worden ingelezen
		optionsLoaded = false;
		globalOptions = null;
		optionsTimestamp = null;
		// Verwijder bestaande knoppen
		const existing = document.querySelector('.contact-buttons');
		if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
		// Voeg opnieuw toe
		communicatie_add_contact_button();
		console.log('Communicatie-knoppen vernieuwd');
	} catch (e) {
		console.error('Fout bij vernieuwen communicatie-knoppen:', e);
	}
}

function communicatie_changeContact(value) {
    console.log("Contact wijzigen naar:", value);
    const searchBtn = document.querySelector('.koppelinfo-header .koppelinfo-contact .picker-icon span.fa-search');
    if (!searchBtn) return false;
    searchBtn.click();
    setTimeout(() => {
        const input = document.querySelector('.area-zoekcontact .simpleinput.bordered input');
        if (!input) return false;
        input.value = value;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        function trySelectFirstItem(retries = 10) {
            const firstItem = document.querySelector('.item-list .item');
            if (firstItem) {
                firstItem.click();
                function tryClickSelecteer(retries = 10) {
                    const footer = document.querySelector('.modal-footer .footer-buttons .right');
                    if (!footer) return false;
                    const buttons = Array.from(footer.querySelectorAll('button'));
                    const selecteerBtn = buttons.find(btn => btn.textContent.trim() === "Selecteer");
                    if (selecteerBtn && !selecteerBtn.disabled) {
                        selecteerBtn.click();
                    } else if (retries > 0) {
                        setTimeout(() => tryClickSelecteer(retries - 1), 100);
                    }
                }
                setTimeout(() => tryClickSelecteer(), 100);
            } else if (retries > 0) {
                setTimeout(() => trySelectFirstItem(retries - 1), 100);
            }
        }
        trySelectFirstItem();
    }, 100);
}

function communicatie_checkForKoppelinfoHeader() {
    //console.log("communicatie_checkForKoppelinfoHeader called");
    
    // Controleer eerst of de header bestaat
    const header = document.querySelector('.koppelinfo-header');
    //console.log("Header found:", !!header);
    
    if (!header) {
        return;
    }
    
    // Controleer of er al knoppen bestaan
    const existingButtons = document.querySelector('.contact-buttons');
    if (existingButtons) {
        //console.log("Contact buttons already exist, skipping");
        return;
    }
    
    // Alleen als de header bestaat en er geen knoppen zijn, haal dan de opties op
    console.log("Header found and no buttons exist, checking options");
    communicatie_getOptionsFromStorage(function(opts) {
        console.log("Options received in checkForKoppelinfoHeader:", opts);
        if (!opts.communicatieKnoppen) {
            console.log("Communicatie knoppen disabled in checkForKoppelinfoHeader, returning");
            return;
        }
        console.log("Communicatie knoppen enabled, adding contact button");
        communicatie_add_contact_button();
    });
}

const communicatie_koppelInfoObserver = new MutationObserver(() => {
    communicatie_checkForKoppelinfoHeader();
});
communicatie_koppelInfoObserver.observe(document.body, { childList: true, subtree: true });
communicatie_checkForKoppelinfoHeader();

//-------------------------------- maak favorieten knop ------------------------------------------------------------

function favorieten_addButton() {
    const modalContent = document.querySelector('.modal-dialog .zoek-contact-content');
    if (!modalContent) return;
    
    const footerRight = document.querySelector('.modal-dialog .footer-buttons .right');
    if (!footerRight || footerRight.querySelector('.btn-favoriet')) return;
    
    const selecteerBtn = Array.from(footerRight.querySelectorAll('button')).find(btn => 
        btn.textContent.includes('Selecteer')
    );
    if (!selecteerBtn) return;
    
    const favorietBtn = document.createElement('button');
    favorietBtn.className = 'btn btn-modal btn-secondary btn-favoriet';
    favorietBtn.setAttribute('data-focus', 'false');
    favorietBtn.id = 'bricks-infused-favorieten-btn';
    favorietBtn.innerHTML = '<span class="">⭐ Snelkoppeling</span>';
    favorietBtn.addEventListener('click', favorieten_addToFavorites);
    
    // Voeg toe vóór de Selecteer knop
    footerRight.insertBefore(favorietBtn, selecteerBtn);
    
    // Voeg tekstveld en OK knop toe op nieuwe regel (verborgen)
    const inputContainer = document.createElement('div');
    inputContainer.style.display = 'none'; // Verborgen standaard
    inputContainer.style.alignItems = 'center';
    inputContainer.style.justifyContent = 'flex-end';
    inputContainer.style.marginTop = '8px';
    inputContainer.style.paddingBottom = '20px';
    inputContainer.style.paddingRight = '20px';
    inputContainer.style.gap = '8px';
    inputContainer.id = 'bricks-infused-input-container';
    
    const naamInput = document.createElement('input');
    naamInput.type = 'text';
    naamInput.placeholder = 'Korte naam snelkoppeling';
    naamInput.style.padding = '4px 8px';
    naamInput.style.border = '1px solid #ccc';
    naamInput.style.borderRadius = '4px';
    naamInput.style.fontSize = '14px';
    naamInput.id = 'bricks-infused-naam-input';
    
    const okBtn = document.createElement('button');
    okBtn.className = 'btn btn-modal btn-secondary';
    okBtn.innerHTML = '💾 Opslaan';
    okBtn.id = 'bricks-infused-ok-btn';
    okBtn.addEventListener('click', () => {
        const korteNaam = naamInput.value.trim();
        const contactName = getContactName();
        
        if (korteNaam && contactName) {
            // Voeg toe aan btnLabels
            chrome.storage.sync.get(['btnLabels'], (result) => {
                const btnLabels = result.btnLabels || [];
                
                // Voeg nieuwe snelkoppeling toe
                btnLabels.push({
                    label: korteNaam,
                    value: contactName
                });
                
                // Sla op
                chrome.storage.sync.set({ btnLabels }, () => {
                    console.log('Snelkoppeling opgeslagen:', { label: korteNaam, value: contactName });
                    
                    // Verander snelkoppeling knop naar disabled met vinkje
                    const favorietBtn = document.getElementById('bricks-infused-favorieten-btn');
                    if (favorietBtn) {
                        favorietBtn.disabled = true;
                        favorietBtn.innerHTML = '<span class="">✅ Snelkoppeling</span>';
                    }
                    
                    // Verberg input velden
                    const inputContainer = document.getElementById('bricks-infused-input-container');
                    if (inputContainer) {
                        inputContainer.style.display = 'none';
                    }
                    
                    // Update de communicatie knoppen
                    communicatie_refreshButtons();
                });
            });
        } else if (!korteNaam) {
            alert('Voer een korte naam in');
        } else if (!contactName) {
            alert('Geen contact geselecteerd');
        }
    });
    
    inputContainer.appendChild(naamInput);
    inputContainer.appendChild(okBtn);
    
    // Voeg toe na de footer-buttons div (op nieuwe regel)
    const footerButtons = document.querySelector('.modal-dialog .footer-buttons');
    if (footerButtons && footerButtons.parentNode) {
        footerButtons.parentNode.insertBefore(inputContainer, footerButtons.nextSibling);
    }
}

// Helper functie om contact naam op te halen
function getContactName() {
    const naamLabel = Array.from(document.querySelectorAll('.modal-dialog .area-contactgegevens .form-textbox label div'))
        .find(div => div.textContent.trim() === 'Naam');
    
    if (!naamLabel) {
        console.log('Geen naam label gevonden');
        return null;
    }
    
    const labelFor = naamLabel.parentElement.getAttribute('for');
    if (!labelFor) {
        console.log('Geen for attribuut gevonden');
        return null;
    }
    
    const naamInput = document.getElementById(labelFor);
    if (!naamInput) {
        console.log('Geen input gevonden');
        return null;
    }
    
    const contactName = naamInput.value.trim();
    if (!contactName) {
        console.log('Geen contact naam gevonden');
        return null;
    }
    
    return contactName;
}

function favorieten_addToFavorites() {
    // Toggle zichtbaarheid van input velden
    const inputContainer = document.getElementById('bricks-infused-input-container');
    if (inputContainer) {
        const isVisible = inputContainer.style.display !== 'none';
        inputContainer.style.display = isVisible ? 'none' : 'flex';
        
        // Als we de velden tonen, controleer of er een contact naam is
        if (!isVisible) {
            const contactName = getContactName();
            if (contactName) {
                // Sla contact naam op in data attribuut voor later gebruik
                inputContainer.setAttribute('data-contact-name', contactName);
                // Leeg het input veld en focus erop
                const bricksInput = document.getElementById('bricks-infused-naam-input');
                if (bricksInput) {
                    bricksInput.value = '';
                    // Focus op het input veld na een korte delay om ervoor te zorgen dat het zichtbaar is
                    setTimeout(() => {
                        bricksInput.focus();
                    }, 100);
                }
            } else {
                // Geen contact naam gevonden, verberg velden weer
                inputContainer.style.display = 'none';
            }
        }
    }
}

// Observer voor favorieten knop
const favorieten_observer = new MutationObserver(() => {
    favorieten_addButton();
});
favorieten_observer.observe(document.body, { childList: true, subtree: true }); 


///////////////////////////////// BRIEF EXPORT ALS PDF //////////////////////////////////////////////////////////////

function addPdfExportButton() {
    //te doen:
    //- tabellen zoals bij labwaarden maken
    //- tiff afbeeldingen samenvoegen als pdf
    //- optie om BSN te verwijderen

    
    // Check of er een brief modal open is
    const modalDialog = document.querySelector('.modal-dialog.nopadding');
    if (!modalDialog) return;

    // Controleer of PDF export optie is ingeschakeld
    loadGlobalOptions(function(options) {
        if (!options.pdfExport) {
            console.log("PDF export disabled, skipping");
            return;
        }
    });
    console.log("PDF export kom hier met die knop");
    const toonBerichtContainer = modalDialog.querySelector('.toon-bericht-container');
    //const berichtdetails = modalDialog.querySelector('.berichtdetails');
    const berichtdetails = document.querySelector('.berichtsoort-med-container .bericht-html');
    const modalFooter = modalDialog.querySelector('.modal-footer');
    
    if (!toonBerichtContainer || !berichtdetails || !modalFooter) return;
    
    // Check of de PDF export knop al bestaat
    const existingPdfBtn = modalFooter.querySelector('.btn-pdf-export');
    if (existingPdfBtn) return;
    
    // Maak de PDF export knop
    const pdfBtn = document.createElement('button');
    pdfBtn.className = 'btn btn-modal btn-secondary-light btn-pdf-export';
    pdfBtn.setAttribute('data-icon', '');
    pdfBtn.setAttribute('data-focus', 'false');
    pdfBtn.innerHTML = '<!----><span class="">Export PDF</span><!---->';
    
    // Voeg event listener toe
    pdfBtn.addEventListener('click', () => {
        // Voorkom dubbele uitvoering
        if (pdfBtn.dataset.exporting === 'true') {
            return;
        }
        pdfBtn.dataset.exporting = 'true';
        
        const berichtContainer = document.querySelector('.berichtsoort-med-container');
        if (berichtContainer) {
            // Check of de header container bestaat
            const headerContainer = berichtContainer.querySelector('.berichtsoort-med-kop-container');
            if (!headerContainer) {
                // Klik op de chevron-down om de container te tonen
                const chevronDown = document.querySelector('.berichtsoort-med-smallkop-container .fa-chevron-down');
                if (chevronDown) {
                    chevronDown.click();
                    
                    let exportExecuted = false;
                    let checkContainer = null;
                    let timeoutId = null;
                    
                    // Timeout na 2 seconden (als het niet werkt)
                    timeoutId = setTimeout(() => {
                        if (!exportExecuted) {
                            exportExecuted = true;
                            if (checkContainer) clearInterval(checkContainer);
                            exportBerichtAsPdf(berichtContainer);
                            pdfBtn.dataset.exporting = 'false';
                        }
                    }, 2000);
                    
                    // Wacht tot de container verschijnt, dan export uitvoeren
                    checkContainer = setInterval(() => {
                        const newHeaderContainer = berichtContainer.querySelector('.berichtsoort-med-kop-container');
                        if (newHeaderContainer && !exportExecuted) {
                            exportExecuted = true;
                            clearInterval(checkContainer);
                            if (timeoutId) clearTimeout(timeoutId);
                            exportBerichtAsPdf(berichtContainer);
                            pdfBtn.dataset.exporting = 'false';
                        }
                    }, 100);
                } else {
                    // Als chevron niet gevonden, gewoon exporteren zonder header
                    exportBerichtAsPdf(berichtContainer);
                    pdfBtn.dataset.exporting = 'false';
                }
            } else {
                // Header container bestaat al, direct exporteren
                exportBerichtAsPdf(berichtContainer);
                pdfBtn.dataset.exporting = 'false';
            }
        } else {
            exportBerichtAsPdf(berichtdetails);
            pdfBtn.dataset.exporting = 'false';
        }
    });
    
    // Voeg de knop toe naast de Export knop
    const buttons = modalFooter.querySelectorAll('.right button');
    let exportBtn = null;
    
    // Zoek de Export knop
    buttons.forEach(btn => {
        const span = btn.querySelector('span');
        if (span && span.textContent.trim() === 'Export') {
            exportBtn = btn;
        }
    });
    
    if (exportBtn) {
        exportBtn.parentNode.insertBefore(pdfBtn, exportBtn.nextSibling);
    } else {
        // Als Export knop niet gevonden, voeg toe aan het einde van de right div
        const rightDiv = modalFooter.querySelector('.right');
        if (rightDiv) {
            rightDiv.appendChild(pdfBtn);
        }
    }
    
    console.log('PDF export knop toegevoegd aan brief modal');
}

function exportBerichtAsPdf(berichtContainer) {
    try {
        // Maak nieuw PDF document
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();
        
        // Pagina afmetingen
        const pageHeight = doc.internal.pageSize.height;
        const pageWidth = doc.internal.pageSize.width;
        const marginTop = 20;
        const marginBottom = 20;
        const marginLeft = 20;
        const marginRight = 20;
        const lineHeight = 5.5; // Kleinere line height voor brief tekst (9pt font)
        const headerLineHeight = 4.5; // Kleinere afstand tussen regels in header
        
        let currentY = marginTop;
        
        // Haal de header tabel op (berichtsoort-med-kop-container)
        const headerContainer = berichtContainer.querySelector('.berichtsoort-med-kop-container');
        if (headerContainer) {
            const headerColumns = headerContainer.querySelectorAll('.berichtsoort-med-kop');
            
            if (headerColumns.length > 0) {
                // Bepaal kolombreedtes (6 kolommen: 3 secties met elk label + waarde)
                const sectionWidth = (pageWidth - marginLeft - marginRight) / 3;
                const labelWidth = sectionWidth * 0.35; // Label is 35% van sectie
                const valueWidth = sectionWidth * 0.65; // Waarde is 65% van sectie
                
                // Tekst voor elke kolom verzamelen
                const columnData = [];
                headerColumns.forEach((col) => {
                    const title = col.querySelector('.title')?.textContent?.trim() || '';
                    const data = [];
                    
                    // Verzamel alle label-waarde paren
                    const col1s = col.querySelectorAll('.col1');
                    col1s.forEach((col1) => {
                        const label = col1.textContent?.trim() || '';
                        const nextSibling = col1.nextElementSibling;
                        if (nextSibling && !nextSibling.classList.contains('col1')) {
                            let value = '';
                            // Als het een flex-col is, combineer de regels
                            if (nextSibling.classList.contains('flex') && nextSibling.classList.contains('flex-col')) {
                                const divs = nextSibling.querySelectorAll('div');
                                value = Array.from(divs).map(d => d.textContent?.trim()).filter(t => t).join('\n');
                            } else {
                                value = nextSibling.textContent?.trim() || '';
                            }
                            if (label && value) {
                                data.push({ label, value });
                            }
                        }
                    });
                    
                    columnData.push({ title, data });
                });
                
                // Voeg header tabel toe aan PDF
                doc.setFontSize(11);
                doc.setFont(undefined, 'bold');
                
                // Teken kolomtitels in lichtgrijs
                columnData.forEach((col, colIndex) => {
                    const x = marginLeft + (colIndex * sectionWidth);
                    // Lichtgrijs: RGB(160, 174, 192) of hex #a0aec0
                    doc.setTextColor(160, 174, 192);
                    doc.text(col.title, x, currentY);
                });
                
                // Reset tekstkleur naar zwart
                doc.setTextColor(0, 0, 0);
                
                currentY += headerLineHeight * 1.5;
                doc.setFont(undefined, 'normal');
                doc.setFontSize(8); // Kleinere tekst voor de rest van de header
                
                // Render elke sectie onafhankelijk
                const sectionYPositions = [];
                columnData.forEach((col, colIndex) => {
                    const sectionX = marginLeft + (colIndex * sectionWidth);
                    const labelX = sectionX;
                    const valueX = sectionX + labelWidth + 2; // Kleine ruimte tussen label en waarde
                    let sectionY = currentY;
                    
                    col.data.forEach((item) => {
                        // Controleer of nieuwe pagina nodig is
                        if (sectionY + (headerLineHeight * 2) > pageHeight - marginBottom) {
                            doc.addPage();
                            sectionY = marginTop + headerLineHeight * 1.5;
                            // Teken kolomtitel opnieuw op nieuwe pagina
                            doc.setFontSize(11);
                            doc.setFont(undefined, 'bold');
                            doc.setTextColor(160, 174, 192);
                            doc.text(col.title, sectionX, marginTop);
                            doc.setTextColor(0, 0, 0);
                            doc.setFont(undefined, 'normal');
                            doc.setFontSize(8);
                        }
                        
                        // Label naast waarde (niet eronder)
                        doc.setFont(undefined, 'bold');
                        const labelText = item.label + ':';
                        doc.text(labelText, labelX, sectionY);
                        
                        // Waarde naast label
                        doc.setFont(undefined, 'normal');
                        const valueLines = doc.splitTextToSize(item.value, valueWidth - 4);
                        doc.text(valueLines, valueX, sectionY);
                        
                        // Bereken hoogte voor deze regel (label hoogte of waarde hoogte, wat groter is)
                        const labelHeight = headerLineHeight;
                        const valueHeight = valueLines.length * headerLineHeight;
                        sectionY += Math.max(labelHeight, valueHeight) + 0.5; // Kleinere ruimte tussen items
                    });
                    
                    sectionYPositions.push(sectionY);
                });
                
                // Bepaal de hoogste Y positie voor de volgende sectie
                currentY = Math.max(...sectionYPositions);
                currentY -= 0.5*headerLineHeight; // Minder ruimte na header tabel (lijn hoger)
                
                // Teken lichtgrijze horizontale balk onder de header
                doc.setDrawColor(160, 174, 192); // Zelfde kleur als kopjes
                doc.setLineWidth(0.25); // Helft dunner (was 0.5)
                doc.line(marginLeft, currentY, pageWidth - marginRight, currentY);
                currentY += headerLineHeight*1.5; // Ruimte na de lijn
                
                doc.setFontSize(9); // Brief tekst nog een punt kleiner (was 10, nu 9)
                doc.setTextColor(0, 0, 0); // Zorg dat tekstkleur weer zwart is
            }
        }
        
        // Haal de bericht-html op
        const berichtHtml = berichtContainer.querySelector('.bericht-html');
        if (berichtHtml) {
            // Haal de tekst op uit bericht-html
            const text = berichtHtml.innerText || berichtHtml.textContent || '';
            
            // Zorg dat font size 9 is voor de brief tekst
            doc.setFontSize(9);
            
            // Voeg tekst toe aan PDF (max 180 karakters per regel)
            const lines = doc.splitTextToSize(text, pageWidth - marginLeft - marginRight);
            
            for (let i = 0; i < lines.length; i++) {
                // Controleer of er nog ruimte is op de huidige pagina
                if (currentY + lineHeight > pageHeight - marginBottom) {
                    // Voeg nieuwe pagina toe
                    doc.addPage();
                    currentY = marginTop;
                }
                
                // Voeg regel toe aan PDF
                doc.text(lines[i], marginLeft, currentY);
                currentY += lineHeight;
            }
        }
        
        // Genereer en download PDF
        const fileName = `brief_${new Date().toISOString().slice(0, 10)}.pdf`;
        doc.save(fileName);
        
        console.log('Brief geëxporteerd als PDF:', fileName);
        
    } catch (error) {
        console.error('Fout bij PDF export:', error);
        alert('Er is een fout opgetreden bij het exporteren van de PDF: ' + error.message);
    }
}

// Observer voor brief modals
const briefModalObserver = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
            if (node.nodeType === 1) { // Element node
                // Check of er een brief modal is toegevoegd
                if (node.classList && node.classList.contains('modal-dialog')) {
                    setTimeout(addPdfExportButton, 100);
                }
                // Check ook child nodes
                const modalDialogs = node.querySelectorAll ? node.querySelectorAll('.modal-dialog') : [];
                modalDialogs.forEach(() => {
                    setTimeout(addPdfExportButton, 100);
                });
            }
        });
    });
});

// Start observer
briefModalObserver.observe(document.body, { childList: true, subtree: true });


///////////////////////////////// JOURNAAL RESIZER //////////////////////////////////////////////////////////////

let journaalResizer_resizeInitialized = false;
let journaalResizer_observer = null;
function journaalResizer_getOptionsFromStorage(cb) {
    loadGlobalOptions(function(options) {
        cb(options.journaalResizer !== false);
    });
}

function journaalResizer_getLayoutElements() {
    const tabjournaal = document.querySelector('.layout-renderer.layout-grid');
    if (!tabjournaal) return null;

    const widgets = Array.from(tabjournaal.querySelectorAll(':scope > .layout-widget, :scope > .layout-flex.layout-flex-column'));
    if (widgets.length < 3) return null;

    const col1 = widgets.find(widget => widget.querySelector('.journaal'));
    const episoden = widgets.find(widget => widget.querySelector('.episoden-content'));
    const colRight = widgets.find(widget => widget.querySelector('.attentieregels-container') && widget.querySelector('.medicatieprofiel-widget'));

    if (!col1 || !episoden || !colRight) return null;
    return { tabjournaal, col1, episoden, colRight };
}

function journaalResizer_addResizeFunctionality() {
    if (journaalResizer_resizeInitialized) return;
    const layout = journaalResizer_getLayoutElements();
    if (!layout) return;
    journaalResizer_resizeInitialized = true;

    const { tabjournaal, col1, episoden, colRight } = layout;
    const getColumnGap = () => parseFloat(getComputedStyle(tabjournaal).columnGap || '0') || 0;
    const resizerHandleWidth = 15;
    const horizontalResizerOffset = 8;
    let currentCol1Size = col1.style.width || 'minmax(500px, 50%)';
    let currentCol2Size = episoden.style.width || '1fr';

    // laad de opgeslagen percentages
    loadResizerPercentages(function(data) {
        if (!data) return;
        if (data.resizer1) currentCol1Size = data.resizer1;
        if (data.resizer2) currentCol2Size = data.resizer2;
        tabjournaal.style.gridTemplateColumns = `${currentCol1Size} ${currentCol2Size} 1fr`;
        if (colRight && data.resizer3) colRight.style.gridTemplateRows = data.resizer3 + ' 1fr';
        updateResizer1();
        updateResizer2();
        updateResizer3();
    });

    // Add resizer between col1 and colRight
    const resizer1 = document.createElement('div');
    resizer1.style.width = `${resizerHandleWidth}px`;
    resizer1.style.cursor = 'col-resize';
    resizer1.style.position = 'absolute';
    resizer1.style.top = '0';
    resizer1.style.bottom = '0';
    resizer1.style.zIndex = '10';
    //resizer1.style.background = 'rgba(0,0,0,0.05)';
    resizer1.className = 'col-resizer-1';

    // Add resizer between episoden and rechter kolom
    const resizer2 = document.createElement('div');
    resizer2.style.width = `${resizerHandleWidth}px`;
    resizer2.style.cursor = 'col-resize';
    resizer2.style.position = 'absolute';
    resizer2.style.top = '0';
    resizer2.style.bottom = '0';
    resizer2.style.zIndex = '10';
    //resizer2.style.background = 'rgba(0,0,0,0.05)';
    resizer2.className = 'col-resizer-2';
    
    // Add vertical resizer between col3 (.attentieregels-container) and col4 (.medicatieprofiel-widget)
    const attentieregels = colRight.querySelector('.attentieregels-container');
    if (!attentieregels) return;
    const resizer3 = document.createElement('div');
    resizer3.style.height = '15px'; 
    resizer3.style.cursor = 'row-resize';
    resizer3.style.position = 'absolute';
    resizer3.style.left = '0';
    resizer3.style.right = '0';
    resizer3.style.zIndex = '10';
    //resizer3.style.background = 'rgba(0,0,0,0.05)';
    resizer3.className = 'col-resizer-3';

    // Set parent to relative for absolute positioning
    tabjournaal.style.position = 'relative';
    colRight.style.position = 'relative';

    // Insert resizers
    tabjournaal.appendChild(resizer1);
    tabjournaal.appendChild(resizer2);
    colRight.appendChild(resizer3);

    // Position resizer1 between col1 and colRight
    function updateResizer1() {
        const tabRect = tabjournaal.getBoundingClientRect();
        const col1Rect = col1.getBoundingClientRect();
        const boundaryX = col1Rect.right - tabRect.left;
        resizer1.style.left = (boundaryX - (resizerHandleWidth / 2) + horizontalResizerOffset) + 'px';
        resizer1.style.height = tabjournaal.offsetHeight + 'px';
    }
    // Position resizer2 between episoden and rechter kolom
    function updateResizer2() {
        const tabRect = tabjournaal.getBoundingClientRect();
        const episodenRect = episoden.getBoundingClientRect();
        const boundaryX = episodenRect.right - tabRect.left;
        resizer2.style.left = (boundaryX - (resizerHandleWidth / 2) + horizontalResizerOffset) + 'px';
        resizer2.style.height = tabjournaal.offsetHeight + 'px';
    }
    // Position resizer3 between attentieregels and medicatieprofiel
    function updateResizer3() {
        resizer3.style.top = (attentieregels.offsetHeight - 3) + 55 + 'px'; //55 omdat het kopje "attentieregels" niet wordt meegenomen, zou je naar de parent moeten verwijzen
        resizer3.style.width = colRight.offsetWidth + 'px';
    }
    updateResizer1();
    updateResizer2();
    updateResizer3();

    window.addEventListener('resize', () => {
        updateResizer1();
        updateResizer2();
        updateResizer3();
    });

    // Drag logic for resizer1 (journaal <-> episoden/rechts)
    resizer1.addEventListener('mousedown', function (e) {
        e.preventDefault();
        document.body.style.cursor = 'col-resize';
        const startX = e.clientX;
        const startCol1Width = col1.offsetWidth;
        const startCol2Width = episoden.offsetWidth;
        const totalWidth = tabjournaal.offsetWidth;
        const gap = getColumnGap();

        function onMouseMove(ev) {
            let newCol1Width = startCol1Width + (ev.clientX - startX);
            // Clamp min/max
            newCol1Width = Math.max(320, Math.min(totalWidth - startCol2Width - gap * 2 - 260, newCol1Width));
            currentCol1Size = `${Math.round(newCol1Width)}px`;
            tabjournaal.style.gridTemplateColumns = `${currentCol1Size} ${currentCol2Size} 1fr`;
            updateResizer1();
            updateResizer2();
        }
        function onMouseUp() {
            saveResizerPercentages({ resizer1: currentCol1Size });
            document.body.style.cursor = '';
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
        }
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    });

    // Drag logic for resizer2 (episoden <-> rechter kolom)
    resizer2.addEventListener('mousedown', function (e) {
        e.preventDefault();
        document.body.style.cursor = 'col-resize';
        const startX = e.clientX;
        const startCol2Width = episoden.offsetWidth;
        const tabWidth = tabjournaal.offsetWidth;
        const gap = getColumnGap();
        const col1Width = col1.offsetWidth;

        function onMouseMove(ev) {
            let newCol2Width = startCol2Width + (ev.clientX - startX);
            newCol2Width = Math.max(220, Math.min(tabWidth - col1Width - gap * 2 - 260, newCol2Width));
            currentCol2Size = `${Math.round(newCol2Width)}px`;
            tabjournaal.style.gridTemplateColumns = `${currentCol1Size} ${currentCol2Size} 1fr`;
            updateResizer2();
        }
        function onMouseUp() {
            saveResizerPercentages({ resizer2: currentCol2Size });
            document.body.style.cursor = '';
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
        }
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    });

    // Drag logic for resizer3 (col3 <-> col4 inside colRight)
    resizer3.addEventListener('mousedown', function (e) {
        e.preventDefault();
        document.body.style.cursor = 'row-resize';
        const startY = e.clientY;
        const startAttentieregelsHeight = attentieregels.offsetHeight;

        function onMouseMove(ev) {
            let newAttentieregelsHeight = startAttentieregelsHeight + (ev.clientY - startY) + 55;
            newAttentieregelsHeight = Math.max(150, Math.min(colRight.offsetHeight - 200 , newAttentieregelsHeight));
            const percent = (newAttentieregelsHeight / colRight.offsetHeight) * 100;
            colRight.style.gridTemplateRows = percent + '% 1fr';
            updateResizer3();
            resizer3.dataset.pendingPercent = percent + '%';
        }
        function onMouseUp() {
            const pendingResizer3 = resizer3.dataset.pendingPercent;
            if (pendingResizer3) {
                saveResizerPercentages({ resizer3: pendingResizer3 });
                delete resizer3.dataset.pendingPercent;
            }
            document.body.style.cursor = '';
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
        }
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    });

    tabjournaal.style.display = 'grid';
    colRight.style.display = 'grid';
    tabjournaal.style.gridTemplateColumns = `${currentCol1Size} ${currentCol2Size} 1fr`;

    // Observe size changes
    new ResizeObserver(() => {
        updateResizer1();
        updateResizer2();
        updateResizer3();
    }).observe(tabjournaal);
    new ResizeObserver(() => {
        updateResizer2();
    }).observe(colRight);
    new ResizeObserver(() => {
        updateResizer3();
    }).observe(colRight);
    console.log("einde");
}

// Helper om percentages op te slaan
function saveResizerPercentages({resizer1, resizer2, resizer3}) {
    chrome.runtime.sendMessage({
        type: 'saveResizerPercentages',
        resizer1, resizer2, resizer3
    });
}
// Helper om percentages op te halen
function loadResizerPercentages(cb) {
    chrome.runtime.sendMessage({ type: 'getResizerPercentages' }, cb);
}

// Pas in journaalResizer_addResizeFunctionality de set van gridTemplateColumns/Rows aan:
// - Bij het aanpassen van resizer1, resizer2, resizer3: sla de nieuwe percentages op via saveResizerPercentages
// - Bij init: haal de percentages op via loadResizerPercentages en pas ze toe



// In de onMouseMove van elke resizer:
// - resizer1: saveResizerPercentages({resizer1: percent + '%', ...})
// - resizer2: saveResizerPercentages({resizer2: percent + '%', ...})
// - resizer3: saveResizerPercentages({resizer3: percent + '%', ...})

//function waitForCol1AndInit() {
//    const col1 = document.querySelector('.col1');
//    if (col1) {
//        addResizeFunctionality();
//    } else {
//        setTimeout(waitForCol1AndInit, 500);
//    }
//}
//waitForCol1AndInit();
function journaalResizer_setupCol1Observer() {
    journaalResizer_getOptionsFromStorage(function(enabled) {
        if (!enabled) return;
        if (journaalResizer_observer) journaalResizer_observer.disconnect();
        journaalResizer_observer = new MutationObserver(() => {
            const layout = journaalResizer_getLayoutElements();
            if (layout && layout.col1.offsetParent !== null) {
                journaalResizer_addResizeFunctionality();
                journaalResizer_observer.disconnect();
                // Now observe for disappearance
                journaalResizer_setupCol1DisappearObserver();
            }
        });
        journaalResizer_observer.observe(document.body, { childList: true, subtree: true });
    });
}

function journaalResizer_setupCol1DisappearObserver() {
    journaalResizer_getOptionsFromStorage(function(enabled) {
        if (!enabled) return;
        if (journaalResizer_observer) journaalResizer_observer.disconnect();
        journaalResizer_observer = new MutationObserver(() => {
            const layout = journaalResizer_getLayoutElements();
            if (!layout || layout.col1.offsetParent === null) {
                journaalResizer_resizeInitialized = false;
                journaalResizer_observer.disconnect();
                // Start checking for appearance again
                journaalResizer_setupCol1Observer();
            }
        });
        journaalResizer_observer.observe(document.body, { childList: true, subtree: true });
    });
}

// Start observing for col1 appearance
journaalResizer_setupCol1Observer();

///////////////////////////////// DECLAREREN NIET METEEEN OP GEBEURD ZETTEN //////////////////////////////////////////////////////////////

let declareer_opGebeurdCheckbox = null;

function declareer_nietMeteenOpGebeurdZetten(headerDiv) {
    console.log("declareer_nietMeteenOpGebeurdZetten");
    headerDiv.textContent = 'Declareren :)'; //om te laten zien dat het werkt, en dan vindt declereer_observer hem niet meer voor nu
    // zoeken naar de checkbox met de label "Op gebeurd zetten afspraak 00:00" en zet deze uit
    document.querySelectorAll('.form-checkbox[disabled="false"]').forEach(cb => {
        const label = cb.textContent.trim();
        if (label.includes('Op gebeurd zetten afspraak')) {
            declareer_opGebeurdCheckbox = cb;
            const input = cb.querySelector('input[type="checkbox"]');
            if (input && input.checked) {
                input.checked = false;
                input.dispatchEvent(new Event('change', { bubbles: true }));
            }
        }
    });
    // knop toevoegen "einde consult en afhandelen"
    const btnbarRight = document.querySelector('.declaratie-content-container .widget-btnbar .buttonbar .right');
    if (btnbarRight && !btnbarRight.querySelector('.btn-einde-consult')) {
        const btn = document.createElement('button');
        btn.setAttribute('data-button', 'true');
        btn.className = 'btn btn-widget btn-secondary btn-einde-consult';
        btn.textContent = '';
        btn.appendChild(document.createTextNode('✅ '));
        btn.appendChild(document.createTextNode('Einde consult en afhandelen'));
        btn.addEventListener('click', function() {
            //zet weer op consult afgehandeld
            if (declareer_opGebeurdCheckbox) {
                const input = declareer_opGebeurdCheckbox.querySelector('input[type="checkbox"]');
                if (input) {
                    input.checked = true;
                    input.dispatchEvent(new Event('change', { bubbles: true }));
                }
            }
            // Zoek en klik de knop 'Einde consult' in btnbarRight
            const eindeConsultBtn = Array.from(btnbarRight.querySelectorAll('button')).find(b => b.textContent.trim() === 'Einde consult');
            if (eindeConsultBtn) {
                eindeConsultBtn.click();
            }
        });
        btnbarRight.appendChild(btn);
    }
    
}

let declareer_observer = new MutationObserver(() => {
    const headerDiv = document.querySelector('.modal-dialog.nopadding div.modal-header');
    if (headerDiv && headerDiv.textContent == 'Declareren') {
        declareer_nietMeteenOpGebeurdZetten(headerDiv);
    }
});

declareer_observer.observe(document.body, { childList: true, subtree: true });

/////////////////////////////// JUVOLY //////////////////////////////////////////////////////////////

let permissionIframe = null;

// Request microphone permission directly
const requestMicrophonePermission = async () => {
  try {
    console.log('Requesting microphone permission directly...');
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    console.log('Microphone access granted');
    
    // Stop the tracks to prevent the recording indicator from being shown
    stream.getTracks().forEach(track => track.stop());
    
    // Permission granted, now we can safely load the Juvoly iframe
    loadJuvolyIframe();
    
    return true;
  } catch (error) {
    console.error('Error requesting microphone permission:', error);
    alert('Microfoon toegang is vereist voor Juvoly. Controleer je browser instellingen en geef toestemming voor microfoon toegang.');
    return false;
  }
};

function loadJuvolyIframe() {
    const journaalColumnRight = document.querySelector('.journaal-column-right');
    if (!journaalColumnRight) return;
    
    const existingIframe = document.querySelector('.juvoly-iframe');
    
    if (!existingIframe) {
        // Geen iframe: maak aan en toon
        journaalColumnRight.style.display = 'none';
        
        const iframe = document.createElement('iframe');
        iframe.className = 'juvoly-iframe';
        iframe.id = 'juvoly-iframe';
        iframe.src = 'https://app.juvoly.nl/consult';
        //iframe.allow = 'microphone; camera; fullscreen; geolocation; encrypted-media; autoplay; clipboard-read; clipboard-write';
        iframe.allow = 'microphone'; //werkt nog steeds niet omdat de Permissions Policy van Bricks de iframe blokkeert, met andere woorden niet toelaat permissions-policy
        //camera=(self "https://videoconsult.tetra.nl" "https://*.mijndokters.com"), fullscreen=(self "https://videoconsult.tetra.nl"), geolocation=(self), microphone=(self "https://videoconsult.tetra.nl" "https://*.mijndokters.com"), picture-in-picture=(self "https://videoconsult.tetra.nl"), speaker-selection=(self "https://videoconsult.tetra.nl")
        iframe.allowfullscreen = true;
        iframe.allowtransparency = true;
        iframe.referrerpolicy = 'no-referrer-when-downgrade';
        // Probeer zonder sandbox restricties
        // iframe.sandbox = 'allow-same-origin allow-scripts allow-forms allow-popups allow-modals allow-downloads allow-storage-access-by-user-activation';
        iframe.style.width = '100%';
        iframe.style.height = '100%';
        iframe.style.border = 'none';
        iframe.style.position = 'relative';
        iframe.style.top = '0';
        iframe.style.left = '0';
        
        // Voeg iframe toe op dezelfde plek als de verborgen div
        journaalColumnRight.parentNode.insertBefore(iframe, journaalColumnRight);
    } else if (existingIframe.style.display === 'none') {
        // Iframe bestaat maar is verborgen: toon iframe, verberg journaal
        existingIframe.style.display = '';
        journaalColumnRight.style.display = 'none';
    } else {
        // Iframe bestaat en is zichtbaar: verberg iframe, toon journaal
        existingIframe.style.display = 'none';
        journaalColumnRight.style.display = '';
    }
    
}

function juvoly_show() {
    console.log("Juvoly button clicked");
    
    // Check if microphone permission is already available
    navigator.permissions.query({ name: 'microphone' }).then(function(result) {
        console.log('Current microphone permission state:', result.state);
        
        if (result.state === 'granted') {
            // Permission already granted, load iframe directly
            loadJuvolyIframe();
        } else {
            // Permission not granted, request it directly
            console.log('Requesting microphone permission...');
            requestMicrophonePermission();
        }
    }).catch(function(error) {
        console.log('Permission query failed, requesting directly:', error);
        // Fallback: request permission directly
        requestMicrophonePermission();
    });
}

function juvoly_addButton() {
    // Check is al gedaan voordat observer wordt gestart, dus direct knop toevoegen
    const tabcontrolRight = document.querySelector('.consult-tabcontrol .right');
    if (tabcontrolRight && !tabcontrolRight.querySelector('.btn-juvoly')) {
        console.log("juvoly_addButton");
        const juvolyBtn = document.createElement('button');
        juvolyBtn.setAttribute('data-button', 'true');
        juvolyBtn.className = 'btn btn-widget btn-secondary btn-juvoly';
        juvolyBtn.textContent = 'Juvoly';
        juvolyBtn.style.backgroundColor = '#ff8c00'; // Oranje kleur
        juvolyBtn.style.color = 'white';
        juvolyBtn.style.border = '1px solid #ff8c00';
        juvolyBtn.style.marginRight = '8px';
        juvolyBtn.addEventListener('click', juvoly_show);
        
        // Voeg de knop toe vóór de eerste bestaande knop
        const firstButton = tabcontrolRight.querySelector('button');
        if (firstButton) {
            tabcontrolRight.insertBefore(juvolyBtn, firstButton);
        } else {
            tabcontrolRight.appendChild(juvolyBtn);
        }
    }
}

// Observer voor het toevoegen van de Juvoly knop (alleen starten als enabled)
loadGlobalOptions(function(options) {
    if (!options.juvolyKnop) {
        console.log("Juvoly knop disabled, observer niet gestart");
        return;
    }
    
    const juvoly_observer = new MutationObserver(() => {
        juvoly_addButton();
    });
    
    juvoly_observer.observe(document.body, { childList: true, subtree: true });
    
    // Initiële check
    juvoly_addButton();
});

///////////////////////////////// MEDICIJN MARKERINGEN //////////////////////////////////////////////////////////////
function medicijn_markeringen() {
    console.log("medicijn_markeringen called");
    
    loadGlobalOptions(function(options) {
        if (!options.medicijnMarkeringen) {
            console.log("Medicijn markeringen disabled, skipping");
            return;
        }
        
        // Controleer of .autorisatiereview.controls .area-rapportdetails zichtbaar is
        const rapportDetails = document.querySelector('.autorisatieview.controls .area-rapportdetails');
        if (!rapportDetails || rapportDetails.style.display === 'none' || rapportDetails.offsetParent === null) {
            console.log("Rapport details not visible, skipping medicijn markeringen");
            return;
        }
    
    console.log("Rapport details visible, processing medicijn markeringen");
    
    // Zoek alle .rapport44-recept elementen
    const recepten = rapportDetails.querySelectorAll('.rapport44-recept');
    console.log(`Found ${recepten.length} recepten to process`);
    
    recepten.forEach((recept, index) => {
        //console.log(`Processing recept ${index + 1}`);
        
        // Zoek alle onderliggende divs met class .rapport44-recept-regel
        const receptRegels = recept.querySelectorAll('.rapport44-recept-regel');
        if (receptRegels.length === 0) {
            //console.log(`No .rapport44-recept-regel found for recept ${index + 1}`);
            return;
        }
        
        console.log(`Found ${receptRegels.length} recept-regel elements in recept ${index + 1}`);
        
        // Verwerk elke recept-regel
        receptRegels.forEach((receptRegel, regelIndex) => {
            // Reset bestaande markeringen
            receptRegel.style.backgroundColor = '';
            receptRegel.classList.remove('medicijn-opiaat', 'medicijn-benzodiazepine', 'medicijn-methotrexaat');
            
            // Zoek de medicijnnaam (in de div met cursor-pointer binnen deze recept-regel)
            const medicijnDiv = receptRegel.querySelector('.cursor-pointer[title="Bekijk voorschrijfgeschiedenis"]');
            if (!medicijnDiv) {
                //console.log(`No medicijn div found for recept ${index + 1}, regel ${regelIndex + 1}`);
                return;
            }
            
            const medicijnNaam = medicijnDiv.textContent.trim();
            console.log(`Medicijn naam: ${medicijnNaam}`);
            
            // Controleer op opiaten
            const opiaatKeywords = ['morfine', 'oxycodon', 'fentanyl', 'codeïne', 'tramadol', 'buprenorfine', 'methadon', 'hydromorfon', 'pethidine', 'diamorfine'];
            const isOpiaat = opiaatKeywords.some(keyword => 
                medicijnNaam.toLowerCase().includes(keyword.toLowerCase())
            );
            
            if (isOpiaat) {
                console.log(`Opiaat gevonden: ${medicijnNaam}`);
                receptRegel.style.backgroundColor = '#ffe4cc'; // Pastel oranje
                receptRegel.classList.add('medicijn-opiaat');
            }
            
            // Controleer op benzodiazepinen
            const benzodiazepineKeywords = ['oxazepam', 'temazepam', 'bromazepam', 'lorazepam', 'diazepam', 'alprazolam', 'clonazepam', 'midazolam', 'nitrazepam', 'flunitrazepam', 'triazolam', 'zolpidem', 'zopiclon'];
            const isBenzodiazepine = benzodiazepineKeywords.some(keyword => 
                medicijnNaam.toLowerCase().includes(keyword.toLowerCase())
            );
            
            if (isBenzodiazepine) {
                console.log(`Benzodiazepine gevonden: ${medicijnNaam}`);
                receptRegel.style.backgroundColor = '#fff2cc'; // Pastel geel
                receptRegel.classList.add('medicijn-benzodiazepine');
            }
            
            // Controleer op ADHD medicatie
            const adhdKeywords = ['methylfenidaat', 'dexamfetamine', 'lisdexamfetamine', 'atomoxetine', 'guanfacine', 'clonidine', 'concerta', 'ritalin', 'medikinet', 'equasym', 'focalin', 'adderall', 'vyvanse', 'strattera', 'intuniv', 'kapvay'];
            const isAdhd = adhdKeywords.some(keyword => 
                medicijnNaam.toLowerCase().includes(keyword.toLowerCase())
            );
            
            if (isAdhd) {
                console.log(`ADHD medicatie gevonden: ${medicijnNaam}`);
                receptRegel.style.backgroundColor = '#f0f8cc'; // Pastel lichtgroen
                receptRegel.classList.add('medicijn-adhd');
            }
            
            // Controleer op methotrexaat
            const methotrexaatKeywords = ['methotrexaat','amiodaron'];
            const isMethotrexaat = methotrexaatKeywords.some(keyword => 
                medicijnNaam.toLowerCase().includes(keyword.toLowerCase())
            );
            
            if (isMethotrexaat) {
                console.log(`Methotrexaat gevonden: ${medicijnNaam}`);
                receptRegel.style.backgroundColor = '#ffcccc'; // Pastel rood
                receptRegel.classList.add('medicijn-methotrexaat');
            }
        });
        
        // Controleer op "1 herhalingen" en markeer deze tekst in elke recept-regel
        receptRegels.forEach((receptRegel, regelIndex) => {
            const herhalingenDiv = receptRegel.querySelector('.flex-grow');
            if (herhalingenDiv && herhalingenDiv.textContent.trim() === '1 herhalingen') {
                console.log(`1 herhalingen gevonden in recept ${index + 1}, regel ${regelIndex + 1}`);
                herhalingenDiv.style.backgroundColor = '#ff8c00'; // Oranje
                herhalingenDiv.style.padding = '2px 4px';
                herhalingenDiv.style.borderRadius = '3px';
            }
        });
    });
    });
}

// Observer voor het toevoegen van de "Toon resultaat" knop
const toonResultaat_observer = new MutationObserver(() => {
    addToonResultaatListener();
});

// Start de observer
toonResultaat_observer.observe(document.body, { 
    childList: true, 
    subtree: true
});

// Initiële check
addToonResultaatListener();

function addToonResultaatListener() {
    // Zoek naar alle buttons in het gebied
    const buttons = document.querySelectorAll('.autorisatieview.controls .area-rapportselectie button');
    let toonResultaatBtn = null;
    
    // Zoek de button met de tekst "Toon resultaat"
    buttons.forEach(button => {
        if (button.textContent.includes('Toon resultaat')) {
            toonResultaatBtn = button;
        }
    });
    
    if (toonResultaatBtn && !toonResultaatBtn.hasAttribute('data-medicijn-listener')) {
        console.log("Toon resultaat knop gevonden, voeg listener toe");
        
        // Markeer dat we al een listener hebben toegevoegd
        toonResultaatBtn.setAttribute('data-medicijn-listener', 'true');
        
        // Voeg event listener toe
        toonResultaatBtn.addEventListener('click', function() {
            console.log("Toon resultaat knop geklikt, start medicijn markeringen na 1000ms");
            setTimeout(() => {
                medicijn_markeringen();
            }, 1000);
        });
    }
}

///////////////////////////////// ZORGDOMEIN CUSTOM //////////////////////////////////////////////////////////////

function zorgdomein_addLabformOption() {
    const contextMenuVars = document.querySelector('.contextmenuvars');
    if (!contextMenuVars) return;
    
    const zorgdomeinItem = contextMenuVars.querySelector('.context-menu-item[title="ZorgDomein"]');
    if (!zorgdomeinItem) return;
    
    // Check if custom options already exist to prevent infinite loop
    const existingCustomOptions = contextMenuVars.querySelectorAll('.context-menu-item[data-custom-zorgdomein="true"]');
    if (existingCustomOptions.length > 0) return; // Already added, skip
    
    // Get zorgdomeinLinks from options
    loadGlobalOptions((options) => {
        const zorgdomeinLinks = options.zorgdomeinLinks || [];
        
        // Reverse the array so items appear in correct order when inserted
        zorgdomeinLinks.slice().reverse().forEach((link, index) => {
            if (!link.name) return; // Skip if no name
            
            // Create option item
            const optionItem = document.createElement('li');
            optionItem.setAttribute('data-v-7d356a63', '');
            optionItem.className = 'context-menu-item';
            optionItem.title = link.name;
            optionItem.setAttribute('data-custom-zorgdomein', 'true');
            optionItem.setAttribute('data-link-index', index);
            
            const optionCaption = document.createElement('div');
            optionCaption.setAttribute('data-v-7d356a63', '');
            optionCaption.className = 'caption';
            optionCaption.style.display = 'flex';
            optionCaption.style.justifyContent = 'space-between';
            optionCaption.style.alignItems = 'center';
            optionCaption.style.width = '100%';
            
            const optionText = document.createElement('span');
            optionText.textContent = `• ${link.name}`;
            optionText.style.fontSize = '0.9em';
            
            // Add episodelijst indicator if needed
            // if (link.episodelijstNodig) {
            //     const episodelijstSpan = document.createElement('span');
            //     episodelijstSpan.innerHTML = ' ⚕️';
            //     episodelijstSpan.style.fontSize = '0.8em';
            //     episodelijstSpan.title = 'Episodelijst nodig';
            //     optionText.appendChild(episodelijstSpan);
            // }
            
            // Add settings button
            const settingsSpan = document.createElement('span');
            settingsSpan.innerHTML = '⚙️';
            settingsSpan.style.cursor = 'pointer';
            settingsSpan.style.fontSize = '12px';
            settingsSpan.title = `${link.name} instellingen`;
            settingsSpan.addEventListener('click', (e) => {
                e.stopPropagation(); // Prevent triggering the parent li click
                console.log(`${link.name} settings clicked`);
                
                // Open plugin settings page
                chrome.runtime.sendMessage({ type: 'openOptionsPage', focusTarget: 'zorgdomein' });
            });
            
            optionCaption.appendChild(optionText);
            optionCaption.appendChild(settingsSpan);
            optionItem.appendChild(optionCaption);
            
            // Add after ZorgDomein item
            const ul = zorgdomeinItem.parentNode;
            ul.insertBefore(optionItem, zorgdomeinItem.nextSibling);
            
            // Add click handler
            optionItem.addEventListener('click', () => {
                //console.log(`${link.name} clicked`, link.link);
                
                // Save the clicked link to storage with timestamp (only the path, not the full URL)
                const timestamp = Date.now();
                let linkPath = link.link;
                if (linkPath && linkPath.startsWith('https://www.zorgdomein.nl/')) {
                    linkPath = linkPath.replace('https://www.zorgdomein.nl', '');
                }
                chrome.storage.sync.set({ 
                    lastClickedLink: linkPath,
                    lastClickedTimestamp: timestamp
                }, () => {
                    console.log('Last clicked link saved:', link.link, 'at', timestamp);
                });
                
                // First step: Click the ZorgDomein button
                const zorgdomeinButton = contextMenuVars.querySelector('.context-menu-item[title="ZorgDomein"]');
                if (!zorgdomeinButton) {
                    console.log('ZorgDomein button not found');
                    return;
                }
                zorgdomeinButton.click();
                console.log('ZorgDomein button clicked');
                
                // Second step: Click "Nieuwe verwijzing maken" button
                setTimeout(() => {
                    const buttons = document.querySelectorAll('.widget-content.widget-hpadding.overflow-tetra button');
                    const nieuweVerwijzingButton = Array.from(buttons).find(btn => 
                        btn.textContent.includes('Nieuwe verwijzing maken')
                    );
                    if (!nieuweVerwijzingButton) {
                        console.log('Nieuwe verwijzing maken button not found');
                        return;
                    }
                    nieuweVerwijzingButton.click();
                    console.log('Nieuwe verwijzing maken button clicked');
                    
                    // Third step: Check for modal and click "Doorgaan" if present (only if episodelijstNodig is false)
                    if (!link.episodelijstNodig) {
                        setTimeout(() => {
                            const buttons = document.querySelectorAll('#modalDialogs .modal-footer button');
                            const doorgaanBtn = Array.from(buttons).find(btn => 
                                btn.textContent.includes('Doorgaan')
                            );
                            if (doorgaanBtn) {
                                doorgaanBtn.click();
                                console.log('Doorgaan button clicked');
                            } else {
                                console.log('No Doorgaan button found - modal probably not shown');
                            }
                        }, 300); // Wait 300ms for modal to appear
                    } else {
                        console.log('Episodelijst nodig - skipping Doorgaan button click');
                    }
                    
                }, 200); // Wait 200ms for the page to load after ZorgDomein click
                
            });
        });
    });
}

// Observer for context menu changes
const zorgdomein_observer = new MutationObserver(() => {
    // Only run if zorgdomeinSnelkoppelingen option is enabled
    loadGlobalOptions((options) => {
        if (options.zorgdomeinSnelkoppelingen !== false) {
            zorgdomein_addLabformOption();
        }
    });
});

zorgdomein_observer.observe(document.body, { childList: true, subtree: true });

// Detecteer en sla klantnummer op bij het laden van de pagina
detectAndSaveKlantnummer();



//to do: sla alle instellingen in een taak op (exporteren/importeren), zodat ze door alle browsers gedeeld worden binnen hetzelfde account


///////////////////////////////// U-PREVENT CVRM INTEGRATIE //////////////////////////////////////////////////////////////
// Adds a "CVRM" shortcut to the patient shortcutsbar. On click, scrapes the
// most recent CVRM-relevant journaal entries (sys/dia BP for now) and lets
// the user either send the text to the U-Prevent Infused extension (which
// opens the chosen calculator and prefills it) or copy it to the clipboard.

const UPREVENT_CALCULATORS = [
    // Eerdere hart- en vaatziekten
    { path: 'smart2Score',    label: 'SMART2',         group: 'Eerdere HVZ',          ageMin: 40, ageMax: 80, lifetime: false },
    { path: 'smartReach',     label: 'SMART-REACH',    group: 'Eerdere HVZ',          ageMin: 45, ageMax: 80, lifetime: true  },
    // Diabetes type 2
    { path: 'score2Diabetes', label: 'SCORE2-Diabetes', group: 'Diabetes type 2',     ageMin: 55, ageMax: 90, lifetime: false },
    { path: 'dial2Model',     label: 'DIAL2',          group: 'Diabetes type 2',      ageMin: 30, ageMax: 85, lifetime: true  },
    // Gezond (geen voorgeschiedenis HVZ of DM2)
    { path: 'score2',         label: 'SCORE2',         group: 'Geen HVZ / geen DM2',  ageMin: 40, ageMax: 69, lifetime: false },
    { path: 'score2OP',       label: 'SCORE2-OP',      group: 'Geen HVZ / geen DM2',  ageMin: 70, ageMax: 90, lifetime: false },
    { path: 'lifeCvd2',       label: 'LIFE-CVD2',      group: 'Geen HVZ / geen DM2',  ageMin: 35, ageMax: 89, lifetime: true  }
];

function uprevent_addShortcut() {
    const bar = document.querySelector('.side-controls .shortcutsbar');
    if (!bar) return;
    if (bar.querySelector('[data-shortcut="CVRM"]')) return;

    const shortcut = document.createElement('div');
    shortcut.className = 'shortcut';
    shortcut.title = 'U-Prevent integratie';
    shortcut.setAttribute('data-shortcut', 'CVRM');
    shortcut.innerHTML = '<div class="caption" style="border-color: rgb(120, 100, 200);">CVRM</div>';
    shortcut.addEventListener('click', uprevent_onClick);
    bar.appendChild(shortcut);
    console.log('CVRM shortcut toegevoegd aan shortcutsbar');
}

function uprevent_removeShortcut() {
    document.querySelectorAll('.side-controls .shortcutsbar [data-shortcut="CVRM"]').forEach((n) => n.remove());
}

// --- Patiëntheader (Bricks patient-header2-left) --------------------------------
function uprevent_ageFromDobDdMmYyyy(dobStr) {
    const m = (dobStr || '').trim().match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
    if (!m) return null;
    const d = new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
    if (isNaN(d.getTime())) return null;
    const today = new Date();
    let age = today.getUTCFullYear() - d.getUTCFullYear();
    const mo = today.getUTCMonth() - d.getUTCMonth();
    if (mo < 0 || (mo === 0 && today.getUTCDate() < d.getUTCDate())) age -= 1;
    if (age < 0 || age > 120) return null;
    return age;
}

function uprevent_parseDdMmYyyyToUtcDate(dateStr) {
    const m = (dateStr || '').trim().match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
    if (!m) return null;
    const d = new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
    if (isNaN(d.getTime())) return null;
    return d;
}

function uprevent_ageOnDateFromDob(dobStr, refDateStr) {
    const dob = uprevent_parseDdMmYyyyToUtcDate(dobStr);
    const ref = uprevent_parseDdMmYyyyToUtcDate(refDateStr);
    if (!dob || !ref || ref < dob) return null;
    let age = ref.getUTCFullYear() - dob.getUTCFullYear();
    const md = ref.getUTCMonth() - dob.getUTCMonth();
    if (md < 0 || (md === 0 && ref.getUTCDate() < dob.getUTCDate())) age -= 1;
    if (age < 0 || age > 120) return null;
    return age;
}

function uprevent_parsePatientHeader() {
    const header = document.querySelector('.patient-header2-left');
    let age = null;
    let dobStr = null;
    if (!header) {
        return { age: null, dobStr: null };
    }
    const naamEl = header.querySelector('.area-profile-fullname .naam');
    if (naamEl) {
        const paren = naamEl.textContent.match(/\((\d{1,3})\)/);
        if (paren) {
            const n = +paren[1];
            if (n >= 0 && n <= 120) age = n;
        }
    }
    const dobSpan = header.querySelector('.area-profile-fullname .text-primary span');
    if (dobSpan) {
        const d = (dobSpan.textContent || '').trim();
        if (/^\d{1,2}-\d{1,2}-\d{4}$/.test(d)) dobStr = d;
    }
    if (age == null && dobStr) age = uprevent_ageFromDobDdMmYyyy(dobStr);
    return { age, dobStr };
}

// Geslacht uit aanhef in .naam: Dhr. = man, Mw. = vrouw, Dhr./Mw. (of Dhr/Mw) = onbekend.
// Retourneert { line: string } met een regel voor de export, of null als niet te bepalen.
function uprevent_detectSexLine() {
    const naamEl = document.querySelector('.patient-header2-left .area-profile-fullname .naam');
    if (!naamEl) return null;
    const naamText = (naamEl.textContent || '').replace(/\(\s*\d{1,3}\s*\)/g, '').trim();
    if (!naamText) return null;

    if (/dhr\.?\s*\/\s*mw\.?/i.test(naamText) || /mw\.?\s*\/\s*dhr\.?/i.test(naamText)) {
        return { line: 'geslacht: Dhr./Mw.' };
    }
    if (/\bmw\./i.test(naamText)) {
        return { line: 'geslacht: vrouw' };
    }
    if (/\bdhr\./i.test(naamText)) {
        return { line: 'geslacht: man' };
    }
    return null;
}

// --- Episoden ICPC (Episoden-widget) -------------------------------------------
function uprevent_normalizeIcpc(codeRaw) {
    return (codeRaw || '').trim().toUpperCase().replace(/\s/g, '');
}

// HVZ: K74*, K75*, K76*, K89*, K90*, K92*, uitsluitend K99.01 (niet andere K99.xx)
function uprevent_isHvzCode(codeRaw) {
    const c = uprevent_normalizeIcpc(codeRaw);
    if (!c) return false;
    if (/^K99\.01/.test(c)) return true;
    if (/^K74/.test(c)) return true;
    if (/^K75/.test(c)) return true;
    if (/^K76/.test(c)) return true;
    if (/^K89/.test(c)) return true;
    if (/^K90/.test(c)) return true;
    if (/^K92/.test(c)) return true;
    return false;
}

// Diabetes type 2 volgens episodes: T90 of T90.02, expliciet niet T90.01
function uprevent_isDm2EpisodeCode(codeRaw) {
    const c = uprevent_normalizeIcpc(codeRaw);
    if (!c) return false;
    if (/^T90\.01/.test(c)) return false;
    if (/^T90\.02/.test(c)) return true;
    if (c === 'T90') return true;
    return false;
}

function uprevent_collectEpisodeIcpcCodes() {
    const codes = [];
    const seen = new Set();
    const pushCode = (raw) => {
        const t = (raw || '').trim();
        if (!t || seen.has(t)) return;
        seen.add(t);
        codes.push(t);
    };

    // Layout variant 1 (oude weergave): episode-icpc / icpc-badge blok.
    document.querySelectorAll('.episoden-content .episode-icpc .split-text span, .episoden-content .icpc-badge .split-text span').forEach((el) => {
        pushCode(el.textContent);
    });

    // Layout variant 2 (uitgebreide/grid-weergave): code staat in een losse split-text link.
    document.querySelectorAll('.episoden-content .episoden-overzicht .split-text').forEach((el) => {
        const txt = (el.textContent || '').trim();
        // ICPC patroon zoals K99.01, T90.02, K75, A62, etc.
        const m = txt.match(/\b([A-Z]\d{2}(?:\.\d{2})?)\b/i);
        if (m) pushCode(m[1].toUpperCase());
    });

    return codes;
}

function uprevent_episodeFlagsFromCodes(codes) {
    let hvz = false;
    let dm2 = false;
    const hvzMatches = [];
    const dm2Matches = [];
    codes.forEach((raw) => {
        if (uprevent_isHvzCode(raw)) {
            hvz = true;
            hvzMatches.push(raw.trim());
        }
        if (uprevent_isDm2EpisodeCode(raw)) {
            dm2 = true;
            dm2Matches.push(raw.trim());
        }
    });
    return { hvz, dm2, codes, hvzMatches, dm2Matches };
}

function uprevent_collectDiabetesEpisodeDates() {
    const dates = [];
    const seen = new Set();

    // Veel episode-regels bevatten in title: "T90.02 ... Datum: dd-mm-jjjj"
    document.querySelectorAll('.episoden-content .episode-name[title], .episoden-content .cursor-help[title]').forEach((el) => {
        const title = (el.getAttribute('title') || '').replace(/\s+/g, ' ').trim();
        if (!title) return;
        const codeMatch = title.match(/\b([A-Z]\d{2}(?:\.\d{2})?)\b/i);
        if (!codeMatch) return;
        const code = codeMatch[1].toUpperCase();
        if (!uprevent_isDm2EpisodeCode(code)) return;
        const dateMatch = title.match(/Datum:\s*(\d{1,2}-\d{1,2}-\d{4})/i);
        if (!dateMatch) return;
        const d = dateMatch[1];
        if (seen.has(d)) return;
        seen.add(d);
        dates.push(d);
    });

    // Fallback: scan losse split-text velden in de episode widget.
    if (!dates.length) {
        const text = (document.querySelector('.episoden-content')?.textContent || '');
        const dm2Mentioned = /\bT90(?:\.02)?\b/i.test(text) && !/\bT90\.01\b/i.test(text);
        if (dm2Mentioned) {
            const allDates = text.match(/\b\d{1,2}-\d{1,2}-\d{4}\b/g) || [];
            allDates.forEach((d) => {
                if (!seen.has(d)) {
                    seen.add(d);
                    dates.push(d);
                }
            });
        }
    }

    return dates;
}

function uprevent_pickEarliestDate(dateStrings) {
    let best = null;
    (dateStrings || []).forEach((s) => {
        const d = uprevent_parseDdMmYyyyToUtcDate(s);
        if (!d) return;
        if (!best || d < best.date) best = { date: d, raw: s };
    });
    return best ? best.raw : null;
}

function uprevent_yearsSinceDate(dateStr) {
    const d = uprevent_parseDdMmYyyyToUtcDate(dateStr);
    if (!d) return null;
    const today = new Date();
    const now = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
    if (d > now) return null;
    let years = now.getUTCFullYear() - d.getUTCFullYear();
    const md = now.getUTCMonth() - d.getUTCMonth();
    if (md < 0 || (md === 0 && now.getUTCDate() < d.getUTCDate())) years -= 1;
    if (years < 0 || years > 120) return null;
    return years;
}

function uprevent_collectHvzEpisodeDates() {
    const dates = [];
    const seen = new Set();

    document.querySelectorAll('.episoden-content .episode-name[title], .episoden-content .cursor-help[title]').forEach((el) => {
        const title = (el.getAttribute('title') || '').replace(/\s+/g, ' ').trim();
        if (!title) return;
        const codeMatch = title.match(/\b([A-Z]\d{2}(?:\.\d{2})?)\b/i);
        if (!codeMatch) return;
        const code = codeMatch[1].toUpperCase();
        if (!uprevent_isHvzCode(code)) return;
        const dateMatch = title.match(/Datum:\s*(\d{1,2}-\d{1,2}-\d{4})/i);
        if (!dateMatch) return;
        const d = dateMatch[1];
        if (seen.has(d)) return;
        seen.add(d);
        dates.push(d);
    });

    if (!dates.length) {
        const text = (document.querySelector('.episoden-content')?.textContent || '');
        const hvzMentioned = /\bK74|K75|K76|K89|K90|K92|K99\.01\b/i.test(text);
        if (hvzMentioned) {
            const allDates = text.match(/\b\d{1,2}-\d{1,2}-\d{4}\b/g) || [];
            allDates.forEach((d) => {
                if (!seen.has(d)) {
                    seen.add(d);
                    dates.push(d);
                }
            });
        }
    }

    return dates;
}

// Scrape journaal + patiëntheader + zichtbare episoden. Geen geboortedatum in
// de export (privacy); leeftijd blijft wel als getal. Bloeddruk als één regel
// zodat de U-Prevent-parser hem via RR/bloeddruk-patroon herkent.
function uprevent_collectText() {
    const lines = [];
    const seen = new Set();
    const push = (s) => {
        if (!s || seen.has(s)) return;
        seen.add(s);
        lines.push(s);
    };

    const { age: headerAge, dobStr } = uprevent_parsePatientHeader();
    if (headerAge != null) push(`leeftijd: ${headerAge}`);

    const sexLine = uprevent_detectSexLine();
    if (sexLine) push(sexLine.line);

    const icpcCodes = uprevent_collectEpisodeIcpcCodes();
    const ep = uprevent_episodeFlagsFromCodes(icpcCodes);
    push(`HVZ: ${ep.hvz ? 'ja' : 'nee'}, DM2: ${ep.dm2 ? 'ja' : 'nee'}`);

    // Alleen bij DM2: stuur leeftijd op moment van diagnose mee.
    if (ep.dm2 && dobStr) {
        const dm2Dates = uprevent_collectDiabetesEpisodeDates();
        const firstDm2Date = uprevent_pickEarliestDate(dm2Dates);
        if (firstDm2Date) {
            const ageAtDm2 = uprevent_ageOnDateFromDob(dobStr, firstDm2Date);
            if (ageAtDm2 != null) {
                push(`leeftijd diagnose diabetes: ${ageAtDm2}`);
            }
        }
    }

    // Bij HVZ: jaren sinds het eerste vasculaire event (oudste HVZ-episode).
    if (ep.hvz) {
        const hvzDates = uprevent_collectHvzEpisodeDates();
        const firstHvzDate = uprevent_pickEarliestDate(hvzDates);
        if (firstHvzDate) {
            const yearsSinceFirstEvent = uprevent_yearsSinceDate(firstHvzDate);
            if (yearsSinceFirstEvent != null) {
                push(`jaren sinds eerste vasculaire event: ${yearsSinceFirstEvent}`);
            }
        }
    }

    // Journaal entries are rendered top = newest, so document order = newest-first.
    const regels = document.querySelectorAll('.journaal-contact-regel .split-text');
    let lastSys = null;
    let lastDia = null;
    let lastHba1c = null;
    let lastEgfr = null;
    let lastCholTotal = null;
    let lastHdl = null;
    let lastLdl = null;
    let lastNonHdl = null;
    let lastTriglycerides = null;
    let lastSmoking = null;
    regels.forEach((regel) => {
        const text = (regel.textContent || '').trim();
        if (!text) return;
        if (lastSys == null) {
            const sys = text.match(/systolische\s+bloeddruk\s*:\s*(\d{2,3})\b/i);
            if (sys) lastSys = sys[1];
        }
        if (lastDia == null) {
            const dia = text.match(/diastolische\s+bloeddruk\s*:\s*(\d{2,3})\b/i);
            if (dia) lastDia = dia[1];
        }
        if (lastHba1c == null) {
            const m = text.match(/hba1c[^:]*:\s*([0-9]+(?:[.,][0-9]+)?)/i);
            if (m) lastHba1c = m[1].replace(',', '.');
        }
        if (lastEgfr == null) {
            const m = text.match(/egfr[^:]*:\s*([0-9]+(?:[.,][0-9]+)?)/i);
            if (m) lastEgfr = m[1].replace(',', '.');
        }
        if (lastCholTotal == null) {
            const m = text.match(/cholesterol\s+totaal\s*:\s*([0-9]+(?:[.,][0-9]+)?)/i);
            if (m) lastCholTotal = m[1].replace(',', '.');
        }
        if (lastHdl == null) {
            const m = text.match(/\bhdl-?\s*cholesterol\s*:\s*([0-9]+(?:[.,][0-9]+)?)/i);
            if (m) lastHdl = m[1].replace(',', '.');
        }
        if (lastLdl == null) {
            const m = text.match(/\bldl-?\s*cholesterol\s*:\s*([0-9]+(?:[.,][0-9]+)?)/i);
            if (m) lastLdl = m[1].replace(',', '.');
        }
        if (lastNonHdl == null) {
            const m = text.match(/\bnon-?\s*hdl\s*cholesterol\s*:\s*([0-9]+(?:[.,][0-9]+)?)/i);
            if (m) lastNonHdl = m[1].replace(',', '.');
        }
        if (lastTriglycerides == null) {
            const m = text.match(/\btriglyceriden\s*:\s*([0-9]+(?:[.,][0-9]+)?)/i);
            if (m) lastTriglycerides = m[1].replace(',', '.');
        }
        if (lastSmoking == null) {
            const m = text.match(/\broken\s*:\s*(ja|nee|voorheen)\b/i);
            if (m) {
                const v = m[1].toLowerCase();
                lastSmoking = v;
            }
        }
    });
    if (lastSys != null && lastDia != null) {
        push(`Bloeddruk: ${lastSys}/${lastDia} mmHg`);
    }
    if (lastSmoking != null) {
        push(`roken: ${lastSmoking}`);
    }
    if (lastHba1c != null) {
        push(`HbA1c IFCC: ${lastHba1c}`);
    }
    if (lastEgfr != null) {
        push(`eGFR: ${lastEgfr}`);
    }
    if (lastCholTotal != null) {
        push(`cholesterol totaal: ${lastCholTotal}`);
    }
    if (lastHdl != null) {
        push(`HDL-cholesterol: ${lastHdl}`);
    }
    if (lastLdl != null) {
        push(`LDL-cholesterol: ${lastLdl}`);
    }
    if (lastNonHdl != null) {
        push(`non-HDL cholesterol: ${lastNonHdl}`);
    }
    if (lastTriglycerides != null) {
        push(`Triglyceriden: ${lastTriglycerides}`);
    }

    return lines.join('\n');
}

// Leeftijd uit patiëntheader (haakjes na naam of geboortedatum dd-mm-jjjj).
function uprevent_detectAge() {
    const { age, dobStr } = uprevent_parsePatientHeader();
    if (age != null) return age;
    if (dobStr) return uprevent_ageFromDobDdMmYyyy(dobStr);
    const headerText = (document.querySelector('.patient-header2-left')?.textContent
        || document.querySelector('.patientcard, .patient-header, .patientinfo')?.textContent
        || '');
    const yrs = headerText.match(/\b(\d{1,3})\s*(?:jaar|jr)\b/i);
    if (yrs) {
        const n = +yrs[1];
        if (n >= 18 && n <= 110) return n;
    }
    const dob = headerText.match(/\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})\b/);
    if (dob) {
        const d = new Date(Date.UTC(+dob[3], +dob[2] - 1, +dob[1]));
        if (!isNaN(d)) {
            const today = new Date();
            let a = today.getUTCFullYear() - d.getUTCFullYear();
            const md = today.getUTCMonth() - d.getUTCMonth();
            if (md < 0 || (md === 0 && today.getUTCDate() < d.getUTCDate())) a -= 1;
            if (a >= 0 && a <= 120) return a;
        }
    }
    return null;
}

let upreventModalEl = null;

function uprevent_closeModal() {
    if (upreventModalEl) {
        upreventModalEl.remove();
        upreventModalEl = null;
    }
    document.removeEventListener('keydown', uprevent_onKeyDown);
}

function uprevent_onKeyDown(e) {
    if (e.key === 'Escape') uprevent_closeModal();
}

function uprevent_onClick(e) {
    if (e) { e.preventDefault(); e.stopPropagation(); }
    const text = uprevent_collectText();
    const age = uprevent_detectAge();
    const episodeFlags = uprevent_episodeFlagsFromCodes(uprevent_collectEpisodeIcpcCodes());
    uprevent_showPicker(text, age, episodeFlags);
}

function uprevent_showPicker(text, age, episodeFlags) {
    uprevent_closeModal();

    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:2147483646;display:flex;align-items:center;justify-content:center;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;';
    overlay.addEventListener('click', (ev) => { if (ev.target === overlay) uprevent_closeModal(); });

    const modal = document.createElement('div');
    modal.style.cssText = 'background:#fff;border-radius:12px;box-shadow:0 20px 60px rgba(0,0,0,0.3);max-width:560px;width:90%;max-height:90vh;overflow:auto;color:#2d3748;';
    overlay.appendChild(modal);

    // Header
    const header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;gap:12px;padding:16px 20px;border-bottom:1px solid #e2e8f0;';
    header.innerHTML = `
        <div style="font-size:1.15em;font-weight:600;flex:1;">U-Prevent CVRM</div>
        <button type="button" class="uprevent-close" aria-label="Sluiten" style="background:transparent;border:none;font-size:20px;cursor:pointer;color:#718096;line-height:1;">&times;</button>
    `;
    header.querySelector('.uprevent-close').addEventListener('click', uprevent_closeModal);
    modal.appendChild(header);

    // Status badge (async)
    const status = document.createElement('div');
    status.style.cssText = 'padding:12px 20px;border-bottom:1px solid #e2e8f0;font-size:13px;color:#4a5568;display:flex;align-items:center;gap:8px;flex-wrap:wrap;';
    status.innerHTML = '<span>U-Prevent Infused: </span><strong class="uprevent-status-text" style="color:#a0aec0;">controleren&hellip;</strong>';
    modal.appendChild(status);

    // Body
    const body = document.createElement('div');
    body.style.cssText = 'padding:16px 20px;';
    modal.appendChild(body);

    if (text) {
        const dataNote = document.createElement('div');
        dataNote.style.cssText = 'background:#f7fafc;border-radius:8px;padding:10px 12px;margin-bottom:14px;font-size:13px;color:#4a5568;border-left:3px solid #667eea;';
        dataNote.innerHTML = `<strong>Gevonden gegevens:</strong><pre style="margin:6px 0 0 0;white-space:pre-wrap;font-size:12px;color:#2d3748;font-family:inherit;">${text.replace(/[<>&]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]))}</pre>`;
        body.appendChild(dataNote);
    } else {
        const noData = document.createElement('div');
        noData.style.cssText = 'background:#fffaf0;border-radius:8px;padding:10px 12px;margin-bottom:14px;font-size:13px;color:#7b6232;border-left:3px solid #ed8936;';
        noData.textContent = 'Geen CVRM-gegevens gevonden in het zichtbare journaal. Je kunt nog steeds een calculator openen en zelf invullen.';
        body.appendChild(noData);
    }

    if (age != null) {
        const ageNote = document.createElement('div');
        ageNote.style.cssText = 'font-size:12px;color:#718096;margin-bottom:10px;';
        ageNote.textContent = `Leeftijd gedetecteerd: ${age} jaar — passende calculators zijn gemarkeerd.`;
        body.appendChild(ageNote);
    }

    // Calculators grouped by group label
    const groups = {};
    UPREVENT_CALCULATORS.forEach((c) => {
        groups[c.group] = groups[c.group] || [];
        groups[c.group].push(c);
    });

    const calcSection = document.createElement('div');
    Object.entries(groups).forEach(([groupLabel, items]) => {
        const groupTitle = document.createElement('div');
        groupTitle.style.cssText = 'font-size:12px;font-weight:600;color:#718096;text-transform:uppercase;letter-spacing:0.5px;margin:10px 0 6px 0;';
        groupTitle.textContent = groupLabel;
        calcSection.appendChild(groupTitle);

        const grid = document.createElement('div');
        grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:8px;margin-bottom:6px;';
        items.forEach((calc) => {
            const fitsAge = age == null ? null : (age >= calc.ageMin && age <= calc.ageMax);
            let matchesCategory = true;
            if (calc.group === 'Eerdere HVZ') {
                matchesCategory = !!episodeFlags?.hvz;
            } else if (calc.group === 'Diabetes type 2') {
                matchesCategory = !!episodeFlags?.dm2;
            } else if (calc.group === 'Geen HVZ / geen DM2') {
                matchesCategory = !episodeFlags?.hvz && !episodeFlags?.dm2;
            }
            const fits = fitsAge === null ? null : (fitsAge && matchesCategory);
            const btn = document.createElement('button');
            btn.type = 'button';
            const baseStyle = 'border-radius:8px;padding:10px 12px;font-size:13px;font-weight:500;cursor:pointer;text-align:left;transition:all 0.15s ease;background:#fff;color:#2d3748;';
            const fitStyle = fits === true
                ? 'border:2px solid #667eea;box-shadow:0 2px 6px rgba(102,126,234,0.15);'
                : fits === false
                    ? 'border:1px solid #e2e8f0;opacity:0.55;'
                    : 'border:1px solid #cbd5e0;';
            btn.style.cssText = baseStyle + fitStyle;
            btn.innerHTML = `
                <div style="font-weight:600;">${calc.label}</div>
                <div style="font-size:11px;color:#718096;margin-top:2px;">${calc.ageMin}-${calc.ageMax} jr${calc.lifetime ? ' · lifetime' : ''}</div>
            `;
            btn.addEventListener('click', () => uprevent_handleCalculatorClick(calc, text, btn));
            grid.appendChild(btn);
        });
        calcSection.appendChild(grid);
    });
    body.appendChild(calcSection);

    // Footer with copy + cancel
    const footer = document.createElement('div');
    footer.style.cssText = 'display:flex;justify-content:space-between;gap:8px;padding:14px 20px;border-top:1px solid #e2e8f0;background:#f7fafc;border-bottom-left-radius:12px;border-bottom-right-radius:12px;';
    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.textContent = '📋 Kopieer naar klembord';
    copyBtn.style.cssText = 'border:1px solid #cbd5e0;background:#fff;color:#2d3748;padding:8px 14px;border-radius:6px;font-size:13px;cursor:pointer;';
    copyBtn.disabled = !text;
    if (!text) copyBtn.style.opacity = '0.5';
    copyBtn.addEventListener('click', async () => {
        if (!text) return;
        try {
            await navigator.clipboard.writeText(text);
            copyBtn.textContent = '✅ Gekopieerd';
            setTimeout(() => uprevent_closeModal(), 700);
        } catch (err) {
            copyBtn.textContent = 'Kopiëren mislukt';
            console.warn('CVRM kopieer-fout', err);
        }
    });
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.textContent = 'Annuleren';
    cancelBtn.style.cssText = 'border:none;background:transparent;color:#718096;padding:8px 14px;font-size:13px;cursor:pointer;';
    cancelBtn.addEventListener('click', uprevent_closeModal);
    footer.appendChild(copyBtn);
    footer.appendChild(cancelBtn);
    modal.appendChild(footer);

    document.body.appendChild(overlay);
    upreventModalEl = overlay;
    document.addEventListener('keydown', uprevent_onKeyDown);

    // Async: ping U-Prevent Infused via background.
    chrome.runtime.sendMessage({ type: 'uprevent.ping' }, (resp) => {
        const target = status.querySelector('.uprevent-status-text');
        if (chrome.runtime.lastError || !resp) {
            if (target) {
                target.textContent = 'fout bij controle';
                target.style.color = '#c53030';
            }
            return;
        }
        if (resp.installed) {
            if (target) {
                target.textContent = `gevonden${resp.version ? ' (v' + resp.version + ')' : ''}`;
                target.style.color = '#2f855a';
            }
            // Calculator buttons keep their default click handler (auto-open).
        } else {
            if (target) {
                target.textContent = 'niet gevonden';
                target.style.color = '#c53030';
            }
            const installRow = document.createElement('div');
            installRow.style.cssText = 'margin-left:auto;';
            const installLink = resp.installUrl || 'https://dokterbart.nl/u-prevent-infused';
            installRow.innerHTML = `<a href="${installLink}" target="_blank" rel="noopener" style="color:#667eea;font-size:13px;text-decoration:none;font-weight:500;">→ Installeer U-Prevent Infused</a>`;
            status.appendChild(installRow);
            // Mark calculator buttons as "open in tab only" mode.
            modal.dataset.upreventInstalled = 'false';
        }
    });
}

function uprevent_handleCalculatorClick(calc, text, btn) {
    const installed = upreventModalEl && upreventModalEl.querySelector('.uprevent-status-text')?.textContent.startsWith('gevonden');
    if (installed) {
        const original = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = `<div style="font-weight:600;">${calc.label}</div><div style="font-size:11px;color:#718096;margin-top:2px;">openen&hellip;</div>`;
        chrome.runtime.sendMessage({ type: 'uprevent.openAndFill', calculatorPath: calc.path, text: text || '' }, (resp) => {
            if (chrome.runtime.lastError || !resp || !resp.ok) {
                btn.disabled = false;
                btn.innerHTML = original;
                console.warn('U-Prevent openAndFill mislukt:', chrome.runtime.lastError || resp);
                // Fallback: just open the URL in a new tab so the user isn't blocked.
                window.open(`https://u-prevent.nl/calculators/${calc.path}`, '_blank', 'noopener');
            } else {
                uprevent_closeModal();
            }
        });
    } else {
        // Plugin not (yet) detected: open the calculator in a new tab so the
        // user can paste the (already-on-clipboard if they hit Copy) text.
        window.open(`https://u-prevent.nl/calculators/${calc.path}`, '_blank', 'noopener');
    }
}

loadGlobalOptions(function (options) {
    if (!options.uprevent) {
        console.log('U-Prevent CVRM integratie disabled, observer niet gestart');
        return;
    }
    const uprevent_observer = new MutationObserver(() => {
        uprevent_addShortcut();
    });
    uprevent_observer.observe(document.body, { childList: true, subtree: true });
    uprevent_addShortcut();
});



