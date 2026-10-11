/////////////////////////////// MEDICATIEGROEPEN (standaard) ////////////////////////////////////////////////////////
// Gedeeld door content.js (markering in de autorisatielijst) en options.html (instellingen).
//
// Instelbaar door de gebruiker (opties):
//   medicijnGroepenUit:    ['nsaid', ...]   standaardgroepen die uit staan
//   medicijnHoogrisico:    [...] of null    eigen woordenlijst voor Hoogrisicomedicatie (null = standaard)
//   medicijnEigenGroepen:  [{ id, naam, kleur, aan, woorden }]   volledig eigen groepen
// De woordenlijsten van de overige standaardgroepen zijn bewust niet aanpasbaar.
//
// Volgorde = voorrang: eigen groepen eerst, dan de standaardgroepen in deze volgorde. Een regel
// krijgt de kleur van de EERSTE groep die past (bv. diazepam: Benzodiazepinen vóór Psychofarmaca).
// Woorden matchen als deel van de medicijnnaam, zonder hoofdletters/accenten (codeïne = CODEINE).

const MEDICIJN_STANDAARD_GROEPEN = [
    {
        id: 'opiaat', naam: 'Opiaten', kleur: '#ffe4cc', aan: true,
        woorden: ['morfine', 'oxycodon', 'fentanyl', 'codeine', 'tramadol', 'tapentadol', 'buprenorfine', 'methadon',
            'hydromorfon', 'pethidine', 'diamorfine']
    },
    {
        id: 'benzodiazepine', naam: 'Benzodiazepinen en Z-drugs', kleur: '#fff2cc', aan: true,
        woorden: ['oxazepam', 'temazepam', 'bromazepam', 'lorazepam', 'diazepam', 'alprazolam', 'clonazepam',
            'midazolam', 'nitrazepam', 'flunitrazepam', 'triazolam', 'chloordiazepoxide', 'clorazepinezuur',
            'zolpidem', 'zopiclon']
    },
    {
        id: 'adhd', naam: 'ADHD-medicatie', kleur: '#f0f8cc', aan: true,
        woorden: ['methylfenidaat', 'dexamfetamine', 'lisdexamfetamine', 'atomoxetine', 'guanfacine', 'clonidine',
            'concerta', 'ritalin', 'medikinet', 'equasym', 'focalin', 'adderall', 'vyvanse', 'strattera', 'intuniv',
            'kapvay']
    },
    {
        // De enige standaardgroep waarvan de gebruiker de woorden mag aanpassen.
        id: 'hoogrisico', naam: 'Hoogrisicomedicatie', kleur: '#ffcccc', aan: true, bewerkbaar: true, lab: ['egfr', 'alat'],
        woorden: ['methotrexaat', 'amiodaron']
    },
    {
        // Ascal/carbasalaatcalcium en acetylsalicylzuur horen hier, NIET bij de NSAID's.
        id: 'bloedverdunner', naam: 'Bloedverdunners', kleur: '#fce7f3', aan: true,
        // Labwaarden alleen bij de DOAC's; eGFR bij een DOAC al oranje vanaf < 50.
        lab: ['egfr'], labAlleen: ['apixaban', 'rivaroxaban', 'edoxaban', 'dabigatran', 'eliquis', 'xarelto', 'lixiana', 'pradaxa'],
        egfrOranjeOnder: 50,
        woorden: ['carbasalaatcalcium', 'ascal', 'acetylsalicylzuur', 'clopidogrel', 'prasugrel', 'ticagrelor',
            'dipyridamol', 'apixaban', 'rivaroxaban', 'edoxaban', 'dabigatran', 'eliquis', 'xarelto', 'lixiana',
            'pradaxa', 'acenocoumarol', 'fenprocoumon', 'warfarine', 'sintrom', 'marcoumar', 'nadroparine',
            'dalteparine', 'enoxaparine', 'tinzaparine', 'fraxiparine', 'fragmin']
    },
    {
        id: 'nsaid', naam: "NSAID's", kleur: '#e7e5e4', aan: true, lab: ['egfr'],
        woorden: ['ibuprofen', 'naproxen', 'diclofenac', 'aceclofenac', 'celecoxib', 'etoricoxib', 'meloxicam',
            'piroxicam', 'indometacine', 'ketoprofen', 'dexketoprofen', 'nabumeton', 'ketorolac', 'arthrotec']
    },
    {
        id: 'antidiabetica', naam: 'Antidiabetica', kleur: '#dcfce7', aan: true, lab: ['hba1c', 'egfr'],
        woorden: ['metformine', 'gliclazide', 'glimepiride', 'glibenclamide', 'tolbutamide', 'sitagliptine',
            'vildagliptine', 'linagliptine', 'saxagliptine', 'alogliptine', 'empagliflozine', 'dapagliflozine',
            'canagliflozine', 'ertugliflozine', 'pioglitazon', 'acarbose', 'repaglinide', 'liraglutide', 'semaglutide',
            'dulaglutide', 'exenatide', 'tirzepatide', 'insuline', 'lantus', 'levemir', 'tresiba', 'toujeo',
            'abasaglar', 'novorapid', 'humalog', 'apidra', 'fiasp', 'humuline', 'insulatard', 'novomix']
    },
    {
        id: 'bloeddruk', naam: 'Bloeddrukmedicatie', kleur: '#dbeafe', aan: true, lab: ['kalium', 'egfr'],
        woorden: [
            // ACE-remmers en ARB's
            'enalapril', 'lisinopril', 'perindopril', 'ramipril', 'captopril', 'fosinopril', 'quinapril', 'trandolapril',
            'losartan', 'valsartan', 'irbesartan', 'candesartan', 'telmisartan', 'olmesartan', 'eprosartan', 'sacubitril',
            // bètablokkers
            'metoprolol', 'bisoprolol', 'atenolol', 'nebivolol', 'propranolol', 'carvedilol', 'labetalol', 'celiprolol',
            // calciumantagonisten
            'amlodipine', 'nifedipine', 'lercanidipine', 'barnidipine', 'felodipine', 'nitrendipine', 'diltiazem', 'verapamil',
            // diuretica
            'hydrochloorthiazide', 'chloortalidon', 'indapamide', 'furosemide', 'bumetanide', 'spironolacton', 'eplerenon',
            'triamtereen', 'amiloride',
            // overig
            'doxazosine', 'moxonidine', 'methyldopa'
        ]
    },
    {
        id: 'cholesterol', naam: 'Cholesterolmedicatie', kleur: '#ede9fe', aan: true, lab: ['ldl'],
        woorden: ['simvastatine', 'atorvastatine', 'rosuvastatine', 'pravastatine', 'fluvastatine', 'pitavastatine',
            'ezetimib', 'evolocumab', 'alirocumab', 'inclisiran', 'bempedoinezuur', 'fenofibraat', 'gemfibrozil']
    },
    {
        id: 'schildklier', naam: 'Schildkliermedicatie', kleur: '#cffafe', aan: true, lab: ['tsh', 'ft4'],
        woorden: ['levothyroxine', 'liothyronine', 'thyrax', 'euthyrox', 'thiamazol', 'propylthiouracil']
    },
    {
        id: 'psychofarmaca', naam: 'Psychofarmaca', kleur: '#fae8ff', aan: true,
        woorden: [
            // antidepressiva
            'sertraline', 'citalopram', 'escitalopram', 'paroxetine', 'fluoxetine', 'fluvoxamine', 'venlafaxine',
            'duloxetine', 'mirtazapine', 'amitriptyline', 'nortriptyline', 'clomipramine', 'imipramine', 'trazodon',
            'bupropion', 'vortioxetine', 'agomelatine',
            // antipsychotica en lithium
            'quetiapine', 'olanzapine', 'risperidon', 'aripiprazol', 'haloperidol', 'clozapine', 'pipamperon',
            'paliperidon', 'lurasidon', 'cariprazine', 'lithium'
        ]
    }
];

