/**
 * Bricks Infused — isolated-world client for bridge_main.js.
 * Usage: await bricksBridge.call('getActiveContext') etc.
 * See BRICKS-INTERNALS.md.
 */
(function bricksInfusedBridgeClient() {
  'use strict';

  const SRC_OUT = 'bricks-infused';
  const SRC_IN = 'bricks-infused-main';
  const pending = new Map();
  let seq = 1;

  function call(method, args, timeoutMs) {
    const id = 'bi-' + Date.now() + '-' + seq++;
    const wait = timeoutMs != null ? timeoutMs : 20000;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error('bricks-bridge-timeout:' + method));
      }, wait);
      pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject: (e) => { clearTimeout(timer); reject(e); }
      });
      window.postMessage(
        {
          source: SRC_OUT,
          type: 'req',
          id,
          method,
          args: args || {}
        },
        location.origin
      );
    });
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== SRC_IN || data.id == null) return;
    const entry = pending.get(data.id);
    if (!entry) return;
    pending.delete(data.id);
    if (data.ok) entry.resolve(data.result);
    else entry.reject(new Error(data.error || 'bricks-bridge-error'));
  });

  async function waitUntilReady(maxMs) {
    const deadline = Date.now() + (maxMs != null ? maxMs : 15000);
    let lastErr = null;
    while (Date.now() < deadline) {
      try {
        const st = await call('getStatus', {}, 2000);
        if (st && st.hasB) return st;
      } catch (e) {
        lastErr = e;
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    throw lastErr || new Error('bricks-bridge-not-ready');
  }

  window.bricksBridge = {
    call,
    waitUntilReady,
    getActiveContext: () => call('getActiveContext'),
    navigate: (to) => call('navigate', { to }),
    doApi: (service, method, params, ignoreBusy) =>
      call('doApi', { service, method, params, ignoreBusy }, 60000),
    toggleLayoutResize: () => call('toggleLayoutResize', {}, 5000),
    startZorgdomeinVerwijzing: (opts) =>
      call('startZorgdomeinVerwijzing', opts || {}, 60000),
    whoAmI: () => call('whoAmI'),
    takenNew: () => call('takenNew'),
    takenStore: (taak, seperateTaskForEachMedewerker, askForCollectieUpdate) =>
      call('takenStore', {
        taak,
        seperateTaskForEachMedewerker,
        askForCollectieUpdate
      }),
    takenGet: (taakId) => call('takenGet', { taakId }),
    takenGetByMedewerkerAndRol: (opts) =>
      call('takenGetByMedewerkerAndRol', opts || {}),
    ping: () => call('ping')
  };
})();
