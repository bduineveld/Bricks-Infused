/////////////////////////////// U-PREVENT INTEGRATIE //////////////////////////////////////////////////////////////
// Apart content-script-bestand zodat content.js niet te lang wordt. Wordt
// door manifest.json **na** content.js geladen in dezelfde isolated world,
// waardoor loadGlobalOptions (content.js) al beschikbaar is.
//
// Adds a "U-PRE" shortcut to the patient shortcutsbar. On click, scrapes the
// most recent cardiovascular-risk-relevant dossier entries and lets
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
    if (bar.querySelector('[data-shortcut="U-PRE"]')) return;

    const shortcut = document.createElement('div');
    shortcut.className = 'shortcut';
    shortcut.title = 'U-Prevent integratie';
    shortcut.setAttribute('data-shortcut', 'U-PRE');
    shortcut.innerHTML = '<div class="caption" style="border-color: rgb(120, 100, 200);">U-PRE</div>';
    shortcut.addEventListener('click', uprevent_onClick);
    bar.appendChild(shortcut);
    console.log('U-PRE shortcut toegevoegd aan shortcutsbar');
}

function uprevent_removeShortcut() {
    document.querySelectorAll('.side-controls .shortcutsbar [data-shortcut="U-PRE"]').forEach((n) => n.remove());
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

// HVZ-relevante ICPC codes voor U-Prevent SMART2 / SMART-REACH:
//   K74   angina pectoris
//   K75   acuut myocardinfarct
//   K76   andere/chronische ischemische hartziekte (incl. K76.02 oud MI)
//   K89   TIA
//   K90   CVA (alle subcodes)
//   K92.02 perifeer arterieel vaatlijden  (K92.01 = atherosclerose anders;
//          die telt niet als specifieke PAV — wel als CV-ziekte. K92 zonder
//          subcode wordt in NHG-praktijk meestal voor PAV gebruikt, dus
//          accepteren we hem ook.)
//   K99.01 aneurysma aorta (andere K99.xx tellen niet)
function uprevent_isHvzCode(codeRaw) {
    const c = uprevent_normalizeIcpc(codeRaw);
    if (!c) return false;
    if (/^K99\.01/.test(c)) return true;
    if (/^K74/.test(c)) return true;
    if (/^K75/.test(c)) return true;
    if (/^K76/.test(c)) return true;
    if (/^K89/.test(c)) return true;
    if (/^K90/.test(c)) return true;
    // K92: alleen K92.02 of K92 zonder subcode. K92.01 = "atherosclerose
    // anders" is te generiek voor PAV-specifieke calculators.
    if (/^K92\.02/.test(c)) return true;
    if (c === 'K92') return true;
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
    let heartFailure = false;
    let afib = false;
    const hvzMatches = [];
    const dm2Matches = [];
    codes.forEach((raw) => {
        const c = uprevent_normalizeIcpc(raw);
        if (uprevent_isHvzCode(raw)) {
            hvz = true;
            hvzMatches.push(raw.trim());
        }
        if (uprevent_isDm2EpisodeCode(raw)) {
            dm2 = true;
            dm2Matches.push(raw.trim());
        }
        if (/^K77/.test(c)) heartFailure = true;
        if (/^K78/.test(c)) afib = true;
    });
    return { hvz, dm2, heartFailure, afib, codes, hvzMatches, dm2Matches };
}

// Vertaal de gematchte HVZ ICPC-codes naar woorden die U-Prevent's parser
// herkent. Belangrijk: de generieke string "HVZ: ja" matcht geen enkele
// U-Prevent regex; SMART2/SMART-REACH hebben specifieke ziekte-categorieën
// nodig (coronaryArteryDisease / cerebrovascularDisease / peripheralArteryDisease
// / aorticAneurysm).
function uprevent_hvzPhrasesFromCodes(hvzCodes) {
    const phrases = new Set();
    (hvzCodes || []).forEach((raw) => {
        const c = uprevent_normalizeIcpc(raw);
        if (/^K74/.test(c)) {
            // K74 = angina pectoris (alle subcodes), valt onder CAD.
            phrases.add('angina pectoris');
            phrases.add('coronairlijden');
        } else if (/^K75/.test(c)) {
            phrases.add('hartinfarct');
            phrases.add('coronairlijden');
        } else if (/^K76\.02/.test(c)) {
            // K76.02 = vroeger myocardinfarct (anamnestisch).
            phrases.add('oud myocardinfarct');
            phrases.add('coronairlijden');
        } else if (/^K76/.test(c)) {
            phrases.add('coronairlijden');
        } else if (/^K89/.test(c)) {
            phrases.add('TIA');
        } else if (/^K90/.test(c)) {
            // K90.x dekt alle CVA-subtypes (ischemisch, hemorragisch, onbekend);
            // U-Prevent's cerebrovasculaire categorie behandelt ze gelijk.
            phrases.add('CVA');
        } else if (/^K92\.02/.test(c) || c === 'K92') {
            // K92.02 = PAV/claudicatio. Bare K92 wordt in NHG-praktijk doorgaans
            // voor PAV gebruikt; K92.01 (atherosclerose anders) wordt elders
            // afgevangen want isHvzCode laat die niet door.
            phrases.add('perifeer arterieel vaatlijden');
        } else if (/^K99\.01/.test(c)) {
            phrases.add('aneurysma aorta');
        }
    });
    return Array.from(phrases);
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
        // Houdt synchroon met uprevent_isHvzCode: K92 alleen .02 (of bare K92),
        // niet K92.01. K74/K75/K76/K89/K90 alle subcodes; K99 alleen .01.
        const hvzMentioned = /\b(?:K74|K75|K76|K89|K90|K92\.02|K92(?!\.)|K99\.01)\b/i.test(text);
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

// Splits combinatiepreparaten naar twee aparte regels zodat U-Prevent's
// drug+dose-regexen elk preparaat correct kunnen matchen. NL FTK-conventie:
// "EZETIMIB/SIMVASTATINE 10/80" betekent ezetimibe 10 mg + simvastatine 80 mg.
// Zonder splitsing zou U-Prevent's RX_STATIN_DOSE_AFTER mislukken op "10/80".
// Retourneert een array van >= 2 regels bij succes, of null bij geen combi.
function uprevent_splitCombinationDrugLine(line) {
    const m = (line || '').match(
        /^\s*([A-Za-z][A-Za-z'\-]+)\s*\/\s*([A-Za-z][A-Za-z'\-]+)\s+(\d{1,3}(?:[.,]\d+)?)\s*\/\s*(\d{1,3}(?:[.,]\d+)?)\s*(mcg|mg|µg|microgram)?/i
    );
    if (!m) return null;
    const [_full, drug1, drug2, dose1, dose2, unitRaw] = m;
    const unit = (unitRaw || 'mg').toLowerCase().replace('µg', 'mcg').replace('microgram', 'mcg');
    return [
        `${drug1.trim()} ${dose1.replace(',', '.')} ${unit}`,
        `${drug2.trim()} ${dose2.replace(',', '.')} ${unit}`
    ];
}

// Scrape uitsluitend de "Chronisch"-categorie van Bricks' medicatieprofiel.
// Cardiovasculair-relevante preparaten (statines, antihypertensiva, GLP-1,
// SGLT2, antistolling) zitten doorgaans in die bundel; kuren / zo nodig /
// niet-geclassificeerd geeft te veel ruis voor de U-Prevent risicocalculators.
//
// Per medicatieprofiel-item gebruiken we het `title`-attribuut: dat bevat
// per regel de INN-naam en (waar van toepassing) ook de merknaam. We strippen
// alleen de datum- en doseringsregels eruit, zodat U-Prevent's drug-regexen
// (INN + merknaam) precies op die preparaatnamen kunnen matchen zonder dat
// omringende DOM-tekst (apotheek, herhalingen, statusdots) meelekt.
function uprevent_collectMedicationText() {
    const container = document.querySelector(
        '.medicatieprofiel-widget [data-container="Chronisch"]'
    );
    if (!container) return '';

    const items = container.querySelectorAll('.medicatieprofiel-item');
    if (!items.length) return '';

    const dateRangeRe = /\d{1,2}-\d{1,2}-\d{4}\s+t\/m/i;
    const dosingRe = /^\s*(?:hv\s*:|dos\s*:)/i;

    const drugLines = [];
    items.forEach((item) => {
        const title = item.getAttribute('title') || '';
        const nameLines = title
            .split(/\r?\n/)
            .map((s) => s.trim())
            .filter((s) => s && !dateRangeRe.test(s) && !dosingRe.test(s));
        if (!nameLines.length) {
            // Fallback: zichtbare drug-naam als het title-attribuut leeg is.
            const visible = item.querySelector('.split-text .content-item')?.textContent;
            if (visible) {
                const cleaned = visible.replace(/\s+/g, ' ').trim();
                if (cleaned) drugLines.push(cleaned);
            }
            return;
        }
        // Combinatiepreparaten: splits naar losse INN+dose-regels en negeer
        // de merknaam-regel (die zou bij combi-splits enkel ruis toevoegen).
        const split = uprevent_splitCombinationDrugLine(nameLines[0]);
        if (split) {
            split.forEach((line) => drugLines.push(line));
            return;
        }
        drugLines.push(nameLines.join(' / '));
    });

    if (!drugLines.length) return '';
    return drugLines.join('\n');
}

// Scrape journaal + patiëntheader + zichtbare episoden. Geen geboortedatum in
// de export (privacy); leeftijd blijft wel als getal. Bloeddruk als één regel
// zodat de U-Prevent-parser hem via RR/bloeddruk-patroon herkent. Eenheden
// worden expliciet meegestuurd zodat de parser ze niet hoeft te raden.
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

    // We werken puur op aan/afwezigheid van ICPC-codes. Niets uitschrijven
    // over "afwezige" condities: in het Bricks-dossier staat geen "DM2: nee"
    // of "HVZ: nee", en U-Prevent's parser interpreteert ontbreken correct
    // als "niet gedetecteerd" (de gebruiker vult dat zelf aan indien nodig).

    // DM2 alleen positief uitzenden bij T90-episode.
    if (ep.dm2) {
        push('diabetes mellitus type 2');
    }

    // HVZ — specifieke termen i.p.v. generieke "HVZ: ja", zodat U-Prevent
    // ze kan classificeren als coronary / cerebrovascular / peripheral /
    // aortic.
    if (ep.hvz) {
        const phrases = uprevent_hvzPhrasesFromCodes(ep.hvzMatches);
        if (phrases.length) {
            push(`voorgeschiedenis: ${phrases.join(', ')}`);
        }
    }

    // Comorbiditeiten alleen uitzenden als de bijbehorende episode bestaat.
    if (ep.heartFailure) push('hartfalen');
    if (ep.afib) push('atriumfibrilleren');

    // Alleen bij DM2: stuur leeftijd op moment van diagnose mee.
    if (ep.dm2 && dobStr) {
        const dm2Dates = uprevent_collectDiabetesEpisodeDates();
        const firstDm2Date = uprevent_pickEarliestDate(dm2Dates);
        if (firstDm2Date) {
            const ageAtDm2 = uprevent_ageOnDateFromDob(dobStr, firstDm2Date);
            if (ageAtDm2 != null) {
                push(`leeftijd bij diabetes diagnose: ${ageAtDm2}`);
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
                push(`${yearsSinceFirstEvent} jaar sinds eerste vasculaire event`);
            }
        }
    }

    // Journaal entries are rendered top = newest, so document order = newest-first.
    const regels = document.querySelectorAll('.journaal-contact-regel .split-text');
    const labs = {
        sys: null, dia: null,
        hba1c: null, hba1cUnit: null,
        egfr: null,
        cholTotal: null, hdl: null, ldl: null, nonHdl: null, triglycerides: null,
        smoking: null,
        creatinine: null, creatinineUnit: null,
        lengte: null, gewicht: null, bmi: null,
        acr: null, acrUnit: null, microalbumine: null
    };
    const tryMatch = (key, text, re, transform) => {
        if (labs[key] != null) return;
        const m = text.match(re);
        if (!m) return;
        labs[key] = transform ? transform(m) : m[1].replace(',', '.');
    };
    regels.forEach((regel) => {
        const text = (regel.textContent || '').trim();
        if (!text) return;
        tryMatch('sys', text, /systolische\s+bloeddruk\s*:\s*(\d{2,3})\b/i);
        tryMatch('dia', text, /diastolische\s+bloeddruk\s*:\s*(\d{2,3})\b/i);
        // HbA1c IFCC = mmol/mol; HbA1c DCCT = %. Bricks-labels bevatten meestal
        // expliciet 'IFCC' of '%'; capture beide vormen + de unit.
        if (labs.hba1c == null) {
            let m = text.match(/hba1c\s*ifcc\s*:\s*([0-9]+(?:[.,][0-9]+)?)/i);
            if (m) { labs.hba1c = m[1].replace(',', '.'); labs.hba1cUnit = 'mmol/mol'; }
            else {
                m = text.match(/hba1c\s*(?:dcct)?\s*:\s*([0-9]+(?:[.,][0-9]+)?)\s*(%)?/i);
                if (m) {
                    labs.hba1c = m[1].replace(',', '.');
                    labs.hba1cUnit = m[2] ? '%' : (parseFloat(labs.hba1c) > 20 ? 'mmol/mol' : '%');
                }
            }
        }
        tryMatch('egfr', text, /egfr[^:]*:\s*([0-9]+(?:[.,][0-9]+)?)/i);
        tryMatch('cholTotal', text, /cholesterol\s+totaal\s*:\s*([0-9]+(?:[.,][0-9]+)?)/i);
        tryMatch('hdl', text, /\bhdl-?\s*cholesterol\s*:\s*([0-9]+(?:[.,][0-9]+)?)/i);
        tryMatch('ldl', text, /\bldl-?\s*cholesterol\s*:\s*([0-9]+(?:[.,][0-9]+)?)/i);
        tryMatch('nonHdl', text, /\bnon-?\s*hdl\s*cholesterol\s*:\s*([0-9]+(?:[.,][0-9]+)?)/i);
        tryMatch('triglycerides', text, /\btriglyceriden\s*:\s*([0-9]+(?:[.,][0-9]+)?)/i);
        // Creatinine: meestal µmol/L in NL; soms wordt 'kreatinine' geschreven.
        if (labs.creatinine == null) {
            const m = text.match(/\b(?:creatinine|kreatinine)\s*:\s*([0-9]+(?:[.,][0-9]+)?)\s*(µmol\/?l|umol\/?l|mg\/?dl)?/i);
            if (m) {
                labs.creatinine = m[1].replace(',', '.');
                labs.creatinineUnit = m[2] ? m[2].toLowerCase().replace('µ', 'u') : 'umol/L';
            }
        }
        tryMatch('lengte', text, /\blengte\s*:\s*([0-9]+(?:[.,][0-9]+)?)/i);
        tryMatch('gewicht', text, /\bgewicht\s*:\s*([0-9]+(?:[.,][0-9]+)?)/i);
        tryMatch('bmi', text, /\bbmi\s*:\s*([0-9]+(?:[.,][0-9]+)?)/i);
        if (labs.acr == null) {
            const m = text.match(/\b(?:acr|albumine[-\s]?creatinine(?:[-\s]?ratio)?)\s*:\s*([0-9]+(?:[.,][0-9]+)?)\s*(mg\/?mmol|mg\/?g)?/i);
            if (m) {
                labs.acr = m[1].replace(',', '.');
                if (m[2]) {
                    // Unit zat direct na de waarde.
                    labs.acrUnit = m[2].toLowerCase().replace(/\s/g, '');
                } else {
                    // Bricks toont unit soms in een apart veld op dezelfde regel.
                    // Scan de hele regel; anders laat de unit leeg en laat
                    // U-Prevent's eigen heuristiek de unit bepalen.
                    const inline = text.match(/(mg\/?mmol|mg\/?g)/i);
                    labs.acrUnit = inline ? inline[1].toLowerCase().replace(/\s/g, '') : null;
                }
            }
        }
        tryMatch('microalbumine', text, /\bmicroalbumin[ue]r?i?e?\s*:\s*([0-9]+(?:[.,][0-9]+)?)/i);
        if (labs.smoking == null) {
            const m = text.match(/\broken\s*:\s*(ja|nee|voorheen)\b/i);
            if (m) labs.smoking = m[1].toLowerCase();
        }
    });

    if (labs.sys != null && labs.dia != null) {
        push(`Bloeddruk: ${labs.sys}/${labs.dia} mmHg`);
    }
    if (labs.smoking != null) {
        // 'voorheen' = ex-roker: niet meer rokend; mapt op RX_SMOKER_NEG.
        if (labs.smoking === 'voorheen') push('ex-roker');
        else push(`roken: ${labs.smoking}`);
    }
    if (labs.hba1c != null) {
        push(`HbA1c: ${labs.hba1c} ${labs.hba1cUnit || 'mmol/mol'}`);
    }
    if (labs.egfr != null) {
        push(`eGFR: ${labs.egfr} ml/min/1.73m²`);
    }
    if (labs.creatinine != null) {
        push(`creatinine: ${labs.creatinine} ${labs.creatinineUnit || 'umol/L'}`);
    }
    if (labs.cholTotal != null) {
        push(`cholesterol totaal: ${labs.cholTotal} mmol/L`);
    }
    if (labs.hdl != null) {
        push(`HDL-cholesterol: ${labs.hdl} mmol/L`);
    }
    if (labs.ldl != null) {
        push(`LDL-cholesterol: ${labs.ldl} mmol/L`);
    }
    if (labs.nonHdl != null) {
        push(`non-HDL cholesterol: ${labs.nonHdl} mmol/L`);
    }
    if (labs.triglycerides != null) {
        push(`triglyceriden: ${labs.triglycerides} mmol/L`);
    }
    if (labs.lengte != null) {
        push(`lengte: ${labs.lengte} cm`);
    }
    if (labs.gewicht != null) {
        push(`gewicht: ${labs.gewicht} kg`);
    }
    if (labs.bmi != null) {
        push(`BMI: ${labs.bmi}`);
    }
    if (labs.acr != null) {
        // Stuur expliciet mg/mmol of mg/g mee zodat U-Prevent niet hoeft te
        // raden. Bij volledig onbekende unit laten we hem weg; U-Prevent's
        // findAlbuminuria past dan zijn magnitude-heuristiek toe.
        if (labs.acrUnit === 'mg/mmol' || labs.acrUnit === 'mgmmol') {
            push(`ACR: ${labs.acr} mg/mmol`);
        } else if (labs.acrUnit === 'mg/g' || labs.acrUnit === 'mgg') {
            push(`ACR: ${labs.acr} mg/g`);
        } else {
            push(`ACR: ${labs.acr}`);
        }
    } else if (labs.microalbumine != null) {
        // Microalbumine in mg/L of mg/24u — geen ACR; markeer als verhoogd
        // wanneer > 20 mg/L (vuistregel) zodat U-Prevent het oppikt.
        const val = parseFloat(labs.microalbumine);
        if (Number.isFinite(val)) {
            if (val >= 20) push('microalbuminurie');
            else push('geen albuminurie');
        }
    }

    // Chronische medicatie als kleine, schone lijst (één preparaat per regel).
    // U-Prevent's drug-regexen herkennen zelf INN's én merknamen.
    const med = uprevent_collectMedicationText();
    if (med) {
        push('--- Chronische medicatie ---');
        push(med);
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

// Korte, niet-blokkerende toast rechtsboven; auto-verdwijnt na 4s. Wordt
// gebruikt voor messaging-fouten en andere asynchrone status die de gebruiker
// niet aan de hand van de modal kan zien (modal sluit bij tab-open).
function uprevent_showToast(message, kind = 'warn') {
    try {
        const palette = kind === 'error'
            ? { bg: '#fff5f5', border: '#fc8181', color: '#742a2a' }
            : kind === 'success'
                ? { bg: '#f0fff4', border: '#48bb78', color: '#22543d' }
                : { bg: '#fffaf0', border: '#ed8936', color: '#7b341e' };
        const toast = document.createElement('div');
        toast.setAttribute('role', 'status');
        toast.style.cssText = [
            'position:fixed', 'top:20px', 'right:20px', 'z-index:2147483647',
            `background:${palette.bg}`, `color:${palette.color}`,
            `border-left:4px solid ${palette.border}`,
            'padding:12px 16px', 'border-radius:8px',
            'box-shadow:0 6px 18px rgba(0,0,0,0.18)',
            'font:13px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif',
            'max-width:360px'
        ].join(';') + ';';
        toast.textContent = message;
        document.body.appendChild(toast);
        setTimeout(() => { toast.style.transition = 'opacity 0.3s'; toast.style.opacity = '0'; }, 3700);
        setTimeout(() => { toast.remove(); }, 4100);
    } catch (e) {
        // Best-effort UI — slik fouten in zodat de hoofd-flow nooit breekt.
    }
}

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
        <div style="font-size:1.15em;font-weight:600;flex:1;">U-Prevent</div>
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
        noData.textContent = 'Geen relevante gegevens gevonden in het zichtbare dossier. Je kunt nog steeds een calculator openen en zelf invullen.';
        body.appendChild(noData);
    }

    if (age != null) {
        const ageNote = document.createElement('div');
        ageNote.style.cssText = 'font-size:12px;color:#718096;margin-bottom:10px;';
        ageNote.textContent = `Leeftijd gedetecteerd: ${age} jaar — passende calculators zijn gemarkeerd.`;
        body.appendChild(ageNote);
    }

    // Legenda boven de calculator-grid: maakt direct duidelijk wat de visuele
    // status van elke knop betekent (past / past niet / onbepaald).
    const legend = document.createElement('div');
    legend.style.cssText = 'display:flex;flex-wrap:wrap;gap:14px;font-size:11px;color:#718096;margin:4px 0 10px 0;';
    legend.innerHTML = `
        <span style="display:inline-flex;align-items:center;gap:6px;">
            <span style="display:inline-block;width:14px;height:14px;border:2px solid #667eea;border-radius:3px;background:#fff;"></span>
            past (leeftijd + categorie)
        </span>
        <span style="display:inline-flex;align-items:center;gap:6px;">
            <span style="display:inline-block;width:14px;height:14px;border:1px solid #e2e8f0;border-radius:3px;background:#fff;opacity:0.55;"></span>
            past niet
        </span>
        <span style="display:inline-flex;align-items:center;gap:6px;">
            <span style="display:inline-block;width:14px;height:14px;border:1px solid #cbd5e0;border-radius:3px;background:#fff;"></span>
            onbepaald (geen leeftijd)
        </span>`;
    body.appendChild(legend);

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
            let categoryReason = '';
            if (calc.group === 'Eerdere HVZ') {
                matchesCategory = !!episodeFlags?.hvz;
                if (!matchesCategory) categoryReason = 'geen HVZ-episode in dossier';
            } else if (calc.group === 'Diabetes type 2') {
                matchesCategory = !!episodeFlags?.dm2;
                if (!matchesCategory) categoryReason = 'geen DM2-episode in dossier';
            } else if (calc.group === 'Geen HVZ / geen DM2') {
                matchesCategory = !episodeFlags?.hvz && !episodeFlags?.dm2;
                if (!matchesCategory) {
                    if (episodeFlags?.hvz && episodeFlags?.dm2) categoryReason = 'HVZ én DM2 gevonden';
                    else if (episodeFlags?.hvz) categoryReason = 'HVZ-episode in dossier';
                    else categoryReason = 'DM2-episode in dossier';
                }
            }
            const fits = fitsAge === null ? null : (fitsAge && matchesCategory);
            const btn = document.createElement('button');
            btn.type = 'button';
            // Title (tooltip) maakt expliciet waarom een knop al dan niet past.
            if (fits === true) {
                btn.title = `Past: ${age} jaar binnen ${calc.ageMin}-${calc.ageMax}, categorie matcht episodes.`;
            } else if (fits === false) {
                const reasons = [];
                if (fitsAge === false) reasons.push(`leeftijd ${age} valt buiten ${calc.ageMin}-${calc.ageMax}`);
                if (categoryReason) reasons.push(categoryReason);
                btn.title = `Past niet: ${reasons.join('; ')}.`;
            } else {
                btn.title = 'Onbepaald: geen leeftijd in dossier gevonden.';
            }
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
            console.warn('U-Prevent kopieer-fout', err);
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
            uprevent_showToast(
                'Kon U-Prevent Infused niet bereiken — klembord-kopie blijft beschikbaar.',
                'error'
            );
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
            const installLink = resp.installUrl || 'https://microsoftedge.microsoft.com/addons/detail/uprevent-infused/pmlakmbpemkfccbhkdmcofagpipfchio';
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
                uprevent_showToast(
                    'U-Prevent niet bereikbaar — calculator geopend zonder vooringevulde data.',
                    'warn'
                );
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
        console.log('U-Prevent integratie disabled, observer niet gestart');
        return;
    }
    const uprevent_observer = new MutationObserver(() => {
        uprevent_addShortcut();
    });
    uprevent_observer.observe(document.body, { childList: true, subtree: true });
    uprevent_addShortcut();
});
