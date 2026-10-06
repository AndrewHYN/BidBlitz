/**
 * Hand-written database types.
 *
 * Generated via `supabase gen types typescript` in a normal setup; written by
 * hand here because the Management API is the only available DDL path on this
 * project. bigint columns are typed as `number` at the row level because
 * PostgREST serialises them to JSON numbers — but application code converts to
 * `bigint` immediately when doing any arithmetic (see src/lib/money.ts).
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type AuctionStatus =
  | "DRAFT" | "SCHEDULED" | "LIVE" | "ENDED" | "SOLD" | "UNSOLD" | "CANCELLED" | "PAUSED" | "PENDING_REVIEW";

export type TransactionStatus =
  | "AWAITING_PAYMENT" | "PAID" | "SETTLED" | "REFUNDED" | "FAILED" | "EXPIRED";

/**
 * The seller fulfilment / payout operation. Deliberately NOT part of
 * `TransactionStatus`: PAID only ever means "Paynow confirmed the buyer's
 * payment", never "the seller has been paid".
 */
export type SellerPayoutStatus =
  | "WAITING_FOR_FULFILMENT" | "DELIVERY_CONFIRMED" | "PAYOUT_PENDING"
  | "PAYOUT_DUE" | "PAID_OUT" | "HELD" | "DISPUTED";

export type NotificationType =
  | "AUCTION_PUBLISHED" | "NEW_BID" | "OUTBID" | "ENDING_SOON"
  | "WON" | "SOLD" | "ENDED_UNSOLD" | "REVIEW_REQUEST" | "NEW_MESSAGE" | "PAYMENT_EXPIRED";

