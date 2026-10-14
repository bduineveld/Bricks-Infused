/////////////////////////////// POSTVERWERKING (BRIEVEN) /////////////////////////////////////////////////////////////
// Geladen vóór content_postverwerking.js; die roept pv_briefAnalyse() aan voor alles wat geen lab is.
//
// Herkent het soort brief (radiologie, scopie, PA, kweek, HAP, GGZ, MDO, opname, meedenkadvies,
// ambulance, ergotherapie, JGZ, operatie, of een gewone specialistenbrief), haalt de relevante
// secties eruit en maakt daar een samenvattingsvoorstel van. Geïnspireerd op Dokkie (HealthConnected),
// zelf geschreven. Nog niet getest op echte berichten van deze typen — alleen op de demo-brief.

// Koppen die een sectie afsluiten (en zelf ook een sectie kunnen zijn).
const PV_KOPPEN = [
    'anamnese', 'lichamelijk onderzoek', 'aanvullend onderzoek', 'onderzoek', 'laboratorium', 'lab',
    'medicatie', 'medicatie bij ontslag', 'ontslagmedicatie', 'voorgeschiedenis', 'conclusie', 'beleid',
    'advies', 'bespreking', 'discussie', 'diagnose', 'werkdiagnose', 'plan', 'indicatie', 'reden van verwijzing',
    'reden van opname', 'reden van komst', 'vraagstelling', 'vraag', 'antwoord', 'beantwoording', 'beloop',
    'samenvatting', 'follow-up', 'controle', 'betreft', 'bevindingen', 'verslag', 'macroscopie', 'microscopie',
    'klinische gegevens', 'impressie', 'beoordeling', 'overwegingen', 'behandeling', 'behandeldoel',
    'hulpvraag', 'gebeurtenis', 'materiaal', 'uitslag', 'resultaat', 'opmerking', 'bijlage', 'addendum'
];
const PV_GROET = /^(met\s+)?(vriendelijke|collegiale|hartelijke)\s+groet|^hoogachtend|^met collegiale hoogachting/i;
// Ondertekening/autorisatie: einde van een sectie ("Patholoog: dr. Z", "Beoordeeld door: …").
const PV_ONDERTEKEND = /^(patholoog|radioloog|arts|specialist|behandelaar|(beoordeeld|geautoriseerd|gevalideerd|gedicteerd|getypt)\s+door)\s*:/i;

// --- Koppelpaneel ------------------------------------------------------------------------------
// Bricks toont het koppelpaneel rechts (`.koppelinfo.vertical-view`) of onderaan (`.koppelinfo`, in
// `.widget-berichtdetails.ki-position-bottom`) — een layoutinstelling per gebruiker. Beide ondersteunen.
function pv_paneel() {
    return document.querySelector('.koppelinfo.vertical-view') || document.querySelector('.koppelinfo');
}

// --- Tekst --------------------------------------------------------------------------------------

function pv_htmlNaarTekst(html) {
    const doc = new DOMParser().parseFromString(html || '', 'text/html');
    const BLOK = /^(DIV|P|TR|LI|H[1-6]|TABLE|PRE|UL|OL|BLOCKQUOTE|SECTION)$/;
    let uit = '';
    (function loop(node) {
        node.childNodes.forEach((n) => {
            if (n.nodeType === Node.TEXT_NODE) { uit += n.data; return; }
            if (n.nodeType !== Node.ELEMENT_NODE) return;
            if (n.tagName === 'BR') { uit += '\n'; return; }
            if (n.tagName === 'TD' || n.tagName === 'TH') { loop(n); uit += '  '; return; }
            const blok = BLOK.test(n.tagName);
            if (blok) uit += '\n';
            loop(n);
            if (blok) uit += '\n';
        });
    })(doc.body);
    return uit.replace(/\r/g, '').replace(/ /g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n')
        // Bricks zet voor onleesbare berichten een eigen inleiding erboven.
        .replace(/^\s*Dit bericht kan niet verwerkt worden[^\n]*\n/i, '')
        .trim();
}

// Kleine letters zonder accenten, maar regeleinden blijven staan (typeherkenning kijkt naar regelbegin).
function pv_normRegels(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[ \t]+/g, ' ');
}

function pv_regels(tekst) {
    return tekst.split('\n').map((r) => r.trim());
}

