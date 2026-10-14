/////////////////////////////// POSTVERWERKING (LAB + BRIEF) ////////////////////////////////////////////////////////////////
// Apart content-script-bestand, geladen na content.js in dezelfde isolated world
// (loadGlobalOptions komt uit content.js).
//
// In Communicatie → bericht zet Infused boven "Samenvatting" een VOORSTEL:
//   - een samenvatting van wat opvalt in een labuitslag
//   - een bestaande episode om aan te koppelen
// Er wordt niets opgeslagen. "Overnemen" vult alleen het formulier; de huisarts
// controleert en drukt zelf op Opslaan. Geen patiëntberichten, geen nieuwe
// episodes vanuit lab.
//
// Bron: Bericht.BerichtInfo (dezelfde call die Bricks zelf doet bij openen) en
// Episode.GetByPatient. Zie BRICKS-INTERNALS.md → "Postverwerking".

const PV_CARD_CLASS = 'bi-pv-card';

// CVRM-episodes waar een LDL bij hoort (eerste bestaande wint, daarna T93).
const PV_CVRM_CODES = ['K74', 'K75', 'K76', 'K77', 'K78', 'K79', 'K83', 'K84', 'K86', 'K87', 'K89', 'K90', 'K91', 'K92', 'K93', 'K94', 'K99'];

// LDL-streefwaarden per CVRM-groep (afgestemd 10-10-2026).
// HVZ = vastgestelde hart- en vaatziekte; uitzondering = codes die er niet onder vallen.
const PV_LDL_STREEF = {
    hvz: { max: 1.8, codes: ['K74', 'K75', 'K76', 'K89', 'K90', 'K91', 'K92', 'K99.01'], uitgezonderd: ['K90.03'] },
    risico: { max: 2.6, codes: ['T90', 'U99.01', 'K86', 'K87', 'T93'] }
};

// Bepalingen die niet los in de samenvatting horen (komen terug via een groepsregel of zeggen weinig).
const PV_NEGEER = /hematocriet|erytrocyt(?!.*(urine|sediment))|\bm\.?c\.?h\b|\bm\.?c\.?h\.?c\b|\brdw\b|distribution width|creatinine.*urine|albumine.*urine.*portie|cholesterol|\bhdl\b|triglycerid|chol\/hdl/;

const PV_PATRONEN = {
    tsh: /\btsh\b|thyro?id.*stimul|schildklier.*stimul/,
    ft4: /\bft4\b|vrij\s*t4|vrije?\s*thyroxine/,
    egfr: /egfr/,
    creatinine: /^creatinine\b(?!.*urine)/,
    acr: /albumine.?\/?.?creatinine.?ratio|\bacr\b|alb.*\/.*creat/,
    natrium: /^natrium/,
    kalium: /^kalium/,
    hba1c: /hba1c|hb\s*a1c|geglyceerd/,
    glucose: /glucose/,
    hb: /^hemoglobine|^haemoglobine|^hb\b(?!\s*a1c)/,
    mcv: /^m\.?c\.?v\.?$/,
    ferritine: /ferritine/,
    crp: /\bcrp\b|c-reacti/,
    bse: /\bbse\b|bezinking/,
    leuko: /leukocyt(?!.*(urine|sediment))/,
    // Urinesediment
    eryUrine: /erytrocyt.*(urine|sediment)(?!.*dysmorf)/,
    dysmorf: /dysmorf/,
    leukoUrine: /leukocyt.*(urine|sediment)/,
    asat: /\basat\b|\bgot\b/,
    alat: /\balat\b|\bgpt\b/,
    ggt: /gamma.?gt|\bggt\b|γ.?gt/,
    af: /alkalische fosfatase|\balp\b|^af\b/,
    b12: /b12|cobalamine/,
    folium: /foliumzuur|folaat/,
    vitd: /vitamine d|25.?oh/,
    ldl: /\bldl\b/
};

let pv_opties = {};
const pv_berichtCache = new Map(); // berichtId → Promise<{berichtId, waarden}|null>
let pv_bezig = false;
let pv_verborgen = null; // sleutel van een kaart die de gebruiker met × heeft gesloten

// --- Helpers -------------------------------------------------------------------

function pv_berichtIdUitUrl() {
    const m = (window.location.pathname || '').match(/\/communicatie\/\d+\/(\d+)/i);
    return m ? parseInt(m[1], 10) : null;
}

function pv_norm(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
}

function pv_getal(s) {
    if (s == null) return null;
    const t = String(s).replace(/[<>≤≥=\s]/g, '').replace(',', '.');
    if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
    return parseFloat(t);
}

function pv_rv(res) {
    return res && res.ReturnValue !== undefined ? res.ReturnValue : res;
}

// --- Lab uit BerichtInfo.HTML ----------------------------------------------------
// Tabellen: Bepaling | (vlag *) | Waarde | Eenheid | Min | Max | Opmerking.
// Afwijkende waarde heeft class "communicatie-afwijkend".

function pv_leesLabWaarden(html) {
    const doc = new DOMParser().parseFromString(html || '', 'text/html');
    const waarden = [];
    const gezien = new Set();
    doc.querySelectorAll('table').forEach((tabel) => {
        const kop = tabel.rows[0];
        if (!kop) return;
        const koppen = Array.from(kop.cells).map((c) => pv_norm(c.textContent));
        const iNaam = koppen.indexOf('bepaling');
        const iWaarde = koppen.indexOf('waarde');
        if (iNaam < 0 || iWaarde < 0) return;
        const iEenheid = koppen.indexOf('eenheid');
        const iMin = koppen.indexOf('min');
        const iMax = koppen.indexOf('max');
        const iOpm = koppen.indexOf('opmerking');
        Array.from(tabel.rows).slice(1).forEach((rij) => {
            const cel = (i) => (i >= 0 && rij.cells[i] ? rij.cells[i].textContent.trim() : '');
            const naam = cel(iNaam);
            const sleutel = pv_norm(naam);
            if (!naam || gezien.has(sleutel)) return;
            gezien.add(sleutel);
            const waardeCel = rij.cells[iWaarde];
            const codeNode = Array.from(rij.childNodes).find((n) => n.nodeType === Node.COMMENT_NODE && /^code:/.test(n.data));
            const w = {
                naam,
                code: codeNode ? codeNode.data.replace(/^code:/, '').trim() : '',
                sleutel,
                waarde: cel(iWaarde),
                getal: pv_getal(cel(iWaarde)),
                eenheid: cel(iEenheid),
                min: pv_getal(cel(iMin)),
                max: pv_getal(cel(iMax)),
                opmerking: cel(iOpm),
                // Afwijkend: rood gekleurde waarde, of een "*" in de vlagkolom (sommige labs).
                labVlag: !!(waardeCel && waardeCel.classList.contains('communicatie-afwijkend'))
                    || Array.from(rij.cells).some((c) => c.textContent.trim() === '*')
            };
            w.status = pv_status(w);
            waarden.push(w);
        });
    });
    return waarden;
}

// Lege min of max = geen grens aan die kant (bv. LDL: alleen max 3,5 → min is 0).
function pv_status(w) {
    if (w.getal == null) return w.labVlag ? 'afwijkend' : 'onbekend';
    if (w.min != null && w.getal < w.min) return 'verlaagd';
    if (w.max != null && w.getal > w.max) return 'verhoogd';
    if (w.min == null && w.max == null) return w.labVlag ? 'afwijkend' : 'onbekend';
    return 'normaal';
}

function pv_zoek(waarden, sleutel) {
    const re = PV_PATRONEN[sleutel];
    return waarden.find((w) => !w.gebruikt && re.test(w.sleutel)) || null;
}

function pv_pak(waarden, sleutel) {
    const w = pv_zoek(waarden, sleutel);
    if (w) w.gebruikt = true;
    return w;
}

function pv_w(w) {
    return w.waarde + (w.eenheid ? ' ' + w.eenheid.replace(/,$/, '') : '');
}

// --- Trend t.o.v. de vorige uitslag -------------------------------------------------------
// Bron: LabBepalingMeting.GetUitslagenByWCIACodes, dezelfde call als Bricks' eigen venster
// "Historische gegevens". "Vorige" = laatste uitslag van een EERDERE dag dan de afname van
// dit bericht; de lijst kan ook nieuwere uitslagen bevatten (oud bericht) en is niet op
// volgorde te vertrouwen.