// Labwaarden die bij een groep getoond kunnen worden (lab: [...] hierboven), met de NHG/WCIA-codes
// uit Bricks' bepalingenlijst (Bepaling.GetList). Met deze codes volstaat één call per patiënt
// (LabBepalingMeting.GetUitslagenByWCIACodes). POC-varianten en vervallen codes tellen mee.
const MEDICIJN_LABWAARDEN = {
    egfr: { label: 'eGFR', codes: ['KREC/O/FB', 'KREM/O/FB', 'KREC/O/PO', 'KREM/O/PO'] },
    kalium: { label: 'K', codes: ['K/B/', 'K/B/PO'] },
    hb: { label: 'Hb', codes: ['HB/B/'] },
    hba1c: { label: 'HbA1c', codes: ['HBAC/B/', 'HBAP/B/PO', 'HBAP/B/', 'HB1C/B/', 'GLHB/B/'] },
    ldl: { label: 'LDL', codes: ['LDL/B/', 'LDLD/B/', 'LDL/B/PO'] },
    tsh: { label: 'TSH', codes: ['TSH/B/'] },
    ft4: { label: 'FT4', codes: ['FT4/B/'] },
    alat: { label: 'ALAT', codes: ['ALAT/B/'] }
};

// Alle groepen in volgorde van voorrang, met de instellingen van de gebruiker toegepast.
function medicijn_groepenUitOpties(options) {
    const o = options || {};
    const uit = Array.isArray(o.medicijnGroepenUit) ? o.medicijnGroepenUit : [];
    const hoog = Array.isArray(o.medicijnHoogrisico) ? o.medicijnHoogrisico : null;
    const eigen = (Array.isArray(o.medicijnEigenGroepen) ? o.medicijnEigenGroepen : [])
        .map((g) => Object.assign({}, g, { eigen: true }));
    const standaard = MEDICIJN_STANDAARD_GROEPEN.map((g) => Object.assign({}, g, {
        aan: !uit.includes(g.id),
        woorden: g.bewerkbaar && hoog ? hoog : g.woorden
    }));
    return eigen.concat(standaard);
}
