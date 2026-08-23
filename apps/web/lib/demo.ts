// Demo fixtures — served when NEXT_PUBLIC_SUPABASE_URL is not set, so the UI
// is fully browsable before a Supabase project is linked.
import type {
  AdminStats,
  CheckInRow,
  ClientRow,
  ConversationRow,
  DashboardRow,
  MessageRow,
  Profile,
  ProgramDetail,
  ProgramRow,
  NutritionPlanRow,
} from "./types";

// Demo user is an admin who also coaches, so every surface is browsable.
export const demoProfile: Profile = {
  id: "demo-coach",
  full_name: "Coach Alex",
  role: "admin",
  tier: "coach_pro",
};

export const demoAdminStats: AdminStats = {
  total_users: 47,
  coaches: 6,
  clients: 40,
  active_relationships: 31,
  tiers: [
    { tier: "free", count: 28 },
    { tier: "premium", count: 12 },
    { tier: "coach_free", count: 4 },
    { tier: "coach_pro", count: 3 },
  ],
  recent_users: [
    { id: "u1", full_name: "Maria D.", role: "client", tier: "premium", created_at: daysAgo(2) },
    { id: "u2", full_name: "Coach Dan", role: "coach", tier: "coach_free", created_at: daysAgo(4) },
    { id: "u3", full_name: "Andrei P.", role: "client", tier: "free", created_at: daysAgo(6) },
    { id: "u4", full_name: "Ioana S.", role: "client", tier: "premium", created_at: daysAgo(9) },
    { id: "u5", full_name: "Coach Vlad", role: "coach", tier: "coach_pro", created_at: daysAgo(12) },
  ],
};

export const demoDashboard: DashboardRow[] = [
  {
    client_id: "d1", full_name: "Maria D.", avatar_url: null,
    signal: "at_risk", reason: "1/4 workouts · food logged 1/7 days · check-in missed · no logs for 5 days",
    overall_pct: 0.32, last_activity: daysAgo(5), pending_checkin: false, unread_messages: 0,
  },
  {
    client_id: "d2", full_name: "Andrei P.", avatar_url: null,
    signal: "at_risk", reason: "1/4 workouts · macros −38% vs target",
    overall_pct: 0.41, last_activity: daysAgo(2), pending_checkin: false, unread_messages: 1,
  },
  {
    client_id: "d3", full_name: "Ioana S.", avatar_url: null,
    signal: "needs_attention", reason: "Check-in submitted — review pending",
    overall_pct: 0.68, last_activity: daysAgo(0), pending_checkin: true, unread_messages: 0,
  },
  {
    client_id: "d4", full_name: "Radu M.", avatar_url: null,
    signal: "needs_attention", reason: "No food logs for 3 days",
    overall_pct: 0.61, last_activity: daysAgo(1), pending_checkin: false, unread_messages: 1,
  },
  {
    client_id: "d5", full_name: "Elena V.", avatar_url: null,
    signal: "on_track", reason: "4/4 workouts · food logged 7/7 days · check-in done",
    overall_pct: 0.91, last_activity: daysAgo(0), pending_checkin: false, unread_messages: 0,
  },
];

export const demoClients: ClientRow[] = demoDashboard.map((d) => ({
  client_id: d.client_id, full_name: d.full_name, signal: d.signal,
  overall_pct: d.overall_pct, last_activity: d.last_activity, status: "active",
  started_at: daysAgo(120),
}));

export const demoCheckIns: CheckInRow[] = [
  {
    id: "c1", client_id: "d3", full_name: "Ioana S.", week_start: mondayOf(0),
    weight_kg: 67.4, sleep: 7, energy: 6, stress: 4, hunger: 6, recovery: 7,
    note: "Slept much better after we moved cardio to mornings.",
    submitted_at: daysAgo(0), coach_reviewed_at: null,
    previous: { weight_kg: 67.8, sleep: 5, energy: 5, stress: 6, hunger: 7, recovery: 6 },
    context: "Workouts 3/4 · food logged 6/7 days · macros within ±8%",
  },
  {
    id: "c2", client_id: "d4", full_name: "Radu M.", week_start: mondayOf(0),
    weight_kg: 82.1, sleep: 6, energy: 7, stress: 5, hunger: 4, recovery: 6,
    note: "Busy week at work, missed Thursday.",
    submitted_at: daysAgo(1), coach_reviewed_at: null,
    previous: { weight_kg: 82.4, sleep: 6, energy: 6, stress: 5, hunger: 5, recovery: 6 },
    context: "Workouts 3/4 · food logged 4/7 days",
  },
];

