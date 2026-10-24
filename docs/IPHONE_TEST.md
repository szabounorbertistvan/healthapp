# Aplicația pe iPhone

Scris 2026-10-24. Aplicația din `apps/mobile` este făcută cu Expo, deci același cod merge și pe
iPhone. Sunt două căi:

| | A. Expo Go (acum, gratuit) | B. Aplicație adevărată (mai târziu) |
|---|---|---|
| Ce îți trebuie | aplicația gratuită **Expo Go** din App Store | cont Apple Developer (99 USD/an) |
| Calculatorul | trebuie să fie pornit, cu `npm run start:go` | nu |
| Pe ecran apare ca | „Expo Go”, cu Voinic înăuntru | „Voinic”, cu iconița lui |
| Notificări de la server | nu (nici nu sunt pornite încă) | da, după pașii de push |
| Bun pentru | să vezi și să încerci aplicația azi | test cu alți oameni (TestFlight), App Store |

## A. Expo Go — în 5 minute

Verificat pe calculatorul acesta: serverul pornește și trimite aplicația pentru iPhone (SDK 58,
pe care îl are Expo Go din App Store), cu setările publice ale Voinic incluse
(`apps/mobile/.env`, deja creat, nu intră în git).

1. Pe iPhone: instalează **Expo Go** din App Store.
2. iPhone-ul și calculatorul pe **aceeași rețea Wi-Fi**.
3. Pe calculator, din dosarul proiectului:

   ```bash
   npm run start:go --workspace=@healthapp/mobile
   ```

   Dacă Windows întreabă de firewall pentru Node.js, alege **Rețele private → Permite**.
4. În terminal apare un **cod QR**. Deschide **Camera** pe iPhone, îndreapt-o spre cod și apasă
   pe „Deschide în Expo Go”. Prima încărcare durează ~1 minut.
5. Te autentifici cu contul tău Voinic (cel de pe www.voinic.fit). Ce notezi e real.

Dacă telefonul nu găsește calculatorul (unele rețele Wi-Fi nu lasă aparatele să se vadă între
ele), oprește serverul cu `Ctrl+C` și pornește-l prin internet:

```bash
npm run start:go:tunnel --workspace=@healthapp/mobile
```

Cât timp serverul merge, orice schimbare în cod apare pe telefon în câteva secunde.

### Ce să încerci

- [ ] Autentificarea; ecranul „Azi” arată același procent și același antrenament ca site-ul.
- [ ] Antrenament: deschide o zi **cu internet**, apoi pune telefonul în **modul avion**,
      notează două seturi (apar cu un ceas). Scoate modul avion: în ~20 de secunde ceasul
      dispare și seturile sunt pe site.
- [ ] Pauza dintre seturi: după un set, blochează telefonul. Notificarea „Pauza s-a terminat”
      trebuie să vină la timp (permite notificările când ți se cere).
- [ ] Mâncare: caută un aliment, adaugă-l; scanează codul de bare al unui produs.
- [ ] Obiceiuri, cântărire, check-in-ul săptămânal.
- [ ] Antrenor: trimite un mesaj; răspunde de pe site din contul de antrenor — apare singur.
- [ ] Limba RO/EN (Mai mult), tema închisă/deschisă (urmează telefonul).

Orice nu arată bine: o captură de ecran e cel mai util lucru de trimis.

Limitele lui Expo Go: notificările trimise de server nu ajung (oricum nu sunt pornite încă),
iar numele și iconița de pe ecran sunt ale lui Expo Go, nu ale Voinic.

## B. Aplicația adevărată pe iPhone (când vrei)

1. Cont **Apple Developer Program** (developer.apple.com, 99 USD/an, verificarea poate dura câteva zile).
2. Contul Expo din [ANDROID_PHONE_TEST.md](ANDROID_PHONE_TEST.md) (pașii 1–4 sunt aceiași).
3. Claude adaugă profilul de build pentru iOS; build-ul se face în cloud-ul Expo (nu e nevoie de Mac),
   iar aplicația ajunge pe telefon prin **TestFlight**.
4. Pentru App Store mai sunt necesare: „Sign in with Apple” (obligatoriu dacă aplicația oferă și
   Google — vezi docs/APPLE_SIGNIN_SETUP.md), politica de confidențialitate (există) și formularele
   Apple despre date.
