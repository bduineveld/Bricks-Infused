# Bricks Huisarts — internals for Bricks Infused

Notes from live inspection of `https://brickshuisarts.nl/{klantnummer}/` (DemoDigidok / Vue SPA).  
Use this so we do not re-discover the same plumbing after a session ends.

Last researched: 2026-09-06 against bundle `assets/index-*.js`.

---

## Stack

- **Vue 3** SPA (`#app` with `data-v-app`, `document.querySelector('#app').__vue_app__`).
- **Vue Router** is provided on the app context (`$router` / `$route` in `globalProperties`).
- Backend calls go over a **WebSocket**, not REST/`fetch`:
  - URL shape: `wss://brickshuisarts.nl/{klantnummer}/?referer=...`
  - Request: `{ T: "r", I: "<id>", M: "Service.Method", ...params }`
  - Responses correlate on `I` and typically include `ReturnValue`.
- The client API object is module-scoped as **`B`**:
  - `B.doApi(service, method, params)` → WebSocket RPC.
  - Wired with `Object.assign(B, f9)` where `f9.doApi === Xf`.
  - **`B` / `P` are NOT on `window`** (ES module scope). Content scripts cannot see them unless a MAIN-world bridge captures them.
- App facade **`P`** (also module-scoped): `P.router`, `P.context`, `P.taken`, `P.settings`, `P.medewerker`, `P.extensionapi`, `P.klantnummer`, dialogs, etc.
- Tetra’s `P.extensionapi` is for **iframe “extensions”** inside Bricks, not Chrome extensions.

---

## Router (navigation without navbar clicks)

Useful named routes / paths:

| Name | Path |
|------|------|
| Home | `/` |
| Taken | `/taken` |
| Patienten | `/patienten` |
| Agenda | `/agenda` |
| Communicatie | `/communicatie` |
| Consult (legacy) | `/consult/:patientid/:tab?/:subtab?/` |
| SideBarContent | `/s/:content*` (active UI) |

Active consult URL examples:

- `/s/consult/{patientId}/journaal`
- `/s/consult/{patientId}/medicatie`
- `/s/consult/{patientId}/verwijzen`
- `/s/consult/{patientId}/verwijzen/zorgdomein` (submenu `relpath: "zorgdomein"`)

From MAIN world:

```js
const app = document.querySelector('#app').__vue_app__;
// router is in app._context.provides (Symbol key); has .push / .currentRoute
await router.push('/taken');
await router.push(`/s/consult/${patientId}/verwijzen/zorgdomein`);
```

---

## Multi-patient / multi-consult context (critical)

Bricks keeps **multiple dossier contexts** open at once (sidebar).

`P.context` (internal `Jn`) tracks:

- `P.context.current` — active context (`patientId`, `contactId`, `isConsult`, …)
- `P.context.huidigConsult` — `{ patientId, contactId }` synced to the server via:
  - `B.hisRegie.setHuidigePatientId(patientId)`
  - `B.hisRegie.setHuidigContactId(contactId)`
- `P.context.getConsultContextByPatientId(id)`
- `P.context.getAllConsultContexts()`

**Plugin bug class:** `document.querySelector` / `querySelectorAll` without scoping to the *active* consult hits the **first** matching node in the DOM (often the first open patient).  

Known vulnerable flows in Infused:

- ZorgDomein snelkoppelingen: global `.widget-content… "Nieuwe verwijzing maken"` → wrong patient.
- Any future action that uses global selectors for consult widgets, contact picker, declareren modal, etc.

**Rule:** always resolve **active `patientId` (+ `contactId`)** from route and/or `P.context` / bridge-tracked hisRegie hooks; never assume “the only” widget on the page.

Active `patientId` from URL (reliable when on a consult route):

```js
location.pathname.match(/\/s\/consult\/(\d+)/)?.[1]
// or /consult/(\d+)/
```

---

## Zorgdomein Infused (losse extensie, sinds Bricks Infused v2.3)

Alles wat óp zorgdomein.nl draait (Snelkoppeling-knop, Productkeuze-link, dashboard-links,
doorsturen na SSO) en het beheer van de snelkoppelingen zit in `../Zorgdomein infused/`.
Bricks houdt alleen het verwijsmenu + de SSO-start (`bricksBridge.startZorgdomeinVerwijzing`).

Flow bij klik op een snelkoppeling in het Bricks-contextmenu:

