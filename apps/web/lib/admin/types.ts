// Shapes of what the admin_* RPCs return (supabase/migrations/20260920100000_admin_panel.sql).
// jsonb comes back untyped from supabase-js; these are the contracts the pages
// render against. Counts are numbers once parsed; timestamps stay ISO strings.

import type { AuditAction } from "./params";

export type AdminOverview = {
  generated_at: string;
  users: {
    total: number; clients: number; coaches: number; admins: number; suspended: number;
    created_today: number; created_7d: number; created_30d: number;
    active_30d: number; inactive_30d: number; with_coach: number; deletion_pending: number;
  };
  activity: {
    workouts_today: number; workouts_7d: number; workouts_30d: number;
    sets_today: number; sets_7d: number;
    active_today: number; active_7d: number; active_30d: number;
    streak_users: number; food_logs_today: number; food_logs_7d: number;
    challenges_active: number; challenge_participants_active: number;
    programs_published: number; habits_active: number;
  };
  auth: {
    logins_total: number; logins_today: number; logins_7d: number; logins_30d: number;
    failed_total: number; failed_24h: number;
    google_accounts: number; email_accounts: number;
    never_logged_in: number; signed_in_7d: number; last_login_at: string | null;
  };
  invitations: {
    total: number; pending: number; expired: number; accepted: number; active: number; ended: number;
    created_7d: number; created_30d: number; acceptance_rate: number | null;
  };
  social: {
    posts: number; posts_7d: number; posts_deleted: number; comments: number; comments_7d: number;
    kudos: number; kudos_7d: number; follows: number; follows_7d: number;
  };
  system: {
    push_subscriptions: number; users_with_push: number; users_without_push: number;
    rest_pushes_sent_7d: number; notifications_unsent: number; audit_events_24h: number; admin_actions_30d: number;
  };
};

export type DailyPoint = {
  day: string; new_users: number; active_users: number; workouts: number; sets: number;
  posts: number; logins: number; invitations: number; food_logs: number;
};

export type AdminUserRow = {
  id: string; full_name: string | null; username: string | null; avatar_url: string | null;
  role: string; timezone: string; created_at: string; suspended_at: string | null;
  email: string | null; last_sign_in_at: string | null; provider: string;
  workouts: number; sets: number; last_activity_at: string | null;
  coach_id: string | null; coach_username: string | null; coach_name: string | null;
  clients: number; tier: string; deletion_requested_at: string | null; push_subscriptions: number;
  streak: number; load_7d: number;
};

export type AdminUsersPage = { total: number; rows: AdminUserRow[] };