// Bepalingen waarvan de vorige waarde wordt opgehaald (alleen genoemd als de huidige afwijkt).
const PV_TREND = { egfr: true, hba1c: true, glucose: true, acr: true };

function pv_maandJaar(d) {
    return String(d.getMonth() + 1).padStart(2, '0') + '-' + d.getFullYear();
}

function pv_afnameDatum(html, info) {
    const m = String(html || '').match(/DATUM:\s*(\d{2})-(\d{2})-(\d{4})/);
    if (m) return new Date(+m[3], +m[2] - 1, +m[1]);
    const d = info && info.Datum ? new Date(info.Datum) : null;
    return d && !isNaN(d) ? new Date(d.getFullYear(), d.getMonth(), d.getDate()) : null;
}

async function pv_koppelVorigeWaarden(waarden, patientId, afname) {
    const trendWaarden = waarden.filter((w) => w.code && Object.keys(PV_TREND).some((k) => PV_PATRONEN[k].test(w.sleutel)));
    if (!(patientId > 0) || !afname || !trendWaarden.length) return;
    const codes = Array.from(new Set(trendWaarden.map((w) => w.code)));
    let groepen = [];
    try {
        groepen = pv_rv(await bricksBridge.doApi('LabBepalingMeting', 'GetUitslagenByWCIACodes', { patientId, codes })) || [];
    } catch (e) {
        console.warn('Postverwerking: labhistorie ophalen mislukt', e);
        return;
    }
    const uitslagen = [];
    groepen.forEach((g) => (g.Uitslagen || []).forEach((u) => uitslagen.push(u)));
    trendWaarden.forEach((w) => {
        const eerder = uitslagen
            .filter((u) => u.Memo === w.code)
            .map((u) => ({ datum: new Date(u.Datum), tekst: u.WaardeDisplay, getal: pv_getal(u.WaardeDisplay) }))
            .filter((u) => !isNaN(u.datum) && u.datum < afname && u.getal != null)
            .sort((a, b) => b.datum - a.datum);
        if (eerder.length) {
            w.vorig = eerder[0];
            w.vorig.dagenGeleden = Math.round((afname - eerder[0].datum) / 86400000);
        }
    });
}

// --- Regels ------------------------------------------------------------------------
// Stijl (afgesproken 14-10-2026): patiënttaal, kort. Alleen AFWIJKINGEN met een getal (zonder eenheid),
// de rest gebundeld zonder getallen:
//   "Laag ferritine (18), past bij ijzertekort, geen bloedarmoede. Verder alles normaal (nierfunctie,
//    bloedsuiker, cholesterol, schildklierwaarde, vitamines)."
// Elke regel pakt zijn bepalingen (gebruikt = true) en geeft { afw: [...], norm: [...] } terug.

function pv_r(afw, norm) {
    return { afw: afw || [], norm: norm || [] };
}

// Getal zoals het lab het geeft ("18", "<0,01"), zonder eenheid.
function pv_g(w) {
    return w.waarde;
}

// ", was 61 in 03-2023" — alleen bij afwijkende waarden zinvol.
function pv_was(w) {
    const v = w && w.vorig;
    return v && v.tekst ? `, was ${v.tekst} in ${pv_maandJaar(v.datum)}` : '';
}

function pv_regelSchildklier(waarden, ctx) {
    const tsh = pv_pak(waarden, 'tsh');
    const ft4 = pv_pak(waarden, 'ft4');
    if (!tsh && !ft4) return pv_r();
    if (!tsh) {
        return ft4.status === 'normaal' ? pv_r([], ['schildklierwaarde'])
            : pv_r([`${ft4.status === 'verhoogd' ? 'verhoogd' : 'verlaagd'} FT4 (${pv_g(ft4)}), TSH niet bepaald`]);
    }
    const t = tsh.status;
    const f = ft4 ? ft4.status : null;
    const waardes = `TSH ${pv_g(tsh)}` + (ft4 ? `, FT4 ${f === 'normaal' ? 'normaal' : pv_g(ft4)}` : '');

    if (ctx.heeftT86) {
        if (t === 'normaal') return pv_r([], ['schildklierwaarde (medicatie goed ingesteld)']);
        if (t === 'verhoogd' && (!ft4 || f !== 'verhoogd')) return pv_r([`schildkliermedicatie te laag ingesteld (${waardes})`]);
        if (t === 'verlaagd' && (!ft4 || f !== 'verlaagd')) return pv_r([`schildkliermedicatie te hoog ingesteld (${waardes})`]);
        return pv_r([`afwijkende schildklierwaarden (${waardes})`]);
    }
    if (t === 'normaal' && (!ft4 || f === 'normaal')) return pv_r([], ['schildklierwaarde']);
    if (!ft4) return pv_r([`${t === 'verhoogd' ? 'verhoogd' : 'verlaagd'} TSH (${pv_g(tsh)}), FT4 niet bepaald`]);
    if (t === 'verlaagd' && f === 'normaal') return pv_r([`licht te snel werkende schildklier (${waardes})`]);
    if (t === 'verlaagd' && f === 'verhoogd') return pv_r([`te snel werkende schildklier (${waardes})`]);
    if (t === 'verhoogd' && f === 'normaal') return pv_r([`licht te traag werkende schildklier (${waardes})`]);
    if (t === 'verhoogd' && f === 'verlaagd') return pv_r([`te traag werkende schildklier (${waardes})`]);
    return pv_r([`afwijkende schildklierwaarden (${waardes})`]);
}

function pv_regelNier(waarden) {
    const egfr = pv_pak(waarden, 'egfr');
    const acr = pv_pak(waarden, 'acr');
    const creat = pv_zoek(waarden, 'creatinine');
    if (egfr && creat) creat.gebruikt = true; // creatinine zegt niets extra naast eGFR
    const afw = [];
    let normaal = false;
    if (egfr) {
        const g = egfr.getal != null ? egfr.getal : (/>\s*\d/.test(egfr.waarde) ? 90 : null);
        const e = `eGFR ${pv_g(egfr)}${pv_was(egfr)}`;
        if (g == null) afw.push(e);
        else if (g >= 60) normaal = true;
        else if (g >= 45) afw.push(`licht verminderde nierfunctie (${e})`);
        else if (g >= 30) afw.push(`matig verminderde nierfunctie (${e})`);
        else if (g >= 15) afw.push(`ernstig verminderde nierfunctie (${e})`);
        else afw.push(`zeer ernstig verminderde nierfunctie (${e})`);
        const v = egfr.vorig;
        if (v && g != null && v.getal && v.dagenGeleden <= 90 && (v.getal - g) / v.getal >= 0.15) {
            afw.push(`nierfunctie meer dan 15% gedaald in 3 maanden (eGFR van ${v.tekst} naar ${pv_g(egfr)})`);
            normaal = false;
        }
    }
    if (acr && acr.getal != null) {
        if (acr.getal < 3) normaal = normaal || !egfr;
        else if (acr.getal <= 30) afw.push(`eiwit in de urine (ACR ${pv_g(acr)}${pv_was(acr)})`);
        else afw.push(`veel eiwit in de urine (ACR ${pv_g(acr)}${pv_was(acr)})`);
    }
    return pv_r(afw, normaal && !afw.length ? ['nierfunctie'] : []);
}

function pv_regelElektrolyten(waarden) {
    const na = pv_pak(waarden, 'natrium');
    const k = pv_pak(waarden, 'kalium');
    if (!na && !k) return pv_r();
    const afw = [];
    if (na && na.status === 'verlaagd') afw.push(`laag natrium (${pv_g(na)})`);
    if (na && na.status === 'verhoogd') afw.push(`hoog natrium (${pv_g(na)})`);
    if (k && k.status === 'verlaagd') afw.push(`laag kalium (${pv_g(k)})`);
    if (k && k.status === 'verhoogd') afw.push(`hoog kalium (${pv_g(k)})`);
    return pv_r(afw, afw.length ? [] : ['zouten']);
}

