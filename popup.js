// Popup script voor Bricks Infused extensie

document.addEventListener('DOMContentLoaded', () => {
  console.log('Bricks Infused popup loaded');
  
  // Haal versienummer uit manifest.json
  const manifest = chrome.runtime.getManifest();
  const versionText = document.getElementById('version-text');
  if (manifest.version_name) {
    versionText.textContent = manifest.version_name;
  } else {
    versionText.textContent = `v${manifest.version}`;
  }
  
  // Start Bricks knop
  document.getElementById('startBricks').addEventListener('click', () => {
    chrome.storage.sync.get(['klantnummer'], (result) => {
      const klantnummer = result.klantnummer;
      if (klantnummer) {
        chrome.tabs.create({ url: `https://brickshuisarts.nl/${klantnummer}/` });
      } else {
        chrome.tabs.create({ url: 'https://brickshuisarts.nl' });
      }
    });
  });
  
  // Open options pagina wanneer op instellingen knop wordt geklikt
  document.getElementById('openOptions').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });
});
