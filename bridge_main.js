/**
 * Bricks Infused — MAIN-world bridge (document_start).
 * Captures Bricks' module-scoped `B` API (via Object.assign(B, f9)),
 * tracks active patient/contact, exposes Vue router + doApi to content scripts
 * through window.postMessage. See BRICKS-INTERNALS.md.
 */
(function bricksInfusedMainBridge() {
  'use strict';

  if (window.__bricksInfusedMain && window.__bricksInfusedMain.__installed) {
    return;
  }

  const SRC_IN = 'bricks-infused';
  const SRC_OUT = 'bricks-infused-main';
  const ZD_LOGIN_PROD = 'https://www.zorgdomein.nl/cgi-bin/zdlogin';
  const ZD_LOGIN_TIO = 'https://tio.zorgdomein.nl/cgi-bin/zdlogin';

  const state = {
    B: null,
    trackedPatientId: -1,
    trackedContactId: -1,
    assignHooked: false,
    hisRegieWrapped: false,
    mapHooked: false,
    layoutResizeExecute: null,
    eventTrigger: null
  };

  function log() {
    /* keep quiet in production page console unless debugging */
  }

  function parsePatientIdFromPath(pathname) {
    const p = pathname || location.pathname || '';
    let m = p.match(/\/s\/consult\/(\d+)/i);
    if (m) return parseInt(m[1], 10);
    m = p.match(/\/consult\/(\d+)/i);
    if (m) return parseInt(m[1], 10);
    m = p.match(/\/patienten\/(\d+)/i);
    if (m) return parseInt(m[1], 10);
    return -1;
  }

  function getVueRouter() {
    try {
      const app = document.querySelector('#app') && document.querySelector('#app').__vue_app__;
      if (!app || !app._context || !app._context.provides) return null;
      const provides = app._context.provides;
      for (const k of Reflect.ownKeys(provides)) {
        const v = provides[k];
        if (v && typeof v.push === 'function' && v.currentRoute) return v;
      }
    } catch (e) { /* ignore */ }
    return null;
  }

  function getKlantnummer() {
    const m = (location.pathname || '').match(/^\/(\d+)(?:\/|$)/);
    if (m) return parseInt(m[1], 10);
    try {
      if (state.B && typeof state.B.doApi === 'function') {
        /* P.klantnummer not available; URL is enough for ZD host choice */
      }
    } catch (e) { /* ignore */ }
    return -1;
  }

  function wrapHisRegieTracking(B) {
    if (state.hisRegieWrapped || !B || !B.hisRegie) return;
    const hr = B.hisRegie;
    if (typeof hr.setHuidigePatientId === 'function') {
      const orig = hr.setHuidigePatientId.bind(hr);
      hr.setHuidigePatientId = function (patientId) {
        const id = parseInt(patientId, 10);
        if (id > 0) state.trackedPatientId = id;
        return orig(patientId);
      };
    }
    if (typeof hr.setHuidigContactId === 'function') {
      const origC = hr.setHuidigContactId.bind(hr);
      hr.setHuidigContactId = function (contactId) {
        const id = parseInt(contactId, 10);
        if (!Number.isNaN(id)) state.trackedContactId = id;
        return origC(contactId);
      };
    }
    state.hisRegieWrapped = true;
  }

  function captureB(candidate) {
    if (!candidate || typeof candidate.doApi !== 'function') return false;
    state.B = candidate;
    wrapHisRegieTracking(candidate);
    return true;
  }

  function rememberLayoutResizeCommand(entry) {
    if (!entry) return;
    if (typeof entry.execute === 'function') {
      state.layoutResizeExecute = entry.execute.bind(entry);
    } else if (typeof entry === 'function') {
      state.layoutResizeExecute = entry;
    }
  }

  function rememberEventBus(candidate) {
    if (
      candidate &&
      typeof candidate.trigger === 'function' &&
      typeof candidate.subscribe === 'function'
    ) {
      state.eventTrigger = candidate.trigger.bind(candidate);
    }
  }

  function installMapHook() {
    if (state.mapHooked) return;
    state.mapHooked = true;
    const origSet = Map.prototype.set;
    Map.prototype.set = function patchedMapSet(key, value) {
      try {
        if (key === 'layout.resize.toggle') {
          rememberLayoutResizeCommand(value);
        }
        if (
          value &&
          typeof value === 'object' &&
          value.id === 'layout.resize.toggle'
        ) {
          rememberLayoutResizeCommand(value);
        }
        if (
          value &&
          typeof value === 'object' &&
          typeof value.trigger === 'function' &&
          typeof value.subscribe === 'function'
        ) {
          rememberEventBus(value);
        }
      } catch (e) { /* ignore */ }
      return origSet.call(this, key, value);
    };
  }

  function isResizeActive() {
    return !!document.querySelector('.layout-renderer.resize-active');
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function dispatchKey(partial) {
    const init = Object.assign(
      {
        bubbles: true,
        cancelable: true,
        composed: true
      },
      partial
    );
    document.dispatchEvent(new KeyboardEvent('keydown', init));
  }

  /**
   * Fallback: CTRL+SPACE opent sneltoetsenpalette, H = hoofdmenu, L = widget aanpassen.
   */
  async function toggleLayoutResizeViaKeyChord() {
    const before = isResizeActive();
    dispatchKey({ key: ' ', code: 'Space', ctrlKey: true, keyCode: 32, which: 32 });
    await sleep(60);
    dispatchKey({ key: 'h', code: 'KeyH', keyCode: 72, which: 72 });
    await sleep(60);
    dispatchKey({ key: 'l', code: 'KeyL', keyCode: 76, which: 76 });
    await sleep(120);
    return {
      ok: true,
      mode: 'keychord',
      resizeActive: isResizeActive(),
      toggled: before !== isResizeActive()
    };
  }

  async function toggleLayoutResize() {
    const before = isResizeActive();
    if (typeof state.layoutResizeExecute === 'function') {
      state.layoutResizeExecute();
      return {
        ok: true,
        mode: 'command',
        resizeActive: isResizeActive(),
        toggled: before !== isResizeActive()
      };
    }
    if (typeof state.eventTrigger === 'function') {
      state.eventTrigger(before ? 'widgets.resize.stop' : 'widgets.resize.start');
      return {
        ok: true,
        mode: 'event-bus',
        resizeActive: isResizeActive(),
        toggled: before !== isResizeActive()
      };
    }
    return toggleLayoutResizeViaKeyChord();
  }

  function installAssignHook() {
    if (state.assignHooked) return;
    state.assignHooked = true;
    const origAssign = Object.assign;
    Object.assign = function patchedAssign(target) {
      const result = origAssign.apply(this, arguments);
      try {
        for (let i = 1; i < arguments.length; i++) {
          const src = arguments[i];
          if (
            src &&
            typeof src.doApi === 'function' &&
            typeof src.connect === 'function' &&
            target &&
            typeof target === 'object'
          ) {
            captureB(target);
          }
          rememberEventBus(src);
        }
        if (
          target &&
          typeof target.doApi === 'function' &&
          target.taken &&
          target.zorgdomeinVerwijzing
        ) {
          captureB(target);
        }
        rememberEventBus(target);
      } catch (e) { /* ignore */ }
      return result;
    };
  }

  function pairsToObject(returnValue) {
    const out = {};
    if (!returnValue) return out;
    if (Array.isArray(returnValue)) {
      returnValue.forEach((t) => {
        if (t && t.Item1 != null) out[t.Item1] = t.Item2;
      });
      return out;
    }
    if (typeof returnValue === 'object') return { ...returnValue };
    return out;
  }

  function postForm(url, fields, charset) {
    const form = document.createElement('form');
    form.setAttribute('method', 'post');
    form.setAttribute('action', url);
    form.setAttribute('target', '_blank');
    form.setAttribute('class', 'hidden');
    form.style.display = 'none';
    if (charset) form.setAttribute('accept-charset', charset);
    Object.keys(fields || {}).forEach((name) => {
      const input = document.createElement('input');
      input.setAttribute('type', 'text');
      input.setAttribute('name', name);
      input.setAttribute('value', fields[name] == null ? '' : String(fields[name]));
      form.appendChild(input);
    });
    document.body.appendChild(form);
    form.submit();
    setTimeout(() => {
      try { form.remove(); } catch (e) { /* ignore */ }
    }, 1000);
  }

  function getActiveContext() {
    const fromUrl = parsePatientIdFromPath(location.pathname);
    let patientId = fromUrl > 0 ? fromUrl : state.trackedPatientId;
    let contactId = state.trackedContactId;

    // Prefer URL patient when it disagrees with last hisRegie track (multi-dossier).
    if (fromUrl > 0) patientId = fromUrl;

    const router = getVueRouter();
    let routePath = null;
    try {
      if (router && router.currentRoute) {
        const r = router.currentRoute.value || router.currentRoute;
        routePath = r && r.fullPath;
        if (patientId <= 0 && r && r.params) {
          const content = r.params.content;
          if (Array.isArray(content) && content[0] === 'consult' && content[1]) {
            patientId = parseInt(content[1], 10) || patientId;
          }
          if (r.params.patientid) {
            patientId = parseInt(r.params.patientid, 10) || patientId;
          }
        }
      }
    } catch (e) { /* ignore */ }

    return {
      patientId: patientId > 0 ? patientId : -1,
      contactId: typeof contactId === 'number' ? contactId : -1,
      routePath,
      hasB: !!state.B,
      klantnummer: getKlantnummer()
    };
  }

  async function navigate(to) {
    const router = getVueRouter();
    if (!router) throw new Error('vue-router-not-ready');
    await router.push(to);
    return { ok: true, path: (router.currentRoute.value || router.currentRoute).fullPath };
  }

  async function doApi(service, method, params, ignoreBusy) {
    if (!state.B || typeof state.B.doApi !== 'function') {
      throw new Error('bricks-api-not-ready');
    }
    return state.B.doApi(service, method, params || {}, !!ignoreBusy);
  }

  async function startZorgdomeinVerwijzing(options) {
    const opts = options || {};
    const ctx = getActiveContext();
    const patientId = parseInt(opts.patientId, 10) > 0
      ? parseInt(opts.patientId, 10)
      : ctx.patientId;
    if (!(patientId > 0)) {
      throw new Error('no-active-patient');
    }

    // Keep server-side "huidige patiënt" aligned with the dossier we act on.
    try {
      if (state.B && state.B.hisRegie && typeof state.B.hisRegie.setHuidigePatientId === 'function') {
        await state.B.hisRegie.setHuidigePatientId(patientId);
        state.trackedPatientId = patientId;
      }
    } catch (e) { /* non-fatal */ }

    let contactId = parseInt(opts.contactId, 10);
    if (!(contactId > 0)) {
      contactId = ctx.contactId > 0 && ctx.patientId === patientId ? ctx.contactId : -1;
    }

    const needEpisodes = !!opts.episodelijstNodig;
    if (needEpisodes) {
      await navigate(`/s/consult/${patientId}/verwijzen/zorgdomein`);
      return {
        ok: true,
        mode: 'ui-tab',
        patientId,
        contactId,
        message: 'Opened ZorgDomein tab for episode selection'
      };
    }

    const params = {
      patientId,
      deelcontactId: contactId > 0 ? contactId : -1,
      contactDagen: opts.contactDagen != null ? opts.contactDagen : 120,
      maxContacten: opts.maxContacten != null ? opts.maxContacten : 6,
      metingDagen: opts.metingDagen != null ? opts.metingDagen : 90,
      episodesIds: opts.episodesIds || opts.episodenIds || [],
      ContraindicatieIds: opts.ContraindicatieIds || opts.indicatieIds || [],
      telefoonNummer: opts.telefoonNummer != null ? opts.telefoonNummer : (opts.telnr || ''),
      dcrEpisodesIds: opts.dcrEpisodesIds || []
    };

    let result;
    if (state.B && state.B.zorgdomeinVerwijzing && typeof state.B.zorgdomeinVerwijzing.verwijzingParams === 'function') {
      result = await state.B.zorgdomeinVerwijzing.verwijzingParams(
        params.patientId,
        params.deelcontactId,
        params.contactDagen,
        params.maxContacten,
        params.metingDagen,
        params.episodesIds,
        params.ContraindicatieIds,
        params.telefoonNummer,
        params.dcrEpisodesIds
      );
    } else {
      result = await doApi('ZorgdomeinVerwijzing', 'VerwijzingParams', params);
    }

    const fields = pairsToObject(result && result.ReturnValue);
    if (!fields || Object.keys(fields).length === 0) {
      throw new Error('zorgdomein-empty-params');
    }

    const klant = getKlantnummer();
    const url = klant > 9000 ? ZD_LOGIN_TIO : ZD_LOGIN_PROD;
    postForm(url, fields, 'ISO-8859-1');

    return {
      ok: true,
      mode: 'direct-api',
      patientId,
      contactId: params.deelcontactId,
      zdUrl: url,
      fieldCount: Object.keys(fields).length
    };
  }

  async function handleRequest(msg) {
    const method = msg.method;
    const args = msg.args || {};
    switch (method) {
      case 'ping':
        return {
          ok: true,
          hasB: !!state.B,
          context: getActiveContext()
        };
      case 'getStatus':
        return {
          hasB: !!state.B,
          hisRegieWrapped: state.hisRegieWrapped,
          context: getActiveContext(),
          hasRouter: !!getVueRouter(),
          hasLayoutResizeCommand: typeof state.layoutResizeExecute === 'function',
          hasEventTrigger: typeof state.eventTrigger === 'function',
          resizeActive: isResizeActive()
        };
      case 'getActiveContext':
        return getActiveContext();
      case 'navigate':
        return navigate(args.to);
      case 'doApi':
        return doApi(args.service, args.method, args.params, args.ignoreBusy);
      case 'toggleLayoutResize':
        return toggleLayoutResize();
      case 'startZorgdomeinVerwijzing':
        return startZorgdomeinVerwijzing(args);
      case 'whoAmI':
        if (!state.B || !state.B.hisRegie || typeof state.B.hisRegie.wieBenIk !== 'function') {
          throw new Error('bricks-api-not-ready');
        }
        return state.B.hisRegie.wieBenIk().then((r) => (r && r.ReturnValue) || r);
      case 'getUISettings':
        if (!state.B || !state.B.hisRegie || typeof state.B.hisRegie.getUISettings !== 'function') {
          throw new Error('bricks-api-not-ready');
        }
        return state.B.hisRegie.getUISettings();
      case 'setUISettings':
        if (!state.B || !state.B.hisRegie || typeof state.B.hisRegie.setUISettings !== 'function') {
          throw new Error('bricks-api-not-ready');
        }
        return state.B.hisRegie.setUISettings(args.settings);
      case 'takenNew':
        if (!state.B || !state.B.taken) throw new Error('bricks-api-not-ready');
        return state.B.taken.newTaak();
      case 'takenStore':
        if (!state.B || !state.B.taken) throw new Error('bricks-api-not-ready');
        return state.B.taken.storeTaak(args.taak, args.seperateTaskForEachMedewerker, args.askForCollectieUpdate);
      case 'takenGet':
        if (!state.B || !state.B.taken) throw new Error('bricks-api-not-ready');
        return state.B.taken.getTaak(args.taakId);
      case 'takenGetByMedewerkerAndRol':
        if (!state.B || !state.B.taken) throw new Error('bricks-api-not-ready');
        return state.B.taken.getTakenByMedewerkerIdAndRol(
          args.medewerkerId,
          args.rol,
          args.inclGroep,
          args.statusFilter,
          args.inclGesloten
        );
      default:
        throw new Error('unknown-method:' + method);
    }
  }

  function reply(id, ok, payload) {
    window.postMessage(
      {
        source: SRC_OUT,
        id,
        ok,
        result: ok ? payload : undefined,
        error: ok ? undefined : (payload && payload.message) || String(payload)
      },
      location.origin
    );
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== SRC_IN || data.type !== 'req') return;
    const id = data.id;
    Promise.resolve()
      .then(() => handleRequest(data))
      .then((result) => reply(id, true, result))
      .catch((err) => reply(id, false, err && err.message ? err : { message: String(err) }));
  });

  installMapHook();
  installAssignHook();

  window.__bricksInfusedMain = {
    __installed: true,
    getB: () => state.B,
    getActiveContext,
    toggleLayoutResize,
    isResizeActive,
    getStatus: () => ({
      hasB: !!state.B,
      context: getActiveContext(),
      hasRouter: !!getVueRouter(),
      hasLayoutResizeCommand: typeof state.layoutResizeExecute === 'function',
      resizeActive: isResizeActive()
    })
  };

  log('bridge installed');
})();
