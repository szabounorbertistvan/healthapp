// Public pages: landing, login, get-the-app.
const en = {
  landing: {
    signIn: "Sign in",
    getStarted: "Get started",
    tagline: "Training · Nutrition · Progress · Coaching",
    heroTitle: "Your coaching, finally in one app.",
    heroBody:
      "{app} replaces WhatsApp threads, spreadsheets and three different trackers with a single flow between you and your coach — or on your own.",
    startFree: "Start free",
    browseCoachDemo: "Browse the coach demo",
    browseClientDemo: "Browse the client demo",
    forYou: "For you",
    forCoaches: "For coaches",
    clientBenefits: [
      { title: "Log a set in 3 taps", body: "Pre-filled targets, automatic rest timer, personal records detected for you — even with no signal at the gym." },
      { title: "Nutrition without spreadsheets", body: "Scan a barcode or tap “ate as planned”. Your macros update instantly against the plan your coach built." },
      { title: "See real progress", body: "Weight trends, strength PRs, weekly check-ins — everything in one timeline, not five apps." },
      { title: "Stay on a streak", body: "Habits, streaks and badges keep the boring weeks moving. Discreet — no leaderboards, no spam." },
    ],
    coachBenefits: [
      { title: "Know who needs you today", body: "Every client carries an On Track / Needs Attention / At Risk signal — with the reason spelled out." },
      { title: "Build once, coach everywhere", body: "Program and meal builders on the web; your clients get them on their phone the moment you hit publish." },
      { title: "Feedback in context", body: "Comment on the exact set, session or check-in — not in a WhatsApp thread three days later." },
    ],
    pricingTitle: "Simple pricing",
    pricingFree: "Free",
    pricingFreeBody: "Workouts, nutrition, habits & streaks",
    pricingPremium: "Premium",
    pricingPremiumBody: "+ progress photos & advanced charts",
    pricingCoach: "Coach",
    pricingCoachBody: "Starter: 3 clients · Pro: 30 clients + analytics",
    pricingFootnote:
      "Română + English · offline logging · your data stays yours (GDPR export & delete built in)",
  },
  login: {
    demoNotice: "Demo mode — sign-in is skipped. Connect Supabase to enable real auth.",
    email: "Email",
    password: "Password",
    signIn: "Sign in",
    createAccount: "Create account",
    switchToSignUp: "New coach? Create an account",
    switchToSignIn: "Already have an account? Sign in",
  },
  getApp: {
    title: "{app} lives on your phone",
    body: "Workouts, nutrition, check-ins and streaks are in the mobile app for iOS and Android. The web dashboard is your coach's workspace.",
    beta: "The mobile app ships with the private beta — your coach will send you an invite link.",
    back: "← Back to buddygym.app",
  },
};

const ro: typeof en = {
  landing: {
    signIn: "Autentificare",
    getStarted: "Începe acum",
    tagline: "Antrenament · Nutriție · Progres · Coaching",
    heroTitle: "Coaching-ul tău, în sfârșit într-o singură aplicație.",
    heroBody:
      "{app} înlocuiește conversațiile de WhatsApp, tabelele Excel și trei aplicații diferite de tracking cu un singur flux între tine și antrenorul tău — sau pe cont propriu.",
    startFree: "Începe gratuit",
    browseCoachDemo: "Vezi demo-ul pentru antrenori",
    browseClientDemo: "Vezi demo-ul pentru clienți",
    forYou: "Pentru tine",
    forCoaches: "Pentru antrenori",
    clientBenefits: [
      { title: "Loghează un set din 3 atingeri", body: "Ținte precompletate, cronometru de pauză automat, recorduri personale detectate pentru tine — chiar și fără semnal la sală." },
      { title: "Nutriție fără tabele Excel", body: "Scanează un cod de bare sau apasă „am mâncat conform planului”. Macronutrienții se actualizează instant față de planul construit de antrenor." },
      { title: "Vezi progres real", body: "Trendul greutății, recorduri de forță, check-in-uri săptămânale — totul într-o singură cronologie, nu în cinci aplicații." },
      { title: "Păstrează-ți seria", body: "Obiceiurile, seriile și insignele țin în mișcare și săptămânile plictisitoare. Discret — fără clasamente, fără spam." },
    ],
    coachBenefits: [
      { title: "Știi cine are nevoie de tine azi", body: "Fiecare client poartă un semnal Pe drumul bun / Necesită atenție / În pericol — cu motivul explicat clar." },
      { title: "Construiește o dată, antrenează peste tot", body: "Constructori de programe și mese pe web; clienții le primesc pe telefon în momentul în care publici." },
      { title: "Feedback în context", body: "Comentează exact pe setul, sesiunea sau check-in-ul respectiv — nu într-o conversație de WhatsApp trei zile mai târziu." },
    ],
    pricingTitle: "Prețuri simple",
    pricingFree: "Gratuit",
    pricingFreeBody: "Antrenamente, nutriție, obiceiuri și serii",
    pricingPremium: "Premium",
    pricingPremiumBody: "+ poze de progres și grafice avansate",
    pricingCoach: "Antrenor",
    pricingCoachBody: "Starter: 3 clienți · Pro: 30 de clienți + analize",
    pricingFootnote:
      "Română + English · logare offline · datele rămân ale tale (export și ștergere GDPR incluse)",
  },
  login: {
    demoNotice: "Mod demo — autentificarea este omisă. Conectează Supabase pentru autentificare reală.",
    email: "Email",
    password: "Parolă",
    signIn: "Autentificare",
    createAccount: "Creează cont",
    switchToSignUp: "Antrenor nou? Creează un cont",
    switchToSignIn: "Ai deja un cont? Autentifică-te",
  },
  getApp: {
    title: "{app} trăiește pe telefonul tău",
    body: "Antrenamentele, nutriția, check-in-urile și seriile sunt în aplicația mobilă pentru iOS și Android. Dashboard-ul web este spațiul de lucru al antrenorului tău.",
    beta: "Aplicația mobilă vine odată cu beta privată — antrenorul tău îți va trimite un link de invitație.",
    back: "← Înapoi la buddygym.app",
  },
};

export const landingMessages = { en, ro };
