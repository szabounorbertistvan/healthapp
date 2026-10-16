export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.17"
  }
  public: {
    Tables: {
      account_deletion_requests: {
        Row: {
          completed_at: string | null
          purge_after: string
          requested_at: string
          status: string
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          purge_after?: string
          requested_at?: string
          status?: string
          user_id: string
        }
        Update: {
          completed_at?: string | null
          purge_after?: string
          requested_at?: string
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "account_deletion_requests_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      adherence_snapshots: {
        Row: {
          checkin_done: boolean
          computed_at: string
          formula_version: number
          habit_pct: number
          id: string
          inputs: Json
          nutrition_pct: number
          overall_pct: number
          reason: string
          signal: Database["public"]["Enums"]["adherence_signal"]
          user_id: string
          week_start: string
          workout_pct: number
        }
        Insert: {
          checkin_done?: boolean
          computed_at?: string
          formula_version?: number
          habit_pct?: number
          id?: string
          inputs?: Json
          nutrition_pct?: number
          overall_pct?: number
          reason: string
          signal: Database["public"]["Enums"]["adherence_signal"]
          user_id: string
          week_start: string
          workout_pct?: number
        }
        Update: {
          checkin_done?: boolean
          computed_at?: string
          formula_version?: number
          habit_pct?: number
          id?: string
          inputs?: Json
          nutrition_pct?: number
          overall_pct?: number
          reason?: string
          signal?: Database["public"]["Enums"]["adherence_signal"]
          user_id?: string
          week_start?: string
          workout_pct?: number
        }
        Relationships: [
          {
            foreignKeyName: "adherence_snapshots_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_audit_events: {
        Row: {
          action: Database["public"]["Enums"]["audit_action"]
          actor_role: string | null
          actor_user_id: string | null
          created_at: string
          entity_id: string | null
          entity_type: string | null
          id: number
          ip: string | null
          metadata: Json
          target_user_id: string | null
          user_agent: string | null
        }
        Insert: {
          action: Database["public"]["Enums"]["audit_action"]
          actor_role?: string | null
          actor_user_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: never
          ip?: string | null
          metadata?: Json
          target_user_id?: string | null
          user_agent?: string | null
        }
        Update: {
          action?: Database["public"]["Enums"]["audit_action"]
          actor_role?: string | null
          actor_user_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: never
          ip?: string | null
          metadata?: Json
          target_user_id?: string | null
          user_agent?: string | null
        }
        Relationships: []
      }
      app_errors: {
        Row: {
          created_at: string
          digest: string | null
          id: number
          ip: string | null
          level: string
          message: string
          resolved_at: string | null
          resolved_by: string | null
          route: string | null
          source: string
          stack: string | null
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          digest?: string | null
          id?: never
          ip?: string | null
          level?: string
          message: string
          resolved_at?: string | null
          resolved_by?: string | null
          route?: string | null
          source: string
          stack?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          digest?: string | null
          id?: never
          ip?: string | null
          level?: string
          message?: string
          resolved_at?: string | null
          resolved_by?: string | null
          route?: string | null
          source?: string
          stack?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      app_flags: {
        Row: {
          enabled: boolean
          key: string
          preview_users: string[]
          updated_at: string
        }
        Insert: {
          enabled?: boolean
          key: string
          preview_users?: string[]
          updated_at?: string
        }
        Update: {
          enabled?: boolean
          key?: string
          preview_users?: string[]
          updated_at?: string
        }
        Relationships: []
      }
      badges: {
        Row: {
          active: boolean
          category: string
          description_en: string | null
          description_ro: string | null
          icon: string | null
          id: string
          kind: string
          metric: string
          name_en: string
          name_ro: string
          rarity: string
          slug: string
          sort: number
          target: number
        }
        Insert: {
          active?: boolean
          category: string
          description_en?: string | null
          description_ro?: string | null
          icon?: string | null
          id?: string
          kind?: string
          metric: string
          name_en: string
          name_ro: string
          rarity: string
          slug: string
          sort?: number
          target: number
        }
        Update: {
          active?: boolean
          category?: string
          description_en?: string | null
          description_ro?: string | null
          icon?: string | null
          id?: string
          kind?: string
          metric?: string
          name_en?: string
          name_ro?: string
          rarity?: string
          slug?: string
          sort?: number
          target?: number
        }
        Relationships: []
      }
      barcode_scans: {
        Row: {
          day: string
          scans: number
          user_id: string
        }
        Insert: {
          day: string
          scans?: number
          user_id: string
        }
        Update: {
          day?: string
          scans?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "barcode_scans_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      bookings: {
        Row: {
          block_end: string
          block_start: string
          cancellation_reason: string | null
          cancelled_by: string | null
          client_id: string
          coach_id: string
          confirmed_at: string | null
          created_at: string
          currency: string | null
          end_at: string
          id: string
          note: string | null
          price_cents: number | null
          price_unit: string | null
          reminded_at: string | null
          resolved_at: string | null
          service_id: string | null
          service_name: string
          start_at: string
          status: string
          timezone: string
          updated_at: string
        }
        Insert: {
          block_end: string
          block_start: string
          cancellation_reason?: string | null
          cancelled_by?: string | null
          client_id: string
          coach_id: string
          confirmed_at?: string | null
          created_at?: string
          currency?: string | null
          end_at: string
          id?: string
          note?: string | null
          price_cents?: number | null
          price_unit?: string | null
          reminded_at?: string | null
          resolved_at?: string | null
          service_id?: string | null
          service_name: string
          start_at: string
          status?: string
          timezone: string
          updated_at?: string
        }
        Update: {
          block_end?: string
          block_start?: string
          cancellation_reason?: string | null
          cancelled_by?: string | null
          client_id?: string
          coach_id?: string
          confirmed_at?: string | null
          created_at?: string
          currency?: string | null
          end_at?: string
          id?: string
          note?: string | null
          price_cents?: number | null
          price_unit?: string | null
          reminded_at?: string | null
          resolved_at?: string | null
          service_id?: string | null
          service_name?: string
          start_at?: string
          status?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bookings_cancelled_by_fkey"
            columns: ["cancelled_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_coach_id_fkey"
            columns: ["coach_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "coach_services"
            referencedColumns: ["id"]
          },
        ]
      }
      calendar_busy_blocks: {
        Row: {
          busy: unknown
          coach_id: string
          id: number
          source_id: string
          synced_at: string
        }
        Insert: {
          busy: unknown
          coach_id: string
          id?: never
          source_id: string
          synced_at?: string
        }
        Update: {
          busy?: unknown
          coach_id?: string
          id?: never
          source_id?: string
          synced_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "calendar_busy_blocks_coach_id_fkey"
            columns: ["coach_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calendar_busy_blocks_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "calendar_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      calendar_connections: {
        Row: {
          account_label: string | null
          coach_id: string
          connected_at: string | null
          created_at: string
          disconnected_at: string | null
          id: string
          last_error_at: string | null
          last_error_code: string | null
          last_synced_at: string | null
          next_sync_at: string | null
          provider: string
          revoke_pending: boolean
          scopes: string[]
          status: string
          updated_at: string
        }
        Insert: {
          account_label?: string | null
          coach_id: string
          connected_at?: string | null
          created_at?: string
          disconnected_at?: string | null
          id?: string
          last_error_at?: string | null
          last_error_code?: string | null
          last_synced_at?: string | null
          next_sync_at?: string | null
          provider: string
          revoke_pending?: boolean
          scopes?: string[]
          status?: string
          updated_at?: string
        }
        Update: {
          account_label?: string | null
          coach_id?: string
          connected_at?: string | null
          created_at?: string
          disconnected_at?: string | null
          id?: string
          last_error_at?: string | null
          last_error_code?: string | null
          last_synced_at?: string | null
          next_sync_at?: string | null
          provider?: string
          revoke_pending?: boolean
          scopes?: string[]
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "calendar_connections_coach_id_fkey"
            columns: ["coach_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      calendar_credentials: {
        Row: {
          access_token_enc: string | null
          access_token_expires_at: string | null
          connection_id: string
          key_version: number
          refresh_token_enc: string | null
          sync_state: Json
          updated_at: string
        }
        Insert: {
          access_token_enc?: string | null
          access_token_expires_at?: string | null
          connection_id: string
          key_version?: number
          refresh_token_enc?: string | null
          sync_state?: Json
          updated_at?: string
        }
        Update: {
          access_token_enc?: string | null
          access_token_expires_at?: string | null
          connection_id?: string
          key_version?: number
          refresh_token_enc?: string | null
          sync_state?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "calendar_credentials_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: true
            referencedRelation: "calendar_connections"
            referencedColumns: ["id"]
          },
        ]
      }
      calendar_sources: {
        Row: {
          affects_availability: boolean
          coach_id: string
          connection_id: string
          created_at: string
          external_id: string
          id: string
          is_primary: boolean
          name: string | null
        }
        Insert: {
          affects_availability?: boolean
          coach_id: string
          connection_id: string
          created_at?: string
          external_id: string
          id?: string
          is_primary?: boolean
          name?: string | null
        }
        Update: {
          affects_availability?: boolean
          coach_id?: string
          connection_id?: string
          created_at?: string
          external_id?: string
          id?: string
          is_primary?: boolean
          name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "calendar_sources_coach_id_fkey"
            columns: ["coach_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calendar_sources_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "calendar_connections"
            referencedColumns: ["id"]
          },
        ]
      }
      challenge_milestones: {
        Row: {
          milestone: number
          participant_id: string
          reached_at: string
        }
        Insert: {
          milestone: number
          participant_id: string
          reached_at?: string
        }
        Update: {
          milestone?: number
          participant_id?: string
          reached_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "challenge_milestones_participant_id_fkey"
            columns: ["participant_id"]
            isOneToOne: false
            referencedRelation: "challenge_participants"
            referencedColumns: ["id"]
          },
        ]
      }
      challenge_participants: {
        Row: {
          challenge_id: string
          completed_at: string | null
          id: string
          joined_at: string
          user_id: string
        }
        Insert: {
          challenge_id: string
          completed_at?: string | null
          id?: string
          joined_at?: string
          user_id: string
        }
        Update: {
          challenge_id?: string
          completed_at?: string | null
          id?: string
          joined_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "challenge_participants_challenge_id_fkey"
            columns: ["challenge_id"]
            isOneToOne: false
            referencedRelation: "challenges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "challenge_participants_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      challenges: {
        Row: {
          created_at: string
          creator_id: string | null
          description_en: string | null
          description_ro: string | null
          difficulty: string | null
          end_date: string
          exercise_id: string | null
          id: string
          start_date: string
          target_value: number
          title_en: string
          title_ro: string
          type: string
          visibility: string
        }
        Insert: {
          created_at?: string
          creator_id?: string | null
          description_en?: string | null
          description_ro?: string | null
          difficulty?: string | null
          end_date: string
          exercise_id?: string | null
          id?: string
          start_date: string
          target_value: number
          title_en: string
          title_ro: string
          type: string
          visibility?: string
        }
        Update: {
          created_at?: string
          creator_id?: string | null
          description_en?: string | null
          description_ro?: string | null
          difficulty?: string | null
          end_date?: string
          exercise_id?: string | null
          id?: string
          start_date?: string
          target_value?: number
          title_en?: string
          title_ro?: string
          type?: string
          visibility?: string
        }
        Relationships: [
          {
            foreignKeyName: "challenges_creator_id_fkey"
            columns: ["creator_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "challenges_exercise_id_fkey"
            columns: ["exercise_id"]
            isOneToOne: false
            referencedRelation: "exercises"
            referencedColumns: ["id"]
          },
        ]
      }
      check_ins: {
        Row: {
          circumferences: Json
          coach_reviewed_at: string | null
          energy: number | null
          hunger: number | null
          id: string
          note: string | null
          recovery: number | null
          sleep: number | null
          stress: number | null
          submitted_at: string
          user_id: string
          week_start: string
          weight_kg: number | null
        }
        Insert: {
          circumferences?: Json
          coach_reviewed_at?: string | null
          energy?: number | null
          hunger?: number | null
          id?: string
          note?: string | null
          recovery?: number | null
          sleep?: number | null
          stress?: number | null
          submitted_at?: string
          user_id: string
          week_start: string
          weight_kg?: number | null
        }
        Update: {
          circumferences?: Json
          coach_reviewed_at?: string | null
          energy?: number | null
          hunger?: number | null
          id?: string
          note?: string | null
          recovery?: number | null
          sleep?: number | null
          stress?: number | null
          submitted_at?: string
          user_id?: string
          week_start?: string
          weight_kg?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "check_ins_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      cities: {
        Row: {
          active: boolean
          country_code: string
          created_at: string
          id: string
          latitude: number | null
          longitude: number | null
          name: string
          name_en: string | null
          slug: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          country_code: string
          created_at?: string
          id?: string
          latitude?: number | null
          longitude?: number | null
          name: string
          name_en?: string | null
          slug: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          country_code?: string
          created_at?: string
          id?: string
          latitude?: number | null
          longitude?: number | null
          name?: string
          name_en?: string | null
          slug?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cities_country_code_fkey"
            columns: ["country_code"]
            isOneToOne: false
            referencedRelation: "countries"
            referencedColumns: ["code"]
          },
        ]
      }
      coach_application_decisions: {
        Row: {
          actor_id: string | null
          coach_profile_id: string
          created_at: string
          decision: string
          id: string
          identity_reviewed: boolean
          note: string | null
          profile_reviewed: boolean
          qualifications_reviewed: boolean
        }
        Insert: {
          actor_id?: string | null
          coach_profile_id: string
          created_at?: string
          decision: string
          id?: string
          identity_reviewed?: boolean
          note?: string | null
          profile_reviewed?: boolean
          qualifications_reviewed?: boolean
        }
        Update: {
          actor_id?: string | null
          coach_profile_id?: string
          created_at?: string
          decision?: string
          id?: string
          identity_reviewed?: boolean
          note?: string | null
          profile_reviewed?: boolean
          qualifications_reviewed?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "coach_application_decisions_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coach_application_decisions_coach_profile_id_fkey"
            columns: ["coach_profile_id"]
            isOneToOne: false
            referencedRelation: "coach_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      coach_availability: {
        Row: {
          active: boolean
          coach_id: string
          created_at: string
          end_time: string
          id: string
          start_time: string
          updated_at: string
          weekday: number
        }
        Insert: {
          active?: boolean
          coach_id: string
          created_at?: string
          end_time: string
          id?: string
          start_time: string
          updated_at?: string
          weekday: number
        }
        Update: {
          active?: boolean
          coach_id?: string
          created_at?: string
          end_time?: string
          id?: string
          start_time?: string
          updated_at?: string
          weekday?: number
        }
        Relationships: [
          {
            foreignKeyName: "coach_availability_coach_id_fkey"
            columns: ["coach_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      coach_availability_exceptions: {
        Row: {
          all_day: boolean
          coach_id: string
          created_at: string
          end_date: string
          end_time: string | null
          id: string
          start_date: string
          start_time: string | null
          title: string | null
        }
        Insert: {
          all_day?: boolean
          coach_id: string
          created_at?: string
          end_date: string
          end_time?: string | null
          id?: string
          start_date: string
          start_time?: string | null
          title?: string | null
        }
        Update: {
          all_day?: boolean
          coach_id?: string
          created_at?: string
          end_date?: string
          end_time?: string | null
          id?: string
          start_date?: string
          start_time?: string | null
          title?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "coach_availability_exceptions_coach_id_fkey"
            columns: ["coach_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      coach_certifications: {
        Row: {
          admin_note: string | null
          coach_profile_id: string
          created_at: string
          credential_number: string | null
          document_ref: string | null
          expires_on: string | null
          id: string
          issuer: string | null
          name: string
          sort_order: number
          updated_at: string
          verification_status: string
          verified_at: string | null
          verified_by: string | null
          year: number | null
        }
        Insert: {
          admin_note?: string | null
          coach_profile_id: string
          created_at?: string
          credential_number?: string | null
          document_ref?: string | null
          expires_on?: string | null
          id?: string
          issuer?: string | null
          name: string
          sort_order?: number
          updated_at?: string
          verification_status?: string
          verified_at?: string | null
          verified_by?: string | null
          year?: number | null
        }
        Update: {
          admin_note?: string | null
          coach_profile_id?: string
          created_at?: string
          credential_number?: string | null
          document_ref?: string | null
          expires_on?: string | null
          id?: string
          issuer?: string | null
          name?: string
          sort_order?: number
          updated_at?: string
          verification_status?: string
          verified_at?: string | null
          verified_by?: string | null
          year?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "coach_certifications_coach_profile_id_fkey"
            columns: ["coach_profile_id"]
            isOneToOne: false
            referencedRelation: "coach_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coach_certifications_verified_by_fkey"
            columns: ["verified_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      coach_feedback: {
        Row: {
          body: string
          client_id: string
          coach_id: string
          created_at: string
          id: string
          read_at: string | null
          reference_id: string
          reference_type: Database["public"]["Enums"]["feedback_reference"]
        }
        Insert: {
          body: string
          client_id: string
          coach_id: string
          created_at?: string
          id?: string
          read_at?: string | null
          reference_id: string
          reference_type: Database["public"]["Enums"]["feedback_reference"]
        }
        Update: {
          body?: string
          client_id?: string
          coach_id?: string
          created_at?: string
          id?: string
          read_at?: string | null
          reference_id?: string
          reference_type?: Database["public"]["Enums"]["feedback_reference"]
        }
        Relationships: [
          {
            foreignKeyName: "coach_feedback_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coach_feedback_coach_id_fkey"
            columns: ["coach_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      coach_languages: {
        Row: {
          coach_profile_id: string
          created_at: string
          language_code: string
        }
        Insert: {
          coach_profile_id: string
          created_at?: string
          language_code: string
        }
        Update: {
          coach_profile_id?: string
          created_at?: string
          language_code?: string
        }
        Relationships: [
          {
            foreignKeyName: "coach_languages_coach_profile_id_fkey"
            columns: ["coach_profile_id"]
            isOneToOne: false
            referencedRelation: "coach_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coach_languages_language_code_fkey"
            columns: ["language_code"]
            isOneToOne: false
            referencedRelation: "languages"
            referencedColumns: ["code"]
          },
        ]
      }
      coach_locations: {
        Row: {
          city_id: string
          coach_profile_id: string
          created_at: string
          gym_id: string | null
          gym_name: string | null
          id: string
        }
        Insert: {
          city_id: string
          coach_profile_id: string
          created_at?: string
          gym_id?: string | null
          gym_name?: string | null
          id?: string
        }
        Update: {
          city_id?: string
          coach_profile_id?: string
          created_at?: string
          gym_id?: string | null
          gym_name?: string | null
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "coach_locations_city_id_fkey"
            columns: ["city_id"]
            isOneToOne: false
            referencedRelation: "cities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coach_locations_coach_profile_id_fkey"
            columns: ["coach_profile_id"]
            isOneToOne: false
            referencedRelation: "coach_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coach_locations_gym_id_fkey"
            columns: ["gym_id"]
            isOneToOne: false
            referencedRelation: "gyms"
            referencedColumns: ["id"]
          },
        ]
      }
      coach_profile_revisions: {
        Row: {
          coach_profile_id: string
          created_at: string
          decided_at: string | null
          decided_by: string | null
          payload: Json
          review_note: string | null
          status: string
          submitted_at: string | null
          updated_at: string
        }
        Insert: {
          coach_profile_id: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          payload: Json
          review_note?: string | null
          status?: string
          submitted_at?: string | null
          updated_at?: string
        }
        Update: {
          coach_profile_id?: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          payload?: Json
          review_note?: string | null
          status?: string
          submitted_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "coach_profile_revisions_coach_profile_id_fkey"
            columns: ["coach_profile_id"]
            isOneToOne: true
            referencedRelation: "coach_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coach_profile_revisions_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      coach_profiles: {
        Row: {
          about: string | null
          accepting_clients: boolean
          approach: string | null
          client_goals: string[]
          coaching_since: number | null
          cover_url: string | null
          created_at: string
          experience_summary: string | null
          headline: string | null
          id: string
          in_person: boolean
          online: boolean
          published_at: string | null
          rank_score: number
          review_avg: number | null
          review_count: number
          review_decision: string | null
          review_distribution: number[]
          review_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          search_doc: unknown
          search_name: string
          search_text: string
          search_wdoc: unknown
          slug: string
          social_links: Json
          status: string
          submitted_at: string | null
          suspended_at: string | null
          suspended_from: string | null
          suspension_reason: string | null
          updated_at: string
          user_id: string
          verification_decided_at: string | null
          verification_decided_by: string | null
          verification_message: string | null
          verification_note: string | null
          verification_requested_at: string | null
          verification_status: string
        }
        Insert: {
          about?: string | null
          accepting_clients?: boolean
          approach?: string | null
          client_goals?: string[]
          coaching_since?: number | null
          cover_url?: string | null
          created_at?: string
          experience_summary?: string | null
          headline?: string | null
          id?: string
          in_person?: boolean
          online?: boolean
          published_at?: string | null
          rank_score?: number
          review_avg?: number | null
          review_count?: number
          review_decision?: string | null
          review_distribution?: number[]
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          search_doc?: unknown
          search_name?: string
          search_text?: string
          search_wdoc?: unknown
          slug: string
          social_links?: Json
          status?: string
          submitted_at?: string | null
          suspended_at?: string | null
          suspended_from?: string | null
          suspension_reason?: string | null
          updated_at?: string
          user_id: string
          verification_decided_at?: string | null
          verification_decided_by?: string | null
          verification_message?: string | null
          verification_note?: string | null
          verification_requested_at?: string | null
          verification_status?: string
        }
        Update: {
          about?: string | null
          accepting_clients?: boolean
          approach?: string | null
          client_goals?: string[]
          coaching_since?: number | null
          cover_url?: string | null
          created_at?: string
          experience_summary?: string | null
          headline?: string | null
          id?: string
          in_person?: boolean
          online?: boolean
          published_at?: string | null
          rank_score?: number
          review_avg?: number | null
          review_count?: number
          review_decision?: string | null
          review_distribution?: number[]
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          search_doc?: unknown
          search_name?: string
          search_text?: string
          search_wdoc?: unknown
          slug?: string
          social_links?: Json
          status?: string
          submitted_at?: string | null
          suspended_at?: string | null
          suspended_from?: string | null
          suspension_reason?: string | null
          updated_at?: string
          user_id?: string
          verification_decided_at?: string | null
          verification_decided_by?: string | null
          verification_message?: string | null
          verification_note?: string | null
          verification_requested_at?: string | null
          verification_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "coach_profiles_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coach_profiles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coach_profiles_verification_decided_by_fkey"
            columns: ["verification_decided_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      coach_rank_signals: {
        Row: {
          coach_profile_id: string
          completed_bookings: number
          completed_relationships: number
          completeness: number
          computed_at: string
          credentials: number
          has_availability: boolean
          last_active_at: string | null
          last_public_post_at: string | null
          next_available_at: string | null
          requests_180d: number
          requests_90d: number
          responded_48h: number
          saves_90d: number
          verified_credentials: number
          views_30d: number
        }
        Insert: {
          coach_profile_id: string
          completed_bookings?: number
          completed_relationships?: number
          completeness?: number
          computed_at?: string
          credentials?: number
          has_availability?: boolean
          last_active_at?: string | null
          last_public_post_at?: string | null
          next_available_at?: string | null
          requests_180d?: number
          requests_90d?: number
          responded_48h?: number
          saves_90d?: number
          verified_credentials?: number
          views_30d?: number
        }
        Update: {
          coach_profile_id?: string
          completed_bookings?: number
          completed_relationships?: number
          completeness?: number
          computed_at?: string
          credentials?: number
          has_availability?: boolean
          last_active_at?: string | null
          last_public_post_at?: string | null
          next_available_at?: string | null
          requests_180d?: number
          requests_90d?: number
          responded_48h?: number
          saves_90d?: number
          verified_credentials?: number
          views_30d?: number
        }
        Relationships: [
          {
            foreignKeyName: "coach_rank_signals_coach_profile_id_fkey"
            columns: ["coach_profile_id"]
            isOneToOne: true
            referencedRelation: "coach_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      coach_reviews: {
        Row: {
          basis: string
          body: string | null
          booking_id: string | null
          coach_id: string
          coach_response: string | null
          coach_response_at: string | null
          created_at: string
          edited_at: string | null
          id: string
          moderated_at: string | null
          moderated_by: string | null
          moderation_reason: string | null
          rating: number
          reviewer_id: string
          status: string
          trainer_client_id: string | null
          updated_at: string
        }
        Insert: {
          basis: string
          body?: string | null
          booking_id?: string | null
          coach_id: string
          coach_response?: string | null
          coach_response_at?: string | null
          created_at?: string
          edited_at?: string | null
          id?: string
          moderated_at?: string | null
          moderated_by?: string | null
          moderation_reason?: string | null
          rating: number
          reviewer_id: string
          status?: string
          trainer_client_id?: string | null
          updated_at?: string
        }
        Update: {
          basis?: string
          body?: string | null
          booking_id?: string | null
          coach_id?: string
          coach_response?: string | null
          coach_response_at?: string | null
          created_at?: string
          edited_at?: string | null
          id?: string
          moderated_at?: string | null
          moderated_by?: string | null
          moderation_reason?: string | null
          rating?: number
          reviewer_id?: string
          status?: string
          trainer_client_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "coach_reviews_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coach_reviews_coach_id_fkey"
            columns: ["coach_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coach_reviews_moderated_by_fkey"
            columns: ["moderated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coach_reviews_reviewer_id_fkey"
            columns: ["reviewer_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coach_reviews_trainer_client_id_fkey"
            columns: ["trainer_client_id"]
            isOneToOne: false
            referencedRelation: "trainer_clients"
            referencedColumns: ["id"]
          },
        ]
      }
      coach_saves: {
        Row: {
          coach_profile_id: string
          created_at: string
          user_id: string
        }
        Insert: {
          coach_profile_id: string
          created_at?: string
          user_id: string
        }
        Update: {
          coach_profile_id?: string
          created_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "coach_saves_coach_profile_id_fkey"
            columns: ["coach_profile_id"]
            isOneToOne: false
            referencedRelation: "coach_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coach_saves_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      coach_services: {
        Row: {
          active: boolean
          bookable: boolean
          booking_access: string
          booking_buffer_after_minutes: number
          booking_buffer_before_minutes: number
          booking_confirmation: string
          booking_duration_minutes: number | null
          booking_max_advance_days: number
          booking_min_notice_minutes: number
          coach_profile_id: string
          created_at: string
          currency: string
          delivery: string
          description: string | null
          duration_unit: string | null
          duration_value: number | null
          id: string
          kind: string
          name: string
          price_cents: number | null
          price_public: boolean
          price_unit: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          bookable?: boolean
          booking_access?: string
          booking_buffer_after_minutes?: number
          booking_buffer_before_minutes?: number
          booking_confirmation?: string
          booking_duration_minutes?: number | null
          booking_max_advance_days?: number
          booking_min_notice_minutes?: number
          coach_profile_id: string
          created_at?: string
          currency?: string
          delivery?: string
          description?: string | null
          duration_unit?: string | null
          duration_value?: number | null
          id?: string
          kind?: string
          name: string
          price_cents?: number | null
          price_public?: boolean
          price_unit?: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          bookable?: boolean
          booking_access?: string
          booking_buffer_after_minutes?: number
          booking_buffer_before_minutes?: number
          booking_confirmation?: string
          booking_duration_minutes?: number | null
          booking_max_advance_days?: number
          booking_min_notice_minutes?: number
          coach_profile_id?: string
          created_at?: string
          currency?: string
          delivery?: string
          description?: string | null
          duration_unit?: string | null
          duration_value?: number | null
          id?: string
          kind?: string
          name?: string
          price_cents?: number | null
          price_public?: boolean
          price_unit?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "coach_services_coach_profile_id_fkey"
            columns: ["coach_profile_id"]
            isOneToOne: false
            referencedRelation: "coach_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      coach_slug_redirects: {
        Row: {
          coach_profile_id: string
          created_at: string
          old_slug: string
        }
        Insert: {
          coach_profile_id: string
          created_at?: string
          old_slug: string
        }
        Update: {
          coach_profile_id?: string
          created_at?: string
          old_slug?: string
        }
        Relationships: [
          {
            foreignKeyName: "coach_slug_redirects_coach_profile_id_fkey"
            columns: ["coach_profile_id"]
            isOneToOne: false
            referencedRelation: "coach_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      coach_specializations: {
        Row: {
          coach_profile_id: string
          created_at: string
          is_primary: boolean
          specialization_id: string
        }
        Insert: {
          coach_profile_id: string
          created_at?: string
          is_primary?: boolean
          specialization_id: string
        }
        Update: {
          coach_profile_id?: string
          created_at?: string
          is_primary?: boolean
          specialization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "coach_specializations_coach_profile_id_fkey"
            columns: ["coach_profile_id"]
            isOneToOne: false
            referencedRelation: "coach_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coach_specializations_specialization_id_fkey"
            columns: ["specialization_id"]
            isOneToOne: false
            referencedRelation: "specializations"
            referencedColumns: ["id"]
          },
        ]
      }
      coach_verification_documents: {
        Row: {
          bytes: number
          coach_profile_id: string
          created_at: string
          format: string
          id: string
          kind: string
          label: string | null
          review_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          specialization_id: string | null
          status: string
          storage_public_id: string
        }
        Insert: {
          bytes: number
          coach_profile_id: string
          created_at?: string
          format: string
          id?: string
          kind: string
          label?: string | null
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          specialization_id?: string | null
          status?: string
          storage_public_id: string
        }
        Update: {
          bytes?: number
          coach_profile_id?: string
          created_at?: string
          format?: string
          id?: string
          kind?: string
          label?: string | null
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          specialization_id?: string | null
          status?: string
          storage_public_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "coach_verification_documents_coach_profile_id_fkey"
            columns: ["coach_profile_id"]
            isOneToOne: false
            referencedRelation: "coach_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coach_verification_documents_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coach_verification_documents_specialization_id_fkey"
            columns: ["specialization_id"]
            isOneToOne: false
            referencedRelation: "specializations"
            referencedColumns: ["id"]
          },
        ]
      }
      coach_verifications: {
        Row: {
          admin_note: string | null
          coach_profile_id: string
          created_at: string
          document_ref: string | null
          id: string
          kind: string
          status: string
          updated_at: string
          verified_at: string | null
          verified_by: string | null
        }
        Insert: {
          admin_note?: string | null
          coach_profile_id: string
          created_at?: string
          document_ref?: string | null
          id?: string
          kind: string
          status?: string
          updated_at?: string
          verified_at?: string | null
          verified_by?: string | null
        }
        Update: {
          admin_note?: string | null
          coach_profile_id?: string
          created_at?: string
          document_ref?: string | null
          id?: string
          kind?: string
          status?: string
          updated_at?: string
          verified_at?: string | null
          verified_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "coach_verifications_coach_profile_id_fkey"
            columns: ["coach_profile_id"]
            isOneToOne: false
            referencedRelation: "coach_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coach_verifications_verified_by_fkey"
            columns: ["verified_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      coaching_relationship_events: {
        Row: {
          actor_id: string | null
          created_at: string
          from_status: Database["public"]["Enums"]["relationship_status"] | null
          id: number
          reason: string | null
          relationship_id: string
          to_status: Database["public"]["Enums"]["relationship_status"]
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          from_status?:
            | Database["public"]["Enums"]["relationship_status"]
            | null
          id?: never
          reason?: string | null
          relationship_id: string
          to_status: Database["public"]["Enums"]["relationship_status"]
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          from_status?:
            | Database["public"]["Enums"]["relationship_status"]
            | null
          id?: never
          reason?: string | null
          relationship_id?: string
          to_status?: Database["public"]["Enums"]["relationship_status"]
        }
        Relationships: [
          {
            foreignKeyName: "coaching_relationship_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coaching_relationship_events_relationship_id_fkey"
            columns: ["relationship_id"]
            isOneToOne: false
            referencedRelation: "trainer_clients"
            referencedColumns: ["id"]
          },
        ]
      }
      coaching_requests: {
        Row: {
          booking_id: string | null
          client_id: string
          coach_id: string
          created_at: string
          decline_reason: string | null
          goal: string | null
          gym_id: string | null
          id: string
          message: string | null
          payment_id: string | null
          preferred_format: string | null
          resolved_at: string | null
          service_id: string | null
          status: string
          trainer_client_id: string | null
          updated_at: string
        }
        Insert: {
          booking_id?: string | null
          client_id: string
          coach_id: string
          created_at?: string
          decline_reason?: string | null
          goal?: string | null
          gym_id?: string | null
          id?: string
          message?: string | null
          payment_id?: string | null
          preferred_format?: string | null
          resolved_at?: string | null
          service_id?: string | null
          status?: string
          trainer_client_id?: string | null
          updated_at?: string
        }
        Update: {
          booking_id?: string | null
          client_id?: string
          coach_id?: string
          created_at?: string
          decline_reason?: string | null
          goal?: string | null
          gym_id?: string | null
          id?: string
          message?: string | null
          payment_id?: string | null
          preferred_format?: string | null
          resolved_at?: string | null
          service_id?: string | null
          status?: string
          trainer_client_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "coaching_requests_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coaching_requests_coach_id_fkey"
            columns: ["coach_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coaching_requests_gym_id_fkey"
            columns: ["gym_id"]
            isOneToOne: false
            referencedRelation: "gyms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coaching_requests_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "coach_services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coaching_requests_trainer_client_id_fkey"
            columns: ["trainer_client_id"]
            isOneToOne: false
            referencedRelation: "trainer_clients"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          client_id: string
          coach_id: string
          created_at: string
          id: string
        }
        Insert: {
          client_id: string
          coach_id: string
          created_at?: string
          id?: string
        }
        Update: {
          client_id?: string
          coach_id?: string
          created_at?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversations_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_coach_id_fkey"
            columns: ["coach_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      countries: {
        Row: {
          active: boolean
          code: string
          created_at: string
          name_en: string
          name_ro: string
          slug: string
        }
        Insert: {
          active?: boolean
          code: string
          created_at?: string
          name_en: string
          name_ro: string
          slug: string
        }
        Update: {
          active?: boolean
          code?: string
          created_at?: string
          name_en?: string
          name_ro?: string
          slug?: string
        }
        Relationships: []
      }
      email_outbox: {
        Row: {
          attempts: number
          created_at: string
          id: string
          last_error_code: string | null
          last_status: number | null
          locked_until: string | null
          not_before: string
          notification_id: string
          provider_message_id: string | null
          reason: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          id?: string
          last_error_code?: string | null
          last_status?: number | null
          locked_until?: string | null
          not_before: string
          notification_id: string
          provider_message_id?: string | null
          reason?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          attempts?: number
          created_at?: string
          id?: string
          last_error_code?: string | null
          last_status?: number | null
          locked_until?: string | null
          not_before?: string
          notification_id?: string
          provider_message_id?: string | null
          reason?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_outbox_notification_id_fkey"
            columns: ["notification_id"]
            isOneToOne: true
            referencedRelation: "notifications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_outbox_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      email_signing_key: {
        Row: {
          created_at: string
          id: boolean
          secret: string
        }
        Insert: {
          created_at?: string
          id?: boolean
          secret: string
        }
        Update: {
          created_at?: string
          id?: boolean
          secret?: string
        }
        Relationships: []
      }
      exercise_video_links: {
        Row: {
          created_at: string
          exercise_id: string
          updated_at: string
          user_id: string
          video_id: string
        }
        Insert: {
          created_at?: string
          exercise_id: string
          updated_at?: string
          user_id: string
          video_id: string
        }
        Update: {
          created_at?: string
          exercise_id?: string
          updated_at?: string
          user_id?: string
          video_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "exercise_video_links_exercise_id_fkey"
            columns: ["exercise_id"]
            isOneToOne: false
            referencedRelation: "exercises"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exercise_video_links_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      exercise_videos: {
        Row: {
          created_at: string
          exercise_id: string
          id: string
          owner_id: string | null
          storage_path: string
        }
        Insert: {
          created_at?: string
          exercise_id: string
          id?: string
          owner_id?: string | null
          storage_path: string
        }
        Update: {
          created_at?: string
          exercise_id?: string
          id?: string
          owner_id?: string | null
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "exercise_videos_exercise_id_fkey"
            columns: ["exercise_id"]
            isOneToOne: false
            referencedRelation: "exercises"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exercise_videos_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      exercises: {
        Row: {
          category: string | null
          created_at: string
          equipment: string | null
          external_id: string | null
          force: string | null
          id: string
          images: string[]
          instructions_en: string | null
          instructions_ro: string | null
          level: string | null
          mechanic: string | null
          name_en: string
          name_ro: string | null
          owner_id: string | null
          primary_muscles: string[]
          secondary_muscles: string[]
          source: string
          updated_at: string
          video_url: string | null
        }
        Insert: {
          category?: string | null
          created_at?: string
          equipment?: string | null
          external_id?: string | null
          force?: string | null
          id?: string
          images?: string[]
          instructions_en?: string | null
          instructions_ro?: string | null
          level?: string | null
          mechanic?: string | null
          name_en: string
          name_ro?: string | null
          owner_id?: string | null
          primary_muscles?: string[]
          secondary_muscles?: string[]
          source?: string
          updated_at?: string
          video_url?: string | null
        }
        Update: {
          category?: string | null
          created_at?: string
          equipment?: string | null
          external_id?: string | null
          force?: string | null
          id?: string
          images?: string[]
          instructions_en?: string | null
          instructions_ro?: string | null
          level?: string | null
          mechanic?: string | null
          name_en?: string
          name_ro?: string | null
          owner_id?: string | null
          primary_muscles?: string[]
          secondary_muscles?: string[]
          source?: string
          updated_at?: string
          video_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "exercises_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      feedback: {
        Row: {
          created_at: string
          handled_at: string | null
          handled_by: string | null
          id: number
          kind: string
          locale: string | null
          message: string
          route: string | null
          status: string
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          handled_at?: string | null
          handled_by?: string | null
          id?: never
          kind: string
          locale?: string | null
          message: string
          route?: string | null
          status?: string
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          handled_at?: string | null
          handled_by?: string | null
          id?: never
          kind?: string
          locale?: string | null
          message?: string
          route?: string | null
          status?: string
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "feedback_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      food_favorites: {
        Row: {
          carbs_100g: number
          created_at: string
          fat_100g: number
          food_id: string | null
          food_name: string
          id: string
          kcal_100g: number
          protein_100g: number
          user_id: string
        }
        Insert: {
          carbs_100g?: number
          created_at?: string
          fat_100g?: number
          food_id?: string | null
          food_name: string
          id?: string
          kcal_100g: number
          protein_100g?: number
          user_id: string
        }
        Update: {
          carbs_100g?: number
          created_at?: string
          fat_100g?: number
          food_id?: string | null
          food_name?: string
          id?: string
          kcal_100g?: number
          protein_100g?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "food_favorites_food_id_fkey"
            columns: ["food_id"]
            isOneToOne: false
            referencedRelation: "foods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "food_favorites_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      food_logs: {
        Row: {
          carbs_g: number
          client_generated_id: string
          client_ts: string | null
          date: string
          fat_g: number
          food_id: string | null
          food_name: string
          grams: number
          id: string
          kcal: number
          method: Database["public"]["Enums"]["food_log_method"]
          protein_g: number
          received_at: string
          salt_g: number | null
          saturated_fat_g: number | null
          slot: Database["public"]["Enums"]["meal_slot"]
          sugar_g: number | null
          user_id: string
        }
        Insert: {
          carbs_g?: number
          client_generated_id: string
          client_ts?: string | null
          date: string
          fat_g?: number
          food_id?: string | null
          food_name: string
          grams: number
          id?: string
          kcal: number
          method?: Database["public"]["Enums"]["food_log_method"]
          protein_g?: number
          received_at?: string
          salt_g?: number | null
          saturated_fat_g?: number | null
          slot: Database["public"]["Enums"]["meal_slot"]
          sugar_g?: number | null
          user_id: string
        }
        Update: {
          carbs_g?: number
          client_generated_id?: string
          client_ts?: string | null
          date?: string
          fat_g?: number
          food_id?: string | null
          food_name?: string
          grams?: number
          id?: string
          kcal?: number
          method?: Database["public"]["Enums"]["food_log_method"]
          protein_g?: number
          received_at?: string
          salt_g?: number | null
          saturated_fat_g?: number | null
          slot?: Database["public"]["Enums"]["meal_slot"]
          sugar_g?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "food_logs_food_id_fkey"
            columns: ["food_id"]
            isOneToOne: false
            referencedRelation: "foods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "food_logs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      food_search_quota: {
        Row: {
          day: string
          hits: number
          user_id: string
        }
        Insert: {
          day?: string
          hits?: number
          user_id: string
        }
        Update: {
          day?: string
          hits?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "food_search_quota_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      foods: {
        Row: {
          barcode: string | null
          brand: string | null
          carbs_100g: number
          created_at: string
          dishfinder_ingredient_id: number | null
          external_id: string | null
          fat_100g: number
          id: string
          kcal_100g: number
          name_en: string | null
          name_ro: string | null
          owner_id: string | null
          portions: Json
          protein_100g: number
          salt_100g: number | null
          saturated_fat_100g: number | null
          search_text: string | null
          source: Database["public"]["Enums"]["food_source"]
          sugar_100g: number | null
          updated_at: string
          verified: boolean
        }
        Insert: {
          barcode?: string | null
          brand?: string | null
          carbs_100g?: number
          created_at?: string
          dishfinder_ingredient_id?: number | null
          external_id?: string | null
          fat_100g?: number
          id?: string
          kcal_100g: number
          name_en?: string | null
          name_ro?: string | null
          owner_id?: string | null
          portions?: Json
          protein_100g?: number
          salt_100g?: number | null
          saturated_fat_100g?: number | null
          search_text?: string | null
          source?: Database["public"]["Enums"]["food_source"]
          sugar_100g?: number | null
          updated_at?: string
          verified?: boolean
        }
        Update: {
          barcode?: string | null
          brand?: string | null
          carbs_100g?: number
          created_at?: string
          dishfinder_ingredient_id?: number | null
          external_id?: string | null
          fat_100g?: number
          id?: string
          kcal_100g?: number
          name_en?: string | null
          name_ro?: string | null
          owner_id?: string | null
          portions?: Json
          protein_100g?: number
          salt_100g?: number | null
          saturated_fat_100g?: number | null
          search_text?: string | null
          source?: Database["public"]["Enums"]["food_source"]
          sugar_100g?: number | null
          updated_at?: string
          verified?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "foods_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      goals: {
        Row: {
          achieved_at: string | null
          closed_at: string | null
          created_at: string
          direction: string | null
          exercise_id: string | null
          id: string
          measure_key: string | null
          metric: string | null
          start_date: string | null
          start_value: number | null
          status: string
          target_date: string | null
          target_value: number | null
          title: string
          type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          achieved_at?: string | null
          closed_at?: string | null
          created_at?: string
          direction?: string | null
          exercise_id?: string | null
          id?: string
          measure_key?: string | null
          metric?: string | null
          start_date?: string | null
          start_value?: number | null
          status?: string
          target_date?: string | null
          target_value?: number | null
          title: string
          type: string
          updated_at?: string
          user_id: string
        }
        Update: {
          achieved_at?: string | null
          closed_at?: string | null
          created_at?: string
          direction?: string | null
          exercise_id?: string | null
          id?: string
          measure_key?: string | null
          metric?: string | null
          start_date?: string | null
          start_value?: number | null
          status?: string
          target_date?: string | null
          target_value?: number | null
          title?: string
          type?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "goals_exercise_id_fkey"
            columns: ["exercise_id"]
            isOneToOne: false
            referencedRelation: "exercises"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goals_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      gym_google_refresh: {
        Row: {
          gym_id: string
          request_id: number
          requested_at: string
        }
        Insert: {
          gym_id: string
          request_id: number
          requested_at?: string
        }
        Update: {
          gym_id?: string
          request_id?: number
          requested_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "gym_google_refresh_gym_id_fkey"
            columns: ["gym_id"]
            isOneToOne: false
            referencedRelation: "gyms"
            referencedColumns: ["id"]
          },
        ]
      }
      gyms: {
        Row: {
          accessibility: Json | null
          address: string | null
          approved_at: string | null
          approved_by: string | null
          city: string
          created_at: string
          google_business_status: string | null
          google_place_id: string | null
          google_rating: number | null
          google_ratings_total: number | null
          google_refreshed_at: string | null
          id: string
          lat: number | null
          lng: number | null
          maps_url: string | null
          name: string
          opening_hours: Json | null
          opening_periods: Json | null
          osm_id: string | null
          parking: Json | null
          payment: Json | null
          phone: string | null
          photo_attribution: string | null
          photo_name: string | null
          photo_url: string | null
          photo_url_source: string | null
          place_types: string[] | null
          primary_type: string | null
          search_text: string | null
          status: string
          suggested_by: string | null
          summary: string | null
          updated_at: string
          website: string | null
        }
        Insert: {
          accessibility?: Json | null
          address?: string | null
          approved_at?: string | null
          approved_by?: string | null
          city: string
          created_at?: string
          google_business_status?: string | null
          google_place_id?: string | null
          google_rating?: number | null
          google_ratings_total?: number | null
          google_refreshed_at?: string | null
          id?: string
          lat?: number | null
          lng?: number | null
          maps_url?: string | null
          name: string
          opening_hours?: Json | null
          opening_periods?: Json | null
          osm_id?: string | null
          parking?: Json | null
          payment?: Json | null
          phone?: string | null
          photo_attribution?: string | null
          photo_name?: string | null
          photo_url?: string | null
          photo_url_source?: string | null
          place_types?: string[] | null
          primary_type?: string | null
          search_text?: string | null
          status?: string
          suggested_by?: string | null
          summary?: string | null
          updated_at?: string
          website?: string | null
        }
        Update: {
          accessibility?: Json | null
          address?: string | null
          approved_at?: string | null
          approved_by?: string | null
          city?: string
          created_at?: string
          google_business_status?: string | null
          google_place_id?: string | null
          google_rating?: number | null
          google_ratings_total?: number | null
          google_refreshed_at?: string | null
          id?: string
          lat?: number | null
          lng?: number | null
          maps_url?: string | null
          name?: string
          opening_hours?: Json | null
          opening_periods?: Json | null
          osm_id?: string | null
          parking?: Json | null
          payment?: Json | null
          phone?: string | null
          photo_attribution?: string | null
          photo_name?: string | null
          photo_url?: string | null
          photo_url_source?: string | null
          place_types?: string[] | null
          primary_type?: string | null
          search_text?: string | null
          status?: string
          suggested_by?: string | null
          summary?: string | null
          updated_at?: string
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "gyms_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gyms_suggested_by_fkey"
            columns: ["suggested_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      habit_logs: {
        Row: {
          client_generated_id: string
          date: string
          habit_id: string
          id: string
          received_at: string
          user_id: string
        }
        Insert: {
          client_generated_id: string
          date: string
          habit_id: string
          id?: string
          received_at?: string
          user_id: string
        }
        Update: {
          client_generated_id?: string
          date?: string
          habit_id?: string
          id?: string
          received_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "habit_logs_habit_id_fkey"
            columns: ["habit_id"]
            isOneToOne: false
            referencedRelation: "habits"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "habit_logs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      habits: {
        Row: {
          active: boolean
          created_at: string
          created_by: string
          id: string
          name: string
          updated_at: string
          user_id: string
          weekdays: number[]
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by: string
          id?: string
          name: string
          updated_at?: string
          user_id: string
          weekdays?: number[]
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by?: string
          id?: string
          name?: string
          updated_at?: string
          user_id?: string
          weekdays?: number[]
        }
        Relationships: [
          {
            foreignKeyName: "habits_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "habits_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      languages: {
        Row: {
          active: boolean
          code: string
          name_en: string
          name_ro: string
          native_name: string
          sort_order: number
        }
        Insert: {
          active?: boolean
          code: string
          name_en: string
          name_ro: string
          native_name: string
          sort_order?: number
        }
        Update: {
          active?: boolean
          code?: string
          name_en?: string
          name_ro?: string
          native_name?: string
          sort_order?: number
        }
        Relationships: []
      }
      logged_sessions: {
        Row: {
          client_generated_id: string
          completed_at: string | null
          gym_id: string | null
          id: string
          notes: string | null
          program_day_id: string | null
          received_at: string
          started_at: string
          user_id: string
        }
        Insert: {
          client_generated_id: string
          completed_at?: string | null
          gym_id?: string | null
          id?: string
          notes?: string | null
          program_day_id?: string | null
          received_at?: string
          started_at: string
          user_id: string
        }
        Update: {
          client_generated_id?: string
          completed_at?: string | null
          gym_id?: string | null
          id?: string
          notes?: string | null
          program_day_id?: string | null
          received_at?: string
          started_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "logged_sessions_gym_id_fkey"
            columns: ["gym_id"]
            isOneToOne: false
            referencedRelation: "gyms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "logged_sessions_program_day_id_fkey"
            columns: ["program_day_id"]
            isOneToOne: false
            referencedRelation: "program_days"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "logged_sessions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      logged_sets: {
        Row: {
          client_generated_id: string
          client_ts: string | null
          duration_seconds: number | null
          effort: Database["public"]["Enums"]["simple_effort"] | null
          exercise_id: string
          id: string
          is_pr: boolean
          notes: string | null
          program_exercise_id: string | null
          received_at: string
          reps: number
          rir: number | null
          rpe: number | null
          session_id: string
          set_index: number
          user_id: string
          weight_kg: number | null
        }
        Insert: {
          client_generated_id: string
          client_ts?: string | null
          duration_seconds?: number | null
          effort?: Database["public"]["Enums"]["simple_effort"] | null
          exercise_id: string
          id?: string
          is_pr?: boolean
          notes?: string | null
          program_exercise_id?: string | null
          received_at?: string
          reps: number
          rir?: number | null
          rpe?: number | null
          session_id: string
          set_index: number
          user_id: string
          weight_kg?: number | null
        }
        Update: {
          client_generated_id?: string
          client_ts?: string | null
          duration_seconds?: number | null
          effort?: Database["public"]["Enums"]["simple_effort"] | null
          exercise_id?: string
          id?: string
          is_pr?: boolean
          notes?: string | null
          program_exercise_id?: string | null
          received_at?: string
          reps?: number
          rir?: number | null
          rpe?: number | null
          session_id?: string
          set_index?: number
          user_id?: string
          weight_kg?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "logged_sets_exercise_id_fkey"
            columns: ["exercise_id"]
            isOneToOne: false
            referencedRelation: "exercises"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "logged_sets_program_exercise_id_fkey"
            columns: ["program_exercise_id"]
            isOneToOne: false
            referencedRelation: "program_exercises"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "logged_sets_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "logged_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "logged_sets_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      marketplace_events: {
        Row: {
          campaign: string | null
          city: string | null
          coach_profile_id: string | null
          created_at: string
          dedupe_key: string | null
          detail: string | null
          event: string
          id: number
          medium: string | null
          signed_in: boolean
          source: string | null
          specialization: string | null
          visitor: string | null
        }
        Insert: {
          campaign?: string | null
          city?: string | null
          coach_profile_id?: string | null
          created_at?: string
          dedupe_key?: string | null
          detail?: string | null
          event: string
          id?: never
          medium?: string | null
          signed_in?: boolean
          source?: string | null
          specialization?: string | null
          visitor?: string | null
        }
        Update: {
          campaign?: string | null
          city?: string | null
          coach_profile_id?: string | null
          created_at?: string
          dedupe_key?: string | null
          detail?: string | null
          event?: string
          id?: never
          medium?: string | null
          signed_in?: boolean
          source?: string | null
          specialization?: string | null
          visitor?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "marketplace_events_coach_profile_id_fkey"
            columns: ["coach_profile_id"]
            isOneToOne: false
            referencedRelation: "coach_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      marketplace_salts: {
        Row: {
          day: string
          salt: string
        }
        Insert: {
          day: string
          salt?: string
        }
        Update: {
          day?: string
          salt?: string
        }
        Relationships: []
      }
      marketplace_signups: {
        Row: {
          campaign: string | null
          coach_profile_id: string | null
          created_at: string
          medium: string | null
          source: string | null
          user_id: string
        }
        Insert: {
          campaign?: string | null
          coach_profile_id?: string | null
          created_at?: string
          medium?: string | null
          source?: string | null
          user_id: string
        }
        Update: {
          campaign?: string | null
          coach_profile_id?: string | null
          created_at?: string
          medium?: string | null
          source?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "marketplace_signups_coach_profile_id_fkey"
            columns: ["coach_profile_id"]
            isOneToOne: false
            referencedRelation: "coach_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketplace_signups_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      measurements: {
        Row: {
          circumferences: Json
          created_at: string
          date: string
          id: string
          user_id: string
          weight_kg: number | null
        }
        Insert: {
          circumferences?: Json
          created_at?: string
          date: string
          id?: string
          user_id: string
          weight_kg?: number | null
        }
        Update: {
          circumferences?: Json
          created_at?: string
          date?: string
          id?: string
          user_id?: string
          weight_kg?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "measurements_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          body: string
          conversation_id: string
          created_at: string
          id: string
          read_at: string | null
          sender_id: string
        }
        Insert: {
          body: string
          conversation_id: string
          created_at?: string
          id?: string
          read_at?: string | null
          sender_id: string
        }
        Update: {
          body?: string
          conversation_id?: string
          created_at?: string
          id?: string
          read_at?: string | null
          sender_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string | null
          category: Database["public"]["Enums"]["notification_category"]
          created_at: string
          id: string
          payload: Json
          read_at: string | null
          sent_at: string | null
          title: string
          user_id: string
        }
        Insert: {
          body?: string | null
          category: Database["public"]["Enums"]["notification_category"]
          created_at?: string
          id?: string
          payload?: Json
          read_at?: string | null
          sent_at?: string | null
          title: string
          user_id: string
        }
        Update: {
          body?: string | null
          category?: Database["public"]["Enums"]["notification_category"]
          created_at?: string
          id?: string
          payload?: Json
          read_at?: string | null
          sent_at?: string | null
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      nutrition_plans: {
        Row: {
          carbs_target_g: number
          client_id: string
          coach_id: string | null
          created_at: string
          fat_target_g: number
          id: string
          kcal_target: number
          name: string
          protein_target_g: number
          status: Database["public"]["Enums"]["publish_status"]
          updated_at: string
        }
        Insert: {
          carbs_target_g?: number
          client_id: string
          coach_id?: string | null
          created_at?: string
          fat_target_g?: number
          id?: string
          kcal_target: number
          name: string
          protein_target_g?: number
          status?: Database["public"]["Enums"]["publish_status"]
          updated_at?: string
        }
        Update: {
          carbs_target_g?: number
          client_id?: string
          coach_id?: string | null
          created_at?: string
          fat_target_g?: number
          id?: string
          kcal_target?: number
          name?: string
          protein_target_g?: number
          status?: Database["public"]["Enums"]["publish_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "nutrition_plans_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nutrition_plans_coach_id_fkey"
            columns: ["coach_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      onboarding_state: {
        Row: {
          state: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          state?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          state?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "onboarding_state_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      planned_meal_foods: {
        Row: {
          food_id: string
          grams: number
          id: string
          planned_meal_id: string
        }
        Insert: {
          food_id: string
          grams: number
          id?: string
          planned_meal_id: string
        }
        Update: {
          food_id?: string
          grams?: number
          id?: string
          planned_meal_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "planned_meal_foods_food_id_fkey"
            columns: ["food_id"]
            isOneToOne: false
            referencedRelation: "foods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "planned_meal_foods_planned_meal_id_fkey"
            columns: ["planned_meal_id"]
            isOneToOne: false
            referencedRelation: "planned_meals"
            referencedColumns: ["id"]
          },
        ]
      }
      planned_meals: {
        Row: {
          day_index: number
          id: string
          name: string
          plan_id: string
          position: number
          slot: Database["public"]["Enums"]["meal_slot"]
        }
        Insert: {
          day_index?: number
          id?: string
          name: string
          plan_id: string
          position?: number
          slot: Database["public"]["Enums"]["meal_slot"]
        }
        Update: {
          day_index?: number
          id?: string
          name?: string
          plan_id?: string
          position?: number
          slot?: Database["public"]["Enums"]["meal_slot"]
        }
        Relationships: [
          {
            foreignKeyName: "planned_meals_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "nutrition_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      program_days: {
        Row: {
          day_index: number
          id: string
          muscle_groups: string[]
          name: string
          program_id: string
          week_index: number
        }
        Insert: {
          day_index: number
          id?: string
          muscle_groups?: string[]
          name: string
          program_id: string
          week_index?: number
        }
        Update: {
          day_index?: number
          id?: string
          muscle_groups?: string[]
          name?: string
          program_id?: string
          week_index?: number
        }
        Relationships: [
          {
            foreignKeyName: "program_days_program_id_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "programs"
            referencedColumns: ["id"]
          },
        ]
      }
      program_exercises: {
        Row: {
          circuit: number | null
          exercise_id: string
          id: string
          measure: string
          notes: string | null
          position: number
          program_day_id: string
          rest_seconds: number | null
          set_type: string
          target_reps: string
          target_rpe: number | null
          target_sets: number
          target_weight_kg: number | null
        }
        Insert: {
          circuit?: number | null
          exercise_id: string
          id?: string
          measure?: string
          notes?: string | null
          position?: number
          program_day_id: string
          rest_seconds?: number | null
          set_type?: string
          target_reps: string
          target_rpe?: number | null
          target_sets: number
          target_weight_kg?: number | null
        }
        Update: {
          circuit?: number | null
          exercise_id?: string
          id?: string
          measure?: string
          notes?: string | null
          position?: number
          program_day_id?: string
          rest_seconds?: number | null
          set_type?: string
          target_reps?: string
          target_rpe?: number | null
          target_sets?: number
          target_weight_kg?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "program_exercises_exercise_id_fkey"
            columns: ["exercise_id"]
            isOneToOne: false
            referencedRelation: "exercises"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "program_exercises_program_day_id_fkey"
            columns: ["program_day_id"]
            isOneToOne: false
            referencedRelation: "program_days"
            referencedColumns: ["id"]
          },
        ]
      }
      program_saves: {
        Row: {
          created_at: string
          id: string
          program_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          program_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          program_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "program_saves_program_id_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "programs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "program_saves_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      programs: {
        Row: {
          activated_at: string | null
          client_id: string
          coach_id: string | null
          copy_count: number
          created_at: string
          description: string | null
          featured_at: string | null
          goal: string | null
          id: string
          intensity_mode: Database["public"]["Enums"]["intensity_mode"]
          is_official: boolean
          level: string | null
          name: string
          notes: string | null
          source_program_id: string | null
          status: Database["public"]["Enums"]["publish_status"]
          training_style: string | null
          updated_at: string
          visibility: string
          weeks: number
        }
        Insert: {
          activated_at?: string | null
          client_id: string
          coach_id?: string | null
          copy_count?: number
          created_at?: string
          description?: string | null
          featured_at?: string | null
          goal?: string | null
          id?: string
          intensity_mode?: Database["public"]["Enums"]["intensity_mode"]
          is_official?: boolean
          level?: string | null
          name: string
          notes?: string | null
          source_program_id?: string | null
          status?: Database["public"]["Enums"]["publish_status"]
          training_style?: string | null
          updated_at?: string
          visibility?: string
          weeks?: number
        }
        Update: {
          activated_at?: string | null
          client_id?: string
          coach_id?: string | null
          copy_count?: number
          created_at?: string
          description?: string | null
          featured_at?: string | null
          goal?: string | null
          id?: string
          intensity_mode?: Database["public"]["Enums"]["intensity_mode"]
          is_official?: boolean
          level?: string | null
          name?: string
          notes?: string | null
          source_program_id?: string | null
          status?: Database["public"]["Enums"]["publish_status"]
          training_style?: string | null
          updated_at?: string
          visibility?: string
          weeks?: number
        }
        Relationships: [
          {
            foreignKeyName: "programs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "programs_coach_id_fkey"
            columns: ["coach_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "programs_source_program_id_fkey"
            columns: ["source_program_id"]
            isOneToOne: false
            referencedRelation: "programs"
            referencedColumns: ["id"]
          },
        ]
      }
      progress_photos: {
        Row: {
          created_at: string
          date: string
          id: string
          pose: string | null
          storage_path: string
          user_id: string
        }
        Insert: {
          created_at?: string
          date: string
          id?: string
          pose?: string | null
          storage_path: string
          user_id: string
        }
        Update: {
          created_at?: string
          date?: string
          id?: string
          pose?: string | null
          storage_path?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "progress_photos_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          endpoint: string
          id: string
          p256dh: string
          updated_at: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          auth: string
          created_at?: string
          endpoint: string
          id?: string
          p256dh: string
          updated_at?: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          id?: string
          p256dh?: string
          updated_at?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "push_subscriptions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      recipe_ingredients: {
        Row: {
          dishfinder_ingredient_id: number | null
          food_id: string | null
          grams: number | null
          id: string
          label: string
          position: number
          recipe_id: string
        }
        Insert: {
          dishfinder_ingredient_id?: number | null
          food_id?: string | null
          grams?: number | null
          id?: string
          label: string
          position: number
          recipe_id: string
        }
        Update: {
          dishfinder_ingredient_id?: number | null
          food_id?: string | null
          grams?: number | null
          id?: string
          label?: string
          position?: number
          recipe_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "recipe_ingredients_food_id_fkey"
            columns: ["food_id"]
            isOneToOne: false
            referencedRelation: "foods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_ingredients_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "recipes"
            referencedColumns: ["id"]
          },
        ]
      }
      recipes: {
        Row: {
          carbs_serving: number
          created_at: string
          dishfinder_recipe_id: number | null
          dishfinder_url: string | null
          fat_serving: number
          id: string
          image_url: string | null
          kcal_serving: number
          nutrition_source: string
          owner_id: string
          protein_serving: number
          serving_grams: number
          servings: number
          title: string
          updated_at: string
        }
        Insert: {
          carbs_serving?: number
          created_at?: string
          dishfinder_recipe_id?: number | null
          dishfinder_url?: string | null
          fat_serving?: number
          id?: string
          image_url?: string | null
          kcal_serving: number
          nutrition_source: string
          owner_id: string
          protein_serving?: number
          serving_grams: number
          servings: number
          title: string
          updated_at?: string
        }
        Update: {
          carbs_serving?: number
          created_at?: string
          dishfinder_recipe_id?: number | null
          dishfinder_url?: string | null
          fat_serving?: number
          id?: string
          image_url?: string | null
          kcal_serving?: number
          nutrition_source?: string
          owner_id?: string
          protein_serving?: number
          serving_grams?: number
          servings?: number
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "recipes_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      rest_pushes: {
        Row: {
          alert: boolean
          body: string
          cancelled_at: string | null
          created_at: string
          id: string
          notify_at: string
          sent_at: string | null
          title: string
          url: string
          user_id: string
        }
        Insert: {
          alert?: boolean
          body: string
          cancelled_at?: string | null
          created_at?: string
          id: string
          notify_at: string
          sent_at?: string | null
          title: string
          url: string
          user_id: string
        }
        Update: {
          alert?: boolean
          body?: string
          cancelled_at?: string | null
          created_at?: string
          id?: string
          notify_at?: string
          sent_at?: string | null
          title?: string
          url?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rest_pushes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      set_videos: {
        Row: {
          created_at: string
          id: string
          logged_set_id: string
          review_status: string
          storage_path: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          logged_set_id: string
          review_status?: string
          storage_path: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          logged_set_id?: string
          review_status?: string
          storage_path?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "set_videos_logged_set_id_fkey"
            columns: ["logged_set_id"]
            isOneToOne: false
            referencedRelation: "logged_sets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "set_videos_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      social_comment_mentions: {
        Row: {
          comment_id: string
          created_at: string
          id: string
          user_id: string
        }
        Insert: {
          comment_id: string
          created_at?: string
          id?: string
          user_id: string
        }
        Update: {
          comment_id?: string
          created_at?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "social_comment_mentions_comment_id_fkey"
            columns: ["comment_id"]
            isOneToOne: false
            referencedRelation: "social_comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_comment_mentions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      social_comments: {
        Row: {
          body: string
          created_at: string
          edited_at: string | null
          id: string
          parent_id: string | null
          post_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          body: string
          created_at?: string
          edited_at?: string | null
          id?: string
          parent_id?: string | null
          post_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string
          edited_at?: string | null
          id?: string
          parent_id?: string | null
          post_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "social_comments_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "social_comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_comments_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "social_posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_comments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      social_follows: {
        Row: {
          created_at: string
          follower_id: string
          following_id: string
          id: string
        }
        Insert: {
          created_at?: string
          follower_id: string
          following_id: string
          id?: string
        }
        Update: {
          created_at?: string
          follower_id?: string
          following_id?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "social_follows_follower_id_fkey"
            columns: ["follower_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_follows_following_id_fkey"
            columns: ["following_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      social_media_uploads: {
        Row: {
          attached_at: string | null
          created_at: string
          discarded_at: string | null
          kind: string
          public_id: string
          user_id: string
        }
        Insert: {
          attached_at?: string | null
          created_at?: string
          discarded_at?: string | null
          kind?: string
          public_id: string
          user_id: string
        }
        Update: {
          attached_at?: string | null
          created_at?: string
          discarded_at?: string | null
          kind?: string
          public_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "social_media_uploads_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      social_post_media: {
        Row: {
          alt: string | null
          created_at: string
          height: number
          id: string
          kind: string
          overlay: Json | null
          position: number
          post_id: string
          public_id: string
          user_id: string
          width: number
        }
        Insert: {
          alt?: string | null
          created_at?: string
          height: number
          id?: string
          kind?: string
          overlay?: Json | null
          position: number
          post_id: string
          public_id: string
          user_id: string
          width: number
        }
        Update: {
          alt?: string | null
          created_at?: string
          height?: number
          id?: string
          kind?: string
          overlay?: Json | null
          position?: number
          post_id?: string
          public_id?: string
          user_id?: string
          width?: number
        }
        Relationships: [
          {
            foreignKeyName: "social_post_media_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "social_posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_post_media_public_id_fkey"
            columns: ["public_id"]
            isOneToOne: true
            referencedRelation: "social_media_uploads"
            referencedColumns: ["public_id"]
          },
          {
            foreignKeyName: "social_post_media_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      social_post_mentions: {
        Row: {
          created_at: string
          id: string
          post_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          post_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          post_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "social_post_mentions_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "social_posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_post_mentions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      social_post_saves: {
        Row: {
          created_at: string
          post_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          post_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          post_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "social_post_saves_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "social_posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_post_saves_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      social_posts: {
        Row: {
          activity_id: string | null
          challenge_id: string | null
          created_at: string
          deleted_at: string | null
          edited_at: string | null
          id: string
          payload: Json | null
          text: string | null
          type: string
          user_id: string
          visibility: string
        }
        Insert: {
          activity_id?: string | null
          challenge_id?: string | null
          created_at?: string
          deleted_at?: string | null
          edited_at?: string | null
          id?: string
          payload?: Json | null
          text?: string | null
          type: string
          user_id: string
          visibility?: string
        }
        Update: {
          activity_id?: string | null
          challenge_id?: string | null
          created_at?: string
          deleted_at?: string | null
          edited_at?: string | null
          id?: string
          payload?: Json | null
          text?: string | null
          type?: string
          user_id?: string
          visibility?: string
        }
        Relationships: [
          {
            foreignKeyName: "social_posts_activity_id_fkey"
            columns: ["activity_id"]
            isOneToOne: false
            referencedRelation: "logged_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_posts_challenge_id_fkey"
            columns: ["challenge_id"]
            isOneToOne: false
            referencedRelation: "challenges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_posts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      social_reactions: {
        Row: {
          created_at: string
          id: string
          post_id: string
          type: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          post_id: string
          type?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          post_id?: string
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "social_reactions_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "social_posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_reactions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      social_reports: {
        Row: {
          created_at: string
          details: string | null
          id: string
          reason: string
          reported_coach_profile_id: string | null
          reported_comment_id: string | null
          reported_post_id: string | null
          reported_review_id: string | null
          reported_user_id: string | null
          reporter_id: string
          resolution_note: string | null
          resolved_at: string | null
          resolved_by: string | null
          status: string
        }
        Insert: {
          created_at?: string
          details?: string | null
          id?: string
          reason: string
          reported_coach_profile_id?: string | null
          reported_comment_id?: string | null
          reported_post_id?: string | null
          reported_review_id?: string | null
          reported_user_id?: string | null
          reporter_id: string
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
        }
        Update: {
          created_at?: string
          details?: string | null
          id?: string
          reason?: string
          reported_coach_profile_id?: string | null
          reported_comment_id?: string | null
          reported_post_id?: string | null
          reported_review_id?: string | null
          reported_user_id?: string | null
          reporter_id?: string
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "social_reports_reported_coach_profile_id_fkey"
            columns: ["reported_coach_profile_id"]
            isOneToOne: false
            referencedRelation: "coach_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_reports_reported_comment_id_fkey"
            columns: ["reported_comment_id"]
            isOneToOne: false
            referencedRelation: "social_comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_reports_reported_post_id_fkey"
            columns: ["reported_post_id"]
            isOneToOne: false
            referencedRelation: "social_posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_reports_reported_review_id_fkey"
            columns: ["reported_review_id"]
            isOneToOne: false
            referencedRelation: "coach_reviews"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_reports_reported_user_id_fkey"
            columns: ["reported_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_reports_reporter_id_fkey"
            columns: ["reporter_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_reports_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      social_stories: {
        Row: {
          background: string
          body: string
          created_at: string
          expires_at: string
          id: string
          user_id: string
        }
        Insert: {
          background?: string
          body: string
          created_at?: string
          expires_at?: string
          id?: string
          user_id: string
        }
        Update: {
          background?: string
          body?: string
          created_at?: string
          expires_at?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "social_stories_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      social_story_views: {
        Row: {
          story_id: string
          viewed_at: string
          viewer_id: string
        }
        Insert: {
          story_id: string
          viewed_at?: string
          viewer_id: string
        }
        Update: {
          story_id?: string
          viewed_at?: string
          viewer_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "social_story_views_story_id_fkey"
            columns: ["story_id"]
            isOneToOne: false
            referencedRelation: "social_stories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_story_views_viewer_id_fkey"
            columns: ["viewer_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      social_user_blocks: {
        Row: {
          blocked_id: string
          blocker_id: string
          created_at: string
        }
        Insert: {
          blocked_id: string
          blocker_id: string
          created_at?: string
        }
        Update: {
          blocked_id?: string
          blocker_id?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "social_user_blocks_blocked_id_fkey"
            columns: ["blocked_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_user_blocks_blocker_id_fkey"
            columns: ["blocker_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      social_user_mutes: {
        Row: {
          created_at: string
          muted_id: string
          muter_id: string
        }
        Insert: {
          created_at?: string
          muted_id: string
          muter_id: string
        }
        Update: {
          created_at?: string
          muted_id?: string
          muter_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "social_user_mutes_muted_id_fkey"
            columns: ["muted_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_user_mutes_muter_id_fkey"
            columns: ["muter_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      specializations: {
        Row: {
          active: boolean
          category: string
          created_at: string
          id: string
          name_en: string
          name_ro: string
          parent_id: string | null
          qualification_evidence: string
          slug: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          category?: string
          created_at?: string
          id?: string
          name_en: string
          name_ro: string
          parent_id?: string | null
          qualification_evidence?: string
          slug: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          category?: string
          created_at?: string
          id?: string
          name_en?: string
          name_ro?: string
          parent_id?: string | null
          qualification_evidence?: string
          slug?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "specializations_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "specializations"
            referencedColumns: ["id"]
          },
        ]
      }
      streaks: {
        Row: {
          best: number
          current: number
          id: string
          last_activity_date: string | null
          type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          best?: number
          current?: number
          id?: string
          last_activity_date?: string | null
          type: string
          updated_at?: string
          user_id: string
        }
        Update: {
          best?: number
          current?: number
          id?: string
          last_activity_date?: string | null
          type?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "streaks_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      subscriptions: {
        Row: {
          cancel_at_period_end: boolean
          created_at: string
          current_period_end: string | null
          id: string
          provider: string
          status: string
          stripe_customer_id: string | null
          stripe_price_id: string | null
          stripe_subscription_id: string | null
          tier: string
          trial_ends_at: string | null
          trial_started_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end?: string | null
          id?: string
          provider?: string
          status?: string
          stripe_customer_id?: string | null
          stripe_price_id?: string | null
          stripe_subscription_id?: string | null
          tier?: string
          trial_ends_at?: string | null
          trial_started_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end?: string | null
          id?: string
          provider?: string
          status?: string
          stripe_customer_id?: string | null
          stripe_price_id?: string | null
          stripe_subscription_id?: string | null
          tier?: string
          trial_ends_at?: string | null
          trial_started_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      timezone_names: {
        Row: {
          name: string
        }
        Insert: {
          name: string
        }
        Update: {
          name?: string
        }
        Relationships: []
      }
      trainer_clients: {
        Row: {
          client_id: string | null
          coach_id: string
          created_at: string
          end_reason: string | null
          ended_at: string | null
          ended_by: string | null
          id: string
          invite_code: string | null
          invite_expires_at: string | null
          invited_at: string
          pause_reason: string | null
          paused_at: string | null
          paused_by: string | null
          started_at: string | null
          status: Database["public"]["Enums"]["relationship_status"]
          updated_at: string
        }
        Insert: {
          client_id?: string | null
          coach_id: string
          created_at?: string
          end_reason?: string | null
          ended_at?: string | null
          ended_by?: string | null
          id?: string
          invite_code?: string | null
          invite_expires_at?: string | null
          invited_at?: string
          pause_reason?: string | null
          paused_at?: string | null
          paused_by?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["relationship_status"]
          updated_at?: string
        }
        Update: {
          client_id?: string | null
          coach_id?: string
          created_at?: string
          end_reason?: string | null
          ended_at?: string | null
          ended_by?: string | null
          id?: string
          invite_code?: string | null
          invite_expires_at?: string | null
          invited_at?: string
          pause_reason?: string | null
          paused_at?: string | null
          paused_by?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["relationship_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "trainer_clients_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trainer_clients_coach_id_fkey"
            columns: ["coach_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trainer_clients_ended_by_fkey"
            columns: ["ended_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trainer_clients_paused_by_fkey"
            columns: ["paused_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      user_badges: {
        Row: {
          awarded_at: string
          badge_id: string
          user_id: string
        }
        Insert: {
          awarded_at?: string
          badge_id: string
          user_id: string
        }
        Update: {
          awarded_at?: string
          badge_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_badges_badge_id_fkey"
            columns: ["badge_id"]
            isOneToOne: false
            referencedRelation: "badges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_badges_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          avatar_url: string | null
          bio: string | null
          birth_year: number | null
          check_in_weekday: number
          city: string | null
          consent_version: string | null
          created_at: string
          fitness_score_public: number | null
          fitness_score_public_at: string | null
          fitness_score_visibility: string
          full_name: string | null
          gym_board: boolean
          health_data_consent_at: string | null
          home_gym_id: string | null
          id: string
          leaderboard_visibility: string
          length_unit: string
          locale: string
          notification_prefs: Json
          push_token: string | null
          rest_prefs: Json
          role: Database["public"]["Enums"]["user_role"]
          sex: string | null
          stats_visibility: string
          suspended_at: string | null
          suspended_reason: string | null
          terms_accepted_at: string | null
          timezone: string
          updated_at: string
          username: string | null
          weight_unit: string
        }
        Insert: {
          avatar_url?: string | null
          bio?: string | null
          birth_year?: number | null
          check_in_weekday?: number
          city?: string | null
          consent_version?: string | null
          created_at?: string
          fitness_score_public?: number | null
          fitness_score_public_at?: string | null
          fitness_score_visibility?: string
          full_name?: string | null
          gym_board?: boolean
          health_data_consent_at?: string | null
          home_gym_id?: string | null
          id: string
          leaderboard_visibility?: string
          length_unit?: string
          locale?: string
          notification_prefs?: Json
          push_token?: string | null
          rest_prefs?: Json
          role?: Database["public"]["Enums"]["user_role"]
          sex?: string | null
          stats_visibility?: string
          suspended_at?: string | null
          suspended_reason?: string | null
          terms_accepted_at?: string | null
          timezone?: string
          updated_at?: string
          username?: string | null
          weight_unit?: string
        }
        Update: {
          avatar_url?: string | null
          bio?: string | null
          birth_year?: number | null
          check_in_weekday?: number
          city?: string | null
          consent_version?: string | null
          created_at?: string
          fitness_score_public?: number | null
          fitness_score_public_at?: string | null
          fitness_score_visibility?: string
          full_name?: string | null
          gym_board?: boolean
          health_data_consent_at?: string | null
          home_gym_id?: string | null
          id?: string
          leaderboard_visibility?: string
          length_unit?: string
          locale?: string
          notification_prefs?: Json
          push_token?: string | null
          rest_prefs?: Json
          role?: Database["public"]["Enums"]["user_role"]
          sex?: string | null
          stats_visibility?: string
          suspended_at?: string | null
          suspended_reason?: string | null
          terms_accepted_at?: string | null
          timezone?: string
          updated_at?: string
          username?: string | null
          weight_unit?: string
        }
        Relationships: [
          {
            foreignKeyName: "users_home_gym_id_fkey"
            columns: ["home_gym_id"]
            isOneToOne: false
            referencedRelation: "gyms"
            referencedColumns: ["id"]
          },
        ]
      }
      workout_events: {
        Row: {
          created_at: string
          event: string
          id: number
          payload: Json
          session_id: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          event: string
          id?: never
          payload?: Json
          session_id?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          event?: string
          id?: never
          payload?: Json
          session_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workout_events_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "logged_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workout_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      admin_login_events: {
        Row: {
          created_at: string | null
          ip: string | null
          provider: string | null
          user_id: string | null
        }
        Relationships: []
      }
      my_plan: {
        Row: {
          has_stripe: boolean | null
          own_tier: string | null
          paywall: boolean | null
          status: string | null
          tier: string | null
          trial_available: boolean | null
          trial_ends_at: string | null
          user_id: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      accept_coaching_request: { Args: { p_request: string }; Returns: string }
      accept_consent: { Args: { p_version: string }; Returns: undefined }
      accept_invite: { Args: { p_code: string }; Returns: string }
      achievement_facts: {
        Args: { p_metrics?: string[]; p_user: string }
        Returns: Json
      }
      achievement_progress: {
        Args: never
        Returns: {
          awarded_at: string
          category: string
          current_value: number
          icon: string
          kind: string
          metric: string
          name_en: string
          name_ro: string
          rarity: string
          shared: boolean
          slug: string
          sort: number
          target: number
        }[]
      }
      admin_active_user_ids: {
        Args: { p_from: string; p_to: string }
        Returns: {
          user_id: string
        }[]
      }
      admin_app_errors: {
        Args: {
          p_days?: number
          p_limit?: number
          p_offset?: number
          p_search?: string
          p_source?: string
          p_status?: string
        }
        Returns: Json
      }
      admin_approve_gym: { Args: { p_id: string }; Returns: undefined }
      admin_assert: { Args: never; Returns: undefined }
      admin_audit_log: {
        Args: {
          p_action?: string
          p_actor?: string
          p_entity_type?: string
          p_from?: string
          p_limit?: number
          p_offset?: number
          p_search?: string
          p_target?: string
          p_to?: string
        }
        Returns: Json
      }
      admin_auth_stats: { Args: never; Returns: Json }
      admin_challenge_detail: { Args: { p_challenge: string }; Returns: Json }
      admin_challenges: { Args: never; Returns: Json }
      admin_coach_application: { Args: { p_profile: string }; Returns: Json }
      admin_coach_applications: {
        Args: {
          p_limit?: number
          p_offset?: number
          p_since?: string
          p_state?: string
        }
        Returns: Json
      }
      admin_coach_attention: {
        Args: { p_limit?: number }
        Returns: {
          display_name: string
          open_reports: number
          profile_id: string
          reasons: string[]
          slug: string
          status: string
        }[]
      }
      admin_coach_marketplace_summary: {
        Args: { p_profile: string }
        Returns: Json
      }
      admin_coach_profile_counts: { Args: never; Returns: Json }
      admin_coach_profiles: {
        Args: { p_status?: string; p_verification?: string }
        Returns: {
          display_name: string
          headline: string
          id: string
          published_at: string
          slug: string
          status: string
          submitted_at: string
          suspended_at: string
          updated_at: string
          user_id: string
          verification_requested_at: string
          verification_status: string
        }[]
      }
      admin_coach_ranking: {
        Args: {
          p_city?: string
          p_in_person?: boolean
          p_limit?: number
          p_online?: boolean
          p_profile?: string
          p_query?: string
          p_specializations?: string[]
        }
        Returns: {
          activity: number
          cold_start: number
          display_name: string
          engagement: number
          ord: number
          placement: number
          profile_id: string
          quality: number
          relevance: number
          responsiveness: number
          score: number
          signals: Json
          slug: string
          trust: number
          verified: boolean
        }[]
      }
      admin_coach_review: { Args: { p_profile: string }; Returns: Json }
      admin_coach_review_base: { Args: { p_profile: string }; Returns: Json }
      admin_coach_reviews: {
        Args: { p_coach?: string }
        Returns: {
          basis: string
          body: string
          coach_id: string
          coach_name: string
          coach_response: string
          created_at: string
          id: string
          moderation_reason: string
          open_reports: number
          rating: number
          reviewer_id: string
          reviewer_name: string
          status: string
        }[]
      }
      admin_coach_revision: { Args: { p_profile: string }; Returns: Json }
      admin_coach_revisions_pending: {
        Args: never
        Returns: {
          coach_profile_id: string
          display_name: string
          slug: string
          submitted_at: string
        }[]
      }
      admin_daily_series: {
        Args: { p_days?: number }
        Returns: {
          active_users: number
          day: string
          food_logs: number
          invitations: number
          logins: number
          new_users: number
          posts: number
          sets: number
          workouts: number
        }[]
      }
      admin_decide_coach_application: {
        Args: {
          p_decision: string
          p_note?: string
          p_profile: string
          p_profile_reviewed?: boolean
          p_qualifications_reviewed?: boolean
        }
        Returns: undefined
      }
      admin_decide_coach_revision: {
        Args: { p_approve: boolean; p_note?: string; p_profile: string }
        Returns: undefined
      }
      admin_decide_coach_revision_base: {
        Args: { p_approve: boolean; p_note?: string; p_profile: string }
        Returns: undefined
      }
      admin_delete_gym: { Args: { p_id: string }; Returns: undefined }
      admin_delete_post: {
        Args: { p_post: string; p_reason?: string }
        Returns: undefined
      }
      admin_exercises: {
        Args: {
          p_category?: string
          p_equipment?: string
          p_limit?: number
          p_muscle?: string
          p_offset?: number
          p_owner?: string
          p_search?: string
          p_source?: string
        }
        Returns: Json
      }
      admin_feedback: {
        Args: {
          p_days?: number
          p_kind?: string
          p_limit?: number
          p_offset?: number
          p_search?: string
          p_status?: string
        }
        Returns: Json
      }
      admin_gym_photo_queue: { Args: { p_limit?: number }; Returns: Json }
      admin_gym_tops: {
        Args: {
          p_city?: string
          p_limit?: number
          p_metric?: string
          p_period?: string
        }
        Returns: {
          athletes: number
          city: string
          gym_id: string
          members: number
          name: string
          rank: number
          score: number
          workouts: number
        }[]
      }
      admin_gyms: {
        Args: {
          p_limit?: number
          p_offset?: number
          p_search?: string
          p_status?: string
        }
        Returns: Json
      }
      admin_import_gyms: {
        Args: { p_city: string; p_places: Json }
        Returns: Json
      }
      admin_invitations: {
        Args: {
          p_days?: number
          p_limit?: number
          p_offset?: number
          p_search?: string
          p_status?: string
        }
        Returns: Json
      }
      admin_known_place_ids: { Args: { p_ids: string[] }; Returns: string[] }
      admin_marketplace_analytics: { Args: { p_weeks?: number }; Returns: Json }
      admin_marketplace_analytics_base: {
        Args: { p_weeks?: number }
        Returns: Json
      }
      admin_notification_stats: { Args: never; Returns: Json }
      admin_nutrition_stats: { Args: { p_days?: number }; Returns: Json }
      admin_overview: { Args: never; Returns: Json }
      admin_remove_push_subscription: {
        Args: { p_subscription: string }
        Returns: undefined
      }
      admin_report_counts: { Args: never; Returns: Json }
      admin_reports: {
        Args: {
          p_coach_profile?: string
          p_kind?: string
          p_limit?: number
          p_offset?: number
          p_status?: string
        }
        Returns: {
          coach_profile_id: string
          coach_slug: string
          coach_status: string
          created_at: string
          details: string
          id: string
          kind: string
          open_for_target: number
          reason: string
          reporter_id: string
          reporter_name: string
          resolution_note: string
          resolved_at: string
          review_body: string
          review_rating: number
          review_status: string
          status: string
          target_id: string
          target_label: string
          target_user_id: string
        }[]
      }
      admin_resolve_app_error: {
        Args: { p_all_alike?: boolean; p_id: number }
        Returns: number
      }
      admin_resolve_report: {
        Args: {
          p_all_for_target?: boolean
          p_note?: string
          p_report: string
          p_status: string
        }
        Returns: number
      }
      admin_revoke_invitation: {
        Args: { p_invitation: string }
        Returns: undefined
      }
      admin_save_gym: {
        Args: {
          p_address?: string
          p_city: string
          p_id: string
          p_lat?: number
          p_lng?: number
          p_maps_url?: string
          p_name: string
        }
        Returns: string
      }
      admin_search: {
        Args: { p_limit?: number; p_query: string }
        Returns: Json
      }
      admin_set_certification_status: {
        Args: { p_certification: string; p_note?: string; p_status: string }
        Returns: undefined
      }
      admin_set_certification_status_base: {
        Args: { p_certification: string; p_note?: string; p_status: string }
        Returns: undefined
      }
      admin_set_coach_profile_status: {
        Args: { p_profile: string; p_reason?: string; p_status: string }
        Returns: undefined
      }
      admin_set_coach_verification: {
        Args: {
          p_kind: string
          p_note?: string
          p_profile: string
          p_status: string
        }
        Returns: undefined
      }
      admin_set_coach_verification_status: {
        Args: { p_note?: string; p_profile: string; p_status: string }
        Returns: undefined
      }
      admin_set_feedback_status: {
        Args: { p_id: number; p_status: string }
        Returns: undefined
      }
      admin_set_gym_google: {
        Args: { p_id: string; p_place: Json }
        Returns: undefined
      }
      admin_set_gym_photo: {
        Args: { p_id: string; p_source: string; p_url: string }
        Returns: undefined
      }
      admin_set_program_flags: {
        Args: { p_featured: boolean; p_official: boolean; p_program: string }
        Returns: undefined
      }
      admin_set_review_status: {
        Args: { p_reason?: string; p_review: string; p_status: string }
        Returns: undefined
      }
      admin_set_suspended: {
        Args: { p_reason?: string; p_suspended: boolean; p_user: string }
        Returns: undefined
      }
      admin_set_tier: {
        Args: { new_tier: string; target_user: string }
        Returns: undefined
      }
      admin_set_username: {
        Args: { p_user: string; p_username: string }
        Returns: string
      }
      admin_set_verification_document_status: {
        Args: { p_document: string; p_note?: string; p_status: string }
        Returns: undefined
      }
      admin_social_post: { Args: { p_post: string }; Returns: Json }
      admin_social_posts: {
        Args: {
          p_author?: string
          p_limit?: number
          p_offset?: number
          p_search?: string
          p_status?: string
          p_type?: string
          p_visibility?: string
        }
        Returns: Json
      }
      admin_system_health: { Args: never; Returns: Json }
      admin_user_activity: {
        Args: never
        Returns: {
          last_activity_at: string
          last_check_in_at: string
          last_food_log_at: string
          last_habit_at: string
          last_measurement_at: string
          last_post_at: string
          last_workout_at: string
          sets: number
          sets_7d: number
          user_id: string
          workouts: number
          workouts_30d: number
          workouts_7d: number
        }[]
      }
      admin_user_detail: { Args: { p_user: string }; Returns: Json }
      admin_user_load_sessions: {
        Args: { p_days?: number; p_user: string }
        Returns: {
          completed_at: string
          sets: Json
          started_at: string
        }[]
      }
      admin_user_timeline: {
        Args: { p_before?: string; p_limit?: number; p_user: string }
        Returns: {
          detail: string
          entity_id: string
          entity_type: string
          kind: string
          occurred_at: string
          title: string
        }[]
      }
      admin_users: {
        Args: {
          p_active_days?: number
          p_coach?: string
          p_created_days?: number
          p_limit?: number
          p_offset?: number
          p_role?: string
          p_search?: string
          p_sort?: string
          p_status?: string
        }
        Returns: Json
      }
      admin_uuid_or_null: { Args: { p: string }; Returns: string }
      admin_workout_stats: { Args: { p_days?: number }; Returns: Json }
      audit_log: {
        Args: {
          p_action: Database["public"]["Enums"]["audit_action"]
          p_actor?: string
          p_entity_id?: string
          p_entity_type?: string
          p_ip?: string
          p_metadata?: Json
          p_target_user?: string
          p_user_agent?: string
        }
        Returns: undefined
      }
      award_badges_for: {
        Args: { p_metrics?: string[]; p_notify?: boolean; p_user: string }
        Returns: string[]
      }
      award_badges_from_facts: {
        Args: { p_facts: Json; p_notify: boolean; p_user: string }
        Returns: string[]
      }
      become_coach: { Args: never; Returns: string }
      book_service: {
        Args: { p_note?: string; p_service: string; p_start_at: string }
        Returns: string
      }
      booking_eligibility: {
        Args: { p_service: string; p_viewer: string }
        Returns: string
      }
      booking_notify: {
        Args: {
          p_actor: string
          p_booking: string
          p_event: string
          p_recipient: string
          p_screen: string
        }
        Returns: undefined
      }
      booking_slots_internal: {
        Args: {
          p_days: number
          p_from: string
          p_service: string
          p_viewer: string
        }
        Returns: {
          end_at: string
          start_at: string
        }[]
      }
      booking_timezone_valid: { Args: { p_tz: string }; Returns: boolean }
      calendar_connection_open: {
        Args: {
          p_account_label: string
          p_coach: string
          p_provider: string
          p_scopes: string[]
        }
        Returns: string
      }
      calendar_connections_due: {
        Args: { p_limit?: number }
        Returns: {
          coach_id: string
          connection_id: string
          provider: string
        }[]
      }
      calendar_credentials_purge: { Args: never; Returns: number }
      calendar_credentials_revoked: {
        Args: { p_connection: string }
        Returns: undefined
      }
      calendar_disconnect: {
        Args: { p_connection: string }
        Returns: undefined
      }
      calendar_set_source_availability: {
        Args: { p_on: boolean; p_source: string }
        Returns: undefined
      }
      calendar_sync_apply: {
        Args: {
          p_busy: Json
          p_calendars: Json
          p_connection: string
          p_from: string
          p_next_sync_at?: string
          p_to: string
        }
        Returns: number
      }
      calendar_sync_failed: {
        Args: { p_code: string; p_connection: string; p_retry_at?: string }
        Returns: undefined
      }
      can_edit_nutrition_plan: { Args: { p_plan: string }; Returns: boolean }
      can_edit_program: { Args: { p_program: string }; Returns: boolean }
      can_kudos_post: { Args: { p_post: string }; Returns: boolean }
      can_see_challenge: { Args: { p_challenge: string }; Returns: boolean }
      can_see_fitness_score: { Args: { p_user: string }; Returns: boolean }
      can_see_post: { Args: { p_post: string }; Returns: boolean }
      can_see_program: { Args: { p_program: string }; Returns: boolean }
      can_see_stats: { Args: { p_user: string }; Returns: boolean }
      can_see_story_author: { Args: { p_author: string }; Returns: boolean }
      cancel_booking: {
        Args: { p_booking: string; p_reason?: string }
        Returns: undefined
      }
      cancel_coaching_request: {
        Args: { p_request: string }
        Returns: undefined
      }
      challenge_cards: {
        Args: { p_challenge?: string }
        Returns: {
          completed_at: string
          description_en: string
          description_ro: string
          difficulty: string
          end_date: string
          exercise_id: string
          exercise_name_en: string
          exercise_name_ro: string
          id: string
          is_mine: boolean
          is_platform: boolean
          joined: boolean
          local_today: string
          milestones: number[]
          participant_count: number
          start_date: string
          target_value: number
          title_en: string
          title_ro: string
          type: string
          value: number
          visibility: string
        }[]
      }
      challenge_leaderboard: {
        Args: { p_challenge: string; p_limit?: number }
        Returns: {
          completed: boolean
          is_me: boolean
          participant_count: number
          rank: number
          username: string
          value: number
        }[]
      }
      challenge_progress_rows: {
        Args: { p_challenge: string }
        Returns: {
          day: string
          duration_min: number
          exercises: number
          full_name: string
          kind: string
          mean_rpe: number
          sets: number
          user_id: string
          username: string
          volume_kg: number
        }[]
      }
      challenge_sync: { Args: { p_challenge: string }; Returns: undefined }
      challenge_value: {
        Args: { p_challenge: string; p_user: string }
        Returns: number
      }
      claim_barcode_scan: { Args: never; Returns: number }
      claim_due_rest_pushes: {
        Args: { p_lead_seconds?: number; p_limit?: number }
        Returns: {
          alert: boolean
          body: string
          cancelled_at: string | null
          created_at: string
          id: string
          notify_at: string
          sent_at: string | null
          title: string
          url: string
          user_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "rest_pushes"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_signup_role: { Args: { p_role: string }; Returns: undefined }
      client_food_daily_totals: {
        Args: { p_client: string; p_from?: string }
        Returns: {
          carbs: number
          day: string
          entries: number
          fat: number
          kcal: number
          meals: number
          protein: number
        }[]
      }
      coach_add_verification_document: {
        Args: {
          p_bytes: number
          p_format: string
          p_kind: string
          p_label?: string
          p_public_id: string
          p_specialization?: string
        }
        Returns: string
      }
      coach_application_missing: {
        Args: { p_profile: string }
        Returns: string[]
      }
      coach_application_missing_disciplines: {
        Args: { p_profile: string }
        Returns: string[]
      }
      coach_apply_languages: {
        Args: { p_codes: string[]; p_profile: string }
        Returns: undefined
      }
      coach_apply_locations: {
        Args: { p_locations: Json; p_profile: string }
        Returns: undefined
      }
      coach_apply_specializations: {
        Args: { p_primary: string; p_profile: string; p_slugs: string[] }
        Returns: undefined
      }
      coach_booking_services: {
        Args: { p_slug: string }
        Returns: {
          access: string
          can_book: string
          confirmation: string
          duration_minutes: number
          max_advance_days: number
          min_notice_minutes: number
          service_id: string
          timezone: string
        }[]
      }
      coach_booking_slots: {
        Args: { p_days?: number; p_from: string; p_service: string }
        Returns: {
          end_at: string
          start_at: string
        }[]
      }
      coach_bookings: {
        Args: { p_scope?: string }
        Returns: {
          cancellation_reason: string
          cancelled_by_me: boolean
          client_avatar: string
          client_id: string
          client_name: string
          conversation_id: string
          created_at: string
          currency: string
          end_at: string
          id: string
          note: string
          price_cents: number
          price_unit: string
          service_name: string
          start_at: string
          status: string
          timezone: string
        }[]
      }
      coach_challenge_progress: {
        Args: never
        Returns: {
          challenge_id: string
          client_id: string
          completed: boolean
          username: string
          value: number
        }[]
      }
      coach_client_relationships: {
        Args: { p_scope?: string }
        Returns: {
          client_avatar: string
          client_id: string
          client_name: string
          completed_bookings: number
          conversation_id: string
          end_reason: string
          ended_at: string
          ended_by_me: boolean
          id: string
          next_booking_at: string
          pause_reason: string
          paused_at: string
          paused_by_me: boolean
          started_at: string
          status: string
        }[]
      }
      coach_conversations: {
        Args: never
        Returns: {
          client_avatar: string
          client_id: string
          client_name: string
          id: string
          last_at: string
          last_message: string
          open: boolean
          relationship: string
          unread: number
        }[]
      }
      coach_dashboard: {
        Args: never
        Returns: {
          avatar_url: string
          client_id: string
          full_name: string
          last_activity: string
          overall_pct: number
          pending_checkin: boolean
          reason: string
          signal: Database["public"]["Enums"]["adherence_signal"]
          unread_messages: number
        }[]
      }
      coach_discovery_facets: { Args: never; Returns: Json }
      coach_document_purge: {
        Args: {
          p_document: string
          p_mode: string
          p_retention_days?: number
          p_storage_public_id: string
        }
        Returns: boolean
      }
      coach_document_purge_candidates: {
        Args: { p_mode: string; p_retention_days?: number }
        Returns: {
          coach_user_id: string
          document_id: string
          reason: string
          storage_public_id: string
        }[]
      }
      coach_document_storage_ids: { Args: never; Returns: string[] }
      coach_marketplace_analytics: { Args: { p_days?: number }; Returns: Json }
      coach_marketplace_analytics_base: {
        Args: { p_days?: number }
        Returns: Json
      }
      coach_marketplace_overview: { Args: never; Returns: Json }
      coach_my_application: { Args: never; Returns: Json }
      coach_my_editable_profile: { Args: never; Returns: string }
      coach_my_live_profile: { Args: never; Returns: string }
      coach_my_reviews: { Args: never; Returns: Json }
      coach_my_revision: { Args: never; Returns: Json }
      coach_my_revision_payload: { Args: never; Returns: Json }
      coach_profile_content: { Args: { p_profile: string }; Returns: Json }
      coach_profile_editable: { Args: { p_profile: string }; Returns: boolean }
      coach_profile_missing: { Args: { p_profile?: string }; Returns: string[] }
      coach_profile_owned: { Args: { p_profile: string }; Returns: boolean }
      coach_profile_snapshot: { Args: { p_profile: string }; Returns: Json }
      coach_profiles_search_parts: {
        Args: {
          p_about: string
          p_approach: string
          p_experience: string
          p_headline: string
          p_profile: string
          p_user: string
        }
        Returns: Record<string, unknown>
      }
      coach_profiles_search_text: {
        Args: {
          p_about: string
          p_headline: string
          p_profile: string
          p_user: string
        }
        Returns: string
      }
      coach_public_availability: { Args: { p_profile: string }; Returns: Json }
      coach_public_posts: {
        Args: { p_limit?: number; p_slug: string }
        Returns: {
          comments: number
          created_at: string
          id: string
          photos: number
          reactions: number
          text: string
          type: string
        }[]
      }
      coach_public_profile: { Args: { p_slug: string }; Returns: Json }
      coach_public_profile_base: { Args: { p_slug: string }; Returns: Json }
      coach_public_programs: {
        Args: { p_limit?: number; p_slug: string }
        Returns: Json
      }
      coach_public_reviews: {
        Args: { p_limit?: number; p_offset?: number; p_slug: string }
        Returns: Json
      }
      coach_public_visible: {
        Args: { p_slug: string }
        Returns: {
          profile_id: string
          user_id: string
        }[]
      }
      coach_query_tokens: {
        Args: { p_query: string }
        Returns: {
          ids: string[]
          kind: string
          n: number
          tok: string
        }[]
      }
      coach_rank_completeness: { Args: { p_profile: string }; Returns: number }
      coach_rank_signals_refresh: {
        Args: { p_profile?: string }
        Returns: number
      }
      coach_ranked: {
        Args: {
          p_accepting?: boolean
          p_available?: boolean
          p_city?: string
          p_country?: string
          p_currency?: string
          p_gym?: string
          p_hybrid?: boolean
          p_in_person?: boolean
          p_languages?: string[]
          p_min_rating?: number
          p_min_years?: number
          p_online?: boolean
          p_price_max?: number
          p_price_min?: number
          p_query?: string
          p_saved?: boolean
          p_service_kinds?: string[]
          p_sort?: string
          p_specializations?: string[]
          p_verified?: boolean
        }
        Returns: {
          activity: number
          cold_start: number
          engagement: number
          exact_name: boolean
          next_available_at: string
          ord: number
          placement: number
          profile_id: string
          quality: number
          rating_bayes: number
          relevance: number
          responsiveness: number
          saved_at: string
          score: number
          signals: Json
          trust: number
        }[]
      }
      coach_remove_verification_document: {
        Args: { p_document: string }
        Returns: string
      }
      coach_reorder_services: { Args: { p_ids: string[] }; Returns: undefined }
      coach_request_inbox: {
        Args: never
        Returns: {
          client_avatar: string
          client_city: string
          client_id: string
          client_name: string
          client_username: string
          created_at: string
          gym_name: string
          id: string
          message: string
          service_name: string
        }[]
      }
      coach_request_notify: {
        Args: {
          p_actor: string
          p_event: string
          p_recipient: string
          p_request: string
        }
        Returns: undefined
      }
      coach_requests: {
        Args: { p_status?: string }
        Returns: {
          client_avatar: string
          client_id: string
          client_name: string
          client_username: string
          created_at: string
          goal: string
          gym_name: string
          id: string
          message: string
          preferred_format: string
          relationship_status: string
          resolved_at: string
          service_name: string
          started: boolean
          status: string
        }[]
      }
      coach_review_eligibility: {
        Args: { p_coach: string; p_reviewer: string }
        Returns: {
          basis: string
          booking_id: string
          trainer_client_id: string
        }[]
      }
      coach_review_stats_refresh: {
        Args: { p_coach: string }
        Returns: undefined
      }
      coach_revision_apply: {
        Args: { p: Json; p_profile: string }
        Returns: undefined
      }
      coach_revision_apply_base: {
        Args: { p: Json; p_profile: string }
        Returns: undefined
      }
      coach_revision_check: {
        Args: { p_payload: Json; p_profile: string }
        Returns: string[]
      }
      coach_revision_discard: { Args: never; Returns: undefined }
      coach_revision_save: { Args: { p_payload: Json }; Returns: string[] }
      coach_revision_start: { Args: never; Returns: Json }
      coach_revision_submit: { Args: never; Returns: string[] }
      coach_saveable: { Args: { p_profile: string }; Returns: boolean }
      coach_search_tsquery: { Args: { p_query: string }; Returns: unknown }
      coach_set_languages: { Args: { p_codes: string[] }; Returns: undefined }
      coach_set_locations: { Args: { p_locations: Json }; Returns: undefined }
      coach_set_service_active: {
        Args: { p_active: boolean; p_service: string }
        Returns: undefined
      }
      coach_set_service_booking: {
        Args: {
          p_access?: string
          p_bookable: boolean
          p_buffer_after?: number
          p_buffer_before?: number
          p_confirmation?: string
          p_duration?: number
          p_max_advance?: number
          p_min_notice?: number
          p_service: string
        }
        Returns: undefined
      }
      coach_set_specializations: {
        Args: { p_primary?: string; p_slugs: string[] }
        Returns: undefined
      }
      coach_sitemap: {
        Args: { p_limit?: number; p_offset?: number }
        Returns: {
          last_modified: string
          slug: string
        }[]
      }
      coach_slug_base: { Args: { p_username: string }; Returns: string }
      coach_slug_redirect: { Args: { p_slug: string }; Returns: string }
      coach_slug_reserved: { Args: { p_slug: string }; Returns: boolean }
      coach_social_links_valid: { Args: { p: Json }; Returns: boolean }
      coach_token_score: {
        Args: {
          p_doc: unknown
          p_ids: string[]
          p_in_person: boolean
          p_kind: string
          p_online: boolean
          p_profile: string
          p_text: string
          p_tok: string
        }
        Returns: number
      }
      coach_viewer_state: { Args: { p_profile: string }; Returns: Json }
      coaching_notify: {
        Args: {
          p_actor: string
          p_event: string
          p_recipient: string
          p_relationship: string
          p_screen: string
        }
        Returns: undefined
      }
      coaching_relationship_history: {
        Args: { p_relationship: string }
        Returns: {
          actor: string
          created_at: string
          from_status: string
          reason: string
          to_status: string
        }[]
      }
      coaching_transition: {
        Args: { p_reason?: string; p_relationship: string; p_to: string }
        Returns: string
      }
      compute_adherence_snapshots: {
        Args: { p_week_start?: string }
        Returns: number
      }
      conversation_context: { Args: { p_conversation: string }; Returns: Json }
      conversation_open: { Args: { p_conversation: string }; Returns: boolean }
      conversation_pair_open: {
        Args: { p_client: string; p_coach: string }
        Returns: boolean
      }
      copy_program: {
        Args: { p_for_client?: string; p_name?: string; p_source: string }
        Returns: string
      }
      create_invite: {
        Args: never
        Returns: {
          code: string
          expires_at: string
          invite_id: string
        }[]
      }
      decline_coaching_request: {
        Args: { p_reason?: string; p_request: string }
        Returns: undefined
      }
      delete_my_coach_review: { Args: { p_review: string }; Returns: undefined }
      detect_booking_reminders: { Args: never; Returns: number }
      detect_checkin_due: { Args: never; Returns: number }
      detect_streak_risk: { Args: never; Returns: number }
      discover_programs: {
        Args: {
          p_equipment?: string
          p_featured?: boolean
          p_goal?: string
          p_level?: string
          p_limit?: number
          p_max_minutes?: number
          p_muscle?: string
          p_offset?: number
          p_q?: string
          p_sort?: string
          p_style?: string
        }
        Returns: {
          assigned_by_coach: boolean
          author_avatar: string
          author_id: string
          author_name: string
          author_username: string
          client_id: string
          coach_id: string
          copy_count: number
          created_at: string
          days: number
          days_per_week: number
          description: string
          equipment: string[]
          est_minutes: number
          exercises: number
          featured: boolean
          goal: string
          id: string
          is_mine: boolean
          level: string
          muscle_groups: string[]
          name: string
          saved: boolean
          session_minutes: number
          source: string
          source_program_id: string
          status: string
          total_sets: number
          training_style: string
          updated_at: string
          visibility: string
          weeks: number
        }[]
      }
      duplicate_program_exercise: { Args: { p_row: string }; Returns: string }
      effective_rpe: { Args: { p_rir: number; p_rpe: number }; Returns: number }
      effective_tier: { Args: { uid: string }; Returns: string }
      email_outbox_claim: {
        Args: { p_limit: number }
        Returns: {
          actor_name: string
          attempts: number
          category: string
          created_at: string
          deletion_requested: boolean
          email: string
          email_confirmed: boolean
          id: string
          locale: string
          notification_id: string
          payload: Json
          prefs: Json
          read_at: string
          starts_at: string
          suspended: boolean
          time_zone: string
          unsubscribe_token: string
          user_id: string
        }[]
      }
      email_outbox_mark: {
        Args: {
          p_error_code: string
          p_id: string
          p_last_status: number
          p_not_before: string
          p_provider_message_id: string
          p_reason: string
          p_status: string
        }
        Returns: undefined
      }
      email_outbox_peek: {
        Args: { p_limit: number }
        Returns: {
          actor_name: string
          attempts: number
          category: string
          created_at: string
          deletion_requested: boolean
          email: string
          email_confirmed: boolean
          id: string
          locale: string
          notification_id: string
          payload: Json
          prefs: Json
          read_at: string
          starts_at: string
          suspended: boolean
          time_zone: string
          unsubscribe_token: string
          user_id: string
        }[]
      }
      email_outbox_rows: {
        Args: { p_ids: string[] }
        Returns: {
          actor_name: string
          attempts: number
          category: string
          created_at: string
          deletion_requested: boolean
          email: string
          email_confirmed: boolean
          id: string
          locale: string
          notification_id: string
          payload: Json
          prefs: Json
          read_at: string
          starts_at: string
          suspended: boolean
          time_zone: string
          unsubscribe_token: string
          user_id: string
        }[]
      }
      email_pref_category_ok: { Args: { p_category: string }; Returns: boolean }
      email_rule_delay_minutes: {
        Args: { p_category: string; p_event: string }
        Returns: number
      }
      email_unsubscribe: {
        Args: { p_category: string; p_token: string; p_user: string }
        Returns: boolean
      }
      email_unsubscribe_token: {
        Args: { p_category: string; p_user: string }
        Returns: string
      }
      exercise_best_sets: {
        Args: never
        Returns: {
          completed_at: string
          exercise_id: string
          name_en: string
          name_ro: string
          reps: number
          weight_kg: number
        }[]
      }
      export_my_restricted_data: { Args: never; Returns: Json }
      fitness_score_of: {
        Args: { p_user: string }
        Returns: {
          active_days: number
          average_training_load: number
          band: string
          completed_workouts: number
          score: number
          status: string
          total_volume: number
        }[]
      }
      food_by_barcode: {
        Args: { p_code: string }
        Returns: {
          brand: string
          carbs_100g: number
          fat_100g: number
          id: string
          kcal_100g: number
          name_en: string
          name_ro: string
          portions: Json
          protein_100g: number
          source: Database["public"]["Enums"]["food_source"]
          verified: boolean
        }[]
      }
      food_by_id: {
        Args: { p_id: string }
        Returns: {
          brand: string
          carbs_100g: number
          fat_100g: number
          id: string
          kcal_100g: number
          name_en: string
          name_ro: string
          portions: Json
          protein_100g: number
          source: Database["public"]["Enums"]["food_source"]
          verified: boolean
        }[]
      }
      food_daily_totals: {
        Args: { p_from?: string }
        Returns: {
          carbs: number
          day: string
          entries: number
          fat: number
          kcal: number
          meals: number
          protein: number
        }[]
      }
      food_visible: {
        Args: { p_food: string; p_owner: string }
        Returns: boolean
      }
      foods_by_dishfinder_ids: {
        Args: { p_ids: number[] }
        Returns: {
          carbs_100g: number
          dishfinder_ingredient_id: number
          fat_100g: number
          id: string
          kcal_100g: number
          name_en: string
          name_ro: string
          protein_100g: number
          source: Database["public"]["Enums"]["food_source"]
        }[]
      }
      foods_by_ids: {
        Args: { p_ids: string[] }
        Returns: {
          carbs_100g: number
          fat_100g: number
          id: string
          kcal_100g: number
          name_en: string
          name_ro: string
          protein_100g: number
        }[]
      }
      gym_apply_google: {
        Args: { p_gym: string; p_place: Json }
        Returns: undefined
      }
      gym_board_listed: { Args: { p_user: string }; Returns: boolean }
      gym_boards_open: { Args: never; Returns: boolean }
      gym_bool_object: { Args: { p: Json }; Returns: Json }
      gym_coach_count: { Args: { p_gym: string }; Returns: number }
      gym_coaches_at: {
        Args: { p_gym: string }
        Returns: {
          accepting_clients: boolean
          avatar_url: string
          coach_profile_id: string
          display_name: string
          headline: string
          request_pending: boolean
          slug: string
        }[]
      }
      gym_countable: { Args: { p_user: string }; Returns: boolean }
      gym_google_field_mask: { Args: never; Returns: string }
      gym_google_refresh_collect: { Args: never; Returns: number }
      gym_google_refresh_request: { Args: never; Returns: number }
      gym_like: { Args: { p_text: string }; Returns: string }
      gym_period_start: { Args: { p_period: string }; Returns: string }
      gym_record_lifts: {
        Args: { p_gym: string }
        Returns: {
          exercise_id: string
          lifters: number
          name_en: string
          name_ro: string
        }[]
      }
      gym_records: {
        Args: {
          p_exercise: string
          p_gym: string
          p_kind?: string
          p_limit?: number
          p_period?: string
        }
        Returns: {
          achieved_at: string
          avatar_url: string
          display_name: string
          is_me: boolean
          rank: number
          reps: number
          user_id: string
          username: string
          weight_kg: number
        }[]
      }
      gym_sets: {
        Args: { p_gym: string; p_since?: string }
        Returns: {
          achieved_at: string
          exercise_id: string
          reps: number
          set_id: string
          user_id: string
          weight_kg: number
        }[]
      }
      gym_stats: { Args: { p_gym: string }; Returns: Json }
      gym_tops: {
        Args: {
          p_city?: string
          p_limit?: number
          p_metric?: string
          p_period?: string
        }
        Returns: {
          athletes: number
          city: string
          gym_id: string
          members: number
          name: string
          rank: number
          score: number
          workouts: number
        }[]
      }
      gyms_map: {
        Args: never
        Returns: {
          address: string
          athletes_30d: number
          city: string
          coaches: number
          google_rating: number
          id: string
          lat: number
          lng: number
          members: number
          name: string
        }[]
      }
      has_active_coach: { Args: never; Returns: boolean }
      hide_coach_profile: { Args: never; Returns: undefined }
      is_active_coach_of: { Args: { p_client: string }; Returns: boolean }
      is_admin: { Args: never; Returns: boolean }
      is_coach_user: { Args: never; Returns: boolean }
      is_connected_to: { Args: { p_user: string }; Returns: boolean }
      is_following: { Args: { p_user: string }; Returns: boolean }
      is_listed_user: { Args: { p_user: string }; Returns: boolean }
      is_valid_food_portions: { Args: { p_portions: Json }; Returns: boolean }
      is_warmup_set: {
        Args: { p_program_exercise_id: string }
        Returns: boolean
      }
      longest_workout_streak: { Args: { p_user: string }; Returns: number }
      mark_booking: {
        Args: { p_booking: string; p_outcome: string }
        Returns: undefined
      }
      mark_booking_base: {
        Args: { p_booking: string; p_outcome: string }
        Returns: undefined
      }
      mark_conversation_read: {
        Args: { p_conversation: string }
        Returns: number
      }
      marketplace_clean: { Args: { p: string; p_max: number }; Returns: string }
      marketplace_detail: {
        Args: { p_detail: string; p_event: string }
        Returns: string
      }
      marketplace_is_bot: { Args: { p_ua: string }; Returns: boolean }
      marketplace_notify: {
        Args: { p_event: string; p_payload?: Json; p_recipient: string }
        Returns: undefined
      }
      marketplace_profile_of: { Args: { p_coach: string }; Returns: string }
      marketplace_record: {
        Args: {
          p_dedupe: string
          p_event: string
          p_profile: string
          p_subject: string
        }
        Returns: undefined
      }
      marketplace_retention: { Args: never; Returns: undefined }
      marketplace_track: {
        Args: {
          p_campaign?: string
          p_city?: string
          p_detail?: string
          p_event: string
          p_medium?: string
          p_slug?: string
          p_source?: string
          p_specialization?: string
        }
        Returns: boolean
      }
      marketplace_user_agent: { Args: never; Returns: string }
      marketplace_visitor: { Args: never; Returns: string }
      move_program_day: {
        Args: { p_day: string; p_direction: number }
        Returns: boolean
      }
      my_bookings: {
        Args: never
        Returns: {
          cancellation_reason: string
          cancelled_by_me: boolean
          coach_avatar: string
          coach_id: string
          coach_name: string
          coach_slug: string
          conversation_id: string
          created_at: string
          currency: string
          end_at: string
          id: string
          note: string
          price_cents: number
          price_unit: string
          service_name: string
          start_at: string
          status: string
          timezone: string
        }[]
      }
      my_calendar_integrations: { Args: never; Returns: Json }
      my_coach_requests: {
        Args: never
        Returns: {
          coach_avatar: string
          coach_name: string
          coach_slug: string
          created_at: string
          gym_name: string
          id: string
        }[]
      }
      my_coach_review_state: {
        Args: { p_coach_profile: string }
        Returns: Json
      }
      my_coaching_relationships: {
        Args: never
        Returns: {
          coach_avatar: string
          coach_id: string
          coach_name: string
          coach_slug: string
          completed_bookings: number
          conversation_id: string
          end_reason: string
          ended_at: string
          ended_by_me: boolean
          id: string
          my_review: Json
          pause_reason: string
          paused_at: string
          paused_by_me: boolean
          started_at: string
          status: string
        }[]
      }
      my_coaching_requests: {
        Args: never
        Returns: {
          coach_avatar: string
          coach_name: string
          coach_slug: string
          created_at: string
          goal: string
          id: string
          message: string
          preferred_format: string
          relationship_status: string
          resolved_at: string
          service_name: string
          started: boolean
          status: string
        }[]
      }
      my_fitness_score: {
        Args: never
        Returns: {
          band: string
          score: number
          status: string
        }[]
      }
      my_gyms: { Args: never; Returns: Json }
      my_local_today: { Args: never; Returns: string }
      my_plan_row: {
        Args: never
        Returns: {
          has_stripe: boolean
          own_tier: string
          paywall: boolean
          status: string
          tier: string
          trial_available: boolean
          trial_ends_at: string
          user_id: string
        }[]
      }
      my_programs: {
        Args: { p_saved?: boolean }
        Returns: {
          assigned_by_coach: boolean
          author_avatar: string
          author_id: string
          author_name: string
          author_username: string
          client_id: string
          coach_id: string
          copy_count: number
          created_at: string
          days: number
          days_per_week: number
          description: string
          equipment: string[]
          est_minutes: number
          exercises: number
          featured: boolean
          goal: string
          id: string
          is_mine: boolean
          level: string
          muscle_groups: string[]
          name: string
          saved: boolean
          session_minutes: number
          source: string
          source_program_id: string
          status: string
          total_sets: number
          training_style: string
          updated_at: string
          visibility: string
          weeks: number
        }[]
      }
      my_recent_gyms: {
        Args: { p_limit?: number }
        Returns: {
          city: string
          id: string
          last_at: string
          name: string
        }[]
      }
      notification_actors: {
        Args: { p_ids: string[] }
        Returns: {
          avatar_url: string
          id: string
          name: string
          username: string
        }[]
      }
      onboarding_mark: {
        Args: { p_key: string; p_mark: string }
        Returns: Json
      }
      open_request_conversation: {
        Args: { p_request: string }
        Returns: string
      }
      own_tier: { Args: { uid: string }; Returns: string }
      paywall_on: { Args: { uid: string }; Returns: boolean }
      plan_limit: { Args: { p_key: string; p_tier: string }; Returns: number }
      program_assignees: {
        Args: { p_program: string }
        Returns: {
          client_id: string
          client_name: string
          program_id: string
          status: string
          updated_at: string
        }[]
      }
      program_card_rows: {
        Args: { p_ids: string[] }
        Returns: {
          assigned_by_coach: boolean
          author_avatar: string
          author_id: string
          author_name: string
          author_username: string
          client_id: string
          coach_id: string
          copy_count: number
          created_at: string
          days: number
          days_per_week: number
          description: string
          equipment: string[]
          est_minutes: number
          exercises: number
          featured: boolean
          goal: string
          id: string
          is_mine: boolean
          level: string
          muscle_groups: string[]
          name: string
          saved: boolean
          session_minutes: number
          source: string
          source_program_id: string
          status: string
          total_sets: number
          training_style: string
          updated_at: string
          visibility: string
          weeks: number
        }[]
      }
      program_clear_flags: { Args: { p_program: string }; Returns: undefined }
      program_usage: {
        Args: { p_program: string }
        Returns: {
          completed: number
          copies: number
          saves: number
          sessions: number
          users: number
        }[]
      }
      public_display_name: {
        Args: { p_full_name: string; p_username: string }
        Returns: string
      }
      purge_deleted_accounts: { Args: never; Returns: number }
      record_app_error: {
        Args: {
          p_digest?: string
          p_ip?: string
          p_level?: string
          p_message: string
          p_route?: string
          p_source: string
          p_stack?: string
          p_user_agent?: string
        }
        Returns: undefined
      }
      record_login_failure: {
        Args: { p_email: string; p_ip?: string; p_user_agent?: string }
        Returns: undefined
      }
      refresh_timezone_names: { Args: never; Returns: number }
      request_account_deletion: { Args: never; Returns: Json }
      request_coach_verification: {
        Args: { p_message?: string }
        Returns: string[]
      }
      request_coaching: {
        Args: {
          p_coach_profile: string
          p_format?: string
          p_goal?: string
          p_gym?: string
          p_message?: string
          p_service?: string
        }
        Returns: string
      }
      request_data_export: { Args: never; Returns: Json }
      respond_booking: {
        Args: { p_accept: boolean; p_booking: string; p_reason?: string }
        Returns: string
      }
      respond_to_coach_review: {
        Args: { p_body: string; p_review: string }
        Returns: undefined
      }
      review_notify: {
        Args: {
          p_actor: string
          p_event: string
          p_recipient: string
          p_review: string
          p_screen: string
          p_slug: string
        }
        Returns: undefined
      }
      search_coaches: {
        Args: {
          p_accepting?: boolean
          p_available?: boolean
          p_city?: string
          p_country?: string
          p_currency?: string
          p_gym?: string
          p_hybrid?: boolean
          p_in_person?: boolean
          p_languages?: string[]
          p_limit?: number
          p_min_rating?: number
          p_min_years?: number
          p_offset?: number
          p_online?: boolean
          p_price_max?: number
          p_price_min?: number
          p_query?: string
          p_saved?: boolean
          p_service_kinds?: string[]
          p_sort?: string
          p_specializations?: string[]
          p_verified?: boolean
        }
        Returns: Json
      }
      search_foods: {
        Args: { p_limit?: number; p_q: string }
        Returns: {
          brand: string
          carbs_100g: number
          fat_100g: number
          id: string
          kcal_100g: number
          name_en: string
          name_ro: string
          portions: Json
          protein_100g: number
          source: Database["public"]["Enums"]["food_source"]
          verified: boolean
        }[]
      }
      search_gyms: {
        Args: { p_limit?: number; p_query?: string }
        Returns: {
          address: string
          city: string
          coaches: number
          id: string
          lat: number
          lng: number
          maps_url: string
          members: number
          name: string
          status: string
        }[]
      }
      search_normalize: { Args: { p_text: string }; Returns: string }
      set_home_gym: {
        Args: { p_board?: boolean; p_gym: string }
        Returns: undefined
      }
      set_public_fitness_score: { Args: never; Returns: number }
      show_coach_profile: { Args: never; Returns: string[] }
      social_actor_active: { Args: never; Returns: boolean }
      social_author_visible: { Args: { p_author: string }; Returns: boolean }
      social_badges: {
        Args: { p_user: string }
        Returns: {
          awarded_at: string
          category: string
          icon: string
          kind: string
          metric: string
          name_en: string
          name_ro: string
          rarity: string
          shared: boolean
          slug: string
          target: number
        }[]
      }
      social_block_user: { Args: { p_user: string }; Returns: undefined }
      social_blocked_between: {
        Args: { p_a: string; p_b: string }
        Returns: boolean
      }
      social_comment_mention_shown: {
        Args: { p_comment: string; p_user: string }
        Returns: boolean
      }
      social_comment_preview: { Args: { p_post: string }; Returns: Json }
      social_comment_replies: {
        Args: { p_after?: string; p_limit?: number; p_parent: string }
        Returns: {
          author_avatar: string
          author_name: string
          author_username: string
          body: string
          created_at: string
          edited_at: string
          id: string
          mentions: Json
          parent_id: string
          reply_count: number
          user_id: string
        }[]
      }
      social_comment_shown: {
        Args: { p_author: string; p_parent: string }
        Returns: boolean
      }
      social_create_post: {
        Args: {
          p_activity_id?: string
          p_media?: Json
          p_payload?: Json
          p_text: string
          p_type: string
          p_visibility: string
        }
        Returns: string
      }
      social_feed: {
        Args: {
          p_author?: string
          p_before?: string
          p_limit?: number
          p_scope?: string
          p_type?: string
        }
        Returns: {
          activity_id: string
          author_avatar: string
          author_muted: boolean
          author_name: string
          author_username: string
          challenge_id: string
          comment_count: number
          comment_preview: Json
          created_at: string
          edited_at: string
          id: string
          kudos_count: number
          kudos_names: string[]
          love_count: number
          media: Json
          mentions: Json
          my_reaction: string
          payload: Json
          saved: boolean
          shared: Json
          text: string
          type: string
          user_id: string
          visibility: string
        }[]
      }
      social_follow_list: {
        Args: {
          p_before?: string
          p_limit?: number
          p_query?: string
          p_user: string
          p_which: string
        }
        Returns: {
          avatar_url: string
          followed_at: string
          follows_me: boolean
          id: string
          is_following: boolean
          name: string
          username: string
        }[]
      }
      social_is_muted: { Args: { p_user: string }; Returns: boolean }
      social_leaderboard: {
        Args: {
          p_limit?: number
          p_metric: string
          p_period: string
          p_scope?: string
        }
        Returns: {
          avatar_url: string
          display_name: string
          is_current_user: boolean
          rank: number
          score: number
          secondary_score: number
          user_id: string
          username: string
        }[]
      }
      social_mark_story_seen: { Args: { p_story: string }; Returns: boolean }
      social_media_discardable: {
        Args: { p_ids?: string[] }
        Returns: string[]
      }
      social_media_mark_discarded: {
        Args: { p_ids: string[] }
        Returns: number
      }
      social_media_upload_register: {
        Args: { p_count?: number }
        Returns: string[]
      }
      social_mention_candidates: {
        Args: { p_post?: string; p_query: string }
        Returns: {
          avatar_url: string
          can_see: boolean
          id: string
          name: string
          username: string
        }[]
      }
      social_mention_handles: { Args: { p_text: string }; Returns: string[] }
      social_mentions_cleanup: {
        Args: never
        Returns: {
          comment_rows: number
          post_rows: number
        }[]
      }
      social_mutual_followers: {
        Args: { p_limit?: number; p_user: string }
        Returns: {
          avatar_url: string
          id: string
          name: string
          total: number
          username: string
        }[]
      }
      social_notification_feed: {
        Args: {
          p_before_at?: string
          p_before_id?: string
          p_limit?: number
          p_unread_only?: boolean
        }
        Returns: {
          actor_avatar: string
          actor_id: string
          actor_name: string
          actor_username: string
          category: string
          created_at: string
          id: string
          payload: Json
          read_at: string
          snippet: string
          title: string
        }[]
      }
      social_notify_ok: {
        Args: { p_actor: string; p_recipient: string }
        Returns: boolean
      }
      social_post: {
        Args: { p_post: string }
        Returns: {
          activity_id: string
          author_avatar: string
          author_muted: boolean
          author_name: string
          author_username: string
          challenge_id: string
          comment_count: number
          created_at: string
          edited_at: string
          id: string
          kudos_count: number
          kudos_names: string[]
          love_count: number
          media: Json
          mentions: Json
          my_reaction: string
          payload: Json
          saved: boolean
          shared: Json
          text: string
          type: string
          user_id: string
          visibility: string
        }[]
      }
      social_post_comments: {
        Args: { p_before?: string; p_limit?: number; p_post: string }
        Returns: {
          author_avatar: string
          author_name: string
          author_username: string
          body: string
          created_at: string
          edited_at: string
          id: string
          mentions: Json
          parent_id: string
          reply_count: number
          user_id: string
        }[]
      }
      social_post_kudos: {
        Args: { p_before?: string; p_limit?: number; p_post: string }
        Returns: {
          avatar_url: string
          created_at: string
          name: string
          type: string
          user_id: string
          username: string
        }[]
      }
      social_post_media_json: { Args: { p_post: string }; Returns: Json }
      social_post_mention_shown: {
        Args: { p_post: string; p_user: string }
        Returns: boolean
      }
      social_profile: {
        Args: { p_user: string }
        Returns: {
          avatar_url: string
          badges: number
          bio: string
          blocked: boolean
          challenges: number
          city: string
          fitness_score: number
          fitness_score_at: string
          fitness_score_visibility: string
          followers: number
          following: number
          follows_me: boolean
          id: string
          is_following: boolean
          longest_streak: number
          muted: boolean
          name: string
          posts: number
          prs: number
          stats_visibility: string
          stats_visible: boolean
          streak_days: number
          username: string
          workouts: number
        }[]
      }
      social_profile_programs: {
        Args: { p_limit?: number; p_user: string }
        Returns: {
          id: string
        }[]
      }
      social_react: {
        Args: { p_post: string; p_type: string }
        Returns: string
      }
      social_report: {
        Args: {
          p_details?: string
          p_kind: string
          p_reason: string
          p_target: string
        }
        Returns: undefined
      }
      social_report_kind: {
        Args: { r: Database["public"]["Tables"]["social_reports"]["Row"] }
        Returns: string
      }
      social_report_target: {
        Args: { r: Database["public"]["Tables"]["social_reports"]["Row"] }
        Returns: string
      }
      social_reports_close_for: {
        Args: { p_kind: string; p_note: string; p_target: string }
        Returns: undefined
      }
      social_resolve_handles: {
        Args: { p_handles: string[] }
        Returns: {
          id: string
          username: string
        }[]
      }
      social_saved_posts: {
        Args: { p_before?: string; p_limit?: number }
        Returns: {
          activity_id: string
          author_avatar: string
          author_muted: boolean
          author_name: string
          author_username: string
          challenge_id: string
          comment_count: number
          comment_preview: Json
          created_at: string
          edited_at: string
          id: string
          kudos_count: number
          kudos_names: string[]
          love_count: number
          media: Json
          mentions: Json
          my_reaction: string
          payload: Json
          saved: boolean
          saved_at: string
          shared: Json
          text: string
          type: string
          user_id: string
          visibility: string
        }[]
      }
      social_search_users: {
        Args: {
          p_city?: string
          p_limit?: number
          p_offset?: number
          p_query: string
        }
        Returns: {
          avatar_url: string
          city: string
          id: string
          is_following: boolean
          name: string
          username: string
        }[]
      }
      social_shared_original: { Args: { p_payload: Json }; Returns: Json }
      social_story_tray: {
        Args: never
        Returns: {
          avatar_url: string
          is_me: boolean
          latest_at: string
          name: string
          stories: number
          unseen: number
          user_id: string
        }[]
      }
      social_story_viewers: {
        Args: { p_before?: string; p_limit?: number; p_story: string }
        Returns: {
          avatar_url: string
          name: string
          user_id: string
          viewed_at: string
        }[]
      }
      social_streak: {
        Args: { p_user: string }
        Returns: {
          current_days: number
          longest_days: number
        }[]
      }
      social_suggested_people: {
        Args: { p_limit?: number }
        Returns: {
          avatar_url: string
          followers: number
          id: string
          is_following: boolean
          mutuals: number
          name: string
          username: string
        }[]
      }
      social_try_uuid: { Args: { p: string }; Returns: string }
      social_unblock_user: { Args: { p_user: string }; Returns: undefined }
      social_user_stories: {
        Args: { p_user: string }
        Returns: {
          background: string
          body: string
          created_at: string
          expires_at: string
          id: string
          seen: boolean
          view_count: number
        }[]
      }
      social_visible_comment_count: {
        Args: { p_post: string }
        Returns: number
      }
      social_visible_comment_mentions: {
        Args: { p_comment: string }
        Returns: Json
      }
      social_visible_post_mentions: { Args: { p_post: string }; Returns: Json }
      social_visible_reply_count: {
        Args: { p_parent: string }
        Returns: number
      }
      specialization_slugs_expand: {
        Args: { p_slugs: string[] }
        Returns: string[]
      }
      start_coaching_from_request: {
        Args: { p_request: string }
        Returns: string
      }
      start_trial: { Args: never; Returns: string }
      submit_coach_for_review: { Args: never; Returns: string[] }
      submit_coach_review: {
        Args: { p_body?: string; p_coach_profile: string; p_rating: number }
        Returns: string
      }
      submit_feedback: {
        Args: {
          p_kind: string
          p_locale?: string
          p_message: string
          p_route?: string
          p_user_agent?: string
        }
        Returns: number
      }
      suggest_gym: {
        Args: {
          p_address?: string
          p_city: string
          p_maps_url?: string
          p_name: string
        }
        Returns: string
      }
      tick_marketplace_email: { Args: never; Returns: undefined }
      tick_rest_pushes: { Args: never; Returns: undefined }
      time_multirange: { Args: never; Returns: unknown }
      training_load_score: {
        Args: {
          p_duration_min: number
          p_exercises: number
          p_intensity: number
          p_sets: number
          p_volume_kg: number
        }
        Returns: number
      }
      trial_available: { Args: { uid: string }; Returns: boolean }
      user_can_see_post: {
        Args: { p_post: string; p_user: string }
        Returns: boolean
      }
      user_plan_limit: { Args: { p_key: string; uid: string }; Returns: number }
      username_available: { Args: { p_username: string }; Returns: boolean }
      withdraw_coach_profile: { Args: never; Returns: undefined }
      workout_days: {
        Args: { p_user?: string }
        Returns: {
          day: string
          workouts: number
        }[]
      }
    }
    Enums: {
      adherence_signal: "on_track" | "needs_attention" | "at_risk"
      audit_action:
        | "USER_CREATED"
        | "USER_LOGIN"
        | "LOGIN_FAILED"
        | "ROLE_CHANGED"
        | "USER_SUSPENDED"
        | "USER_REACTIVATED"
        | "ACCOUNT_DELETION_REQUESTED"
        | "TIER_CHANGED"
        | "INVITATION_CREATED"
        | "INVITATION_ACCEPTED"
        | "INVITATION_REVOKED"
        | "RELATIONSHIP_ENDED"
        | "PROGRAM_CREATED"
        | "PROGRAM_UPDATED"
        | "PROGRAM_DELETED"
        | "WORKOUT_STARTED"
        | "WORKOUT_COMPLETED"
        | "WORKOUT_DELETED"
        | "SET_LOGGED"
        | "SET_EDITED"
        | "SET_DELETED"
        | "EXERCISE_CREATED"
        | "EXERCISE_UPDATED"
        | "EXERCISE_DELETED"
        | "CHALLENGE_CREATED"
        | "CHALLENGE_JOINED"
        | "CHALLENGE_COMPLETED"
        | "POST_CREATED"
        | "POST_DELETED"
        | "COMMENT_CREATED"
        | "COMMENT_DELETED"
        | "KUDOS_ADDED"
        | "KUDOS_REMOVED"
        | "FOLLOW_CREATED"
        | "FOLLOW_REMOVED"
        | "PUSH_SUBSCRIBED"
        | "PUSH_UNSUBSCRIBED"
        | "ADMIN_ACTION"
        | "RELATIONSHIP_PAUSED"
        | "RELATIONSHIP_RESUMED"
      feedback_reference: "session" | "set" | "check_in" | "set_video"
      food_log_method:
        | "plan"
        | "search"
        | "barcode"
        | "recent"
        | "copy"
        | "custom"
        | "recipe"
      food_source: "off" | "usda" | "custom"
      intensity_mode: "rpe" | "rir" | "simple"
      meal_slot: "breakfast" | "lunch" | "dinner" | "snack"
      notification_category:
        | "workout_reminder"
        | "streak_at_risk"
        | "check_in_due"
        | "plan_updated"
        | "new_message"
        | "new_feedback"
        | "achievement"
        | "checkin_submitted"
        | "client_at_risk"
        | "new_kudos"
        | "new_comment"
        | "new_follower"
        | "comment_reply"
        | "new_mention"
        | "badge_earned"
        | "challenge_milestone"
        | "coaching_request"
        | "booking"
        | "review"
        | "coaching"
        | "marketplace"
      publish_status: "draft" | "published" | "archived"
      relationship_status: "invited" | "active" | "paused" | "ended"
      simple_effort: "easy" | "moderate" | "hard"
      user_role: "client" | "coach" | "both" | "admin"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      adherence_signal: ["on_track", "needs_attention", "at_risk"],
      audit_action: [
        "USER_CREATED",
        "USER_LOGIN",
        "LOGIN_FAILED",
        "ROLE_CHANGED",
        "USER_SUSPENDED",
        "USER_REACTIVATED",
        "ACCOUNT_DELETION_REQUESTED",
        "TIER_CHANGED",
        "INVITATION_CREATED",
        "INVITATION_ACCEPTED",
        "INVITATION_REVOKED",
        "RELATIONSHIP_ENDED",
        "PROGRAM_CREATED",
        "PROGRAM_UPDATED",
        "PROGRAM_DELETED",
        "WORKOUT_STARTED",
        "WORKOUT_COMPLETED",
        "WORKOUT_DELETED",
        "SET_LOGGED",
        "SET_EDITED",
        "SET_DELETED",
        "EXERCISE_CREATED",
        "EXERCISE_UPDATED",
        "EXERCISE_DELETED",
        "CHALLENGE_CREATED",
        "CHALLENGE_JOINED",
        "CHALLENGE_COMPLETED",
        "POST_CREATED",
        "POST_DELETED",
        "COMMENT_CREATED",
        "COMMENT_DELETED",
        "KUDOS_ADDED",
        "KUDOS_REMOVED",
        "FOLLOW_CREATED",
        "FOLLOW_REMOVED",
        "PUSH_SUBSCRIBED",
        "PUSH_UNSUBSCRIBED",
        "ADMIN_ACTION",
        "RELATIONSHIP_PAUSED",
        "RELATIONSHIP_RESUMED",
      ],
      feedback_reference: ["session", "set", "check_in", "set_video"],
      food_log_method: [
        "plan",
        "search",
        "barcode",
        "recent",
        "copy",
        "custom",
        "recipe",
      ],
      food_source: ["off", "usda", "custom"],
      intensity_mode: ["rpe", "rir", "simple"],
      meal_slot: ["breakfast", "lunch", "dinner", "snack"],
      notification_category: [
        "workout_reminder",
        "streak_at_risk",
        "check_in_due",
        "plan_updated",
        "new_message",
        "new_feedback",
        "achievement",
        "checkin_submitted",
        "client_at_risk",
        "new_kudos",
        "new_comment",
        "new_follower",
        "comment_reply",
        "new_mention",
        "badge_earned",
        "challenge_milestone",
        "coaching_request",
        "booking",
        "review",
        "coaching",
        "marketplace",
      ],
      publish_status: ["draft", "published", "archived"],
      relationship_status: ["invited", "active", "paused", "ended"],
      simple_effort: ["easy", "moderate", "hard"],
      user_role: ["client", "coach", "both", "admin"],
    },
  },
} as const