export type Condition = "new" | "like_new" | "good" | "fair" | "poor";

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          username: string;
          display_name: string;
          /**
           * Storage KEY of this user's avatar inside the public `avatars`
           * bucket: `<auth uid>/avatar.<ext>`. Never a URL — the old free-text
           * `avatar_url` column was removed in migration 20260928000004 because
           * the UI rendered it as an image source, which let any user point
           * the site at a remote image of their choosing.
           */
          avatar_path: string | null;
          bio: string | null;
          location: string | null;
          rating_sum: number;
          rating_count: number;
          sales_count: number;
          purchases_count: number;
          email_verified: boolean;
          is_admin: boolean;
          is_banned: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["profiles"]["Row"]> & { id: string; username: string; display_name: string };
        Update: Partial<Database["public"]["Tables"]["profiles"]["Row"]>;
      };
      categories: {
        Row: { id: number; slug: string; name: string; emoji: string | null; sort_order: number };
        Insert: { id?: number; slug: string; name: string; emoji?: string | null; sort_order?: number };
        Update: Partial<Database["public"]["Tables"]["categories"]["Row"]>;
      };
      auctions: {
        Row: {
          id: string;
          seller_id: string;
          title: string;
          description: string;
          category_id: number | null;
          condition: Condition;
          location: string;
          currency: string;
          starting_bid_minor: number;
          bid_increment_minor: number;
          status: AuctionStatus;
          starts_at: string | null;
          ends_at: string | null;
          duration_seconds: number;
          anti_snipe_window_seconds: number;
          anti_snipe_extension_seconds: number;
          extension_count: number;
          current_bid_minor: number | null;
          current_bidder_id: string | null;
          bid_count: number;
          winner_id: string | null;
          winning_bid_minor: number | null;
          settled_at: string | null;
          featured: boolean;
          image_count: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          seller_id: string;
          title: string;
          description: string;
          category_id?: number | null;
          condition: Condition;
          location: string;
          currency?: string;
          starting_bid_minor: number;
          bid_increment_minor: number;
          status?: AuctionStatus;
          duration_seconds?: number;
          anti_snipe_window_seconds?: number;
          anti_snipe_extension_seconds?: number;
          image_count?: number;
        };
        Update: Partial<Database["public"]["Tables"]["auctions"]["Row"]>;
      };
      auction_images: {
        Row: {
          id: string; auction_id: string; storage_path: string; position: number;
          width: number | null; height: number | null; bytes: number | null; created_at: string;
        };
        Insert: { id?: string; auction_id: string; storage_path: string; position?: number; width?: number | null; height?: number | null; bytes?: number | null };
        Update: Partial<Database["public"]["Tables"]["auction_images"]["Row"]>;
      };
      bids: {
        Row: {
          id: string; auction_id: string; bidder_id: string; amount_minor: number;
          currency: string; request_id: string; is_winning: boolean; created_at: string;
        };
        Insert: { id?: string; auction_id: string; bidder_id: string; amount_minor: number; currency: string; request_id: string; is_winning?: boolean };
        Update: Partial<Database["public"]["Tables"]["bids"]["Row"]>;
      };
      watchlist: {
        Row: { user_id: string; auction_id: string; created_at: string };
        Insert: { user_id: string; auction_id: string; created_at?: string };
        Update: { created_at?: string };
      };
      notifications: {
        Row: {
          id: string; user_id: string; type: NotificationType; auction_id: string | null;
          payload: Json; read_at: string | null; created_at: string;
        };
        Insert: { id?: string; user_id: string; type: NotificationType; auction_id?: string | null; payload?: Json; read_at?: string | null };
        Update: { read_at?: string | null };
      };
      fee_settings: {
        Row: { id: number; fee_bps: number; min_fee_minor: number; currency: string; updated_at: string };
        Insert: never;
        Update: never;
      };
      transactions: {
        Row: {
          id: string; auction_id: string; seller_id: string; buyer_id: string;
          currency: string; gross_minor: number; fee_bps: number; fee_minor: number;
          net_minor: number; status: TransactionStatus; provider: string | null;
          provider_reference: string | null; created_at: string; updated_at: string;
        };
        Insert: never;
        Update: never;
      };
      reviews: {
        Row: {
          id: string; transaction_id: string; auction_id: string; reviewer_id: string;
          reviewee_id: string; rating: number; comment: string | null; created_at: string;
        };
        Insert: { id?: string; transaction_id: string; auction_id: string; reviewer_id: string; reviewee_id: string; rating: number; comment?: string | null };
        Update: never;
      };
      reports: {
        Row: {
          id: string; reporter_id: string; target_type: "auction" | "user"; target_id: string;
          reason: string; status: "OPEN" | "REVIEWING" | "RESOLVED" | "DISMISSED";
          resolution: string | null; created_at: string; resolved_at: string | null;
        };
        Insert: { id?: string; reporter_id: string; target_type: "auction" | "user"; target_id: string; reason: string };
        Update: { status?: string; resolution?: string | null };
      };
      transaction_messages: {
        Row: {
          id: string; transaction_id: string; sender_id: string; body: string;
          read_at: string | null; created_at: string;
        };
        Insert: { id?: string; transaction_id: string; sender_id: string; body: string };
        // The recipient marks read; the history trigger freezes everything else.
        Update: { read_at?: string | null };
      };
      seller_payouts: {
        Row: {
          id: string;
          transaction_id: string;
          seller_id: string;
          amount_minor: number;
          currency: string;
          status: SellerPayoutStatus;
          payout_reference: string | null;
          paid_at: string | null;
          delivery_confirmed_at: string | null;
          internal_note: string | null;
          created_at: string;
          updated_at: string;
        };
        // No client write path exists: INSERT/UPDATE/DELETE are revoked from
        // anon and authenticated, and RLS grants SELECT to admins only. The
        // sole writer is admin_transition_seller_payout().
        Insert: never;
        Update: never;
      };
      seller_payout_recipients: {
        Row: {
          seller_id: string;
          provider: string;
          external_user_id: string;
          external_wallet_id: string;
          created_at: string;
          updated_at: string;
        };
        // Server-side only: service role writes, admins read via RLS, the
        // browser never does either. The ids stay on the server by design.
        Insert: never;
        Update: never;
      };
      seller_payout_events: {
        Row: {
          id: string;
          payout_id: string;
          from_status: SellerPayoutStatus | null;
          to_status: SellerPayoutStatus;
          payout_reference: string | null;
          note: string | null;
          actor_id: string | null;
          created_at: string;
        };
        Insert: never;
        Update: never;
      };
      schema_migrations: {
        Row: { filename: string; applied_at: string };
        Insert: { filename: string; applied_at?: string };
        Update: never;
      };
    };
    Functions: {
      place_bid: {
        Args: { p_auction_id: string; p_amount_minor: number; p_request_id: string };
        Returns: Json;
      };
      publish_auction: {
        Args: { p_auction_id: string; p_starts_at?: string | null };
        Returns: Json;
      };
      cancel_auction: { Args: { p_auction_id: string }; Returns: Json };
      settle_auction: { Args: { p_auction_id: string }; Returns: Json };
      settle_due_auctions: { Args: { p_limit?: number }; Returns: number };
      admin_transition_seller_payout: {
        Args: {
          p_payout_id: string;
          p_to_status: SellerPayoutStatus;
          p_payout_reference?: string | null;
          p_internal_note?: string | null;
        };
        Returns: Json;
      };
      my_seller_payouts: {
        Args: Record<string, never>;
        Returns: {
          transaction_id: string;
          status: SellerPayoutStatus;
          amount_minor: number;
          currency: string;
          delivery_confirmed_at: string | null;
          paid_at: string | null;
          updated_at: string;
        }[];
      };
      server_now: { Args: Record<string, never>; Returns: string };
      // is_admin intentionally absent: the function lives in the `private`
      // schema (migration 000010) and has no PostgREST route. Admin UI reads
      // `profiles.is_admin` on the caller's own row instead.
      auction_effective_status: {
        Args: { p_status: AuctionStatus; p_starts_at: string; p_ends_at: string; p_now?: string };
        Returns: string;
      };
    };
    Views: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