export type AdminUserDetail = {
  profile: {
    id: string; full_name: string | null; username: string | null; avatar_url: string | null;
    city: string | null; bio: string | null; sex: string | null; birth_year: number | null;
    role: string; locale: string; timezone: string; weight_unit: string; length_unit: string;
    check_in_weekday: number; leaderboard_visibility: string;
    notification_prefs: Record<string, unknown>; rest_prefs: Record<string, unknown>;
    created_at: string; updated_at: string; suspended_at: string | null; suspended_reason: string | null;
  };
  account: {
    email: string | null; email_confirmed_at: string | null; auth_created_at: string | null;
    last_sign_in_at: string | null; primary_provider: string; providers: string[];
    tier: string; tier_status: string | null; tier_provider: string | null;
    deletion: { requested_at: string; purge_after: string; status: string } | null;
    invited_by: { id: string; username: string | null; full_name: string | null; at: string } | null;
  } | null;
  coaching: {
    current_coach: { id: string; username: string | null; full_name: string | null; avatar_url: string | null; since: string } | null;
    past_coaches: { id: string; username: string | null; full_name: string | null; from: string; to: string | null }[];
    clients: { id: string; username: string | null; full_name: string | null; avatar_url: string | null; status: string; since: string | null }[];
    invitations_sent: { id: string; status: string; created_at: string; expires_at: string | null; started_at: string | null; ended_at: string | null; client_username: string | null }[];
    invitations_received: { id: string; status: string; started_at: string | null; ended_at: string | null; coach_username: string | null }[];
  };
  activity: {
    workouts: number; workouts_7d: number; workouts_30d: number; abandoned: number;
    first_workout_at: string | null; last_workout_at: string | null; avg_duration_min: number | null;
    sets: number; sets_7d: number; prs: number; exercises_used: number;
    top_exercises: { name: string; sets: number }[];
    programs: number; programs_published: number; programs_built: number;
    challenges: { id: string; title: string; type: string; start_date: string; end_date: string; joined_at: string; completed_at: string | null }[];
    habits_active: number; habit_logs_30d: number;
    badges: { slug: string; name: string; awarded_at: string }[];
  };
  nutrition: {
    food_logs: number; food_logs_7d: number; food_logs_30d: number; last_food_log_at: string | null;
    days_logged_30d: number; avg_kcal_7d: number | null; methods: Record<string, number>;
    plans: number;
    active_plan: { id: string; name: string; kcal: number; protein_g: number; carbs_g: number; fat_g: number; meals: number; coach_id: string | null } | null;
    plans_built: number; custom_foods: number; favorites: number;
  };
  progress: {
    measurements: number;
    latest_weight: { kg: number; date: string } | null;
    first_weight: { kg: number; date: string } | null;
    weight_history: { date: string; kg: number }[];
    check_ins: number;
    last_check_in: { week_start: string; submitted_at: string; reviewed: boolean; sleep: number | null; energy: number | null; stress: number | null; hunger: number | null; recovery: number | null } | null;
    photos: number; last_photo_at: string | null;
    latest_adherence: { week_start: string; overall_pct: number; signal: string; reason: string } | null;
    goals: number;
  };
  social: {
    posts: number; posts_deleted: number; comments: number; kudos_given: number; kudos_received: number;
    followers: number; following: number;
    recent_posts: { id: string; type: string; text: string | null; visibility: string; created_at: string; deleted_at: string | null; kudos: number; comments: number }[];
  };
  auth: {
    logins_total: number; logins_30d: number; failed_30d: number;
    history: { at: string; action: string; provider: string | null; ip: string | null }[];
  };
  devices: {
    push_subscriptions: { id: string; user_agent: string | null; created_at: string; updated_at: string }[];
    rest_pushes_sent: number; rest_pushes_cancelled: number; last_rest_push_at: string | null;
    notifications: number; notifications_unread: number; last_notification_at: string | null;
  };
};

export type TimelineEvent = {
  occurred_at: string; kind: string; title: string | null; detail: string | null;
  entity_type: string | null; entity_id: string | null;
};

export type AuditRow = {
  id: number; created_at: string; action: AuditAction; entity_type: string | null; entity_id: string | null;
  metadata: Record<string, unknown>; ip: string | null; user_agent: string | null;
  actor_user_id: string | null; actor_role: string | null; actor_username: string | null; actor_name: string | null;
  target_user_id: string | null; target_username: string | null; target_name: string | null;
};
export type AuditPage = { total: number; rows: AuditRow[] };

export type AuthStats = {
  logins_total: number; logins_today: number; logins_7d: number; logins_30d: number;
  unique_7d: number; unique_30d: number; never_logged_in: number; signups_total: number; recoveries_30d: number;
  by_provider: Record<string, number>; logins_by_provider_30d: Record<string, number>;
  failed_24h: number; failed_7d: number; failed_total: number;
  repeated_failures_24h: { email: string; attempts: number; last_at: string; known_user: boolean }[];
  recent_logins: { at: string; user_id: string | null; username: string | null; full_name: string | null; email: string | null; provider: string | null; ip: string | null }[];
  last_login_per_user: { user_id: string; username: string | null; full_name: string | null; email: string | null; last_sign_in_at: string | null; provider: string }[];
};

export type InvitationRow = {
  id: string; created_at: string; expires_at: string | null; started_at: string | null; ended_at: string | null;
  status: "pending" | "expired" | "accepted" | "revoked" | "ended";
  coach_id: string; coach_username: string | null; coach_name: string | null;
  client_id: string | null; client_username: string | null; client_name: string | null; has_code: boolean;
};
export type InvitationsPage = {
  stats: { total: number; pending: number; expired: number; accepted: number; active: number; ended: number; revoked: number; created_7d: number; created_30d: number; acceptance_rate: number | null };
  total: number; rows: InvitationRow[];
};