function pv_regelGlucose(waarden, ctx) {
    const afw = [];
    let normaal = false;
    const hba1c = pv_pak(waarden, 'hba1c');
    if (hba1c) {
        // Bij diabetes is het HbA1c de controlewaarde zelf: altijd noemen.
        if (ctx.heeftT90 || hba1c.getal == null) afw.push(`HbA1c ${pv_g(hba1c)}${pv_was(hba1c)}`);
        else if (hba1c.getal >= 48) afw.push(`verhoogd HbA1c (${pv_g(hba1c)}), past bij diabetes`);
        else normaal = true;
    }
    const gluc = pv_pak(waarden, 'glucose');
    if (gluc && gluc.getal != null) {
        const nuchter = /nuchter/.test(gluc.sleutel) && !/niet nuchter/.test(gluc.sleutel);
        const g = gluc.getal;
        const dm = ctx.heeftT90 ? '' : ', past bij diabetes';
        const n = nuchter ? 'nuchtere ' : '';
        if (g < 4) afw.push(`lage bloedsuiker (${pv_g(gluc)})`);
        else if (nuchter && g < 6.1) normaal = true;
        else if (nuchter && g < 7.0) afw.push(`licht verhoogde nuchtere bloedsuiker (${pv_g(gluc)})`);
        else if (!nuchter && g < 7.8) normaal = true;
        else if (!nuchter && g < 11.1) afw.push(`licht verhoogde bloedsuiker (${pv_g(gluc)})`);
        else afw.push(`verhoogde ${n}bloedsuiker (${pv_g(gluc)})${dm}`);
    }
    return pv_r(afw, normaal ? ['bloedsuiker'] : []);
}

function pv_regelBloedbeeld(waarden) {
    const hb = pv_pak(waarden, 'hb');
    const mcv = pv_pak(waarden, 'mcv');
    const ferr = pv_pak(waarden, 'ferritine');
    const afw = [];
    const norm = [];
    const ferrLaag = ferr && (ferr.status === 'verlaagd' || (ferr.getal != null && ferr.getal < 30 && ferr.status !== 'verhoogd'));
    let bloedarmoede = null;
    if (hb && hb.status === 'verlaagd') {
        const cellen = mcv && mcv.status === 'verlaagd' ? ' met kleine rode bloedcellen'
            : mcv && mcv.status === 'verhoogd' ? ' met grote rode bloedcellen' : '';
        bloedarmoede = `bloedarmoede (Hb ${pv_g(hb)})${cellen}`;
    }
    if (ferrLaag) {
        // "laag ferritine (18), past bij ijzertekort, geen bloedarmoede"
        afw.push(`laag ferritine (${pv_g(ferr)}), past bij ijzertekort` + (bloedarmoede ? `, ${bloedarmoede}` : hb ? ', geen bloedarmoede' : ''));
    } else {
        if (bloedarmoede) afw.push(bloedarmoede);
        if (hb && hb.status === 'verhoogd') afw.push(`verhoogd Hb (${pv_g(hb)})`);
        if (hb && hb.status !== 'verlaagd' && hb.status !== 'verhoogd' && mcv && (mcv.status === 'verlaagd' || mcv.status === 'verhoogd')) {
            afw.push(`${mcv.status === 'verlaagd' ? 'kleine' : 'grote'} rode bloedcellen (MCV ${pv_g(mcv)}), geen bloedarmoede`);
        }
        if (ferr && ferr.status === 'verhoogd') afw.push(`verhoogd ferritine (${pv_g(ferr)})`);
        if (!afw.length && (hb || ferr)) norm.push('bloedbeeld');
    }
    return pv_r(afw, norm);
}

const PV_KORTE_NAAM = { crp: 'CRP', bse: 'BSE', leuko: 'leukocyten', asat: 'ASAT', alat: 'ALAT', ggt: 'GGT', af: 'AF' };

// marge: { sleutel: n } — tot n punten boven de bovengrens telt nog als normaal.
function pv_regelGroep(waarden, sleutels, afwTekst, normLabel, marge) {
    const delen = sleutels.map((k) => ({ k, w: pv_pak(waarden, k) })).filter((d) => d.w);
    if (!delen.length) return pv_r();
    const binnenMarge = (d) => marge && marge[d.k] != null && d.w.status === 'verhoogd'
        && d.w.getal != null && d.w.max != null && d.w.getal <= d.w.max + marge[d.k];
    const afw = delen.filter((d) => (d.w.status === 'verhoogd' || d.w.status === 'verlaagd') && !binnenMarge(d));
    if (!afw.length) return pv_r([], [normLabel]);
    return pv_r([`${afwTekst} (${afw.map((d) => `${PV_KORTE_NAAM[d.k]} ${pv_g(d.w)}`).join(', ')})`]);
}

function pv_regelOntsteking(waarden) {
    // CRP en BSE: tot 5 punten boven de bovengrens nog niet als afwijkend noemen (afgesproken 14-10-2026).
    return pv_regelGroep(waarden, ['crp', 'bse', 'leuko'], 'verhoogde ontstekingswaarden', 'ontstekingswaarden', { crp: 5, bse: 5 });
}

function pv_regelLever(waarden) {
    return pv_regelGroep(waarden, ['asat', 'alat', 'ggt', 'af'], 'afwijkende leverwaarden', 'leverwaarden');
}

function pv_regelVitamines(waarden) {
    const afw = [];
    let normaal = false;
    const b12 = pv_pak(waarden, 'b12');
    if (b12) { if (b12.status === 'verlaagd') afw.push(`laag vitamine B12 (${pv_g(b12)})`); else normaal = true; }
    const fol = pv_pak(waarden, 'folium');
    if (fol) { if (fol.status === 'verlaagd') afw.push(`laag foliumzuur (${pv_g(fol)})`); else normaal = true; }
    const vitd = pv_pak(waarden, 'vitd');
    if (vitd) {
        if ((vitd.getal != null && vitd.getal < 50) || vitd.status === 'verlaagd') afw.push(`laag vitamine D (${pv_g(vitd)})`);
        else normaal = true;
    }
    return pv_r(afw, normaal ? ['vitamines'] : []);
}

function pv_regelLdl(waarden, ctx) {
    const ldl = pv_pak(waarden, 'ldl');
    if (!ldl) return pv_r();
    if (ctx.cvrm === 'hvz' && ldl.getal != null) {
        return ldl.getal < PV_LDL_STREEF.hvz.max ? pv_r([], ['cholesterol (op streefwaarde)'])
            : pv_r([`LDL boven streefwaarde (${pv_g(ldl)}; streef < 1,8)`]);
    }
    // Zonder HVZ hangt het oordeel af van o.a. statinegebruik: boven 2,6 alleen de streefwaarde noemen.
    if (ctx.cvrm === 'risico' && ldl.getal != null) {
        return ldl.getal <= PV_LDL_STREEF.risico.max ? pv_r([], ['cholesterol'])
            : pv_r([`LDL ${pv_g(ldl)} (streefwaarde < 2,6 bij CVRM)`]);
    }
    if (ldl.status === 'verhoogd') return pv_r([`verhoogd LDL-cholesterol (${pv_g(ldl)})`]);
    return pv_r([], ['cholesterol']);
}

// Urinesediment: erytrocyten + % dysmorfe erytrocyten (afgesproken 14-10-2026):
//   ≤ 40% dysmorf: bloed waarschijnlijk niet uit de nieren (maar bijv. uit de blaas)
//   > 40%:         bloed mogelijk uit de nieren
//   > 80%:         bloed waarschijnlijk uit de nieren
function pv_dysmorfDuiding(pct) {
    if (pct > 80) return 'bloed waarschijnlijk uit de nieren';
    if (pct > 40) return 'bloed mogelijk uit de nieren';
    return 'bloed waarschijnlijk niet uit de nieren (maar bijv. uit de blaas)';
}

function pv_regelUrine(waarden) {
    const dys = pv_pak(waarden, 'dysmorf');
    const ery = pv_pak(waarden, 'eryUrine');
    const leu = pv_pak(waarden, 'leukoUrine');
    if (!dys && !ery && !leu) return pv_r();
    const afw = [];
    const isAfw = (w) => w && (w.status === 'verhoogd' || w.status === 'afwijkend' || (w.labVlag && w.status !== 'verlaagd'));
    const pct = dys && dys.getal != null ? dys.getal : null;
    if (isAfw(ery)) {
        afw.push(`bloed in de urine (ery's ${pv_g(ery)}/uL)` + (pct != null ? `, ${pv_g(dys)}% dysmorf: ${pv_dysmorfDuiding(pct)}` : ''));
    } else if (pct != null && pct > 40) {
        afw.push(`${pv_g(dys)}% dysmorfe ery's in de urine: ${pv_dysmorfDuiding(pct)}`);
    }
    if (isAfw(leu)) afw.push(`leukocyten in de urine (${pv_g(leu)}/uL)`);
    return pv_r(afw, afw.length ? [] : ['urinesediment']);
}