export const demoPrograms: ProgramRow[] = [
  { id: "p1", name: "Hypertrophy Block 1", client_name: "Maria D.", status: "published", days: 4, updated_at: daysAgo(3) },
  { id: "p2", name: "Strength Base", client_name: "Elena V.", status: "published", days: 3, updated_at: daysAgo(8) },
  { id: "p3", name: "Return to training", client_name: "Andrei P.", status: "draft", days: 3, updated_at: daysAgo(1) },
];

export const demoProgramDetail: ProgramDetail = {
  id: "p1", name: "Hypertrophy Block 1", client_name: "Maria D.", status: "published",
  intensity_mode: "rir", week: 2, weeks: 6,
  days: [
    {
      id: "pd1", name: "Thu · Legs A",
      exercises: [
        { id: "pe1", exercise: "Barbell Squat", sets: 4, reps: "8", weight: "80 kg", rpe: "2", rest: "90s" },
        { id: "pe2", exercise: "Romanian Deadlift", sets: 3, reps: "10", weight: "60 kg", rpe: "2", rest: "90s" },
        { id: "pe3", exercise: "Leg Press", sets: 3, reps: "12", weight: "140 kg", rpe: "1", rest: "60s" },
      ],
    },
    {
      id: "pd2", name: "Sat · Push B",
      exercises: [
        { id: "pe4", exercise: "Bench Press", sets: 4, reps: "6", weight: "70 kg", rpe: "2", rest: "120s" },
        { id: "pe5", exercise: "Overhead Press", sets: 3, reps: "8", weight: "40 kg", rpe: "2", rest: "90s" },
      ],
    },
  ],
};

export const demoNutritionPlans: NutritionPlanRow[] = [
  { id: "n1", name: "Maria · Cut phase", client_name: "Maria D.", status: "published", kcal_target: 1800, protein_target_g: 150, carbs_target_g: 160, fat_target_g: 55 },
  { id: "n2", name: "Elena · Maintenance", client_name: "Elena V.", status: "published", kcal_target: 2200, protein_target_g: 140, carbs_target_g: 250, fat_target_g: 70 },
];

export const demoConversations: ConversationRow[] = [
  { id: "cv1", client_id: "d2", full_name: "Andrei P.", last_message: "Should I swap deadlifts this week?", last_at: daysAgo(0), unread: 1 },
  { id: "cv2", client_id: "d4", full_name: "Radu M.", last_message: "Thanks coach!", last_at: daysAgo(0), unread: 1 },
  { id: "cv3", client_id: "d5", full_name: "Elena V.", last_message: "Done, felt strong today.", last_at: daysAgo(1), unread: 0 },
];

export const demoMessages: Record<string, MessageRow[]> = {
  cv1: [
    { id: "m1", mine: false, body: "Should I swap deadlifts this week? Lower back feels tight.", at: daysAgo(0) },
    { id: "m2", mine: true, body: "Yes — do back extensions instead, 3×12, and keep RIR 3.", at: daysAgo(0) },
  ],
  cv2: [
    { id: "m3", mine: true, body: "Great check-in this week, keep the protein up.", at: daysAgo(1) },
    { id: "m4", mine: false, body: "Thanks coach!", at: daysAgo(0) },
  ],
  cv3: [
    { id: "m5", mine: false, body: "Done, felt strong today.", at: daysAgo(1) },
  ],
};

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
}
function mondayOf(weeksBack: number): string {
  const d = new Date();
  const day = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - day - weeksBack * 7);
  return d.toISOString().slice(0, 10);
}