// --- Instellingen (opties → pv_opties, gezet door content_postverwerking.js) ----------------------
// postKopjes:   { conclusie: [...], beleid: [...], advies: [...], reden: [...], diagnose: [...] }
//               extra kopwoorden van de praktijk, AANVULLEND op wat hier al staat.
// postTypenUit: ['Radiologie', ...]                 typen zonder voorstel
// postWeglaten: { Specialistenbrief: ['Advies huisarts'], ... }   blokken die niet in de samenvatting komen

function pv_extraKopjes(groep) {
    const k = (typeof pv_opties !== 'undefined' && pv_opties.postKopjes) || {};
    return (k[groep] || []).map((w) => String(w).toLowerCase().trim()).filter(Boolean);
}

function pv_alleExtraKopjes() {
    return ['conclusie', 'beleid', 'advies', 'reden', 'diagnose'].flatMap(pv_extraKopjes);
}

// Welke groep een labellijst is; volgorde telt ("conclusie/beleid" is een conclusielijst).
function pv_kopGroep(labels) {
    const l = labels.map((x) => x.toLowerCase());
    if (l.some((x) => /^(conclusie|c\/|bespreking|discussie|indruk|beoordeling)/.test(x))) return 'conclusie';
    if (l.some((x) => /^(beleid|b\/|plan|behandelbeleid)/.test(x))) return 'beleid';
    if (l.some((x) => /^(advies|antwoord|beantwoording|verzoek aan)/.test(x))) return 'advies';
    if (l.some((x) => /^(reden|vraag|vraagstelling|indicatie)/.test(x))) return 'reden';
    if (l.some((x) => /diagnose|dsm/.test(x))) return 'diagnose';
    return null;
}

// Kop = precies een bekende kop ("Beleid", "BELEID:"), of een langere kop die met een bekende kop
// begint en eindigt op ":" of in HOOFDLETTERS staat. "Controle over 3 maanden" is dus geen kop.
function pv_isKop(regel) {
    const kaal = regel.replace(/:\s*$/, '').trim();
    const r = kaal.toLowerCase();
    if (!r || r.length > 45) return false;
    const koppen = PV_KOPPEN.concat(pv_alleExtraKopjes());
    if (koppen.includes(r)) return true;
    const begintMetKop = koppen.some((k) => r.startsWith(k + ' ') || r.startsWith(k + '/'));
    return begintMetKop && (/:\s*$/.test(regel) || (kaal === kaal.toUpperCase() && /[A-Z]/.test(kaal)));
}

// Zoekt een sectie op label. Label staat op een eigen regel ("Conclusie" / "CONCLUSIE:") of
// inline ("Conclusie: tekst"). Neemt de volgende regels mee tot een lege regel, een nieuwe kop
// of een groet. opts.laatste: neem de laatste match (brieven herhalen soms koppen).
function pv_sectie(regels, labels, opts) {
    opts = opts || {};
    const groep = pv_kopGroep(labels);
    if (groep) {
        // Extra kopjes van de praktijk erbij; lang vóór kort zodat "conclusie en beleid" vóór "conclusie" gaat.
        labels = Array.from(new Set(labels.concat(pv_extraKopjes(groep)))).sort((a, b) => b.length - a.length);
    }
    const max = opts.max || 12;
    // Label gevolgd door ':' of '/' ("Conclusie/ tekst", "Beleid/"), of alleen op de regel.
    const re = new RegExp('^(?:' + labels.map((l) => l.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')).join('|') + ')\\s*(?:[:/]\\s*(.*)|\\s*$)', 'i');
    let gevonden = null;
    for (let i = 0; i < regels.length; i++) {
        const m = regels[i].match(re);
        if (!m) continue;
        const delen = [];
        if (m[1] && m[1].trim()) delen.push(m[1].trim());
        for (let j = i + 1; j < regels.length && delen.length < max; j++) {
            const r = regels[j];
            if (!r) { if (delen.length) break; continue; }
            if (PV_GROET.test(r) || PV_ONDERTEKEND.test(r) || pv_isKop(r) || /^[A-Za-zÀ-ÿ /-]{2,30}:\s/.test(r) && pv_isKop(r.split(':')[0] + ':')) break;
            delen.push(r);
        }
        if (delen.length) {
            gevonden = delen.join(' ').replace(/\s+/g, ' ').trim();
            if (!opts.laatste) break;
        }
    }
    return gevonden;
}

function pv_eerste(regels, labelSets, opts) {
    for (const labels of labelSets) {
        const s = pv_sectie(regels, labels, opts);
        if (s) return s;
    }
    return null;
}

function pv_zin(s) {
    if (!s) return '';
    s = s.trim();
    return /[.!?)]$/.test(s) ? s : s + '.';
}