// --- Allergietest (specifiek IgE) ----------------------------------------------------------
// Klassen (afgesproken 14-10-2026): <0,35 negatief; 0,35–0,69 zwak; 0,70–3,49 matig; 3,50–17,49 sterk;
// 17,50–49,99 zeer sterk; 50–100 zeer hoog; >100 extreem hoog positief.
// "Allergietest: matig positief voor huisstofmijt, negatief voor katten, honden en graspollen."
const PV_IGE_KLASSEN = [
    [100, 'extreem hoog positief'], [50, 'zeer hoog positief'], [17.5, 'zeer sterk positief'],
    [3.5, 'sterk positief'], [0.7, 'matig positief'], [0.35, 'zwak positief']
];
// Allergeen → gewone naam: op lab-code (e1, d1, gx3, …) of op woorden in de naam.
const PV_ALLERGEEN_CODES = {
    e1: 'katten', e2: 'honden', e3: 'paarden', e5: 'honden', e82: 'konijnen', e6: 'cavia\'s',
    d1: 'huisstofmijt', d2: 'huisstofmijt', gx3: 'graspollen', g6: 'graspollen (timotheegras)',
    tx9: 'boompollen', t3: 'berkenpollen', t2: 'elzenpollen', t4: 'hazelaarpollen',
    wx3: 'kruidpollen', w6: 'bijvoet', w1: 'ambrosia', mx1: 'schimmels', m2: 'schimmels (Cladosporium)',
    m3: 'schimmels (Aspergillus)', m6: 'schimmels (Alternaria)', f1: 'kippenei-eiwit', f2: 'koemelk',
    f13: 'pinda', f14: 'soja', f17: 'hazelnoot', f3: 'vis', f24: 'garnaal', i1: 'bijengif', i3: 'wespengif'
};
const PV_ALLERGEEN_WOORDEN = [
    [/dermatophag|huisstofmijt/, 'huisstofmijt'], [/\bhond/, 'honden'], [/\bkat\b|\bkatten/, 'katten'],
    [/\bpaard/, 'paarden'], [/graspollen|timothee/, 'graspollen'], [/boompollen/, 'boompollen'], [/\bberk/, 'berkenpollen'],
    [/kruidpollen/, 'kruidpollen'], [/bijvoet/, 'bijvoet'], [/schimmel|alternaria|cladosporium|aspergillus/, 'schimmels'],
    [/pinda/, 'pinda'], [/kippenei|\bei\b/, 'kippenei'], [/melk/, 'koemelk']
];

function pv_isAllergeen(w) {
    return /^as\.?\s/.test(w.sleutel) || /\bige\b.*specifiek|specifiek.*\bige\b/.test(w.sleutel);
}

function pv_allergeenNaam(w) {
    const code = (w.sleutel.match(/\b([a-z]{1,2}x?\d{1,3})\s*$/) || [])[1];
    if (code && PV_ALLERGEEN_CODES[code]) return PV_ALLERGEEN_CODES[code];
    const hit = PV_ALLERGEEN_WOORDEN.find(([re]) => re.test(w.sleutel));
    if (hit) return hit[1];
    return w.naam.replace(/^as\.?\s*/i, '').replace(/\s+[a-z]{1,2}x?\d{1,3}\s*$/i, '').replace(/^mengsel\s+/i, '').trim();
}

function pv_igeKlasse(waarde) {
    const k = PV_IGE_KLASSEN.find(([grens]) => waarde >= grens);
    return k ? k[1] : 'negatief';
}

// "a, b en c"
function pv_opsomming(lijst) {
    return lijst.length <= 1 ? (lijst[0] || '') : lijst.slice(0, -1).join(', ') + ' en ' + lijst[lijst.length - 1];
}

function pv_regelAllergie(waarden) {
    const screening = waarden.find((w) => !w.gebruikt && /phadiatop|multi.?rast/.test(w.sleutel));
    if (screening) screening.gebruikt = true;
    const allergenen = waarden.filter((w) => !w.gebruikt && pv_isAllergeen(w));
    allergenen.forEach((w) => { w.gebruikt = true; });
    if (!screening && !allergenen.length) return pv_r();

    // Per klasse de allergenen verzamelen (dubbele namen samenvoegen, hoogste klasse wint).
    const perNaam = new Map();
    allergenen.forEach((w) => {
        if (w.getal == null) return;
        const naam = pv_allergeenNaam(w);
        const oud = perNaam.get(naam);
        if (oud == null || w.getal > oud) perNaam.set(naam, w.getal);
    });
    const volgorde = PV_IGE_KLASSEN.map(([, k]) => k).concat(['negatief']);
    const perKlasse = {};
    perNaam.forEach((waarde, naam) => { (perKlasse[pv_igeKlasse(waarde)] = perKlasse[pv_igeKlasse(waarde)] || []).push(naam); });
    const delen = volgorde.filter((k) => perKlasse[k]).map((k) => `${k} voor ${pv_opsomming(perKlasse[k])}`);

    if (!delen.length && screening) {
        return pv_r([`allergiescreening (Phadiatop) ${/pos/.test(pv_norm(screening.waarde)) ? 'positief' : 'negatief'}`]);
    }
    return pv_r([`allergietest: ${delen.join(', ')}`]);
}

function pv_regelOverig(waarden) {
    const afw = [];
    waarden.forEach((w) => {
        if (w.gebruikt) return;
        w.gebruikt = true;
        if (PV_NEGEER.test(w.sleutel)) return;
        if (w.status === 'verhoogd' || w.status === 'verlaagd') afw.push(`${w.naam} ${w.status} (${pv_g(w)})`);
    });
    return pv_r(afw);
}

function pv_maakLabSamenvatting(waarden, ctx) {
    const delen = [
        pv_regelNier(waarden),
        pv_regelElektrolyten(waarden),
        pv_regelGlucose(waarden, ctx),
        pv_regelLdl(waarden, ctx),
        pv_regelSchildklier(waarden, ctx),
        pv_regelBloedbeeld(waarden),
        pv_regelOntsteking(waarden),
        pv_regelLever(waarden),
        pv_regelVitamines(waarden),
        pv_regelUrine(waarden),
        pv_regelAllergie(waarden),
        pv_regelOverig(waarden)
    ];
    const afw = delen.flatMap((d) => d.afw);
    const norm = Array.from(new Set(delen.flatMap((d) => d.norm)));
    const hoofd = (t) => t.charAt(0).toUpperCase() + t.slice(1);
    if (!afw.length && !norm.length) return '';
    if (!afw.length) return `Alles normaal (${norm.join(', ')}).`;
    const tekst = afw.map(hoofd).join('. ') + '.';
    return norm.length ? `${tekst} Verder alles normaal (${norm.join(', ')}).` : tekst;
}

// --- Episodes uit de lijst op het scherm ------------------------------------------------
// De lijst in het paneel is wat de huisarts ziet: al gesorteerd op laatste contact en
// ook gevuld als de patiënt net gekozen is maar het bericht nog niet is opgeslagen
// (BerichtInfo kent de patiënt dan nog niet). Rij = <tr> met radio; eerste rij is "Geen".

const PV_ICPC = /^[A-Z]\d{2}(\.\d{2})?$/;

function pv_leesEpisodes(pane) {
    const episodes = [];
    pane.querySelectorAll('tr').forEach((rij) => {
        const radio = rij.querySelector('input[type="radio"]');
        if (!radio) return;
        const codeEl = Array.from(rij.querySelectorAll('*')).find((el) =>
            el.childElementCount === 0 && PV_ICPC.test(el.textContent.trim()));
        if (!codeEl) return;
        const code = codeEl.textContent.trim();
        const titel = rij.textContent.replace(/\s+/g, ' ').trim().replace(code, '').trim();
        episodes.push({ code, titel, rij, radio, gekozen: radio.checked });
    });
    return episodes;
}

// --- Episode-voorstel (alleen bestaande episodes) ---------------------------------------
// HbA1c → T90; LDL → meest recente CVRM-episode, anders T93; schildklier → T86.
// Niets herkend: de bovenste episode (meest recente contact).

