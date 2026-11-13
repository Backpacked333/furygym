
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "graphql_public": {
          Tables: {
            [_ in never]: never
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "graphql":
{ Args: { "extensions"?: Json,"operationName"?: string,"query"?: string,"variables"?: Json }; Returns: Json
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        },"public": {
          Tables: {
            "audit_log": {
                  Row: {
                    "action": string,"actor_id": string | null,"created_at": string,"details": Json | null,"entity": string,"entity_id": string | null,"gym_id": string | null,"id": number
                  }
                  ComputedFields: never
                  Insert: {
                    "action": string,"actor_id"?: string | null,"created_at"?: string,"details"?: Json | null,"entity": string,"entity_id"?: string | null,"gym_id"?: string | null,"id"?: never
                  }
                  Update: {
                    "action"?: string,"actor_id"?: string | null,"created_at"?: string,"details"?: Json | null,"entity"?: string,"entity_id"?: string | null,"gym_id"?: string | null,"id"?: never
                  }
                  Relationships: [
                    {
      foreignKeyName: "audit_log_gym_id_fkey"
      columns: ["gym_id"]
isOneToOne: false
      referencedRelation: "gyms"
      referencedColumns: ["id"]
    }
                  ]
                },"bookings": {
                  Row: {
                    "booked_at": string,"cancelled_at": string | null,"checked_in_at": string | null,"checked_in_by": string | null,"credit_used": boolean,"gym_id": string,"id": string,"late_cancel": boolean,"membership_id": string | null,"session_id": string,"status": Database["public"]['Enums']["booking_status"],"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "booked_at"?: string,"cancelled_at"?: string | null,"checked_in_at"?: string | null,"checked_in_by"?: string | null,"credit_used"?: boolean,"gym_id": string,"id"?: string,"late_cancel"?: boolean,"membership_id"?: string | null,"session_id": string,"status"?: Database["public"]['Enums']["booking_status"],"user_id": string
                  }
                  Update: {
                    "booked_at"?: string,"cancelled_at"?: string | null,"checked_in_at"?: string | null,"checked_in_by"?: string | null,"credit_used"?: boolean,"gym_id"?: string,"id"?: string,"late_cancel"?: boolean,"membership_id"?: string | null,"session_id"?: string,"status"?: Database["public"]['Enums']["booking_status"],"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "bookings_checked_in_by_fkey"
      columns: ["checked_in_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "bookings_gym_id_fkey"
      columns: ["gym_id"]
isOneToOne: false
      referencedRelation: "gyms"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "bookings_membership_id_fkey"
      columns: ["membership_id"]
isOneToOne: false
      referencedRelation: "memberships"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "bookings_session_id_fkey"
      columns: ["session_id"]
isOneToOne: false
      referencedRelation: "class_session_overview"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "bookings_session_id_fkey"
      columns: ["session_id"]
isOneToOne: false
      referencedRelation: "class_sessions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "bookings_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"checkin_secrets": {
                  Row: {
                    "created_at": string,"secret": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"secret"?: string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"secret"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "checkin_secrets_user_id_fkey"
      columns: ["user_id"]
isOneToOne: true
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"class_schedules": {
                  Row: {
                    "active": boolean,"capacity": number,"coach_id": string | null,"created_at": string,"duration_minutes": number,"gym_id": string,"id": string,"start_time": string,"title": string,"track_id": string | null,"valid_from": string | null,"valid_until": string | null,"weekday": number
                  }
                  ComputedFields: never
                  Insert: {
                    "active"?: boolean,"capacity"?: number,"coach_id"?: string | null,"created_at"?: string,"duration_minutes"?: number,"gym_id": string,"id"?: string,"start_time": string,"title": string,"track_id"?: string | null,"valid_from"?: string | null,"valid_until"?: string | null,"weekday": number
                  }
                  Update: {
                    "active"?: boolean,"capacity"?: number,"coach_id"?: string | null,"created_at"?: string,"duration_minutes"?: number,"gym_id"?: string,"id"?: string,"start_time"?: string,"title"?: string,"track_id"?: string | null,"valid_from"?: string | null,"valid_until"?: string | null,"weekday"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "class_schedules_coach_id_fkey"
      columns: ["coach_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "class_schedules_gym_id_fkey"
      columns: ["gym_id"]
isOneToOne: false
      referencedRelation: "gyms"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "class_schedules_track_id_fkey"
      columns: ["track_id"]
isOneToOne: false
      referencedRelation: "tracks"
      referencedColumns: ["id"]
    }
                  ]
                },"class_sessions": {
                  Row: {
                    "capacity": number,"coach_id": string | null,"created_at": string,"ends_at": string,"gym_id": string,"id": string,"notes": string | null,"schedule_id": string | null,"starts_at": string,"status": string,"title": string,"track_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "capacity": number,"coach_id"?: string | null,"created_at"?: string,"ends_at": string,"gym_id": string,"id"?: string,"notes"?: string | null,"schedule_id"?: string | null,"starts_at": string,"status"?: string,"title": string,"track_id"?: string | null
                  }
                  Update: {
                    "capacity"?: number,"coach_id"?: string | null,"created_at"?: string,"ends_at"?: string,"gym_id"?: string,"id"?: string,"notes"?: string | null,"schedule_id"?: string | null,"starts_at"?: string,"status"?: string,"title"?: string,"track_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "class_sessions_coach_id_fkey"
      columns: ["coach_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "class_sessions_gym_id_fkey"
      columns: ["gym_id"]
isOneToOne: false
      referencedRelation: "gyms"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "class_sessions_schedule_id_fkey"
      columns: ["schedule_id"]
isOneToOne: false
      referencedRelation: "class_schedules"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "class_sessions_track_id_fkey"
      columns: ["track_id"]
isOneToOne: false
      referencedRelation: "tracks"
      referencedColumns: ["id"]
    }
                  ]
                },"coach_feedback": {
                  Row: {
                    "body": string,"coach_id": string | null,"created_at": string,"id": string,"log_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "body": string,"coach_id"?: string | null,"created_at"?: string,"id"?: string,"log_id": string
                  }
                  Update: {
                    "body"?: string,"coach_id"?: string | null,"created_at"?: string,"id"?: string,"log_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "coach_feedback_coach_id_fkey"
      columns: ["coach_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "coach_feedback_log_id_fkey"
      columns: ["log_id"]
isOneToOne: false
      referencedRelation: "workout_logs"
      referencedColumns: ["id"]
    }
                  ]
                },"display_state": {
                  Row: {
                    "gym_id": string,"message": string | null,"mode": Database["public"]['Enums']["display_mode"],"show_checked_in": boolean,"show_coach_notes": boolean,"track_id": string | null,"updated_at": string,"updated_by": string | null,"workout_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "gym_id": string,"message"?: string | null,"mode"?: Database["public"]['Enums']["display_mode"],"show_checked_in"?: boolean,"show_coach_notes"?: boolean,"track_id"?: string | null,"updated_at"?: string,"updated_by"?: string | null,"workout_id"?: string | null
                  }
                  Update: {
                    "gym_id"?: string,"message"?: string | null,"mode"?: Database["public"]['Enums']["display_mode"],"show_checked_in"?: boolean,"show_coach_notes"?: boolean,"track_id"?: string | null,"updated_at"?: string,"updated_by"?: string | null,"workout_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "display_state_gym_id_fkey"
      columns: ["gym_id"]
isOneToOne: true
      referencedRelation: "gyms"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "display_state_track_id_fkey"
      columns: ["track_id"]
isOneToOne: false
      referencedRelation: "tracks"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "display_state_updated_by_fkey"
      columns: ["updated_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "display_state_workout_id_fkey"
      columns: ["workout_id"]
isOneToOne: false
      referencedRelation: "workouts"
      referencedColumns: ["id"]
    }
                  ]
                },"enrollments": {
                  Row: {
                    "created_at": string,"expires_at": string | null,"gym_id": string,"id": string,"program_id": string,"source": string,"start_date": string,"status": Database["public"]['Enums']["enrollment_status"],"stripe_checkout_session_id": string | null,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"expires_at"?: string | null,"gym_id": string,"id"?: string,"program_id": string,"source"?: string,"start_date": string,"status"?: Database["public"]['Enums']["enrollment_status"],"stripe_checkout_session_id"?: string | null,"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"expires_at"?: string | null,"gym_id"?: string,"id"?: string,"program_id"?: string,"source"?: string,"start_date"?: string,"status"?: Database["public"]['Enums']["enrollment_status"],"stripe_checkout_session_id"?: string | null,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "enrollments_gym_id_fkey"
      columns: ["gym_id"]
isOneToOne: false
      referencedRelation: "gyms"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "enrollments_program_id_fkey"
      columns: ["program_id"]
isOneToOne: false
      referencedRelation: "programs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "enrollments_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"exercises": {
                  Row: {
                    "archived": boolean,"category": string | null,"created_at": string,"cues": string | null,"default_metrics": (Database["public"]['Enums']["workout_metric"])[],"gym_id": string,"id": string,"name": string,"video_url": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "archived"?: boolean,"category"?: string | null,"created_at"?: string,"cues"?: string | null,"default_metrics"?: (Database["public"]['Enums']["workout_metric"])[],"gym_id": string,"id"?: string,"name": string,"video_url"?: string | null
                  }
                  Update: {
                    "archived"?: boolean,"category"?: string | null,"created_at"?: string,"cues"?: string | null,"default_metrics"?: (Database["public"]['Enums']["workout_metric"])[],"gym_id"?: string,"id"?: string,"name"?: string,"video_url"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "exercises_gym_id_fkey"
      columns: ["gym_id"]
isOneToOne: false
      referencedRelation: "gyms"
      referencedColumns: ["id"]
    }
                  ]
                },"gym_members": {
                  Row: {
                    "gym_id": string,"joined_at": string,"role": Database["public"]['Enums']["gym_role"],"status": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "gym_id": string,"joined_at"?: string,"role"?: Database["public"]['Enums']["gym_role"],"status"?: string,"user_id": string
                  }
                  Update: {
                    "gym_id"?: string,"joined_at"?: string,"role"?: Database["public"]['Enums']["gym_role"],"status"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "gym_members_gym_id_fkey"
      columns: ["gym_id"]
isOneToOne: false
      referencedRelation: "gyms"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "gym_members_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"gym_secrets": {
                  Row: {
                    "display_seen_at": string | null,"display_token": string,"gym_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "display_seen_at"?: string | null,"display_token"?: string,"gym_id": string,"updated_at"?: string
                  }
                  Update: {
                    "display_seen_at"?: string | null,"display_token"?: string,"gym_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "gym_secrets_gym_id_fkey"
      columns: ["gym_id"]
isOneToOne: true
      referencedRelation: "gyms"
      referencedColumns: ["id"]
    }
                  ]
                },"gyms": {
                  Row: {
                    "booking_window_days": number,"cancel_cutoff_minutes": number,"created_at": string,"id": string,"ios_program_purchase_link": boolean,"is_default": boolean,"milestone_reward": string | null,"milestone_visits": number,"name": string,"slug": string,"timezone": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "booking_window_days"?: number,"cancel_cutoff_minutes"?: number,"created_at"?: string,"id"?: string,"ios_program_purchase_link"?: boolean,"is_default"?: boolean,"milestone_reward"?: string | null,"milestone_visits"?: number,"name": string,"slug": string,"timezone"?: string,"updated_at"?: string
                  }
                  Update: {
                    "booking_window_days"?: number,"cancel_cutoff_minutes"?: number,"created_at"?: string,"id"?: string,"ios_program_purchase_link"?: boolean,"is_default"?: boolean,"milestone_reward"?: string | null,"milestone_visits"?: number,"name"?: string,"slug"?: string,"timezone"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"membership_plans": {
                  Row: {
                    "active": boolean,"billing_interval": string | null,"class_credits": number | null,"created_at": string,"currency": string,"description": string | null,"duration_days": number | null,"gym_id": string,"id": string,"is_public": boolean,"kind": Database["public"]['Enums']["plan_kind"],"name": string,"position": number,"price_cents": number,"stripe_price_id": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "active"?: boolean,"billing_interval"?: string | null,"class_credits"?: number | null,"created_at"?: string,"currency"?: string,"description"?: string | null,"duration_days"?: number | null,"gym_id": string,"id"?: string,"is_public"?: boolean,"kind": Database["public"]['Enums']["plan_kind"],"name": string,"position"?: number,"price_cents": number,"stripe_price_id"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "active"?: boolean,"billing_interval"?: string | null,"class_credits"?: number | null,"created_at"?: string,"currency"?: string,"description"?: string | null,"duration_days"?: number | null,"gym_id"?: string,"id"?: string,"is_public"?: boolean,"kind"?: Database["public"]['Enums']["plan_kind"],"name"?: string,"position"?: number,"price_cents"?: number,"stripe_price_id"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "membership_plans_gym_id_fkey"
      columns: ["gym_id"]
isOneToOne: false
      referencedRelation: "gyms"
      referencedColumns: ["id"]
    }
                  ]
                },"memberships": {
                  Row: {
                    "cancel_at_period_end": boolean,"created_at": string,"credits_remaining": number | null,"current_period_end": string | null,"ends_at": string | null,"frozen_until": string | null,"gym_id": string,"id": string,"plan_id": string,"source": string,"started_at": string,"status": Database["public"]['Enums']["membership_status"],"stripe_checkout_session_id": string | null,"stripe_subscription_id": string | null,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "cancel_at_period_end"?: boolean,"created_at"?: string,"credits_remaining"?: number | null,"current_period_end"?: string | null,"ends_at"?: string | null,"frozen_until"?: string | null,"gym_id": string,"id"?: string,"plan_id": string,"source"?: string,"started_at"?: string,"status"?: Database["public"]['Enums']["membership_status"],"stripe_checkout_session_id"?: string | null,"stripe_subscription_id"?: string | null,"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "cancel_at_period_end"?: boolean,"created_at"?: string,"credits_remaining"?: number | null,"current_period_end"?: string | null,"ends_at"?: string | null,"frozen_until"?: string | null,"gym_id"?: string,"id"?: string,"plan_id"?: string,"source"?: string,"started_at"?: string,"status"?: Database["public"]['Enums']["membership_status"],"stripe_checkout_session_id"?: string | null,"stripe_subscription_id"?: string | null,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "memberships_gym_id_fkey"
      columns: ["gym_id"]
isOneToOne: false
      referencedRelation: "gyms"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "memberships_plan_id_fkey"
      columns: ["plan_id"]
isOneToOne: false
      referencedRelation: "membership_plans"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "memberships_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"payments": {
                  Row: {
                    "amount_cents": number,"created_at": string,"currency": string,"description": string | null,"enrollment_id": string | null,"failure_reason": string | null,"fee_cents": number,"gym_id": string,"id": string,"kind": Database["public"]['Enums']["payment_kind"],"membership_id": string | null,"paid_at": string | null,"plan_id": string | null,"program_id": string | null,"refunded_cents": number,"revenue_stream": Database["public"]['Enums']["revenue_stream"],"status": Database["public"]['Enums']["payment_status"],"stripe_balance_transaction_id": string | null,"stripe_charge_id": string | null,"stripe_checkout_session_id": string | null,"stripe_invoice_id": string | null,"stripe_payment_intent_id": string | null,"tax_cents": number,"updated_at": string,"user_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "amount_cents": number,"created_at"?: string,"currency"?: string,"description"?: string | null,"enrollment_id"?: string | null,"failure_reason"?: string | null,"fee_cents"?: number,"gym_id": string,"id"?: string,"kind": Database["public"]['Enums']["payment_kind"],"membership_id"?: string | null,"paid_at"?: string | null,"plan_id"?: string | null,"program_id"?: string | null,"refunded_cents"?: number,"revenue_stream": Database["public"]['Enums']["revenue_stream"],"status"?: Database["public"]['Enums']["payment_status"],"stripe_balance_transaction_id"?: string | null,"stripe_charge_id"?: string | null,"stripe_checkout_session_id"?: string | null,"stripe_invoice_id"?: string | null,"stripe_payment_intent_id"?: string | null,"tax_cents"?: number,"updated_at"?: string,"user_id"?: string | null
                  }
                  Update: {
                    "amount_cents"?: number,"created_at"?: string,"currency"?: string,"description"?: string | null,"enrollment_id"?: string | null,"failure_reason"?: string | null,"fee_cents"?: number,"gym_id"?: string,"id"?: string,"kind"?: Database["public"]['Enums']["payment_kind"],"membership_id"?: string | null,"paid_at"?: string | null,"plan_id"?: string | null,"program_id"?: string | null,"refunded_cents"?: number,"revenue_stream"?: Database["public"]['Enums']["revenue_stream"],"status"?: Database["public"]['Enums']["payment_status"],"stripe_balance_transaction_id"?: string | null,"stripe_charge_id"?: string | null,"stripe_checkout_session_id"?: string | null,"stripe_invoice_id"?: string | null,"stripe_payment_intent_id"?: string | null,"tax_cents"?: number,"updated_at"?: string,"user_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "payments_enrollment_id_fkey"
      columns: ["enrollment_id"]
isOneToOne: false
      referencedRelation: "enrollments"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "payments_gym_id_fkey"
      columns: ["gym_id"]
isOneToOne: false
      referencedRelation: "gyms"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "payments_membership_id_fkey"
      columns: ["membership_id"]
isOneToOne: false
      referencedRelation: "memberships"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "payments_plan_id_fkey"
      columns: ["plan_id"]
isOneToOne: false
      referencedRelation: "membership_plans"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "payments_program_id_fkey"
      columns: ["program_id"]
isOneToOne: false
      referencedRelation: "programs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "payments_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"payouts": {
                  Row: {
                    "amount_cents": number,"arrival_date": string | null,"created_at": string,"currency": string,"gym_id": string,"id": string,"status": string,"stripe_payout_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount_cents": number,"arrival_date"?: string | null,"created_at"?: string,"currency"?: string,"gym_id": string,"id"?: string,"status": string,"stripe_payout_id": string
                  }
                  Update: {
                    "amount_cents"?: number,"arrival_date"?: string | null,"created_at"?: string,"currency"?: string,"gym_id"?: string,"id"?: string,"status"?: string,"stripe_payout_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "payouts_gym_id_fkey"
      columns: ["gym_id"]
isOneToOne: false
      referencedRelation: "gyms"
      referencedColumns: ["id"]
    }
                  ]
                },"profiles": {
                  Row: {
                    "avatar_url": string | null,"created_at": string,"date_of_birth": string | null,"email": string | null,"emergency_contact_name": string | null,"emergency_contact_phone": string | null,"full_name": string,"id": string,"phone": string | null,"units": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "avatar_url"?: string | null,"created_at"?: string,"date_of_birth"?: string | null,"email"?: string | null,"emergency_contact_name"?: string | null,"emergency_contact_phone"?: string | null,"full_name"?: string,"id": string,"phone"?: string | null,"units"?: string,"updated_at"?: string
                  }
                  Update: {
                    "avatar_url"?: string | null,"created_at"?: string,"date_of_birth"?: string | null,"email"?: string | null,"emergency_contact_name"?: string | null,"emergency_contact_phone"?: string | null,"full_name"?: string,"id"?: string,"phone"?: string | null,"units"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"program_workouts": {
                  Row: {
                    "day": number,"id": string,"program_id": string,"week": number,"workout_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "day": number,"id"?: string,"program_id": string,"week": number,"workout_id": string
                  }
                  Update: {
                    "day"?: number,"id"?: string,"program_id"?: string,"week"?: number,"workout_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "program_workouts_program_id_fkey"
      columns: ["program_id"]
isOneToOne: false
      referencedRelation: "programs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "program_workouts_workout_id_fkey"
      columns: ["workout_id"]
isOneToOne: false
      referencedRelation: "workouts"
      referencedColumns: ["id"]
    }
                  ]
                },"programs": {
                  Row: {
                    "created_at": string,"currency": string,"days_per_week": number,"description": string | null,"duration_weeks": number,"grace_days": number,"gym_id": string,"id": string,"name": string,"position": number,"price_cents": number,"slug": string,"status": Database["public"]['Enums']["program_status"],"stripe_price_id": string | null,"summary": string | null,"track_id": string | null,"unlock_mode": Database["public"]['Enums']["unlock_mode"],"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"currency"?: string,"days_per_week"?: number,"description"?: string | null,"duration_weeks": number,"grace_days"?: number,"gym_id": string,"id"?: string,"name": string,"position"?: number,"price_cents"?: number,"slug": string,"status"?: Database["public"]['Enums']["program_status"],"stripe_price_id"?: string | null,"summary"?: string | null,"track_id"?: string | null,"unlock_mode"?: Database["public"]['Enums']["unlock_mode"],"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"currency"?: string,"days_per_week"?: number,"description"?: string | null,"duration_weeks"?: number,"grace_days"?: number,"gym_id"?: string,"id"?: string,"name"?: string,"position"?: number,"price_cents"?: number,"slug"?: string,"status"?: Database["public"]['Enums']["program_status"],"stripe_price_id"?: string | null,"summary"?: string | null,"track_id"?: string | null,"unlock_mode"?: Database["public"]['Enums']["unlock_mode"],"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "programs_gym_id_fkey"
      columns: ["gym_id"]
isOneToOne: false
      referencedRelation: "gyms"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "programs_track_id_fkey"
      columns: ["track_id"]
isOneToOne: false
      referencedRelation: "tracks"
      referencedColumns: ["id"]
    }
                  ]
                },"stripe_customers": {
                  Row: {
                    "created_at": string,"stripe_customer_id": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"stripe_customer_id": string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"stripe_customer_id"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "stripe_customers_user_id_fkey"
      columns: ["user_id"]
isOneToOne: true
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"stripe_events": {
                  Row: {
                    "error": string | null,"id": string,"processed_at": string | null,"received_at": string,"type": string
                  }
                  ComputedFields: never
                  Insert: {
                    "error"?: string | null,"id": string,"processed_at"?: string | null,"received_at"?: string,"type": string
                  }
                  Update: {
                    "error"?: string | null,"id"?: string,"processed_at"?: string | null,"received_at"?: string,"type"?: string
                  }
                  Relationships: [
                    
                  ]
                },"tracks": {
                  Row: {
                    "active": boolean,"color": string,"created_at": string,"description": string | null,"gym_id": string,"id": string,"kind": Database["public"]['Enums']["track_kind"],"name": string,"position": number,"slug": string
                  }
                  ComputedFields: never
                  Insert: {
                    "active"?: boolean,"color"?: string,"created_at"?: string,"description"?: string | null,"gym_id": string,"id"?: string,"kind"?: Database["public"]['Enums']["track_kind"],"name": string,"position"?: number,"slug": string
                  }
                  Update: {
                    "active"?: boolean,"color"?: string,"created_at"?: string,"description"?: string | null,"gym_id"?: string,"id"?: string,"kind"?: Database["public"]['Enums']["track_kind"],"name"?: string,"position"?: number,"slug"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "tracks_gym_id_fkey"
      columns: ["gym_id"]
isOneToOne: false
      referencedRelation: "gyms"
      referencedColumns: ["id"]
    }
                  ]
                },"waiver_signatures": {
                  Row: {
                    "gym_id": string,"id": string,"ip_address": string | null,"signed_at": string,"signed_name": string,"user_agent": string | null,"user_id": string,"waiver_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "gym_id": string,"id"?: string,"ip_address"?: string | null,"signed_at"?: string,"signed_name": string,"user_agent"?: string | null,"user_id": string,"waiver_id": string
                  }
                  Update: {
                    "gym_id"?: string,"id"?: string,"ip_address"?: string | null,"signed_at"?: string,"signed_name"?: string,"user_agent"?: string | null,"user_id"?: string,"waiver_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "waiver_signatures_gym_id_fkey"
      columns: ["gym_id"]
isOneToOne: false
      referencedRelation: "gyms"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "waiver_signatures_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "waiver_signatures_waiver_id_fkey"
      columns: ["waiver_id"]
isOneToOne: false
      referencedRelation: "waivers"
      referencedColumns: ["id"]
    }
                  ]
                },"waivers": {
                  Row: {
                    "active": boolean,"body": string,"created_at": string,"gym_id": string,"id": string,"required": boolean,"title": string,"version": number
                  }
                  ComputedFields: never
                  Insert: {
                    "active"?: boolean,"body": string,"created_at"?: string,"gym_id": string,"id"?: string,"required"?: boolean,"title": string,"version"?: number
                  }
                  Update: {
                    "active"?: boolean,"body"?: string,"created_at"?: string,"gym_id"?: string,"id"?: string,"required"?: boolean,"title"?: string,"version"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "waivers_gym_id_fkey"
      columns: ["gym_id"]
isOneToOne: false
      referencedRelation: "gyms"
      referencedColumns: ["id"]
    }
                  ]
                },"workout_items": {
                  Row: {
                    "benchmark_name": string | null,"created_at": string,"exercise_id": string | null,"id": string,"metrics": (Database["public"]['Enums']["workout_metric"])[],"notes": string | null,"position": number,"prescription": string | null,"scaling": string | null,"section": string | null,"title": string,"video_url": string | null,"workout_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "benchmark_name"?: string | null,"created_at"?: string,"exercise_id"?: string | null,"id"?: string,"metrics"?: (Database["public"]['Enums']["workout_metric"])[],"notes"?: string | null,"position"?: number,"prescription"?: string | null,"scaling"?: string | null,"section"?: string | null,"title": string,"video_url"?: string | null,"workout_id": string
                  }
                  Update: {
                    "benchmark_name"?: string | null,"created_at"?: string,"exercise_id"?: string | null,"id"?: string,"metrics"?: (Database["public"]['Enums']["workout_metric"])[],"notes"?: string | null,"position"?: number,"prescription"?: string | null,"scaling"?: string | null,"section"?: string | null,"title"?: string,"video_url"?: string | null,"workout_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "workout_items_exercise_id_fkey"
      columns: ["exercise_id"]
isOneToOne: false
      referencedRelation: "exercises"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "workout_items_workout_id_fkey"
      columns: ["workout_id"]
isOneToOne: false
      referencedRelation: "workouts"
      referencedColumns: ["id"]
    }
                  ]
                },"workout_log_entries": {
                  Row: {
                    "benchmark_name": string | null,"comments": string | null,"created_at": string,"distance_m": number | null,"exercise_id": string | null,"id": string,"is_pr": boolean,"load": number | null,"load_kg": number | null,"load_unit": string,"log_id": string,"pace_seconds": number | null,"pace_unit": string | null,"performed_on": string,"reps": number | null,"rpe": number | null,"set_index": number,"sets": number | null,"splits": Json | null,"time_seconds": number | null,"user_id": string,"workout_item_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "benchmark_name"?: string | null,"comments"?: string | null,"created_at"?: string,"distance_m"?: number | null,"exercise_id"?: string | null,"id"?: string,"is_pr"?: boolean,"load"?: number | null,"load_kg"?: never,"load_unit"?: string,"log_id": string,"pace_seconds"?: number | null,"pace_unit"?: string | null,"performed_on": string,"reps"?: number | null,"rpe"?: number | null,"set_index"?: number,"sets"?: number | null,"splits"?: Json | null,"time_seconds"?: number | null,"user_id": string,"workout_item_id"?: string | null
                  }
                  Update: {
                    "benchmark_name"?: string | null,"comments"?: string | null,"created_at"?: string,"distance_m"?: number | null,"exercise_id"?: string | null,"id"?: string,"is_pr"?: boolean,"load"?: number | null,"load_kg"?: never,"load_unit"?: string,"log_id"?: string,"pace_seconds"?: number | null,"pace_unit"?: string | null,"performed_on"?: string,"reps"?: number | null,"rpe"?: number | null,"set_index"?: number,"sets"?: number | null,"splits"?: Json | null,"time_seconds"?: number | null,"user_id"?: string,"workout_item_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "workout_log_entries_exercise_id_fkey"
      columns: ["exercise_id"]
isOneToOne: false
      referencedRelation: "exercises"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "workout_log_entries_log_id_fkey"
      columns: ["log_id"]
isOneToOne: false
      referencedRelation: "workout_logs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "workout_log_entries_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "workout_log_entries_workout_item_id_fkey"
      columns: ["workout_item_id"]
isOneToOne: false
      referencedRelation: "workout_items"
      referencedColumns: ["id"]
    }
                  ]
                },"workout_logs": {
                  Row: {
                    "created_at": string,"duration_seconds": number | null,"enrollment_id": string | null,"gym_id": string,"id": string,"notes": string | null,"performed_on": string,"rpe": number | null,"updated_at": string,"user_id": string,"workout_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"duration_seconds"?: number | null,"enrollment_id"?: string | null,"gym_id": string,"id"?: string,"notes"?: string | null,"performed_on": string,"rpe"?: number | null,"updated_at"?: string,"user_id": string,"workout_id": string
                  }
                  Update: {
                    "created_at"?: string,"duration_seconds"?: number | null,"enrollment_id"?: string | null,"gym_id"?: string,"id"?: string,"notes"?: string | null,"performed_on"?: string,"rpe"?: number | null,"updated_at"?: string,"user_id"?: string,"workout_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "workout_logs_enrollment_id_fkey"
      columns: ["enrollment_id"]
isOneToOne: false
      referencedRelation: "enrollments"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "workout_logs_gym_id_fkey"
      columns: ["gym_id"]
isOneToOne: false
      referencedRelation: "gyms"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "workout_logs_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "workout_logs_workout_id_fkey"
      columns: ["workout_id"]
isOneToOne: false
      referencedRelation: "workouts"
      referencedColumns: ["id"]
    }
                  ]
                },"workouts": {
                  Row: {
                    "coach_notes": string | null,"created_at": string,"created_by": string | null,"description": string | null,"gym_id": string,"id": string,"is_template": boolean,"publish_at": string | null,"scheduled_date": string | null,"status": Database["public"]['Enums']["workout_status"],"title": string,"track_id": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "coach_notes"?: string | null,"created_at"?: string,"created_by"?: string | null,"description"?: string | null,"gym_id": string,"id"?: string,"is_template"?: boolean,"publish_at"?: string | null,"scheduled_date"?: string | null,"status"?: Database["public"]['Enums']["workout_status"],"title": string,"track_id"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "coach_notes"?: string | null,"created_at"?: string,"created_by"?: string | null,"description"?: string | null,"gym_id"?: string,"id"?: string,"is_template"?: boolean,"publish_at"?: string | null,"scheduled_date"?: string | null,"status"?: Database["public"]['Enums']["workout_status"],"title"?: string,"track_id"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "workouts_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "workouts_gym_id_fkey"
      columns: ["gym_id"]
isOneToOne: false
      referencedRelation: "gyms"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "workouts_track_id_fkey"
      columns: ["track_id"]
isOneToOne: false
      referencedRelation: "tracks"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            "benchmark_results": {
                  Row: {
                    "benchmark_name": string | null,"distance_m": number | null,"id": string,"is_pr": boolean,"load": number | null,"load_kg": number | null,"load_unit": string,"log_id": string,"performed_on": string,"reps": number | null,"time_seconds": number | null,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                           "benchmark_name"?: string | null,"distance_m"?: number | null,"id"?: string | null,"is_pr"?: boolean | null,"load"?: number | null,"load_kg"?: number | null,"load_unit"?: string | null,"log_id"?: string | null,"performed_on"?: string | null,"reps"?: number | null,"time_seconds"?: number | null,"user_id"?: string | null
                         }
                        Update: {
                           "benchmark_name"?: string | null,"distance_m"?: number | null,"id"?: string | null,"is_pr"?: boolean | null,"load"?: number | null,"load_kg"?: number | null,"load_unit"?: string | null,"log_id"?: string | null,"performed_on"?: string | null,"reps"?: number | null,"time_seconds"?: number | null,"user_id"?: string | null
                         }
                        Relationships: [
                    {
      foreignKeyName: "workout_log_entries_log_id_fkey"
      columns: ["log_id"]
isOneToOne: false
      referencedRelation: "workout_logs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "workout_log_entries_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"class_session_overview": {
                  Row: {
                    "booked_count": number | null,"capacity": number,"checked_in_count": number | null,"coach_id": string | null,"coach_name": string | null,"ends_at": string,"gym_id": string,"id": string,"my_booking_id": string | null,"my_booking_status": Database["public"]['Enums']["booking_status"] | null,"my_waitlist_position": number | null,"notes": string | null,"schedule_id": string | null,"starts_at": string,"status": string,"title": string,"track_color": string | null,"track_id": string | null,"track_name": string | null,"waitlist_count": number | null
                  }
                  ComputedFields: never
                  Relationships: [
                    {
      foreignKeyName: "class_sessions_coach_id_fkey"
      columns: ["coach_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "class_sessions_gym_id_fkey"
      columns: ["gym_id"]
isOneToOne: false
      referencedRelation: "gyms"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "class_sessions_schedule_id_fkey"
      columns: ["schedule_id"]
isOneToOne: false
      referencedRelation: "class_schedules"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "class_sessions_track_id_fkey"
      columns: ["track_id"]
isOneToOne: false
      referencedRelation: "tracks"
      referencedColumns: ["id"]
    }
                  ]
                },"personal_records": {
                  Row: {
                    "exercise_id": string | null,"exercise_name": string,"load": number | null,"load_kg": number | null,"load_unit": string,"log_id": string,"performed_on": string,"reps": number | null,"user_id": string
                  }
                  ComputedFields: never
                  Relationships: [
                    {
      foreignKeyName: "workout_log_entries_exercise_id_fkey"
      columns: ["exercise_id"]
isOneToOne: false
      referencedRelation: "exercises"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "workout_log_entries_log_id_fkey"
      columns: ["log_id"]
isOneToOne: false
      referencedRelation: "workout_logs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "workout_log_entries_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"staff_directory": {
                  Row: {
                    "avatar_url": string | null,"full_name": string,"gym_id": string,"role": Database["public"]['Enums']["gym_role"],"user_id": string
                  }
                  ComputedFields: never
                  Relationships: [
                    {
      foreignKeyName: "gym_members_gym_id_fkey"
      columns: ["gym_id"]
isOneToOne: false
      referencedRelation: "gyms"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "gym_members_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Functions: {
            "apply_payment_refund":
{ Args: { "p_charge": string,"p_payment": string,"p_refunded": number }; Returns: undefined
                           },
"book_class":
{ Args: { "p_session": string,"p_user"?: string }; Returns: {
              "booked_at": string,
"cancelled_at": string | null,
"checked_in_at": string | null,
"checked_in_by": string | null,
"credit_used": boolean,
"gym_id": string,
"id": string,
"late_cancel": boolean,
"membership_id": string | null,
"session_id": string,
"status": Database["public"]['Enums']["booking_status"],
"user_id": string
            }
                          SetofOptions: {
        from: "*"
        to: "bookings"
        isOneToOne: true
        isSetofReturn: false
      } },
"can_view_workout":
{ Args: { "p_workout": string }; Returns: boolean
                           },
"cancel_booking":
{ Args: { "p_booking": string }; Returns: {
              "booked_at": string,
"cancelled_at": string | null,
"checked_in_at": string | null,
"checked_in_by": string | null,
"credit_used": boolean,
"gym_id": string,
"id": string,
"late_cancel": boolean,
"membership_id": string | null,
"session_id": string,
"status": Database["public"]['Enums']["booking_status"],
"user_id": string
            }
                          SetofOptions: {
        from: "*"
        to: "bookings"
        isOneToOne: true
        isSetofReturn: false
      } },
"check_in":
{ Args: { "p_booking": string,"p_status"?: Database["public"]['Enums']["booking_status"] }; Returns: {
              "booked_at": string,
"cancelled_at": string | null,
"checked_in_at": string | null,
"checked_in_by": string | null,
"credit_used": boolean,
"gym_id": string,
"id": string,
"late_cancel": boolean,
"membership_id": string | null,
"session_id": string,
"status": Database["public"]['Enums']["booking_status"],
"user_id": string
            }
                          SetofOptions: {
        from: "*"
        to: "bookings"
        isOneToOne: true
        isSetofReturn: false
      } },
"check_in_with_code":
{ Args: { "p_payload": string }; Returns: Json
                           },
"default_gym_id":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"display_ping":
{ Args: { "p_token": string }; Returns: undefined
                           },
"freeze_membership":
{ Args: { "p_membership": string,"p_until": string,"p_user": string }; Returns: Json
                           },
"generate_sessions":
{ Args: { "p_from": string,"p_gym": string,"p_to": string }; Returns: number
                           },
"get_display":
{ Args: { "p_token": string }; Returns: Json
                           },
"gym_today":
{ Args: { "p_gym": string }; Returns: string
                           },
"has_facility_access":
{ Args: { "p_gym": string }; Returns: boolean
                           },
"has_gym_role":
{ Args: { "p_gym": string,"p_roles": (Database["public"]['Enums']["gym_role"])[] }; Returns: boolean
                           },
"is_admin":
{ Args: { "p_gym": string }; Returns: boolean
                           },
"is_member":
{ Args: { "p_gym": string }; Returns: boolean
                           },
"is_staff":
{ Args: { "p_gym": string }; Returns: boolean
                           },
"my_attendance":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"my_calendar":
{ Args: { "p_from": string,"p_to": string }; Returns: {
              "calendar_date": string,"day": number,"enrollment_id": string,"locked": boolean,"log_id": string,"program_id": string,"program_name": string,"source": string,"title": string,"track_color": string,"track_id": string,"track_name": string,"week": number,"workout_id": string
            }[]
                           },
"my_checkin_secret":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"publish_waiver":
{ Args: { "p_body": string,"p_gym": string,"p_title": string }; Returns: {
              "active": boolean,
"body": string,
"created_at": string,
"gym_id": string,
"id": string,
"required": boolean,
"title": string,
"version": number
            }
                          SetofOptions: {
        from: "*"
        to: "waivers"
        isOneToOne: true
        isSetofReturn: false
      } },
"report_overview":
{ Args: { "p_from": string,"p_gym": string,"p_to": string }; Returns: Json
                           },
"report_revenue":
{ Args: { "p_from": string,"p_gym": string,"p_to": string }; Returns: {
              "fee_cents": number,"gross_cents": number,"kind": Database["public"]['Enums']["payment_kind"],"net_cents": number,"payments": number,"refunded_cents": number,"revenue_stream": Database["public"]['Enums']["revenue_stream"],"tax_cents": number
            }[]
                           },
"set_enrollment_start":
{ Args: { "p_enrollment": string,"p_start": string }; Returns: {
              "created_at": string,
"expires_at": string | null,
"gym_id": string,
"id": string,
"program_id": string,
"source": string,
"start_date": string,
"status": Database["public"]['Enums']["enrollment_status"],
"stripe_checkout_session_id": string | null,
"updated_at": string,
"user_id": string
            }
                          SetofOptions: {
        from: "*"
        to: "enrollments"
        isOneToOne: true
        isSetofReturn: false
      } },
"sign_waiver":
{ Args: { "p_signed_name": string,"p_waiver": string }; Returns: {
              "gym_id": string,
"id": string,
"ip_address": string | null,
"signed_at": string,
"signed_name": string,
"user_agent": string | null,
"user_id": string,
"waiver_id": string
            }
                          SetofOptions: {
        from: "*"
        to: "waiver_signatures"
        isOneToOne: true
        isSetofReturn: false
      } },
"submit_workout_log":
{ Args: { "p_duration_seconds"?: number,"p_enrollment"?: string,"p_entries": Json,"p_notes"?: string,"p_performed_on": string,"p_rpe"?: number,"p_workout": string }; Returns: Json
                           }
          }
          Enums: {
            "booking_status": "booked"|"waitlisted"|"cancelled"|"attended"|"no_show","display_mode": "auto"|"manual"|"off","enrollment_status": "active"|"paused"|"completed"|"cancelled"|"refunded","gym_role": "athlete"|"coach"|"admin"|"owner","membership_status": "active"|"past_due"|"frozen"|"cancelled"|"expired","payment_kind": "membership"|"class_pack"|"drop_in"|"intro"|"program","payment_status": "pending"|"succeeded"|"failed"|"refunded"|"partially_refunded","plan_kind": "recurring"|"class_pack"|"drop_in"|"intro","program_status": "draft"|"published"|"archived","revenue_stream": "facility"|"digital","track_kind": "facility"|"online","unlock_mode": "weekly"|"daily"|"all","workout_metric": "load"|"sets"|"reps"|"time"|"distance"|"pace"|"splits"|"rpe"|"benchmark"|"comments","workout_status": "draft"|"published"
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R
    }
    ? R
    : never
  : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
  ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "graphql_public": {
          Enums: {
            
          }
        },"public": {
          Enums: {
            "booking_status": ["booked", "waitlisted", "cancelled", "attended", "no_show"],"display_mode": ["auto", "manual", "off"],"enrollment_status": ["active", "paused", "completed", "cancelled", "refunded"],"gym_role": ["athlete", "coach", "admin", "owner"],"membership_status": ["active", "past_due", "frozen", "cancelled", "expired"],"payment_kind": ["membership", "class_pack", "drop_in", "intro", "program"],"payment_status": ["pending", "succeeded", "failed", "refunded", "partially_refunded"],"plan_kind": ["recurring", "class_pack", "drop_in", "intro"],"program_status": ["draft", "published", "archived"],"revenue_stream": ["facility", "digital"],"track_kind": ["facility", "online"],"unlock_mode": ["weekly", "daily", "all"],"workout_metric": ["load", "sets", "reps", "time", "distance", "pace", "splits", "rpe", "benchmark", "comments"],"workout_status": ["draft", "published"]
          }
        }
} as const