export type WorkoutStats = {
  days: number; sessions: number; completed: number; abandoned: number; in_progress: number;
  sets: number; prs: number; exercises_logged: number; active_users: number;
  avg_duration_min: number | null; avg_sets_per_session: number | null;
  programs_total: number; programs_published: number; programs_created: number; programs_solo: number;
  top_exercises: { id: string; name: string; sets: number; users: number }[];
  top_users: { id: string; username: string | null; full_name: string | null; workouts: number; sets: number }[];
  load_distribution: Record<string, number>;
  streak_users_today: number;
  by_hour: { hour: number; sessions: number }[];
};

export type ExerciseRow = {
  id: string; name_en: string; name_ro: string | null; category: string | null; level: string | null; equipment: string | null;
  primary_muscles: string[]; secondary_muscles: string[]; source: string; external_id: string | null;
  owner_id: string | null; owner_username: string | null; created_at: string; updated_at: string;
  image_count: number; logged_sets: number; in_programs: number;
};
export type ExercisesPage = {
  stats: { total: number; system: number; custom: number; missing_ro: number; with_images: number; in_use: number; categories: Record<string, number>; equipment: Record<string, number> };
  total: number; rows: ExerciseRow[];
};

export type NutritionStats = {
  days: number; foods_total: number; foods_by_source: Record<string, number>; foods_custom: number; foods_verified: number;
  foods_with_barcode: number; foods_missing_ro: number; foods_no_kcal: number; foods_no_macros: number; foods_no_portions: number;
  foods_duplicate_names: number;
  duplicate_samples: { name: string; brand: string; count: number }[];
  incomplete_samples: { id: string; name: string; source: string; kcal: number; protein: number; carbs: number; fat: number }[];
  food_logs: number; food_logs_total: number; active_users: number;
  logs_by_method: Record<string, number>; logs_by_slot: Record<string, number>;
  top_foods: { name: string; logs: number; users: number }[];
  plans_total: number; plans_published: number; plans_solo: number; meals_total: number; favorites_total: number;
  avg_kcal_per_day: number | null;
};

export type SocialPostRow = {
  id: string; type: string; text: string | null; visibility: string; created_at: string; deleted_at: string | null;
  payload: Record<string, unknown> | null; user_id: string; username: string | null; full_name: string | null; avatar_url: string | null;
  comments: number; kudos: number;
};
export type SocialPage = {
  stats: {
    posts: number; posts_7d: number; posts_deleted: number; comments: number; comments_7d: number; kudos: number; kudos_7d: number;
    follows: number; follows_7d: number; active_users_7d: number;
    by_type: Record<string, number>; by_visibility: Record<string, number>;
    top_authors: { id: string; username: string | null; full_name: string | null; posts: number }[];
  };
  total: number; rows: SocialPostRow[];
};
export type SocialPostDetail = {
  id: string; type: string; text: string | null; visibility: string; payload: Record<string, unknown> | null;
  created_at: string; deleted_at: string | null; activity_id: string | null; challenge_id: string | null;
  author: { id: string; username: string | null; full_name: string | null; avatar_url: string | null };
  comments: { id: string; body: string; created_at: string; user_id: string; username: string | null }[];
  kudos: { user_id: string; username: string | null; created_at: string }[];
};

export type ChallengeRow = {
  id: string; title_en: string; title_ro: string; type: string; target_value: number; start_date: string; end_date: string;
  visibility: string; created_at: string; creator_id: string | null; creator_username: string | null;
  status: "active" | "upcoming" | "finished"; participants: number; completions: number;
};
export type ChallengesPage = {
  stats: { total: number; active: number; upcoming: number; finished: number; platform: number; user_created: number; participants: number; completions: number; completion_rate: number | null };
  rows: ChallengeRow[];
};
export type ChallengeDetail = {
  id: string; title_en: string; title_ro: string; description_en: string | null; description_ro: string | null;
  type: string; target_value: number; start_date: string; end_date: string; visibility: string; created_at: string;
  creator: { id: string; username: string | null; full_name: string | null } | null;
  status: "active" | "upcoming" | "finished";
  participants: { user_id: string; username: string | null; full_name: string | null; avatar_url: string | null; joined_at: string; completed_at: string | null; workouts: number; active_days: number; volume_kg: number; load: number }[];
};