function pv_hoofdletter(s) {
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

// --- Afzender / specialisme ----------------------------------------------------------------------

const PV_SPECIALISMEN = [
    'internist', 'interne geneeskunde', 'cardioloog', 'cardiologie', 'longarts', 'longziekten', 'neuroloog', 'neurologie',
    'chirurg', 'chirurgie', 'orthopeed', 'orthopedie', 'uroloog', 'urologie', 'gynaecoloog', 'gynaecologie',
    'kinderarts', 'kindergeneeskunde', 'dermatoloog', 'dermatologie', 'kno-arts', 'keel-, neus- en oorheelkunde',
    'oogarts', 'oogheelkunde', 'mdl-arts', 'maag-, darm- en leverziekten', 'reumatoloog', 'reumatologie',
    'geriater', 'geriatrie', 'psychiater', 'psychiatrie', 'revalidatiearts', 'plastisch chirurg', 'anesthesioloog',
    'radioloog', 'radiologie', 'patholoog', 'pathologie', 'arts-microbioloog', 'microbiologie', 'specialist ouderengeneeskunde',
    'sportarts', 'klinisch geriater', 'nefroloog', 'nefrologie', 'endocrinoloog', 'hematoloog', 'oncoloog', 'vaatchirurg'
];

function pv_specialisme(regels) {
    const tekst = regels.join('\n');
    let m = tekst.match(/(?:^|\n)\s*specialisme\s*:\s*([^\n]{3,40})/i);
    if (m) return m[1].trim();
    m = tekst.match(/\b(?:polikliniek|poli)\s+([A-Za-zÀ-ÿ\- ]{4,35}?)(?=[\n,.]|\s+(?:van|te|in|op|bij)\b)/i);
    if (m) return pv_hoofdletter(m[1].trim());
    // Ondertekening: "dr. A. Jansen, internist" of naam met functie op de volgende regel.
    const groet = regels.findIndex((r) => PV_GROET.test(r));
    if (groet >= 0) {
        const onder = regels.slice(groet, groet + 8).join(' ').toLowerCase();
        for (const s of PV_SPECIALISMEN) {
            if (new RegExp('\\b' + s.replace(/[-,]/g, '.') + '\\b').test(onder)) return pv_hoofdletter(s);
        }
    }
    for (const s of PV_SPECIALISMEN) {
        if (new RegExp('\\b' + s.replace(/[-,]/g, '.') + '\\b', 'i').test(regels.slice(0, 15).join(' '))) return pv_hoofdletter(s);
    }
    return '';
}

// --- Typen ---------------------------------------------------------------------------------------
// Volgorde = voorrang (eerste match wint), zoals Dokkie: specifieke typen vóór de algemene brief.
// type + blokken staan ook in PV_TYPEN_OPTIES (options.js) voor de instellingenpagina: houd gelijk.

// ZorgDomein-terugkoppeling: kopie van de eigen verwijzing, begint met "ZD<nummer>" en "verwijsbrief".
const PV_ZD_TERUGKOPPELING = /^\s*zd\d{5,}\s*\n?\s*verwijsbrief/;

const PV_BRIEFTYPEN = [
    {
        type: 'ZorgDomein-terugkoppeling',
        blokken: [],
        test: (t) => PV_ZD_TERUGKOPPELING.test(t),
        maak: (r) => {
            const reden = pv_eerste(r, [['reden van verwijzing', 'vraagstelling', 'verwijsreden', 'vraag', 'specialisme']], { max: 3 });
            return ['ZorgDomein-verwijzing' + (reden ? ': ' + pv_zin(reden) : '.')];
        }
    },
    {
        type: 'GGZ',
        blokken: ['Recent', 'Beleid'],
        test: (t) => (t.match(/dsm-?5|beschrijvende diagnose|behandelbeleid|tussentijds bericht huisarts|samenvatting behandeling|regiebehandelaar/g) || []).length >= 2,
        maak: (r) => {
            const diag = pv_eerste(r, [['dsm-5 classificatie', 'dsm-5', 'beschrijvende diagnose', 'diagnose']], { max: 3 });
            const recent = pv_eerste(r, [['samenvatting behandeling', 'beloop']], { max: 4 });
            const beleid = pv_eerste(r, [['behandelbeleid', 'beleid', 'advies']], { max: 6 });
            return ['GGZ' + (diag ? ': ' + pv_zin(diag) : '.'), recent && 'Recent: ' + pv_zin(recent), beleid && 'Beleid: ' + pv_zin(beleid)];
        },
        diagnose: (r) => pv_eerste(r, [['dsm-5 classificatie', 'dsm-5', 'beschrijvende diagnose', 'diagnose']], { max: 2 })
    },
    {
        type: 'Ergotherapie',
        blokken: ['Hulpvraag', 'Doelen'],
        test: (t) => /ergotherap/.test(t) && /eindverslag|tussentijds verslag|behandelperiode|behandeldoelen|ergotherapeutische conclusie/.test(t),
        maak: (r, t) => {
            const soort = (t.match(/\b(eindverslag|tussentijds verslag|startverslag)\b/) || [])[1];
            const hulpvraag = pv_sectie(r, ['hulpvraag'], { max: 3 });
            const doelen = (t.match(/doelen\s+(?:zijn\s+)?(?:grotendeels\s+|deels\s+|volledig\s+)?behaald[^\n.]*/) || [])[0];
            const afgerond = /(behandeling|ergotherapie)\s+(is\s+)?(afgerond|afgesloten)/.test(t);
            return [pv_hoofdletter((soort ? soort + ' ' : '') + 'ergotherapie.'), hulpvraag && 'Hulpvraag: ' + pv_zin(hulpvraag),
                doelen && pv_zin(pv_hoofdletter(doelen)), afgerond && 'Behandeling afgerond.'];
        }
    },
    {
        type: 'JGZ',
        blokken: [],
        test: (t) => /\b(jgz|jeugdgezondheidszorg|jeugdarts|jeugdverpleegkundige|rijksvaccinatieprogramma)\b/.test(t),
        maak: (r, t) => {
            const vacc = t.match(/gevaccineerd\s+tegen\s+([^\n.]+)/);
            return [vacc ? 'JGZ: gevaccineerd tegen ' + pv_zin(vacc[1]) : 'Bericht van de JGZ.',
                pv_eerste(r, [['conclusie', 'advies', 'verzoek']], { max: 4 })];
        }
    },
    {
        type: 'MDO',
        blokken: ['Reden', 'Conclusie', 'Advies'],
        test: (t) => (t.match(/verslag\s+\S+\s+bespreking|datum mdo|deelnemerslijst|conclusie en advies bij|multidisciplina/g) || []).length >= 2,
        maak: (r) => {
            const reden = pv_sectie(r, ['reden bespreking', 'reden van bespreking', 'vraagstelling'], { max: 3 });
            const concl = pv_eerste(r, [['conclusie bij de bespreking', 'conclusie en advies bij bespreking', 'conclusie']], { max: 8, laatste: true });
            const advies = pv_sectie(r, ['advies na bespreking', 'advies', 'beleid'], { max: 6 });
            return ['MDO-bespreking.', reden && 'Reden: ' + pv_zin(reden), concl && 'Conclusie: ' + pv_zin(concl), advies && 'Advies: ' + pv_zin(advies)];
        }
    },
    {
        type: 'Waarneembericht',
        blokken: ['(E)', '(P)'],
        test: (t) => [/\([sp]\)\s*\[[a-z]+\]/.test(t), /telefonische triage|fysieke triage|hulpvraag|klacht\/beloop/.test(t),
            /spoedpost|huisartsenpost|\bhap\b|waarneem/.test(t)].filter(Boolean).length >= 2,
        maak: (r, t, ruw) => {
            const diag = (ruw.match(/^\s*diagnose:\s*(.+)$/im) || [])[1];
            const blok = (letter) => {
                const m = ruw.match(new RegExp('\\(' + letter + '\\)\\s*(?:\\[[A-Z]+\\])?\\s*([\\s\\S]+?)(?=\\n\\s*\\([SOEP]\\)|\\n\\s*(?:Telefonische triage|Fysieke triage|Samenvatting triage)|$)', 'i'));
                return m ? m[1].replace(/\s+/g, ' ').trim() : '';
            };
            const e = blok('E');
            const p = blok('P');
            return ['HAP' + (diag ? ': ' + pv_zin(diag) : '.'), !diag && e && '(E) ' + pv_zin(e), p && '(P) ' + pv_zin(p)];
        },
        diagnose: (r, t, ruw) => (ruw.match(/^\s*diagnose:\s*(.+)$/im) || [])[1]
    },
    {
        type: 'Operatieverslag',
        blokken: ['Conclusie', 'Beleid'],
        test: (t) => /operatiedatum|operatieverslag|verrichting\(en\)|postoperatieve conclusie/.test(t.slice(0, 1200))
            && !/reden van opname|medicatie bij ontslag|opgenomen op de afdeling/.test(t.slice(0, 2500)),
        maak: (r) => {
            const verr = pv_eerste(r, [['verrichting(en)', 'verrichting', 'ingreep', 'operatie']], { max: 2 });
            const concl = pv_eerste(r, [['postoperatieve conclusie', 'conclusie', 'postoperatieve diagnose']], { max: 4 });
            const beleid = pv_eerste(r, [['postoperatief beleid', 'beleid', 'advies']], { max: 5 });
            return ['Operatie' + (verr ? ': ' + pv_zin(verr) : '.'), concl && 'Conclusie: ' + pv_zin(concl), beleid && 'Beleid: ' + pv_zin(beleid)];
        }
    },
    {
        type: 'Pathologie',
        blokken: [],
        test: (t) => /pathologisch onderzoek|patholoog|afd\.? pathologie|pathologische anatomie/.test(t) && /(^|\n)\s*(macroscopie|microscopie)/.test(t),
        maak: (r) => {
            const concl = pv_sectie(r, ['conclusie', 'pa-conclusie', 'diagnose'], { max: 10, laatste: true });
            return ['PA-uitslag' + (concl ? ': ' + pv_zin(concl) : '.')];
        },
        diagnose: (r) => pv_sectie(r, ['conclusie', 'diagnose'], { max: 3, laatste: true })
    },
    {
        type: 'Scopie',
        blokken: ['Indicatie', 'Conclusie', 'Advies'],
        test: (t) => /\b(colo(?:no)?scopie|gastroscopie|sigmo[iï]doscopie|duodenoscopie|bronchoscopie|hysteroscopie|cystoscopie|artroscopie|arthroscopie|enteroscopie|rectoscopie|oesofagoscopie)\b/.test(t.slice(0, 800)),
        maak: (r, t) => {
            const naam = pv_hoofdletter((t.slice(0, 800).match(/\b(colo(?:no)?scopie|gastroscopie|sigmo[iï]doscopie|duodenoscopie|bronchoscopie|hysteroscopie|cystoscopie|artroscopie|arthroscopie|enteroscopie|rectoscopie|oesofagoscopie)\b/) || [])[1] || 'Scopie');
            const ind = pv_sectie(r, ['indicatie'], { max: 2 });
            const concl = pv_sectie(r, ['conclusie', 'diagnose'], { max: 7 });
            const advies = pv_sectie(r, ['advies', 'voorlopig advies', 'beleid'], { max: 5 });
            return [naam + '.', ind && 'Indicatie: ' + pv_zin(ind), concl && 'Conclusie: ' + pv_zin(concl), advies && 'Advies: ' + pv_zin(advies)];
        }
    },
    {
        type: 'Radiologie',
        blokken: [],
        test: (t) => /radiologiebericht|uitgevoerde onderzoeken|\bradiolo/.test(t) && /(conclusie|indruk|beoordeling)/.test(t),
        maak: (r, t) => {
            const m = t.match(/(?:^|\n)\s*((?:echo|echografie|mri|ct|cta|röntgen|rontgen|rtg|x-?thorax|thorax|mammografie|dexa|pet-?ct)(?:[ -][a-zà-ÿ]+){0,3})\s*:/);
            const onderzoek = m ? pv_hoofdletter(m[1]) : '';
            const concl = pv_eerste(r, [['conclusie', 'indruk', 'beoordeling']], { max: 8, laatste: true });
            return [(onderzoek ? onderzoek + ': ' : 'Radiologie: ') + (concl ? pv_zin(concl) : 'zie verslag.')];
        },
        diagnose: (r) => pv_eerste(r, [['conclusie', 'indruk', 'beoordeling']], { max: 3, laatste: true })
    },
    {
        type: 'Kweek',
        blokken: ['Resistentie'],
        test: (t) => /streeklab|microbiolog/.test(t) || /(^|\n)\s*(bacteriologie|virologie|mycologie|parasitologie)\s*(\/|\n|$)/.test(t),
        maak: (r) => {
            const materiaal = (r.find((x) => /^materiaal\b/i.test(x)) || '').replace(/^materiaal\s*:?\s*/i, '');
            // Uitslagregels: positief gaat voor; puur negatieve regels alleen als er niets positiefs is.
            const uitslag = r.filter((x) => /\b(groei|aangetoond|positief|negatief|pos\b|neg\b|reactief|kve|cfu|\d+\s*x\s*10)/i.test(x) && x.length < 160);
            const positief = uitslag.filter((x) => !/\b(geen groei|niet aangetoond|negatief|neg\b)/i.test(x));
            const resistentie = r.filter((x) => /^\s*(amoxicilline|amoxi.?clav|nitrofurantoine|fosfomycine|trimethoprim|cotrimoxazol|ciprofloxacine|cefuroxim|doxycycline|claritromycine|flucloxacilline)\b.*\b[RSI]\b/i.test(x));
            const regels = (positief.length ? positief : uitslag).slice(0, 6);
            return ['Kweek' + (materiaal ? ' ' + materiaal : '') + ': ' + (regels.length ? regels.join('; ') : 'zie uitslag') + '.',
                resistentie.length && 'Resistentie: ' + resistentie.map((x) => x.replace(/\s+/g, ' ')).join('; ') + '.'];
        }
    },
    {
        type: 'Ambulance',
        blokken: [],
        test: (t) => /regionale ambulance|ritformulier|\bambulancedienst\b/.test(t),
        maak: (r) => {
            const g = pv_sectie(r, ['gebeurtenis', 'reden van inzet', 'bevindingen'], { max: 4 });
            return ['Ambulance' + (g ? ': ' + pv_zin(g) : '.')];
        }
    },
    {
        type: 'Meedenkadvies',
        blokken: ['Vraag', 'Advies', 'Beleid'],
        test: (t) => (/(^|\n)\s*vraag\s*:/.test(t) && /(^|\n)\s*(antwoord|advies|beantwoording)\s*:/.test(t))
            || /\b(meedenkconsult|meedenkadvies|teleconsult|meekijkconsult)\b/.test(t) && !/(^|\n)\s*(anamnese|lichamelijk onderzoek)\s*:?\s*\n/.test(t),
        maak: (r) => {
            const vraag = pv_sectie(r, ['vraag', 'vraagstelling', 'reden van aanvraag', 'reden van verwijzing'], { max: 4 });
            const antw = pv_eerste(r, [['antwoord', 'beantwoording', 'advies', 'conclusie']], { max: 8 });
            const beleid = pv_sectie(r, ['beleid'], { max: 5 });
            return ['Meedenkadvies' + (pv_specialisme(r) ? ' ' + pv_specialisme(r).toLowerCase() : '') + '.', vraag && 'Vraag: ' + pv_zin(vraag),
                antw && 'Advies: ' + pv_zin(antw), beleid && 'Beleid: ' + pv_zin(beleid)];
        }
    },
    {
        type: 'Opname',
        blokken: ['Reden', 'Conclusie', 'Beleid'],
        test: (t) => /reden van opname|opgenomen (?:op|van)\b/.test(t),
        maak: (r) => {
            const reden = pv_sectie(r, ['reden van opname'], { max: 3 });
            const concl = pv_eerste(r, [['conclusie bij ontslag', 'ontslagdiagnose', 'conclusie', 'diagnose', 'beloop']], { max: 6, laatste: true });
            const beleid = pv_eerste(r, [['beleid bij ontslag', 'beleid', 'advies aan de huisarts', 'advies']], { max: 6 });
            const spec = pv_specialisme(r);
            return ['Opname' + (spec ? ' (' + spec.toLowerCase() + ')' : '') + '.', reden && 'Reden: ' + pv_zin(reden),
                concl && 'Conclusie: ' + pv_zin(concl), beleid && 'Beleid: ' + pv_zin(beleid)];
        }
    },
    {
        type: 'Specialistenbrief',
        blokken: ['Beleid', 'Advies huisarts'],
        test: () => true,
        maak: (r) => {
            const concl = pv_eerste(r, [['conclusie/beleid', 'conclusie en beleid', 'conclusie/discussie', 'discussie/conclusie', 'bespreking/conclusie'],
                ['conclusie', 'c/', 'bespreking', 'discussie', 'beoordeling', 'indruk', 'samenvatting en werkdiagnose', 'werkdiagnose', 'diagnose']], { max: 8, laatste: true });
            const beleid = pv_eerste(r, [['beleid en vervolgafspraken', 'beleid', 'b/', 'plan']], { max: 6 });
            const advies = pv_sectie(r, ['advies aan de huisarts', 'adviezen aan de huisarts', 'verzoek aan de huisarts', 'vraag aan de huisarts', 'advies huisarts'], { max: 5 });
            const spec = pv_specialisme(r);
            const kop = spec ? pv_hoofdletter(spec) + ': ' : '';
            if (!concl && !beleid) return [];
            return [kop + (concl ? pv_zin(concl) : ''), beleid && 'Beleid: ' + pv_zin(beleid),
                advies && pv_norm(advies) !== pv_norm(beleid) && 'Advies huisarts: ' + pv_zin(advies)];
        }
    }
];

// --- Episode-voorstel bij brieven ------------------------------------------------------------------
// Eerst de bestaande episodes (titel- en synoniemmatch met diagnose/conclusie), dan ICPC-suggesties
// via Bricks' eigen ICPC-zoekfunctie (ICPC.Zoek) voor een NIEUWE episode — die alleen het
// "Episode toevoegen"-dialoog opent; de huisarts slaat zelf op.

const PV_SYNONIEMEN = [
    [/\bdm\s*(ii|2)\b|diabetes/, 'T90'], [/hypertensie|hoge bloeddruk|\bht\b/, 'K86'], [/\bcopd\b/, 'R95'], [/astma/, 'R96'],
    [/atriumfibrilleren|\baf\b|boezemfibrilleren/, 'K78'], [/hartfalen|decompensatio/, 'K77'], [/angina pectoris|\bap\b/, 'K74'],
    [/myocardinfarct|\bstemi\b|\bnstemi\b|hartinfarct/, 'K75'], [/\btia\b/, 'K89'], [/\bcva\b|herseninfarct/, 'K90'],
    [/claudicatio|perifeer arterieel vaatlijden|\bpav\b/, 'K92'], [/hypothyre/, 'T86'], [/hyperthyre/, 'T85'],
    [/hypercholesterol|dyslipid/, 'T93'], [/gonartrose|artrose knie/, 'L90'], [/coxartrose|artrose heup/, 'L89'],
    [/artrose/, 'L91'], [/osteoporose/, 'L95'], [/depressi/, 'P76'], [/angststoornis|paniekstoornis/, 'P74'],
    [/\bcns\b|chronische nierschade|nierinsufficientie/, 'U99'], [/anemie/, 'B80'], [/obesitas|adipositas/, 'T82'],
    [/jicht/, 'T92'], [/migraine/, 'N89'], [/prostaathypertrofie|\bbph\b/, 'Y85'], [/reflux|gerd/, 'D84']
];
const PV_STOPWOORDEN = new Set(['voor', 'naar', 'door', 'over', 'onder', 'tegen', 'tussen', 'omdat', 'deze', 'maar', 'wegens',
    'vanwege', 'tijdens', 'heeft', 'hebben', 'wordt', 'worden', 'zijn', 'waren', 'goed', 'ingesteld', 'stabiel', 'controle',
    'patient', 'patiente', 'mevrouw', 'meneer', 'links', 'rechts', 'beiderzijds', 'geen', 'verdere', 'verder', 'huisarts',
    'beleid', 'conclusie', 'ophogen', 'starten', 'gestart', 'bekend', 'recidief', 'klachten', 'status', 'type',
    'graad', 'acute', 'chronische', 'andere', 'verwijderd', 'normaal', 'afwijkingen', 'aanwijzingen']);

function pv_woorden(s) {
    return pv_norm(s).replace(/[^a-z0-9 ]/g, ' ').split(' ').filter((w) => w.length > 4 && !PV_STOPWOORDEN.has(w));
}

function pv_briefEpisodeMatch(tekst, episodes) {
    const t = pv_norm(tekst);
    const codes = PV_SYNONIEMEN.filter(([re]) => re.test(t)).map(([, c]) => c);
    const woorden = pv_woorden(tekst);
    let beste = null;
    episodes.forEach((e, i) => {
        let score = 0;
        if (codes.some((c) => e.code.toUpperCase().startsWith(c))) score += 10;
        const titel = pv_norm(e.titel);
        woorden.forEach((w) => { if (titel.includes(w)) score += 3; });
        score -= i * 0.01; // bij gelijke stand: de meest recente
        if (score > 0 && (!beste || score > beste.score)) beste = { episode: e, score };
    });
    return beste ? beste.episode : null;
}

async function pv_icpcSuggesties(tekst) {
    const t = pv_norm(tekst);
    const zoek = [];
    PV_SYNONIEMEN.forEach(([re, code]) => { if (re.test(t)) zoek.push(code); });
    pv_woorden(tekst).slice(0, 3).forEach((w) => zoek.push(w));
    const gezien = new Set();
    const uit = [];
    for (const q of zoek) {
        if (uit.length >= 3) break;
        let res = [];
        try {
            res = pv_rv(await bricksBridge.doApi('ICPC', 'Zoek', { query: q }, true)) || [];
        } catch (e) {
            continue;
        }
        res.filter((x) => x && x.Code && !x.Vervallen).slice(0, 3).forEach((x) => {
            if (gezien.has(x.Code) || uit.length >= 3) return;
            gezien.add(x.Code);
            uit.push({ code: x.Code, omschrijving: x.Omschrijving });
        });
    }
    return uit;
}

// --- Analyse ---------------------------------------------------------------------------------------

// Geboortedatum die in de brief zelf staat ("geb. 15-05-1958", "geboortedatum: 15-05-1958").
function pv_geboortedatumUitTekst(tekst) {
    const m = tekst.match(/\b(?:geb\.?|geboren|geboortedatum|geb\.datum)\s*:?\s*(?:op\s+)?(\d{1,2})[-./–](\d{1,2})[-./–](\d{4})/i);
    return m ? `${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}-${m[3]}` : null;
}

// Wordt aangeroepen met de BerichtInfo; levert het "bericht"-object voor content_postverwerking.js.
async function pv_briefAnalyse(info) {
    const ruw = pv_htmlNaarTekst(info.HTML);
    if (!ruw || ruw.length < 40) return null;
    const regels = pv_regels(ruw);
    const t = pv_normRegels(ruw);
    const def = PV_BRIEFTYPEN.find((d) => d.test(t));
    if ((pv_opties.postTypenUit || []).includes(def.type)) return null;
    // Blokken die de gebruiker bij dit type niet wil ("Beleid: …", "(P) …"); de kopregel blijft altijd.
    const weg = ((pv_opties.postWeglaten || {})[def.type] || []);
    const isWeg = (deel) => weg.some((b) => deel.startsWith(b + ':') || deel.startsWith(b + ' '));
    const delen = def.maak(regels, t, ruw).filter(Boolean).filter((d, i) => i === 0 || !isWeg(d));
    const samenvatting = delen.join('\n').trim();
    const diagnoseTekst = (def.diagnose && def.diagnose(regels, t, ruw))
        || pv_eerste(regels, [['diagnose', 'werkdiagnose', 'conclusie', 'c/']], { max: 3, laatste: true })
        || '';
    // Radiologie, kweek en PA: de afzender is de instelling + afdeling (geen ondertekening door een
    // persoon). Anders de persoon uit het bericht/ondertekening, met de instelling als terugval.
    const instelling = pv_instellingUitInfo(info);
    const persoon = ['Radiologie', 'Kweek', 'Pathologie'].includes(def.type) ? null
        : (pv_afzenderUitInfo(info) || pv_afzenderUitTekst(regels));
    // ZorgDomein-terugkoppeling: afzender is de eigen praktijk (instelbaar adresboekcontact).
    const zdContact = String(pv_opties.postZdContact || '').trim();
    const afzender = def.type === 'ZorgDomein-terugkoppeling'
        ? (zdContact ? { soort: 'vast', tekst: zdContact, naamDeel: zdContact, initialen: '', achternaam: '', functie: '', instelling: null } : null)
        : (persoon || pv_afzenderInstelling(instelling));
    if (persoon) persoon.instelling = instelling;
    return {
        soort: 'brief',
        type: def.type,
        samenvatting,
        diagnoseTekst,
        afzender,
        adresboek: await pv_adresboekKandidaten(afzender),
        // Wat Bricks al als adresboekcontact heeft OPGESLAGEN (>0); een niet-opgeslagen suggestie mag Infused vervangen.
        opgeslagenContactId: info.TelefoonboekContactId,
        icpc: diagnoseTekst ? await pv_icpcSuggesties(diagnoseTekst) : [],
        geboortedatum: pv_geboortedatumUitTekst(ruw)
    };
}