1. `content.js` → background `zorgdomein.getLinks` → Zorgdomein Infused (`externally_connectable`).
2. Klik → `zorgdomein.setPendingLink(link)` → daarna bridge start verwijzing (POST `zdlogin`).
3. ZorgDomein landt op `/dashboard` → Zorgdomein Infused navigeert naar de link (≤ 60 s).

ID's: `background.js` → `ZORGDOMEIN_EXT_IDS_DEV/PROD`; Bricks-ID's staan in de whitelist van
Zorgdomein Infused (`manifest.json` → `externally_connectable.ids`, zie `manifest.ids.md` daar).
Oude `zorgdomeinLinks` in Bricks-opslag worden eenmalig overgezet (`zorgdomeinLinksMigrated`).

---

## Taken API

```js
B.taken.newTaak()
B.taken.storeTaak(taak, seperateTaskForEachMedewerker, askForCollectieUpdate)
B.taken.getTaak(taakId)
B.taken.getTakenByMedewerkerIdAndRol(medewerkerId, rol, inclGroep, statusFilter, inclGesloten)
B.taken.deleteTaak(taakId, askForCollectieDelete)
// statusFilter examples: ["Open","Bezig"] or ["Afgehandeld"]
```

UI store (when `P` available): `P.taken`, `P.settings.taken.filter`, `setFilter` on taken page state.

Settings export/import writes compact JSON to `UISettings.Vars.BricksInfused` via `B.hisRegie.getUISettings` / `setUISettings` (same store as AppSettings/Widgets). Taken-omschrijving is only a legacy import fallback — the list preview truncates that field.

---

## Contact / communicatie

Consult contact type (koppelinfo-style) is not the Telefoonboek picker RPC alone:

```js
B.contact.wijzigContactType(contactId, type)
B.contactwijze.getList()
B.contactwijze.getByCode(code)
B.telefoonboek.zoekPersonen(...)  // adresboek search
```

DOM flow in the plugin (search → first item → Selecteer) is fragile; prefer APIs + active `contactId`.

---

## ZorgDomein verwijzing (native flow)

Verwijzen tab footer (`VecozoFooter` with `tabid: "zorgdomein"`):

1. Defaults (`CU()`):  
   `{ contactDagen:120, maxContacten:6, metingDagen:90, episodenIds:[], indicatieIds:[], telnr:"", dcrEpisodesIds:[] }`
2. If no episodes and user has not dismissed warning → modal “Geen episoden” / Doorgaan.
3. Else:

```js
const h = await B.zorgdomeinVerwijzing.verwijzingParams(
  context.patientId,
  context.contactId,   // API field name: deelcontactId
  contactDagen, maxContacten, metingDagen,
  episodesIds, ContraindicatieIds, telefoonNummer, dcrEpisodesIds
);
// h.ReturnValue = array of { Item1: name, Item2: value }
// POST to:
//   P.klantnummer > 9000 → https://tio.zorgdomein.nl/cgi-bin/zdlogin
//   else → https://www.zorgdomein.nl/cgi-bin/zdlogin
// charset ISO-8859-1, target _blank
```

Related:

- `B.zorgdomeinVerwijzing.startVerwijzing(...)` / `startVerwijzing2(patientId, episodeIds)`
- `B.browser.formStartVerwijzing(patientId, verwijsPortaal)`
- `B.browser.zorgdomeinSSO()`

Param tuple builder in API object:

`doApi("ZorgdomeinVerwijzing","VerwijzingParams",{ patientId, deelcontactId, contactDagen, maxContacten, metingDagen, episodesIds, ContraindicatieIds, telefoonNummer, dcrEpisodesIds })`

---

## Capturing `B` from a Chrome extension

MAIN-world script at `document_start` can intercept:

```js
Object.assign(B, f9); // f9 has doApi + connect
```

After that, `B.doApi` / `B.taken` / `B.zorgdomeinVerwijzing` are usable from the bridge.

Track active patient/contact by wrapping:

- `B.hisRegie.setHuidigePatientId`
- `B.hisRegie.setHuidigContactId`

Plus URL parsing for the focused sidebar consult.

Isolated content scripts talk to MAIN via `window.postMessage` (see `bridge_main.js` / `bridge_client.js`).

---

## HisRegie commands

```js
B.hisRegie.doe(actieString)
B.hisRegie.doePatient(patientId, actie)
```

Examples seen: `"toon taakdialoog"`, `"voer commando TAAKINSTELLINGEN uit"`, etc.

---

## Why DOM click automation breaks after updates