function pv_episodeVoorstellen(waarden, episodes) {
    const metCode = (code) => episodes.filter((e) => e.code.toUpperCase().startsWith(code));
    const heeft = (sleutel) => waarden.some((w) => PV_PATRONEN[sleutel].test(w.sleutel));
    const voorstellen = [];
    const voegToe = (lijst, reden) => lijst.forEach((e) => {
        if (!voorstellen.some((v) => v.episode === e)) voorstellen.push({ episode: e, reden });
    });
    if (heeft('hba1c')) voegToe(metCode('T90'), 'HbA1c');
    if (heeft('ldl')) {
        const cvrm = episodes.filter((e) => PV_CVRM_CODES.some((c) => e.code.toUpperCase().startsWith(c)));
        voegToe(cvrm.length ? cvrm.slice(0, 1) : metCode('T93'), 'LDL');
    }
    if (heeft('tsh') || heeft('ft4')) voegToe(metCode('T86'), 'schildklier');
    if (!voorstellen.length) voegToe(episodes.slice(0, 1), 'laatste contact');
    return voorstellen;
}

// --- Analyse ---------------------------------------------------------------------------
// Labwaarden per bericht (één keer ophalen); samenvatting en episodes hangen af van de
// episodelijst op het scherm en worden opnieuw bepaald als die verandert.

function pv_datumNL(iso) {
    const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m && m[1] !== '0001' ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

async function pv_leesBericht(berichtId) {
    const info = pv_rv(await bricksBridge.doApi('Bericht', 'BerichtInfo', { berichtId }));
    if (!info || !info.HTML) return null;
    const isLab = /lab/i.test(info.Soort || '') || /uitgevoerde labbepalingen/i.test(info.HTML);
    if (isLab) {
        if (pv_opties.postverwerkingLab === false) return null;
        const waarden = pv_leesLabWaarden(info.HTML);
        if (!waarden.length) return null;
        // Alleen als het bericht al aan een patiënt hangt; anders kent de server de patiënt nog niet.
        await pv_koppelVorigeWaarden(waarden, info.GekoppeldePatientId, pv_afnameDatum(info.HTML, info));
        // Afzender van een labuitslag: instelling + afdeling ("Rode Kruis Ziekenhuis, Klinisch Chemisch
        // Laboratorium" → "!Laboratorium RKZ"). Bricks vult vaak zelf al een contact in; een opgeslagen
        // contact wordt nooit overschreven.
        return { berichtId, soort: 'lab', waarden, geboortedatum: pv_datumNL(info.Patient && info.Patient.GeboorteDatum),
            afzender: pv_afzenderInstelling(pv_instellingUitInfo(info)), opgeslagenContactId: info.TelefoonboekContactId };
    }
    if (pv_opties.postverwerkingBrief === false) return null;
    const brief = await pv_briefAnalyse(info);
    if (!brief) return null;
    brief.berichtId = berichtId;
    if (!brief.geboortedatum) brief.geboortedatum = pv_datumNL(info.Patient && info.Patient.GeboorteDatum);
    return brief;
}

function pv_analyseer(bericht, episodes) {
    if (bericht.soort === 'brief') {
        const match = pv_briefEpisodeMatch(bericht.diagnoseTekst + ' ' + bericht.samenvatting, episodes);
        return {
            berichtId: bericht.berichtId,
            titel: bericht.type,
            samenvatting: bericht.samenvatting,
            voorstellen: match ? [{ episode: match, reden: 'de diagnose/conclusie in de brief' }]
                : episodes.slice(0, 1).map((e) => ({ episode: e, reden: 'laatste contact' })),
            // Nieuwe episode alleen voorstellen als er geen bestaande past.
            nieuw: match ? [] : (bericht.icpc || []),
            heeftPatient: episodes.length > 0,
            geboortedatum: bericht.geboortedatum,
            afzender: bericht.afzender,
            adresboek: bericht.adresboek,
            opgeslagenContactId: bericht.opgeslagenContactId
        };
    }
    const codes = episodes.map((e) => e.code.toUpperCase());
    const begintMet = (lijst) => codes.some((c) => lijst.some((p) => c.startsWith(p)));
    const hvz = codes.some((c) => PV_LDL_STREEF.hvz.codes.some((p) => c.startsWith(p))
        && !PV_LDL_STREEF.hvz.uitgezonderd.some((p) => c.startsWith(p)));
    const ctx = {
        heeftT86: begintMet(['T86']),
        heeftT90: begintMet(['T90']),
        cvrm: hvz ? 'hvz' : (begintMet(PV_LDL_STREEF.risico.codes) ? 'risico' : null)
    };
    // Kopie: de regels markeren bepalingen als gebruikt.
    return {
        berichtId: bericht.berichtId,
        titel: 'lab',
        geboortedatum: bericht.geboortedatum,
        nieuw: [],
        samenvatting: pv_maakLabSamenvatting(bericht.waarden.map((w) => Object.assign({}, w)), ctx),
        voorstellen: pv_episodeVoorstellen(bericht.waarden, episodes),
        heeftPatient: episodes.length > 0,
        afzender: bericht.afzender,
        adresboek: bericht.adresboek,
        opgeslagenContactId: bericht.opgeslagenContactId
    };
}

// --- Formulier invullen (de gebruiker slaat zelf op) ------------------------------------

function pv_vulSamenvatting(pane, tekst) {
    const ta = pane.querySelector('textarea.samenvatting');
    if (!ta) return false;
    const huidig = ta.value.trim();
    const nieuw = (!huidig || /^labuitslag\.?$/i.test(huidig)) ? tekst : huidig + '\n' + tekst;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, nieuw);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    ta.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
}

function pv_selecteerEpisode(pane, episode) {
    // Vue kan de rij intussen opnieuw hebben getekend: zoek op code + titel.
    const actueel = episode.rij.isConnected ? episode
        : pv_leesEpisodes(pane).find((e) => e.code === episode.code && e.titel === episode.titel);
    if (!actueel) return false;
    actueel.radio.click();
    return true;
}

// Opent Bricks' eigen dialoog "Episode toevoegen" en vult naam (en ICPC-zoekterm) alvast in.
// De huisarts kiest de ICPC uit de lijst van Bricks en klikt zelf op Opslaan.
async function pv_openNieuweEpisode(pane, icpc) {
    const plus = pane.querySelector('[title="Nieuwe episode"]');
    if (!plus) return false;
    plus.click();
    let dialoog = null;
    for (let i = 0; i < 20 && !dialoog; i++) {
        await new Promise((r) => setTimeout(r, 150));
        dialoog = Array.from(document.querySelectorAll('.modal-dialog, [role="dialog"], .modal-content'))
            .find((d) => /episode toevoegen/i.test(d.textContent));
    }
    if (!dialoog) return false;
    const zet = (input, waarde) => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        setter.call(input, waarde);
        input.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const inputs = Array.from(dialoog.querySelectorAll('input[type="text"], input:not([type])'));
    const icpcVeld = inputs.find((i) => /icpc/i.test(i.placeholder || ''));
    const naamVeld = inputs.find((i) => i !== icpcVeld && !/dd-mm|jjjj/i.test(i.placeholder || '') && !i.value);
    if (naamVeld) zet(naamVeld, icpc.omschrijving);
    if (icpcVeld) { icpcVeld.focus(); zet(icpcVeld, icpc.code); }
    return true;
}

// Geboortedatum van de gekoppelde patiënt uit het Patiënt-veld: "Mw. X (38) (12-01-1988) Arts".
// Dat is tekst, geen input; leeftijd + datum tussen haakjes is uniek genoeg in het paneel.
function pv_patientGeboortedatum(pane) {
    const kaart = pane.querySelector('.' + PV_CARD_CLASS);
    const tekst = pane.innerText.replace(kaart ? kaart.innerText : '', '');
    const m = tekst.match(/\(\d{1,3}\)\s*\((\d{2}-\d{2}-\d{4})\)/);
    return m ? m[1] : null;
}

// --- Geadresseerde (adresboek) -------------------------------------------------------------------
// Eén duidelijke match en het veld is leeg → automatisch invullen (één keer per bericht).
// Meerdere kandidaten → knoppen; niets gevonden → melding. Zie content_postverwerking_adresboek.js.

const pv_adresboekPogingen = new Map(); // berichtId → aantal automatische pogingen (klaar = 99)

// Afzender is een instelling + afdeling, maar het adresboek heeft alleen een algemeen contact van de
// instelling: bied aan om een contact voor de afdeling aan te maken (het algemene blijft ingevuld).
function pv_afdelingKnop(regel, analyse, beste) {
    const a = analyse.afzender;
    if (!a || a.soort !== 'instelling' || !a.instelling || !a.instelling.afdeling) return;
    if (beste && beste.afdeling) return;
    regel.appendChild(document.createTextNode(' '));
    regel.appendChild(pv_nieuwContactKnop(a, `Nieuw contact: ${a.tekst}`, analyse));
}

