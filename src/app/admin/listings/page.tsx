import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight,ClipboardCheck,FileSearch,ShieldCheck,TriangleAlert } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { hasPermission } from "@/server/permissions";
import { AdminNav } from "@/components/dashboard/admin-nav";
import { ListingReviewControls } from "@/components/dashboard/listing-review-controls";
import { formatMoney,money } from "@/lib/money";

export const metadata:Metadata={title:"Listing review desk",robots:{index:false,follow:false}};
type Review={reviewId:string;submittedAt:string;auctionId:string;title:string;
 description:string;status:string;condition:string;startingMinor:string;
 durationSeconds:number;location:string|null;sellerName:string};
export default async function AdminListingReviews(){
 const supabase=await createClient();
 const {data:{user}}=await supabase.auth.getUser();
 if(!user)redirect("/login?next=/admin/listings");
 const [canView,canApprove,canReject,canChanges,canTeam]=await Promise.all([
  hasPermission(user.id,"listings.review"),
  hasPermission(user.id,"listings.approve"),
  hasPermission(user.id,"listings.reject"),
  hasPermission(user.id,"listings.request_changes"),
  hasPermission(user.id,"admin.manage_team")
 ]);
 if(!canView)redirect("/");
 const {data,error}=await supabase.rpc("staff_listing_review_queue",{p_limit:60});
 const reviews:Review[]=Array.isArray(data)?data as Review[]:[];
 return <main className="page-container space-y-7 py-8 sm:py-12" data-testid="staff-listing-reviews">
  <header className="relative overflow-hidden rounded-[1.75rem] border border-orange-500/20 bg-[#151719] p-7 text-white shadow-xl sm:p-10">
   <p className="flex items-center gap-2 text-xs font-black uppercase tracking-[.2em] text-orange-300"><ClipboardCheck className="size-4" aria-hidden/> BidBlitz / Seller onboarding</p>
   <h1 className="mt-4 text-4xl font-black tracking-[-.055em] sm:text-6xl">Listing desk<span className="text-orange-400">.</span></h1>
   <p className="mt-3 max-w-2xl text-sm leading-7 text-zinc-300">Publish only listings that are accurate, complete and safe. Every decision is recorded against the responsible employee.</p>
  </header>
  <AdminNav active="listings" showListings showTeam={canTeam}/>
  {error?<p role="alert" className="rounded-xl border border-destructive/25 bg-destructive/5 p-5 text-sm text-destructive">The review queue is unavailable. No listings were changed. Do not assume there are zero pending submissions.</p>:
   <>
    <div className="flex flex-wrap items-center justify-between gap-3">
     <div className="flex items-center gap-3">
      <span className="grid size-12 place-items-center rounded-xl bg-orange-500/10 text-orange-700 dark:text-orange-300"><FileSearch className="size-6" aria-hidden/></span>
      <div><p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Pending moderation</p><p className="text-3xl font-black tabular-nums">{reviews.length}</p></div>
     </div>
     <p className="text-xs text-muted-foreground">Oldest submission first · Latest 60</p>
    </div>
    {reviews.length===0?
     <div className="rounded-2xl border bg-card p-7">
      <h2 className="text-lg font-black">Review queue is clear</h2>
      <p className="mt-2 text-sm text-muted-foreground">No listings currently require moderation.</p>
      <Link href="/admin/command" className="mt-4 inline-flex items-center gap-2 text-sm font-bold text-primary">Back to HQ <ArrowRight className="size-4" aria-hidden/></Link>
     </div>:
     <ul className="grid gap-4 lg:grid-cols-2">
      {reviews.map(r=><li key={r.reviewId} className="space-y-4 rounded-2xl border bg-card p-5 shadow-sm" data-testid="listing-review-row">
       <div className="flex flex-wrap justify-between gap-2">
        <p className="text-xs font-black uppercase tracking-widest text-primary">{r.condition.replaceAll("_"," ")}</p>
        <time className="text-xs text-muted-foreground" dateTime={r.submittedAt}>{new Date(r.submittedAt).toLocaleString("en-US")}</time>
       </div>
       <div><h2 className="text-xl font-extrabold tracking-tight">{r.title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">Seller: {r.sellerName} · {r.location||"Location not specified"}</p>
       </div>
       <div className="rounded-xl border bg-muted/20 p-4">
        <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Starting bid</p>
        <p className="mt-1 text-2xl font-black tabular-nums">{formatMoney(money(r.startingMinor,"USD"))}</p>
        <p className="mt-2 text-xs text-muted-foreground">Duration: {Math.round(r.durationSeconds/3600)} hours</p>
       </div>
       <p className="line-clamp-5 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{r.description}</p>
       <Link href={`/auction/${r.auctionId}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-bold text-primary hover:underline">Inspect auction details <ArrowRight className="size-3.5" aria-hidden/></Link>
       <ListingReviewControls reviewId={r.reviewId} canApprove={canApprove} canReject={canReject} canRequestChanges={canChanges}/>
      </li>)}
     </ul>}
   </>}
  <p className="flex gap-2 rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 text-xs leading-5">
   <TriangleAlert className="size-4 shrink-0 text-amber-700 dark:text-amber-300" aria-hidden/>
   Never approve your own listing or misrepresent an item's condition. Listing approval does not bypass auction rules, payment settlement or dispute holds.
  </p>
 </main>;
}
