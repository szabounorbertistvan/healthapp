// Client-surface interactive components: set logger, food logger, habit ticks,
// check-in form, measurement form, add-habit form.
const en = {
  setLogger: {
    setsProgress: "{done}/{total} sets",
    personalRecord: "Personal record — {name}",
    personalRecordDetail: "Best estimated 1RM for this lift. Nice work.",
    couldNotLogSet: "Could not log that set",
    couldNotFinish: "Could not finish",
    finishWorkout: "Finish workout",
    rest: "rest",
    pr: "PR",
    kg: "kg",
    reps: "reps",
    rir: "RIR",
    logSet: "Log set",
  },
  foodLogger: {
    logFood: "Log food",
    slots: {
      breakfast: "breakfast",
      lunch: "lunch",
      dinner: "dinner",
      snack: "snack",
    },
    change: "Change",
    grams: "grams",
    couldNotLog: "Could not log that",
    addTo: "Add to {slot}",
    searchPlaceholder: "Search foods…",
    noMatches: "No matches.",
  },
  habitTicks: {
    // The habit list renders only dynamic data (habit names and counts);
    // no static chrome to translate.
  },
  checkInForm: {
    scales: {
      sleep: "Sleep quality",
      energy: "Energy",
      stress: "Stress",
      hunger: "Hunger",
      recovery: "Recovery",
    },
    weightKg: "weight kg",
    optional: "optional",
    coachNote: "anything your coach should know",
    couldNotSubmit: "Could not submit",
    submit: "Submit check-in",
  },
  measurementForm: {
    title: "Add a measurement",
    weightKg: "weight kg",
    waistCm: "waist cm",
    couldNotSave: "Could not save",
    saved: "Saved.",
  },
  addHabitForm: {
    title: "Add a habit",
    name: "name",
    namePlaceholder: "Walk 30 minutes",
    daysPerWeek: "days/week",
    couldNotAdd: "Could not add that",
  },
};

const ro: typeof en = {
  setLogger: {
    setsProgress: "{done}/{total} seturi",
    personalRecord: "Record personal — {name}",
    personalRecordDetail: "Cel mai bun 1RM estimat pentru acest exercițiu. Bravo!",
    couldNotLogSet: "Nu s-a putut înregistra setul",
    couldNotFinish: "Nu s-a putut finaliza",
    finishWorkout: "Finalizează antrenamentul",
    rest: "pauză",
    pr: "PR",
    kg: "kg",
    reps: "repetări",
    rir: "RIR",
    logSet: "Înregistrează setul",
  },
  foodLogger: {
    logFood: "Adaugă mâncare",
    slots: {
      breakfast: "mic dejun",
      lunch: "prânz",
      dinner: "cină",
      snack: "gustare",
    },
    change: "Schimbă",
    grams: "grame",
    couldNotLog: "Nu s-a putut înregistra",
    addTo: "Adaugă la {slot}",
    searchPlaceholder: "Caută alimente…",
    noMatches: "Niciun rezultat.",
  },
  habitTicks: {},
  checkInForm: {
    scales: {
      sleep: "Calitatea somnului",
      energy: "Energie",
      stress: "Stres",
      hunger: "Foame",
      recovery: "Recuperare",
    },
    weightKg: "greutate kg",
    optional: "opțional",
    coachNote: "ceva ce antrenorul tău ar trebui să știe",
    couldNotSubmit: "Nu s-a putut trimite",
    submit: "Trimite check-in-ul",
  },
  measurementForm: {
    title: "Adaugă o măsurătoare",
    weightKg: "greutate kg",
    waistCm: "talie cm",
    couldNotSave: "Nu s-a putut salva",
    saved: "Salvat.",
  },
  addHabitForm: {
    title: "Adaugă un obicei",
    name: "nume",
    namePlaceholder: "Mergi pe jos 30 de minute",
    daysPerWeek: "zile/săptămână",
    couldNotAdd: "Nu s-a putut adăuga",
  },
};

export const clientWidgetsMessages = { en, ro };
