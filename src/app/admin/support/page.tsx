import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight,Headset,Inbox,MessageSquareText,ShieldAlert } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { hasPermission } from "@/server/permissions";
import { AdminNav } from "@/components/dashboard/admin-nav";

export const metadata:Metadata={title:"Support operations",robots:{index:false,follow:false}};
type Ticket={id:string;customer_id:string;subject:string;category:string;
 status:string;priority:string;assigned_to:string|null;updated_at:string;created_at:string};
export default async function AdminSupportPage(){
 const supabase=await createClient();const {data:{user}}=await supabase.auth.getUser();
 if(!user)redirect("/login?next=/admin/support");
 const [canSupport,canTeam]=await Promise.all([
  hasPermission(user.id,"support.manage"),
  hasPermission(user.id,"admin.manage_team")
 ]);
 if(!canSupport)redirect("/");
 const {data,error}=await supabase.from("support_tickets")
  .select("id,customer_id,subject,category,status,priority,assigned_to,updated_at,created_at")
  .order("updated_at",{ascending:false}).limit(100);
 const tickets=(data??[]) as Ticket[];
 const open=tickets.filter(t=>!["CLOSED","RESOLVED"].includes(t.status)).length;
 const urgent=tickets.filter(t=>t.priority==="URGENT"&&!["CLOSED","RESOLVED"].includes(t.status)).length;
 return <main className="page-container space-y-7 py-8 sm:py-12" data-testid="admin-support-page">
  <header className="relative overflow-hidden rounded-[1.75rem] border border-orange-500/20 bg-[#16181b] p-7 text-white shadow-xl sm:p-10">
   <p className="flex items-center gap-2 text-xs font-black uppercase tracking-[.2em] text-orange-300"><Headset className="size-4" aria-hidden/> BidBlitz / Care operations</p>
   <h1 className="mt-4 text-4xl font-black tracking-[-.055em] sm:text-6xl">Support command<span className="text-orange-400">.</span></h1>
   <p className="mt-3 max-w-2xl text-sm leading-7 text-zinc-300">Answer real customer conversations, own assigned cases, and escalate safety issues without exposing financial controls.</p>
  </header>
  <AdminNav active="support" showSupport showTeam={canTeam}/>
  {error?<p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-5 text-sm text-destructive">
    Ticket records are currently unavailable. Do not interpret this as zero requests.
   </p>:
   <>
    <div className="grid gap-3 sm:grid-cols-3">
     {[
      {label:"Open conversations",value:open,icon:MessageSquareText},
      {label:"Urgent outstanding",value:urgent,icon:ShieldAlert},
      {label:"Recent cases in view",value:tickets.length,icon:Inbox}
     ].map(m=>{const Icon=m.icon;return <div key={m.label} className="rounded-2xl border bg-card p-5 shadow-sm">
      <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-muted-foreground"><Icon className="size-4" aria-hidden/>{m.label}</p>
      <p className="mt-3 text-4xl font-black tabular-nums">{m.value}</p>
     </div>;})}
    </div>
    <section aria-labelledby="staff-tickets-heading" className="space-y-4">
     <div className="flex justify-between gap-3">
      <h2 id="staff-tickets-heading" className="text-2xl font-black tracking-tight">Customer cases</h2>
      <span className="text-xs text-muted-foreground">Latest {tickets.length}, sorted by activity</span>
     </div>
     {tickets.length===0?
      <p className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">No support tickets have been opened.</p>:
      <ul className="grid gap-3 md:grid-cols-2">
       {tickets.map(t=><li key={t.id}>
        <Link href={`/support/tickets/${t.id}`} className="group block rounded-2xl border bg-card p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-primary/35 hover:shadow-lg" data-testid="support-case-card">
         <div className="flex flex-wrap items-start justify-between gap-3">
          <span className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">{t.category}</span>
          <span className={t.priority==="URGENT"?"rounded-md bg-red-500/10 px-2 py-1 text-xs font-bold text-red-700 dark:text-red-300":"rounded-md bg-muted px-2 py-1 text-xs font-bold text-muted-foreground"}>{t.priority}</span>
         </div>
         <h3 className="mt-3 text-lg font-extrabold">{t.subject}</h3>
         <p className="mt-2 text-xs text-muted-foreground">Status: {t.status.replaceAll("_"," ")} · Customer #{t.customer_id.slice(0,8)}</p>
         <p className="mt-1 text-xs text-muted-foreground">Assigned {t.assigned_to?"to staff":"Unassigned"} · Updated {new Date(t.updated_at).toLocaleString("en-US")}</p>
         <span className="mt-4 flex items-center gap-1 text-xs font-bold text-primary">Work this case <ArrowRight className="size-4 transition group-hover:translate-x-1" aria-hidden/></span>
        </Link>
       </li>)}
      </ul>}
    </section>
   </>}
  <footer className="rounded-xl border border-orange-500/15 bg-orange-500/5 p-4 text-xs leading-6">
   Support may not release payouts, change auction bids, request PINs or decide financial disputes. Use the dedicated finance and dispute departments.
  </footer>
 </main>;
}
