# To do — Bricks Infused

## Instellingen

- [x] Instellingenpagina overzichtelijker maken, bijvoorbeeld met icoontjes per onderdeel
      (de lijst met opties en uitklapsecties wordt lang, zeker sinds Postverwerking).

## Postverwerking — nog te testen

- [x] "+ ICPC"-knop: opent en vult Bricks' eigen venster "Episode toevoegen" (getest 11-10-2026 met R83.03 COVID-19).
- [ ] Trend bij eGFR / HbA1c / glucose bij een patiënt met eerdere waarden.
- [ ] Brieftypen met echte voorbeelden: radiologie, scopie, PA, kweek, HAP, GGZ, MDO, opname, meedenkadvies e.a.
- [ ] "Overnemen" en de episodeknop in de kaart.
- [ ] Instellingen per type / weglaten / extra kopjes in de echte optiepagina.

## Postverwerking — nog te bouwen

- [x] Geadresseerde (adresboek): afzender herkennen en automatisch invullen (R. Smit), onderscheid op specialisme
      (twee K. Mulder), Bricks' instelling-suggestie vervangen door de specialist, nieuw contact voorstellen.
- [ ] Nieuw contact (Dr. De Vries, Dagoziekenhuis) live testen, en daarna of Infused hem zelf vindt.
- [ ] Geadresseerde invullen vóór het koppelen van de patiënt live testen.

## Medicatie-autorisatie

- [ ] Labwaarden achter medicatie live testen (gebouwd: eGFR/Hb bij bloedverdunners, HbA1c/eGFR bij
      antidiabetica, K/eGFR bij bloeddruk, LDL, TSH, eGFR/ALAT bij hoogrisico).
- [ ] Eigen medicatiegroepen ook labwaarden laten kiezen.
- [ ] Medicatiegroepen live testen in de autorisatielijst (kleuren, voorrang, legenda).

## Bugs / wensen (14-10-2026) — gebouwd, nog live te testen

- [ ] Juvoly: een nieuwe regel in de samenvatting werd na overnemen 3 nieuwe regels (lege regels samengevoegd).
- [ ] Brief-export (PDF): bestandsnaam "2015-04-19 Cardioloog" (datum + specialisme uit de kop, anders uit de brief).
      Fix 2.6.0: niet meer de geboortedatum; soort organisatie (bv. fysiotherapeut) als er geen afdeling is.
- [ ] Instellingen die standaard aan staan maar nooit zijn opgeslagen, werkten niet; nu altijd samengevoegd met
      de standaardwaarden.
- [ ] Autorisatielijst: alleen ADHD, benzo's, opiaten en hoogrisico een hele rij; overige groepen een strook vooraan.
- [ ] Labeltjes: HbA1c niet kleuren bij afwijkend; bloeddruk alleen eGFR (geen kalium), bètablokkers geen eGFR.
- [ ] Labeltjes: "eGFR 101 mrt'26" (zonder eenheid); LDL/K/Hb altijd 1 decimaal.
- [ ] Labeltjes: afwijkend = geel; ouder dan 13 maanden of onbekend = oranje.

## Gebouwd tot en met 2.6.0 — nog live te testen

- [ ] RKZ-radiologie en -lab in productie: afzender "!Radiologie RKZ" / "!Laboratorium RKZ".
- [ ] ZorgDomein-terugkoppeling: afzender "!Huisartsenpraktijk Broekpolder".
- [ ] Urine (dysmorfe ery's), allergietest, CRP/BSE-marge van 5.
- [ ] Microbiologie/SOA-test (MEDVRI) en het vangnet "labbericht zonder tabel → brief".
- [ ] "Slecht cholesterol onmeetbaar hoog" en "schildklier goed ingesteld".
- [ ] Nieuw contact: knop "Toewijzen" verschijnt en vult het contact in.
- [ ] Watermerk-iconen (Health Icons) en icoonkiezer voor eigen groepen in de echte autorisatielijst.

## Gebouwd in 2.7.0 — nog live te testen

- [ ] Nieuwe medicatiegroepen met icoon: long/inhalatoren, maag, ontlasting, prostaat, vrouwelijke hormonen,
      zenuwpijn, hooikoorts (neusspray-corticosteroïden alleen bij "neus"/"nasaal" in de naam).
- [ ] Labeltjes zonder eenheid; GLP-1-agonisten (Mounjaro e.a.) geen oranje bij ontbrekende of oude waarden.
- [ ] Firefox-versie (Bricks, U-Prevent en Zorgdomein Infused): installeren, en de koppeling tussen de drie testen.

## Gebouwd in 2.8.0 — nog live te testen

- [ ] Labwaarden in de autorisatie weer zichtbaar (Bricks' title is nu "Open dossier van …"); datum in het labeltje lichter.
- [ ] Nieuwe groepen: oog, oor, bot, vitamines, ijzer, vaccinaties, migraine, anti-epileptica, blaas, antibiotica,
      hartmedicatie; hooikoorts → "Hooikoorts en eczeem" incl. hormooncrèmes; ♀/♂ als icoon; Trimbow-afkortingen.
- [ ] Locatiebolletje per patiënt (kleur zoals Bricks: Citadel/Prinsenhof groen, Plantage blauw).
- [ ] Locatiefilter op werkgroep (Alle | Plantage | Citadel + Prinsenhof): standaard de werkplek uit de tabtitel,
      keuze per computer onthouden, patiënten zonder locatie/Telefonisch in elke groep, melding + "Toon alles".
- [ ] "Alles goedkeuren/afkeuren" slaat verborgen recepten over (Bricks' dialoog telt alleen zichtbare regels);
      na "Alles goedkeuren" de groep wisselen: verborgen recepten staan nog op "geen autorisatie".
- [ ] Compacte legenda (alleen icoon + aantal, naam in tooltip) rechts op dezelfde regel als het locatiefilter;
      klik op een icoon markeert die groep (andere regels half doorzichtig), nog eens klikken heft het op.
- [ ] Opties "Medicatie markeren" opnieuw ingedeeld (In de lijst / Locatiefilter / Medicatiegroepen / Eigen groepen);
      locatiekeuze per computer (standaard Alle); in de lijst "Bewaar als standaard", ook te kiezen in de opties.
- [ ] Opties: alleen de schakelaar zet een optie om; klik op de tekst klapt een uitklapbaar item uit/in.
- [ ] "Gemarkeerd goedkeuren" (pastelgroen, links van "Alles goedkeuren"): keurt de open regels van de
      gemarkeerde groep goed in zichtbare recepten; uit zolang er niets gemarkeerd is. Controleren: knop staat
      er, zonder vraag, regels worden groen/goedgekeurd, afgekeurde blijven afgekeurd, verwerken
      werkt daarna normaal.
