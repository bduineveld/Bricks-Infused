/////////////////////////////// POSTVERWERKING (ADRESBOEK) ///////////////////////////////////////////////////////////
// Geladen vóór content_postverwerking.js. Herkent de afzender van een brief en zoekt die in het
// adresboek van Bricks (TelefoonBoekContact.Zoek — dezelfde call als het venster "Selecteer contact").
// Invullen gaat via dat eigen venster: zoeken, het juiste item kiezen, Selecteer. Er wordt niets
// opgeslagen; de huisarts controleert en klikt zelf op Opslaan.
//
// Stap 1 (nu): één duidelijke match → automatisch invullen als het veld leeg is.
// Stap 2 (later): meerdere kandidaten (bv. twee S. Smit) kiezen op ziekenhuis/afdeling. Tot die tijd
// toont de kaart de kandidaten als knoppen.

// "dr. R. Smit, psychiater" / "R.J. van der Berg" / "Dr. A. Jansen, internist-nefroloog"
const PV_AFZENDER_RE = /(?:\b(?:dr|drs|prof|mr|mw|dhr)\.?\s+)?((?:[A-Z]\.\s?){1,4})\s*((?:(?:van|de|der|den|ter|ten|te|op|in|'t)\s+)*[A-ZÀ-Ý][a-zà-ÿ'’]+(?:-[A-ZÀ-Ý][a-zà-ÿ'’]+)?)(?:\s*,\s*([a-zà-ÿ][a-zà-ÿ\- ]{2,40}))?/;
// Zonder initialen, wel met titel: "Dr. De Vries" (tussenvoegsel mag met hoofdletter).
const PV_AFZENDER_TITEL_RE = /\b(?:dr|drs|prof|mr)\.?\s+((?:(?:van|de|der|den|ter|ten|te|op|in|'t)\s+)*[A-ZÀ-Ý][a-zà-ÿ'’]+(?:-[A-ZÀ-Ý][a-zà-ÿ'’]+)?)(?:\s*,\s*([a-zà-ÿ][a-zà-ÿ\- ]{2,40}))?/i;

// Losse regel met alleen een functie ("Orthopedisch chirurg") onder de naam.
function pv_isFunctie(regel) {
    const r = String(regel || '').trim();
    if (!r || r.length > 45 || /\d/.test(r)) return false;
    return !!pv_specialismeVan(r) || /(arts|loog|chirurg|geneeskunde|specialist|verpleegkundige|therapeut|psychiater|internist)\b/i.test(r);
}

function pv_afzenderUitTekst(regels) {
    const groet = regels.findIndex((r) => PV_GROET.test(r));
    if (groet < 0) return null;
    // Rest van de groetregel ("Met collegiale groeten, dr. R. Smit, psychiater") en de niet-lege regels erna.
    const rest = regels[groet].replace(PV_GROET, '').replace(/^[^,]*?groet(en)?\s*,?\s*/i, '').replace(/^\s*,\s*/, '');
    const kandidaten = [rest].concat(regels.slice(groet + 1, groet + 8)).filter((r) => r && r.trim());
    for (let i = 0; i < kandidaten.length; i++) {
        const r = kandidaten[i];
        const volgende = kandidaten[i + 1];
        let m = r.match(PV_AFZENDER_RE);
        if (m) {
            const functie = (m[3] || '').trim() || (pv_isFunctie(volgende) ? volgende.trim() : '');
            return { tekst: m[0].trim(), naamDeel: m[0].replace(/\s*,.*$/, '').trim(), initialen: m[1].replace(/\s/g, ''), achternaam: m[2].trim(), functie };
        }
        m = r.match(PV_AFZENDER_TITEL_RE);
        if (m) {
            const functie = (m[2] || '').trim() || (pv_isFunctie(volgende) ? volgende.trim() : '');
            const naamDeel = m[0].replace(/\s*,.*$/, '').trim();
            return { tekst: naamDeel + (functie ? ', ' + functie.toLowerCase() : ''), naamDeel, initialen: '', achternaam: m[1].trim(), functie };
        }
    }
    return null;
}

function pv_afzenderUitInfo(info) {
    const a = info && info.Afzender;
    if (!a || !a.NaamPersoon) return null;
    const m = String(a.NaamPersoon).match(PV_AFZENDER_RE);
    if (!m) return null;
    return { tekst: a.NaamPersoon, naamDeel: a.NaamPersoon, initialen: m[1].replace(/\s/g, ''), achternaam: m[2].trim(), functie: a.Specialisme || '' };
}

// Instelling uit de gestructureerde afzender van het bericht (bij "Fout"-berichten leeg).
function pv_instellingUitInfo(info) {
    const a = info && info.Afzender;
    if (!a || !a.NaamInstelling) return null;
    return {
        naam: a.NaamInstelling,
        afdeling: a.NaamAfdeling || '',
        straat: [a.Straat, a.Huisnummer, a.HuisnummerToevoeging].filter(Boolean).join(' '),
        plaats: [a.Postcode, a.Woonplaats].filter(Boolean).join(' '),
        telefoon: a.Telefoon || ''
    };
}

// Specialismen: functie in de brief ("neuroloog") ↔ naam in het adresboek ("polikliniek neurologie")
// ↔ DerdeCode ("NEU"). Langste/specifiekste eerst (neurochirurg vóór chirurg). Codes NEU/KIN/PSY zijn
// gezien in de demo; de rest volgt hetzelfde patroon en kan worden bijgesteld.
const PV_SPECIALISMEN_ADRES = [
    { termen: ['neurochirurg', 'neurochirurgie'], code: 'NCH' },
    { termen: ['plastisch chirurg', 'plastische chirurgie'], code: 'PLA' },
    { termen: ['kinderarts', 'kindergeneeskunde', 'pediatrie', 'kinderafdeling'], code: 'KIN' },
    { termen: ['neuroloog', 'neurologie'], code: 'NEU' },
    { termen: ['psychiater', 'psychiatrie'], code: 'PSY' },
    { termen: ['internist', 'interne geneeskunde', 'interne'], code: 'INT' },
    { termen: ['cardioloog', 'cardiologie'], code: 'CAR' },
    { termen: ['longarts', 'longziekten', 'longgeneeskunde'], code: 'LON' },
    { termen: ['orthopedisch chirurg', 'orthopeed', 'orthopedie', 'orthopaedie'], code: 'ORT' },
    { termen: ['uroloog', 'urologie'], code: 'URO' },
    { termen: ['gynaecoloog', 'gynaecologie', 'verloskunde'], code: 'GYN' },
    { termen: ['dermatoloog', 'dermatologie'], code: 'DER' },
    { termen: ['kno-arts', 'keel-, neus- en oorheelkunde', 'kno'], code: 'KNO' },
    { termen: ['oogarts', 'oogheelkunde'], code: 'OOG' },
    { termen: ['mdl-arts', 'maag-, darm- en leverziekten', 'mdl'], code: 'MDL' },
    { termen: ['reumatoloog', 'reumatologie'], code: 'REU' },
    { termen: ['geriater', 'geriatrie'], code: 'GER' },
    { termen: ['revalidatiearts', 'revalidatiegeneeskunde', 'revalidatie'], code: 'REV' },
    { termen: ['radioloog', 'radiologie'], code: 'RAD' },
    { termen: ['patholoog', 'pathologie'], code: 'PAT' },
    { termen: ['klinisch chemisch laboratorium', 'klinische chemie', 'klinisch chemicus', 'laboratorium', 'lab'], code: 'LAB' },
    { termen: ['medische microbiologie', 'microbiologie', 'arts-microbioloog', 'microbioloog'], code: 'MMB' },
    { termen: ['anesthesioloog', 'anesthesiologie'], code: 'ANE' },
    { termen: ['chirurg', 'chirurgie'], code: 'CHI' }
];

function pv_specialismeVan(tekst, code) {
    const t = pv_norm(tekst);
    const c = String(code || '').toUpperCase();
    return PV_SPECIALISMEN_ADRES.find((s) => (c && s.code === c)
        || s.termen.some((term) => new RegExp('(^|[^a-z])' + pv_norm(term).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([^a-z]|$)').test(t))) || null;
}

// Afzender = instelling + afdeling ("Rode Kruis Ziekenhuis Beverwijk, Radiologie"). Voor berichten
// zonder ondertekening door een persoon (radiologie, kweek, PA) of als er geen persoon te vinden is.
function pv_afzenderInstelling(inst) {
    if (!inst || !inst.naam) return null;
    // Afdeling gelijk aan de instelling ("DagoLab - DagoLab") niet dubbel noemen.
    if (inst.afdeling && pv_norm(inst.afdeling) === pv_norm(inst.naam)) inst = Object.assign({}, inst, { afdeling: '' });
    const tekst = inst.naam + (inst.afdeling ? ', ' + inst.afdeling : '');
    return { soort: 'instelling', tekst, naamDeel: tekst, initialen: '', achternaam: '', functie: inst.afdeling || '', instelling: inst };
}

// Woorden die een instellingsnaam onderscheiden ("Rode Kruis Ziekenhuis Beverwijk" → rode, kruis, beverwijk).
const PV_INSTELLING_ALGEMEEN = new Set(['ziekenhuis', 'medisch', 'centrum', 'mc', 'umc', 'stichting', 'zorg', 'groep',
    'kliniek', 'polikliniek', 'afdeling', 'het', 'de', 'van', 'en', 'st', 'sint', 'locatie']);
function pv_instellingWoorden(naam) {
    return pv_norm(naam).replace(/[^a-z0-9 ]/g, ' ').split(' ').filter((w) => w.length > 2 && !PV_INSTELLING_ALGEMEEN.has(w));
}

// Afkortingen zoals adresboeken ze gebruiken: "Rode Kruis Ziekenhuis Beverwijk" → rkz, rkzb.
// (Beginletters van alle woorden, en zonder het laatste woord — vaak de plaatsnaam.)
function pv_instellingAfkortingen(naam) {
    const w = pv_norm(naam).replace(/[^a-z0-9 ]/g, ' ').split(' ').filter((x) => x && !['de', 'het', 'van', 'en', 'te'].includes(x));
    const alle = w.map((x) => x[0]).join('');
    const zonderLaatste = w.slice(0, -1).map((x) => x[0]).join('');
    return Array.from(new Set([zonderLaatste, alle])).filter((a) => a.length >= 3);
}

async function pv_adresboekZoek(query) {
    try {
        return pv_rv(await bricksBridge.doApi('TelefoonBoekContact', 'Zoek', { query }, true)) || [];
    } catch (e) {
        return [];
    }
}

// Instelling: zoek op de volle naam, dan op de onderscheidende woorden; contacten bij die instelling
// met de juiste afdeling scoren het hoogst, een algemeen contact van de instelling daarna.
async function pv_adresboekKandidatenInstelling(afzender) {
    const inst = afzender.instelling;
    const woorden = pv_instellingWoorden(inst.naam);
    // Volle naam, opvallende woorden, afkortingen ("RKZ") en de afdeling ("Radiologie" → "!Radiologie RKZ").
    const queries = [inst.naam].concat(woorden.length > 1 ? [woorden.slice(0, 2).join(' ')] : [], woorden,
        pv_instellingAfkortingen(inst.naam), inst.afdeling ? [inst.afdeling] : []);
    const gezien = new Map(); // Id → { contact, query }
    for (const q of Array.from(new Set(queries))) {
        if (q.length < 3) continue;
        (await pv_adresboekZoek(q)).forEach((c) => { if (c && !gezien.has(c.Id)) gezien.set(c.Id, { c, query: q }); });
    }
    return { query: inst.naam, kandidaten: pv_scoorInstelling(afzender, Array.from(gezien.values())) };
}

// Score per adresboekcontact voor een instelling-afzender; entries = [{ c: contact, query }].
function pv_scoorInstelling(afzender, entries) {
    const inst = afzender.instelling;
    const woorden = pv_instellingWoorden(inst.naam);
    const afkortingen = pv_instellingAfkortingen(inst.naam);
    const specAfd = pv_specialismeVan(inst.afdeling || '');
    const afd = pv_norm(inst.afdeling || '');
    return entries.map(({ c, query }) => {
        const naam = pv_norm([c.Naam, c.JournaalNaam, c.Organisatie].filter(Boolean).join(' '));
        const tokens = naam.replace(/[^a-z0-9 ]/g, ' ').split(' ');
        // Afkorting als los woord ("!radiologie rkz") telt als de volledige instellingsnaam.
        const afkorting = afkortingen.some((a) => tokens.includes(a));
        const treffers = afkorting ? woorden.length : woorden.filter((w) => naam.includes(w)).length;
        // Zonder enig woord of afkorting van de instelling is het een ander ziekenhuis (bv. Dijklander, Radiologie).
        if (woorden.length && !treffers) return null;
        let score = woorden.length ? Math.round((treffers / woorden.length) * 6) : 0;
        if (pv_norm(inst.naam) && naam.includes(pv_norm(inst.naam))) score += 2;
        // De juiste afdeling weegt het zwaarst: "RKZ Beverwijk, Radiologie" gaat vóór het algemene contact.
        const specContact = pv_specialismeVan(naam, c.DerdeCode);
        const afdeling = (specAfd && specContact === specAfd) || (!specContact && !!afd && naam.includes(afd));
        if (specAfd && specContact) score += specAfd === specContact ? 8 : -4;
        else if (afd && naam.includes(afd)) score += 8;
        // Persoon (initialen) bij die instelling is niet "de afdeling".
        if (/\b[a-z]\.\s*[a-z]/.test(naam) && !(specAfd && specContact === specAfd)) score -= 2;
        // "!" vooraan = het voorkeurscontact van de praktijk ("!Laboratorium RKZ" vóór "Laboratorium RKZ").
        if (/^\s*!/.test(c.Naam || c.JournaalNaam || '')) score += 1;
        return { id: c.Id, naam: c.Naam || c.JournaalNaam || '', index: 0, score, query, initiaalAnders: false, afdeling };
    }).filter((k) => k && k.score >= 4).sort((a, b) => b.score - a.score);
}

// Zoekt op achternaam en scoort elke kandidaat. Let op: Bricks' venster toont dezelfde contacten in
// een andere volgorde (alfabetisch), dus kiezen gaat op naam, niet op positie.
async function pv_adresboekKandidaten(afzender) {
    if (afzender && afzender.soort === 'instelling') return pv_adresboekKandidatenInstelling(afzender);
    if (!afzender || afzender.achternaam.length < 3) return { query: '', kandidaten: [] };
    const query = afzender.achternaam;
    let res = [];
    try {
        res = pv_rv(await bricksBridge.doApi('TelefoonBoekContact', 'Zoek', { query }, true)) || [];
    } catch (e) {
        return { query, kandidaten: [] };
    }
    return { query, kandidaten: pv_scoorKandidaten(afzender, res) };
}

// Score per adresboekcontact (los van de API, zodat het te testen is).
function pv_scoorKandidaten(afzender, res) {
    const achter = pv_norm(afzender.achternaam);
    const eersteInitiaal = pv_norm(afzender.initialen).charAt(0);
    const functie = pv_norm(afzender.functie);
    return res.map((c, index) => {
        const naam = pv_norm([c.Naam, c.JournaalNaam, c.Organisatie].filter(Boolean).join(' '));
        let score = 0;
        if (new RegExp('\\b' + achter.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b').test(naam)) score += 5;
        // Initiaal vóór de achternaam, ook met tussenvoegsels ("R.J. van der Berg"). Een ANDERE initiaal
        // (P. Mulder tegenover K. Mulder) telt negatief en blokkeert automatisch invullen.
        const m = naam.match(new RegExp('\\b([a-z])\\.\\s*(?:[a-z]\\.\\s*)*(?:[a-z\'’]+\\s+)*' + achter.split(' ').pop()));
        const initiaal = !m ? null : m[1] === eersteInitiaal;
        if (eersteInitiaal && initiaal === true) score += 3;
        if (eersteInitiaal && initiaal === false) score -= 3;
        // Specialisme: zelfde = erbij, duidelijk ander specialisme = eraf (twee K. Mulder: neuroloog/kinderarts).
        const specBrief = functie ? pv_specialismeVan(functie) : null;
        const specContact = pv_specialismeVan(naam, c.DerdeCode);
        if (specBrief && specContact) score += specBrief === specContact ? 4 : -4;
        else if (functie && naam.includes(functie)) score += 2;
        // Zelfde instelling als in het bericht (bv. "Dagoziekenhuis").
        const inst = afzender.instelling && pv_norm(afzender.instelling.naam);
        if (inst && naam.includes(inst)) score += 2;
        if (/^\s*!/.test(c.Naam || c.JournaalNaam || '')) score += 1; // "!" = voorkeurscontact
        return { id: c.Id, naam: c.Naam || c.JournaalNaam || '', index, score, initiaalAnders: !!eersteInitiaal && initiaal === false };
    }).filter((k) => k.score >= 5).sort((a, b) => b.score - a.score);
}

// Eén duidelijke winnaar: hoogste score, en geen tweede met dezelfde score.
function pv_adresboekBeste(kandidaten) {
    if (!kandidaten.length || kandidaten[0].initiaalAnders) return null;
    if (kandidaten.length > 1 && kandidaten[1].score === kandidaten[0].score) return null;
    return kandidaten[0];
}

function pv_adresboekHuidig(pane) {
    const v = pane.querySelector('.koppelinfo-contact .picker-current-value');
    return v ? v.textContent.trim() : '';
}

async function pv_wacht(fn, ms) {
    const tot = Date.now() + (ms || 3000);
    while (Date.now() < tot) {
        const r = fn();
        if (r) return r;
        await new Promise((res) => setTimeout(res, 100));
    }
    return null;
}

// Bedient Bricks' venster "Selecteer contact": zoekterm typen, item op naam kiezen, Selecteer.
// Er is geen API die alleen de geadresseerde in het formulier zet (Bericht.BerichtOpslaan slaat alles
// op), dus via het venster. Met `onzichtbaar` staat het venster op doorzichtig zolang Infused het bedient.
async function pv_kiesAdresboek(query, kandidaat, onzichtbaar) {
    const pane = pv_paneel();
    const icoon = pane && pane.querySelector('.koppelinfo-contact .picker-icon .fa-search');
    if (!icoon) return false;
    let verberg = null;
    if (onzichtbaar) {
        verberg = document.createElement('style');
        verberg.textContent = '.modal-container { opacity: 0 !important; }';
        document.head.appendChild(verberg);
    }
    let dlg = null;
    const annuleer = () => {
        const b = dlg && Array.from(dlg.querySelectorAll('button')).find((x) => x.textContent.trim() === 'Annuleren');
        if (b) b.click();
    };
    try {
        icoon.click();
        dlg = await pv_wacht(() => Array.from(document.querySelectorAll('.modal-dialog'))
            .find((d) => /selecteer contact/i.test(d.textContent)));
        if (!dlg) return false;
        const input = dlg.querySelector('input');
        if (!input) { annuleer(); return false; }
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        setter.call(input, kandidaat.query || query); // instelling: de zoekterm die dit contact vond
        input.dispatchEvent(new Event('input', { bubbles: true }));
        // Kiezen op naam: het venster sorteert anders dan de API (alfabetisch). Twee items met precies
        // dezelfde naam → niet raden, stoppen.
        const doel = pv_norm(kandidaat.naam);
        const treffers = await pv_wacht(() => {
            const t = Array.from(dlg.querySelectorAll('.item')).filter((el) => pv_norm(el.textContent) === doel);
            return t.length ? t : null;
        });
        const item = treffers && treffers.length === 1 ? treffers[0] : null;
        if (!item) { annuleer(); return false; }
        (item.firstElementChild || item).click();
        const selecteer = await pv_wacht(() => Array.from(dlg.querySelectorAll('button'))
            .find((b) => b.textContent.trim() === 'Selecteer' && !b.disabled));
        if (!selecteer) { annuleer(); return false; }
        selecteer.click();
        return !!(await pv_wacht(() => {
            const p = pv_paneel();
            return p && pv_adresboekHuidig(p);
        }));
    } finally {
        if (verberg) setTimeout(() => verberg.remove(), 150);
    }
}

// Opent Bricks' venster → "Nieuw" en vult het formulier alvast in met de afzender uit de brief.
// Het venster blijft zichtbaar: de huisarts controleert, vult eventueel Organisatie in en slaat zelf op.
async function pv_nieuwContact(afzender) {
    const pane = pv_paneel();
    const icoon = pane && pane.querySelector('.koppelinfo-contact .picker-icon .fa-search');
    if (!icoon) return false;
    icoon.click();
    const lijst = await pv_wacht(() => Array.from(document.querySelectorAll('.modal-dialog'))
        .find((d) => /selecteer contact/i.test(d.textContent)));
    const nieuw = lijst && Array.from(lijst.querySelectorAll('button')).find((b) => b.textContent.trim() === 'Nieuw');
    if (!nieuw) return false;
    nieuw.click();
    const dlg = await pv_wacht(() => Array.from(document.querySelectorAll('.modal-dialog'))
        .find((d) => /journaalkoptekst/i.test(d.textContent)));
    if (!dlg) return false;
    const velden = Array.from(dlg.querySelectorAll('input.form-input, textarea'));
    const zet = (label, waarde) => {
        if (!waarde) return;
        const l = Array.from(dlg.querySelectorAll('*')).find((e) => e.childElementCount === 0 && e.textContent.trim() === label);
        const veld = l && velden.find((v) => l.compareDocumentPosition(v) & Node.DOCUMENT_POSITION_FOLLOWING);
        if (!veld || veld.value) return;
        const proto = veld.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, 'value').set.call(veld, waarde);
        veld.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const spec = afzender.functie ? pv_specialismeVan(afzender.functie) : null;
    const functie = afzender.functie ? afzender.functie.toLowerCase() : '';
    const inst = afzender.instelling;
    const isInstelling = afzender.soort === 'instelling';
    zet('Journaalkoptekst', afzender.naamDeel + (spec && !isInstelling ? ', ' + spec.code : ''));
    zet('Code derde', spec ? spec.code : '');
    zet('Naam', isInstelling ? afzender.tekst : afzender.naamDeel + (functie ? ', ' + functie : ''));
    if (inst) {
        zet('Adres 1', inst.naam + (inst.afdeling ? ', ' + inst.afdeling : ''));
        zet('Adres 2', inst.straat);
        zet('Adres 3', inst.plaats);
        zet('Telefoon', inst.telefoon);
    }
    return true;
}
