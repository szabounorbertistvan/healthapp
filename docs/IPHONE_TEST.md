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

## B. Aplicația adevărată pe iPhone, prin TestFlight

Pregătit 2026-10-27: profilul de build pentru iOS există (`apps/mobile/eas.json`, profilul
`production`), iconița pentru iPhone (`assets/icon-ios.png`, 1024 × 1024, fără transparență) și
textele de permisiuni pe care Apple le cere (cameră, poze, microfon, locație). Build-ul se face în
cloud-ul Expo, pe un Mac al lor — nu ai nevoie de Mac.

### O singură dată

1. **Apple Developer Program** — developer.apple.com → Account → Enroll, 99 USD/an. Ca persoană
   fizică e cel mai simplu (numele tău apare ca „vânzător” în App Store); ca firmă îți trebuie un
   număr D-U-N-S. Aprobarea poate dura de la câteva ore la câteva zile.
2. **Contul Expo** — pașii 1–3 din [ANDROID_PHONE_TEST.md](ANDROID_PHONE_TEST.md) (cont pe
   expo.dev, `login`, `init`). Dacă i-ai făcut deja pentru Android, sari peste.
3. **Setările publice pentru build-ul de producție** — cele trei variabile din pasul 4 al aceluiași
   document (`EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, `EXPO_PUBLIC_API_URL`)
   trebuie să existe și pentru mediul **production**. Cel mai simplu: expo.dev → proiectul Voinic →
   **Environment variables** → la fiecare dintre cele trei, Edit → bifează **Production** → Save.
   (Dacă nu le-ai creat încă deloc, creează-le cu comenzile de acolo, adăugând
   `--environment production`.)

### Primul build

Din dosarul proiectului:

```bash
npm run build:ios --workspace=@healthapp/mobile
```

Pe parcurs, terminalul te întreabă câteva lucruri — răspunde așa:

- **Log in to your Apple account?** → Yes, apoi Apple ID-ul și codul de pe telefon (2FA).
- **Generate a new Apple Distribution Certificate / Provisioning Profile?** → Yes (Expo le ține în
  contul tău).
- **Set up Push Notifications?** → Yes (cheia pentru notificări; o folosim când pornim push-ul).
- **Numele aplicației în App Store Connect** — dacă „Voinic” e deja luat de altcineva în App
  Store, alege o variantă, de ex. „Voinic Coach”. Numele de sub iconiță rămâne „Voinic”.

Build-ul durează ~15–30 de minute (planul gratuit poate sta la coadă). La final este trimis singur
în App Store Connect (`--auto-submit`), unde Apple îl procesează încă ~10–30 de minute și îți
trimite un email.

### Pe iPhone

1. appstoreconnect.apple.com → **Apps** → Voinic → **TestFlight** → **Internal Testing** → creează
   un grup (de ex. „Eu”) și adaugă-te pe tine (Apple ID-ul tău).
2. Instalează aplicația **TestFlight** din App Store, pe iPhone.
3. Deschide invitația primită pe email (sau direct TestFlight) → **Install**. Apare „Voinic” cu
   iconița lui, ca o aplicație normală. Fiecare build e valabil 90 de zile.

Testarea internă (până la 100 de oameni din contul tău) **nu trece prin verificarea Apple**. Pentru
testeri din afară (link public TestFlight) Apple face o verificare scurtă a build-ului.

### Build-uri următoare

1. Mărește `ios.buildNumber` în `apps/mobile/app.json` ("1" → "2" → …) — Apple refuză un build cu
   un număr deja trimis.
2. Din nou `npm run build:ios --workspace=@healthapp/mobile`; certificatele sunt deja salvate, deci
   nu mai întreabă nimic. Dacă un build s-a făcut dar trimiterea a eșuat:
   `npm run submit:ios --workspace=@healthapp/mobile`.

### Pentru App Store (mai târziu)

- „Sign in with Apple” trebuie să fie pornit (docs/APPLE_SIGNIN_SETUP.md): aplicația oferă deja
  Google, iar Apple cere atunci și varianta lor. Pentru TestFlight intern nu e nevoie.
- În App Store Connect: formularele despre date („App Privacy”), capturi de ecran, descriere;
  politica de confidențialitate există (www.voinic.fit/privacy).
- Plățile rămân ascunse în aplicație, deci nu e nevoie de In-App Purchase.