// Mag Infused het huidige adresboekcontact vervangen? Ja als het leeg is, of als het Bricks' eigen
// suggestie van alleen de instelling is (bv. "Dagoziekenhuis") die nog niet is opgeslagen.
// Mag Infused het huidige adresboekcontact vervangen?
// - leeg: ja;
// - een algemeen contact van de instelling (geen afdeling) terwijl er een afdelingscontact past
//   ("Rode Kruis Ziekenhuis Beverwijk" → "!Radiologie RKZ"): ja, ook als Bricks het al had opgeslagen
//   — het gebeurt alleen in het formulier, de huisarts slaat zelf op;
// - Bricks' niet-opgeslagen suggestie van alleen de instelling: ja;
// - anders (een ander, specifiek contact): nee.
function pv_adresboekVervangbaar(pane, analyse) {
    const huidig = pv_norm(pv_adresboekHuidig(pane));
    if (!huidig) return true;
    // Vast contact (ZorgDomein-terugkoppeling → eigen praktijk): altijd dat contact.
    if (analyse.afzender && analyse.afzender.soort === 'vast') return huidig !== pv_norm(analyse.afzender.tekst);
    const inst = analyse.afzender && analyse.afzender.instelling;
    if (!inst) return false;
    const kandidaten = (analyse.adresboek && analyse.adresboek.kandidaten) || [];
    const beste = pv_adresboekBeste(kandidaten);
    if (beste && pv_norm(beste.naam) === huidig) return false;
    const huidigeKandidaat = kandidaten.find((k) => pv_norm(k.naam) === huidig);
    const huidigIsAlgemeen = huidig === pv_norm(inst.naam) || (huidigeKandidaat && !huidigeKandidaat.afdeling);
    if (beste && beste.afdeling && huidigIsAlgemeen) return true;
    return !(analyse.opgeslagenContactId > 0) && huidig === pv_norm(inst.naam);
}

// Na "Nieuw contact aanmaken": wacht tot het formulier dicht is (opgeslagen of geannuleerd), zoek
// opnieuw en vervang de knop door "Toewijzen: <naam>". Staat Bricks' zoeklijst nog open, dan zet
// Infused de naam erin zodat het nieuwe contact er direct staat.
function pv_nieuwContactKnop(afzender, tekst, analyse) {
    const b = pv_knop(tekst || 'Nieuw contact aanmaken', false);
    b.title = 'Opent het venster van Bricks met de afzender alvast ingevuld; controleer en sla zelf op.';
    b.addEventListener('click', async () => {
        if (!(await pv_nieuwContact(afzender))) {
            b.title = 'Lukte niet — maak het contact zelf aan via het vergrootglas → Nieuw.';
            b.style.borderColor = '#c53030';
            return;
        }
        const formulierOpen = () => Array.from(document.querySelectorAll('.modal-dialog')).some((d) => /journaalkoptekst/i.test(d.textContent));
        await pv_wacht(() => !formulierOpen(), 10 * 60 * 1000);
        const ab = await pv_adresboekKandidaten(afzender);
        const beste = pv_adresboekBeste(ab.kandidaten);
        if (!beste) return; // geannuleerd of (nog) niet te vinden
        if (analyse) analyse.adresboek = ab;
        const lijst = Array.from(document.querySelectorAll('.modal-dialog')).find((d) => /selecteer contact/i.test(d.textContent));
        const zoekveld = lijst && lijst.querySelector('input');
        if (zoekveld && !zoekveld.value) {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(zoekveld, beste.query || ab.query);
            zoekveld.dispatchEvent(new Event('input', { bubbles: true }));
        }
        const toewijzen = pv_knop('Toewijzen: ' + beste.naam, true);
        toewijzen.title = 'Kies dit nieuwe contact als geadresseerde (via het venster van Bricks).';
        toewijzen.addEventListener('click', async () => {
            toewijzen.disabled = true;
            const ok = await pv_kiesAdresboek(ab.query, beste, false);
            toewijzen.disabled = false;
            if (ok) toewijzen.textContent = '✓ ' + beste.naam;
            else { toewijzen.title = 'Lukte niet — kies het contact zelf via het vergrootglas.'; toewijzen.style.borderColor = '#c53030'; }
        });
        b.replaceWith(toewijzen);
    });
    return b;
}

function pv_toonAdresboekRegel(kaart, pane, analyse) {
    const regel = document.createElement('div');
    regel.className = 'bi-pv-adresboek';
    regel.style.cssText = 'margin-top:4px;color:#444;';
    kaart.appendChild(regel);
    const ab = analyse.adresboek || { kandidaten: [] };
    const huidig = pv_adresboekHuidig(pane);
    const beste = pv_adresboekBeste(ab.kandidaten);
    const vervangbaar = pv_adresboekVervangbaar(pane, analyse);
    if (huidig && (!vervangbaar || (beste && pv_norm(huidig) === pv_norm(beste.naam)))) {
        regel.textContent = `Geadresseerde: ${huidig}` + (beste && pv_norm(huidig) !== pv_norm(beste.naam) ? ` (afzender in brief: ${analyse.afzender.tekst})` : '');
        if (beste && pv_norm(huidig) !== pv_norm(beste.naam)) {
            // Niet automatisch vervangen, maar wel met één klik mogelijk.
            const b = pv_knop('Vervangen door ' + beste.naam, false);
            b.addEventListener('click', async () => {
                b.disabled = true;
                const ok = await pv_kiesAdresboek(ab.query, beste, false);
                b.disabled = false;
                if (ok) b.textContent = '✓ ' + beste.naam;
                else { b.title = 'Lukte niet — kies het contact zelf via het vergrootglas.'; b.style.borderColor = '#c53030'; }
            });
            regel.appendChild(document.createTextNode(' '));
            regel.appendChild(b);
        }
        pv_afdelingKnop(regel, analyse, beste);
        return;
    }
    if (!ab.kandidaten.length) {
        regel.textContent = `"${analyse.afzender.tekst}" staat niet in het adresboek` + (huidig ? ` (nu: ${huidig}). ` : '. ');
        regel.appendChild(pv_nieuwContactKnop(analyse.afzender, null, analyse));
        return;
    }
    regel.textContent = beste ? 'Geadresseerde:' : `Meerdere contacten passen bij "${analyse.afzender.tekst}":`;
    (beste ? [beste] : ab.kandidaten.slice(0, 4)).forEach((k) => {
        const b = pv_knop(k.naam, !!beste);
        b.title = 'Kies dit contact in het adresboekveld (via het venster van Bricks).';
        b.addEventListener('click', async () => {
            b.disabled = true;
            const ok = await pv_kiesAdresboek(ab.query, k, false);
            b.disabled = false;
            if (ok) b.textContent = '✓ ' + k.naam;
            else { b.title = 'Lukte niet — kies het contact zelf via het vergrootglas.'; b.style.borderColor = '#c53030'; }
        });
        regel.appendChild(b);
    });
}

async function pv_adresboekAutomatisch(analyse) {
    const pogingen = pv_adresboekPogingen.get(analyse.berichtId) || 0;
    if (!analyse.afzender || pogingen >= 2) return;
    const beste = pv_adresboekBeste((analyse.adresboek || {}).kandidaten || []);
    if (!beste) return;
    // Bricks bouwt het paneel na het koppelen van een patiënt opnieuw op; even laten bijkomen.
    await new Promise((r) => setTimeout(r, 800));
    const pane = pv_paneel();
    if (!pane || pv_berichtIdUitUrl() !== analyse.berichtId || !pv_adresboekVervangbaar(pane, analyse)) return;
    if (pv_norm(pv_adresboekHuidig(pane)) === pv_norm(beste.naam)) return;
    pv_adresboekPogingen.set(analyse.berichtId, pogingen + 1);
    const ok = await pv_kiesAdresboek(analyse.adresboek.query, beste, true);
    if (ok) pv_adresboekPogingen.set(analyse.berichtId, 99);
    const paneNu = pv_paneel();
    const regel = document.querySelector('.' + PV_CARD_CLASS + ' .bi-pv-adresboek');
    if (regel) {
        regel.textContent = ok ? `✓ Geadresseerde ingevuld: ${beste.naam} (herkend uit "${analyse.afzender.tekst}"; controleer en sla op)`
            : `Geadresseerde "${beste.naam}" kon niet automatisch worden ingevuld; kies via het vergrootglas.`;
        if (ok) pv_afdelingKnop(regel, analyse, beste);
    }
}