- Vue re-renders; scoped `data-v-*` hashes change.
- Labels/structure of dropdowns and widget chrome change.
- Multi-context DOM means “first match” ≠ “active patient”.
- Timing (`setTimeout` 200–300ms) races slower loads.

Prefer: **router + `B.doApi` + explicit patientId/contactId**.

---

## Layout resize (journaal widgets)

Native command (registered in command map `g0`):

- id: `layout.resize.toggle`
- caption: “Widgets aanpassen”
- execute: `qA.trigger(document.querySelector(".layout-renderer.resize-active") ? "widgets.resize.stop" : "widgets.resize.start")`

Keyboard path (sneltoetsenpalette):

1. **CTRL+SPACE** — opent sneltoetsen
2. **H** — hoofdmenu
3. **L** — widget aanpassen

While active, `.layout-renderer` gets class `resize-active`. Sizes persist in `P.settings.layout.sizes` / `P.settings.layout.active`.

Infused (v2.1+): does **not** drag columns itself. Gap hit-zones on grey between-panes call `bricksBridge.toggleLayoutResize()` which prefers the captured command, then event-bus, then the keychord fallback.

Old Infused resizer broke because journaal DOM nested under `.consult-journaal-stack` (no flat 3-column `.col1` layout).

---

## Extension bridge files

| File | World | Role |
|------|--------|------|
| `bridge_main.js` | MAIN, `document_start` | Capture `B`, track context, expose RPC |
| `bridge_client.js` | isolated, before `content.js` | Promise API for content scripts |

Message envelope: `{ source: "bricks-infused", … }` / `{ source: "bricks-infused-main", … }`.

Client helpers:

```js
await bricksBridge.getActiveContext()
await bricksBridge.navigate('/taken')
await bricksBridge.whoAmI()
await bricksBridge.getUISettings()
await bricksBridge.setUISettings(settings)
await bricksBridge.takenNew()
await bricksBridge.takenStore(taak, false, true)
await bricksBridge.takenGet(taakId)
await bricksBridge.takenGetByMedewerkerAndRol({ medewerkerId, rol: 'ToegewezenAan', inclGroep: true, statusFilter: ['Afgehandeld'], inclGesloten: true })
await bricksBridge.toggleLayoutResize()
await bricksBridge.startZorgdomeinVerwijzing({ patientId, episodelijstNodig: false })
await bricksBridge.waitUntilReady()
```

---

## Still DOM-based / multi-context risky (backlog)

- Settings export/import via `UISettings.Vars.BricksInfused` (Taken-omschrijving is legacy fallback).
- `communicatie_changeContact` (global koppelinfo picker).
- `declareren` / einde-consult helpers (global modal selectors).
- `content_uprevent.js` scrapes episoden/medicatie/journaal from the **active** consult shell (`patientId` from URL/`bricksBridge.getActiveContext`). Missing data is preferred over another dossier’s widgets.

### Medicijn-markeringen (autorisatie)

DOM-only feature. Stable hooks (2026-09):

- Rows: `.rapport44-recept` / `.rapport44-recept-regel`
- Name: `[title="Bekijk voorschrijfgeschiedenis"]` (often also `.cursor-pointer`)
- Results root: `.rapport-nothtml-content-scroll` (legacy `.autorisatieview…area-rapportdetails` is gone)

Match drug names with NFD + strip diacritics so `codeïne` matches `CODEINE`.

When adding features: **resolve active patientId first**, then API or scoped DOM — never bare `document.querySelectorAll` for consult widgets.

### Brief PDF export (`ToonBericht`)

Infused adds a caret (`.btn-pdf-export-caret`) next to Bricks’ **Export** in the brief modal footer — not a separate PDF button. Menu: **Export** (native click), **PDF**, **PDF zonder BSN**.

BSN redaction applies only to the export string (header + `.bericht-html` text), never the live DOM:

- Header fields: label `BSN` and value are separate DOM nodes — `redactBsnField` masks the value
- `BSN` + optional `:` + 9 digits (incl. across newlines) → `BSN: *********`
- dotted `0000.00.000` → `****.**.***`
- bare `\b\d{9}\b` → `*********` (precaution; BSN length)

Option: `pdfExport` in global options.

### U-Prevent scrape

`content_uprevent.js` resolves `patientId` (consult URL, then `bricksBridge.getActiveContext`) and scrapes only that consult shell: header, episoden, chronische medicatie, journaal. Shortcut is injected on every `.shortcutsbar`.