export type NotificationStats = {
  users_total: number; users_with_push: number; users_without_push: number; subscriptions: number; subscriptions_7d: number;
  users_rest_notify_on: number; by_browser: Record<string, number>;
  rest_pushes: { total: number; sent: number; cancelled: number; pending: number; sent_24h: number; sent_7d: number; last_sent_at: string | null };
  notifications: { total: number; unsent: number; unread: number; created_7d: number; by_category: Record<string, number> };
  recent_subscriptions: { id: string; user_id: string; username: string | null; full_name: string | null; user_agent: string | null; created_at: string; updated_at: string }[];
};

export type SystemHealth = {
  db_now: string; db_version: string; db_size: string; latest_migration: string | null; migrations_applied: number | null;
  pg_cron: { name: string; schedule: string; active: boolean; last_status: string | null; last_start: string | null; last_end: string | null; last_message: string | null }[] | null;
  cron_runs: { failed_24h: number; runs_24h: number } | null;
  extensions: string[]; rest_push_configured: boolean; rest_pushes_stuck: number; notifications_unsent: number;
  deletion_requests_overdue: number; adherence_last_computed: string | null; failed_logins_1h: number; audit_events_total: number;
  table_counts: Record<string, number>;
};

/** A reachability probe the server made from this box, not the database. */
export type Probe = { name: string; url: string; ok: boolean | null; status: number | null; ms: number | null; note?: string };

export type SearchResults = {
  users: { id: string; username: string | null; full_name: string | null; email: string | null; role: string; avatar_url: string | null }[];
  invitations: { id: string; status: string; coach_username: string | null; client_username: string | null; created_at: string }[];
  exercises: { id: string; name_en: string; name_ro: string | null; category: string | null; source: string }[];
  foods: { id: string; name: string | null; brand: string | null; source: string; barcode: string | null }[];
  challenges: { id: string; title_en: string; title_ro: string; start_date: string; end_date: string }[];
  posts: { id: string; type: string; text: string | null; username: string | null; created_at: string; deleted: boolean }[];
  audit: { id: number; action: string; entity_type: string | null; entity_id: string | null; created_at: string; actor_username: string | null }[];
};

/** One reported application error, as /admin/errors lists it. */
export type AppErrorRow = {
  id: number; created_at: string; source: "client" | "server" | "edge"; level: "error" | "warn";
  message: string; digest: string | null; route: string | null; stack: string | null;
  user_agent: string | null; ip: string | null; resolved_at: string | null;
  user_id: string | null; username: string | null; full_name: string | null;
};

/** The same errors folded by message — what the page ranks before the raw rows. */
export type AppErrorGroup = {
  message: string; count: number; first_at: string; last_at: string;
  sources: string[]; open: number; users: number; sample_id: number;
};

export type AppErrorsPage = {
  stats: {
    days: number; total: number; window: number; last_24h: number; last_1h: number; open: number;
    client: number; server: number; edge: number; users: number; last_at: string | null;
  };
  groups: AppErrorGroup[];
  total: number;
  rows: AppErrorRow[];
};

export type FeedbackRow = {
  id: number; created_at: string; kind: "bug" | "idea" | "other"; message: string;
  route: string | null; user_agent: string | null; locale: string | null;
  status: "new" | "seen" | "done"; handled_at: string | null;
  user_id: string | null; username: string | null; full_name: string | null; role: string | null;
};

export type FeedbackPage = {
  stats: {
    days: number; total: number; window: number; new: number; seen: number; done: number;
    bug: number; idea: number; other: number; users: number; last_at: string | null;
  };
  total: number;
  rows: FeedbackRow[];
};