// --- Kaart -----------------------------------------------------------------------------

function pv_knop(tekst, primair) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = tekst;
    b.style.cssText = 'border-radius:12px;padding:2px 10px;font-size:0.85em;cursor:pointer;margin:4px 6px 0 0;'
        + (primair ? 'border:1px solid #2f855a;background:#2f855a;color:#fff;' : 'border:1px solid #ccc;background:#f5f5f5;color:#333;');
    return b;
}

// --- Zwevend paneel -----------------------------------------------------------------------------------
// De kaart zweeft over de brief, aangemeerd tegen het koppelpaneel, zodat hij de samenvatting van Bricks
// nooit uit beeld duwt. De greep ("Infused") schuift het paneel weg naar het koppelpaneel toe of terug;
// die stand wordt onthouden.
//   - Koppelpaneel rechts (`.koppelinfo.vertical-view`): rechterkant tegen de linkerrand van het
//     koppelpaneel, onderkant gelijk met de onderkant van het samenvattingsvak.
//   - Koppelpaneel onderaan (`.koppelinfo`, `.ki-position-bottom`): onderkant op de (versleepbare)
//     scheidingslijn, rechterkant op de rand van het berichtblok.
// Hoogte = zo hoog als het voorstel; alleen bij te weinig ruimte (tot onder de kop "Bericht") scrollen.

const PV_ZWEEF_ID = 'bi-pv-zweef';
// Standaard uitgeklapt; ingeklapt blijft het alleen zolang je bij hetzelfde bericht bent.
let pv_zweefDicht = false;
let pv_zweefBericht = null;

function pv_isZwevend(pane) {
    return !pane.classList.contains('vertical-view');
}

function pv_zweefStand() {
    const z = document.getElementById(PV_ZWEEF_ID);
    if (!z) return;
    const inhoud = z.querySelector('.bi-pv-zweef-inhoud');
    const pijl = z.querySelector('.bi-pv-zweef-pijl');
    inhoud.style.width = pv_zweefDicht ? '0' : '360px';
    inhoud.style.padding = pv_zweefDicht ? '0' : '8px';
    pijl.textContent = pv_zweefDicht ? '«' : '»';
    z.querySelector('.bi-pv-zweef-greep').title = pv_zweefDicht ? 'Infused-voorstel tonen' : 'Infused-voorstel wegschuiven';
}

function pv_zweefPositie() {
    const z = document.getElementById(PV_ZWEEF_ID);
    const widget = document.querySelector('.widget-berichtdetails');
    const pane = pv_paneel();
    if (!z || !widget || !pane) return;
    const w = widget.getBoundingClientRect();
    let onder;
    let rechts;
    if (!pv_isZwevend(pane)) {
        // Koppelpaneel rechts: naast het samenvattingsvak, tegen de rand van het koppelpaneel.
        const vak = pane.querySelector('textarea.samenvatting');
        const blok = vak && (vak.closest('.koppelinfo-input-container') || vak);
        onder = Math.round(blok ? blok.getBoundingClientRect().bottom : w.bottom - 8);
        rechts = Math.round(pane.getBoundingClientRect().left) - 6;
    } else {
        const lijn = widget.querySelector('.bericht-resizebar');
        onder = Math.round(lijn ? lijn.getBoundingClientRect().top : w.bottom - 8);
        rechts = Math.round(w.right);
    }
    const ruimte = Math.max(120, onder - Math.round(w.top + 28));
    z.style.top = 'auto';
    z.style.bottom = Math.max(0, window.innerHeight - onder) + 'px';
    z.style.right = Math.max(0, window.innerWidth - rechts) + 'px';
    z.style.maxHeight = ruimte + 'px';
    const inhoud = z.querySelector('.bi-pv-zweef-inhoud');
    inhoud.style.height = 'auto';
    inhoud.style.maxHeight = ruimte + 'px';
}

// Meebewegen met versleepbare lijnen (brief/koppelpaneel, episodelijst/samenvatting) en vensterformaat.
let pv_zweefObserver = null;
function pv_volgBriefzone() {
    const details = document.querySelector('.widget-berichtdetails .berichtdetails') || document.querySelector('.widget-berichtdetails');
    const pane = pv_paneel();
    if (!details || (pv_zweefObserver && pv_zweefObserver.__details === details && pv_zweefObserver.__pane === pane)) return;
    if (pv_zweefObserver) pv_zweefObserver.disconnect();
    pv_zweefObserver = new ResizeObserver(() => pv_zweefPositie());
    pv_zweefObserver.__details = details;
    pv_zweefObserver.__pane = pane;
    pv_zweefObserver.observe(details);
    if (pane) {
        pv_zweefObserver.observe(pane);
        const vak = pane.querySelector('textarea.samenvatting');
        if (vak) pv_zweefObserver.observe(vak);
    }
}
window.addEventListener('resize', () => pv_zweefPositie());

function pv_zweefPaneel() {
    let z = document.getElementById(PV_ZWEEF_ID);
    if (z) {
        pv_volgBriefzone();
        pv_zweefPositie();
        return z;
    }
    z = document.createElement('div');
    z.id = PV_ZWEEF_ID;
    // Onder Bricks' eigen vensters blijven: .modal-container heeft z-index 50 (instellingen, adresboek, …).
    z.style.cssText = 'position:fixed;top:96px;right:0;z-index:40;display:flex;align-items:flex-end;'
        + 'max-height:calc(100vh - 190px);filter:drop-shadow(0 4px 12px rgba(0,0,0,0.18));';
    const greep = document.createElement('div');
    greep.className = 'bi-pv-zweef-greep';
    greep.style.cssText = 'cursor:pointer;background:#2f855a;color:#fff;border-radius:8px 0 0 8px;padding:10px 4px;'
        + 'display:flex;flex-direction:column;align-items:center;gap:6px;font-size:12px;font-weight:600;user-select:none;';
    greep.innerHTML = '<span class="bi-pv-zweef-pijl" style="font-size:14px;line-height:1;"></span>'
        + '<span style="writing-mode:vertical-rl;transform:rotate(180deg);letter-spacing:0.05em;">Infused</span>';
    greep.addEventListener('click', () => {
        pv_zweefDicht = !pv_zweefDicht;
        pv_zweefStand();
    });
    const inhoud = document.createElement('div');
    inhoud.className = 'bi-pv-zweef-inhoud';
    inhoud.style.cssText = 'background:#fff;overflow-y:auto;overflow-x:hidden;max-height:calc(100vh - 190px);'
        + 'box-sizing:border-box;transition:width 0.2s ease;';
    z.appendChild(greep);
    z.appendChild(inhoud);
    document.body.appendChild(z);
    pv_zweefStand();
    pv_volgBriefzone();
    pv_zweefPositie();
    return z;
}

function pv_verwijderKaart() {
    document.querySelectorAll('.' + PV_CARD_CLASS).forEach((n) => n.remove());
    const z = document.getElementById(PV_ZWEEF_ID);
    if (z) z.remove();
    if (pv_zweefObserver) { pv_zweefObserver.disconnect(); pv_zweefObserver = null; }
}

