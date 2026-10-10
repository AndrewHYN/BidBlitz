import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight,LifeBuoy,MessageSquareText,ShieldCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { NewSupportTicketForm } from "@/components/support/ticket-controls";

export const metadata:Metadata={title:"Your support tickets",robots:{index:false,follow:false}};
export default async function SupportTicketsPage(){
 const supabase=await createClient();const {data:{user}}=await supabase.auth.getUser();
 if(!user)redirect("/login?next=/support/tickets");
 const {data,error}=await supabase.from("support_tickets")
  .select("id,category,subject,status,priority,created_at,updated_at")
  .eq("customer_id",user.id).order("updated_at",{ascending:false}).limit(50);
 const tickets=data??[];
 return <main className="page-container space-y-7 py-8 sm:py-12" data-testid="customer-support-tickets">
  <header className="relative overflow-hidden rounded-[1.75rem] border border-orange-500/20 bg-[#16181b] p-7 text-white shadow-xl sm:p-10">
   <p className="flex items-center gap-2 text-xs font-black uppercase tracking-[.16em] text-orange-300"><LifeBuoy className="size-4" aria-hidden/> BidBlitz / Customer care</p>
   <h1 className="mt-4 text-4xl font-black tracking-[-.055em] sm:text-6xl">We're here to help<span className="text-orange-400">.</span></h1>
   <p className="mt-3 max-w-xl text-sm leading-7 text-zinc-300">Keep your auction questions, payments concerns and account assistance in one private, trackable conversation.</p>
  </header>
  <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
   <NewSupportTicketForm/>
   <div className="space-y-4">
    <section className="rounded-2xl border bg-card p-5 shadow-sm">
     <h2 className="flex items-center gap-2 text-lg font-black"><MessageSquareText className="size-5 text-primary" aria-hidden/> Your conversations</h2>
     {error?<p role="alert" className="mt-3 text-sm text-destructive">Your ticket history is unavailable; do not assume your messages were lost.</p>:
     tickets.length===0?<p className="mt-3 text-sm leading-6 text-muted-foreground">No tickets yet. Your first request will appear here once it is saved.</p>:
     <ul className="mt-4 divide-y">
      {tickets.map(t=><li key={t.id}>
       <Link className="group flex items-center justify-between gap-3 py-4 hover:text-primary" href={`/support/tickets/${t.id}`}>
        <div className="min-w-0">
         <p className="truncate text-sm font-bold">{t.subject}</p>
         <p className="mt-1 text-xs text-muted-foreground">{t.category} · {t.status.replaceAll("_"," ")} · {new Date(t.updated_at).toLocaleDateString("en-US")}</p>
        </div>
        <ArrowRight className="size-4 shrink-0 transition group-hover:translate-x-1" aria-hidden/>
       </Link>
      </li>)}
     </ul>}
    </section>
    <aside className="flex gap-3 rounded-2xl border border-orange-500/20 bg-orange-500/5 p-5 text-xs leading-6">
     <ShieldCheck className="mt-1 size-5 shrink-0 text-orange-600" aria-hidden/>
     Staff will never ask for your login password, EcoCash PIN, API key or one-time code. For a dispute about a completed sale, continue through the transaction's formal dispute controls too.
    </aside>
   </div>
  </div>
 </main>;
}
