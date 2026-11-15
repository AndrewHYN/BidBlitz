import { Star } from "lucide-react";
import { createClient } from "@/lib/supabase/server";

export async function ServiceReviewList({ listingId }: { listingId: string }) {
  const supabase = await createClient();
  const { data: reviews } = await supabase.from("service_reviews")
    .select("id, rating, comment, created_at")
    .eq("listing_id", listingId)
    .order("created_at", { ascending: false })
    .limit(20);
  const rows = reviews ?? [];
  const average = rows.length
    ? (rows.reduce((sum, review) => sum + review.rating, 0) / rows.length).toFixed(1)
    : null;
  return (
    <section className="space-y-3 rounded-xl border bg-card p-5" aria-label="Verified service reviews">
      <h2 className="flex items-center gap-2 font-semibold">
        <Star className="size-5 text-primary" aria-hidden />
        Verified client reviews {average ? `· ${average}/5` : ""}
      </h2>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No verified completed jobs reviewed yet.</p>
      ) : (
        <ul className="space-y-3 divide-y">
          {rows.map((review) => (
            <li key={review.id} className="pt-3 text-sm">
              <p className="font-medium">{review.rating}/5 stars · Confirmed hire</p>
              {review.comment && <p className="mt-1 break-words text-muted-foreground">{review.comment}</p>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