function pv_toonKaart(pane, analyse) {
    const ta = pane.querySelector('textarea.samenvatting');
    if (!ta) return null;

    const kaart = document.createElement('div');
    kaart.className = PV_CARD_CLASS;
    // grid-column: het paneel is (deels) een grid; de kaart moet de hele breedte nemen.
    kaart.style.cssText = 'grid-column:1 / -1;border:1px solid #b7d7c4;background:#f3faf6;border-radius:6px;padding:8px 10px;margin:6px 0 10px 0;font-size:0.9em;';

    const kop = document.createElement('div');
    kop.style.cssText = 'display:flex;justify-content:space-between;align-items:center;font-weight:600;color:#2f855a;';
    kop.textContent = `Infused-voorstel (${analyse.titel || 'lab'})`;
    const sluit = document.createElement('span');
    sluit.textContent = '×';
    sluit.title = 'Voorstel verbergen';
    sluit.style.cssText = 'cursor:pointer;color:#888;font-size:1.2em;padding:0 4px;';
    sluit.addEventListener('click', () => {
        pv_verborgen = kaart.dataset.sleutel || null;
        pv_verwijderKaart();
    });
    kop.appendChild(sluit);
    kaart.appendChild(kop);

    const patGeb = pv_patientGeboortedatum(pane);
    if (analyse.geboortedatum && patGeb && analyse.geboortedatum !== patGeb) {
        const waarsch = document.createElement('div');
        waarsch.textContent = `⚠ Geboortedatum in bericht (${analyse.geboortedatum}) wijkt af van gekoppelde patiënt (${patGeb}). Klopt de patiënt?`;
        waarsch.style.cssText = 'margin-top:4px;padding:4px 6px;background:#fff5f5;border:1px solid #feb2b2;border-radius:4px;color:#c53030;';
        kaart.appendChild(waarsch);
    }

    if (analyse.afzender) pv_toonAdresboekRegel(kaart, pane, analyse);

    const tekst = document.createElement('div');
    tekst.textContent = analyse.samenvatting || (analyse.titel === 'lab' ? 'Geen bepalingen herkend.' : 'Geen conclusie of beleid gevonden.');
    tekst.style.cssText = 'margin-top:4px;white-space:pre-wrap;color:#222;';
    kaart.appendChild(tekst);

    if (analyse.samenvatting) {
        const neem = pv_knop('Overnemen in samenvatting', true);
        neem.addEventListener('click', () => {
            if (pv_vulSamenvatting(pane, analyse.samenvatting)) {
                neem.textContent = '✓ Overgenomen — controleer en sla op';
                neem.disabled = true;
            }
        });
        kaart.appendChild(neem);
    }

    if (analyse.heeftPatient) {
        const epiRegel = document.createElement('div');
        epiRegel.style.cssText = 'margin-top:6px;color:#444;';
        if (!analyse.voorstellen.length) {
            epiRegel.textContent = 'Geen episodes gevonden.';
            kaart.appendChild(epiRegel);
        } else {
            epiRegel.textContent = 'Episode:';
            kaart.appendChild(epiRegel);
            analyse.voorstellen.forEach((v, i) => {
                const e = v.episode;
                const b = pv_knop(`${e.code} ${e.titel}` + (e.gekozen ? ' ✓' : ''), i === 0);
                b.title = `Voorgesteld op basis van ${v.reden}. Klik om deze episode te selecteren.`;
                b.addEventListener('click', () => {
                    if (!pv_selecteerEpisode(pane, e)) {
                        b.title = 'Niet gevonden in de episodelijst — selecteer handmatig.';
                        b.style.borderColor = '#c53030';
                    }
                });
                kaart.appendChild(b);
            });
        }
        if (analyse.nieuw && analyse.nieuw.length) {
            const nieuwRegel = document.createElement('div');
            nieuwRegel.style.cssText = 'margin-top:6px;color:#444;';
            nieuwRegel.textContent = 'Of nieuwe episode (opent het venster van Bricks):';
            kaart.appendChild(nieuwRegel);
            analyse.nieuw.forEach((icpc) => {
                const b = pv_knop(`+ ${icpc.code} ${icpc.omschrijving}`, false);
                b.addEventListener('click', async () => {
                    if (!(await pv_openNieuweEpisode(pane, icpc))) {
                        b.title = 'Venster niet gevonden — gebruik de + bij Episoden.';
                        b.style.borderColor = '#c53030';
                    }
                });
                kaart.appendChild(b);
            });
        }
    }

    const voet = document.createElement('div');
    voet.textContent = 'Er wordt niets opgeslagen; controleer en klik zelf op Opslaan.';
    voet.style.cssText = 'margin-top:6px;color:#888;font-size:0.85em;';
    kaart.appendChild(voet);

    // Nieuw bericht → paneel weer uitgeklapt.
    if (pv_zweefBericht !== analyse.berichtId) {
        pv_zweefBericht = analyse.berichtId;
        pv_zweefDicht = false;
    }
    // Altijd in het zwevende paneel (in beide layouts), zodat de samenvatting zichtbaar blijft.
    kaart.style.margin = '0';
    kaart.style.gridColumn = '';
    const inhoud = pv_zweefPaneel().querySelector('.bi-pv-zweef-inhoud');
    inhoud.innerHTML = '';
    inhoud.appendChild(kaart);
    pv_zweefStand();
    pv_zweefPositie();
    return kaart;
}

// --- Aansturing ----------------------------------------------------------------------------

function pv_berichtLaden(berichtId) {
    if (!pv_berichtCache.has(berichtId)) {
        pv_berichtCache.set(berichtId, bricksBridge.waitUntilReady().then(() => pv_leesBericht(berichtId)).catch((e) => {
            console.warn('Postverwerking: bericht lezen mislukt', e);
            return null;
        }));
    }
    return pv_berichtCache.get(berichtId);
}

async function pv_check() {
    if (pv_bezig) return;
    const berichtId = pv_berichtIdUitUrl();
    const pane = pv_paneel();
    if (!berichtId || !pane) {
        pv_verwijderKaart();
        return;
    }
    // Nog geen patiënt gekozen: Bricks toont dan geen samenvatting (dus geen kaart), maar de
    // geadresseerde staat los van de patiënt en kan al wel worden ingevuld.
    if (!pane.querySelector('textarea.samenvatting')) {
        pv_verwijderKaart();
        if (pv_adresboekPogingen.get(berichtId) >= 2) return;
        pv_bezig = true;
        try {
            const bericht = await pv_berichtLaden(berichtId);
            if (bericht && bericht.afzender && pv_berichtIdUitUrl() === berichtId) {
                if (bericht.afzender) bericht.adresboek = await pv_adresboekKandidaten(bericht.afzender);
                await pv_adresboekAutomatisch(Object.assign({ berichtId, opgeslagenContactId: bericht.opgeslagenContactId }, bericht));
            }
        } catch (e) {
            console.warn('Postverwerking: adresboek invullen mislukt', e);
        } finally {
            pv_bezig = false;
        }
        return;
    }

    // Opnieuw tekenen als bericht of episodelijst (= gekozen patiënt) verandert.
    const sleutel = berichtId + '|' + pv_leesEpisodes(pane).map((e) => e.code).join(',');
    const bestaand = document.querySelector('.' + PV_CARD_CLASS);
    // Zelfde bericht, zelfde episodes en de kaart staat in het zwevende paneel: positie bijwerken (layout kan wisselen).
    const goedePlek = bestaand && !!bestaand.closest('#' + PV_ZWEEF_ID);
    if (bestaand && bestaand.dataset.sleutel === sleutel && goedePlek) {
        pv_volgBriefzone();
        pv_zweefPositie();
        return;
    }
    if (pv_verborgen === sleutel) return;

    pv_bezig = true;
    try {
        const bericht = await pv_berichtLaden(berichtId);
        // Intussen naar een ander bericht gegaan?
        if (pv_berichtIdUitUrl() !== berichtId) return;
        const paneNu = pv_paneel();
        if (!paneNu) return;
        pv_verwijderKaart();
        if (!bericht) return;
        // Adresboek altijd opnieuw doorzoeken (niet uit de cache): intussen kan er een contact zijn
        // aangemaakt of verwijderd — anders vond Infused een net aangemaakt contact pas na verversen.
        if (bericht.afzender) {
            bericht.adresboek = await pv_adresboekKandidaten(bericht.afzender);
            if (pv_berichtIdUitUrl() !== berichtId) return;
        }
        const episodes = pv_leesEpisodes(paneNu);
        const analyse = pv_analyseer(bericht, episodes);
        const kaart = pv_toonKaart(paneNu, analyse);
        if (kaart) kaart.dataset.sleutel = berichtId + '|' + episodes.map((e) => e.code).join(',');
        if (kaart && bericht.afzender) {
            pv_adresboekAutomatisch(analyse).catch((e) => console.warn('Postverwerking: adresboek invullen mislukt', e));
        }
    } finally {
        pv_bezig = false;
    }
}

loadGlobalOptions(function (options) {
    pv_opties = options || {};
    if (pv_opties.postverwerkingLab === false && pv_opties.postverwerkingBrief === false) return;
    let timer = null;
    const observer = new MutationObserver(() => {
        if (timer) return;
        timer = setTimeout(() => { timer = null; pv_check(); }, 300);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    // Opties gewijzigd (bv. kopjes of weg te laten blokken): opnieuw analyseren zonder verversen.
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'sync') return;
        Object.keys(changes).forEach((k) => { pv_opties[k] = changes[k].newValue; });
        pv_berichtCache.clear();
        pv_verborgen = null;
        pv_verwijderKaart();
        pv_check();
    });
    pv_check();
});
