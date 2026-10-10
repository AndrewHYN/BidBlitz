import type { Metadata } from "next";
import Link from "next/link";
import { notFound,redirect } from "next/navigation";
import { ArrowLeft,MessageSquare,LockKeyhole } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { hasPermission } from "@/server/permissions";
import { TicketReplyForm,StaffSupportActions } from "@/components/support/ticket-controls";

export const metadata:Metadata={title:"Support conversation",robots:{index:false,follow:false}};
type Ticket={
 id:string;customer_id:string;subject:string;category:string;status:string;
 priority:"NORMAL"|"HIGH"|"URGENT";assigned_to:string|null;created_at:string;updated_at:string;
};
type Message={id:string;ticket_id:string;author_id:string;body:string;created_at:string};
type Note={id:string;author_id:string;body:string;created_at:string};
export default async function SupportConversationPage({params}:{params:Promise<{id:string}>}){
 const {id}=await params;
 if(!/^[0-9a-f-]{36}$/i.test(id))notFound();
 const supabase=await createClient();
 const {data:{user}}=await supabase.auth.getUser();
 if(!user)redirect(`/login?next=/support/tickets/${id}`);
 const [ticketResult,canStaff]=await Promise.all([
  supabase.from("support_tickets")
   .select("id,customer_id,subject,category,status,priority,assigned_to,created_at,updated_at")
   .eq("id",id).maybeSingle(),
  hasPermission(user.id,"support.manage")
 ]);
 if(ticketResult.error || !ticketResult.data)notFound();
 const ticket=ticketResult.data as Ticket;
 // RLS is authoritative; a ticket doesn't become visible by guessing the UUID.
 const [messagesRes,notesRes,agentsRes]=await Promise.all([
  supabase.from("support_ticket_messages")
   .select("id,ticket_id,author_id,body,created_at")
   .eq("ticket_id",id).order("created_at",{ascending:true}).limit(200),
  canStaff?supabase.from("support_staff_notes")
   .select("id,author_id,body,created_at").eq("ticket_id",id)
   .order("created_at",{ascending:false}).limit(100):Promise.resolve(null),
  canStaff?supabase.rpc("staff_support_agents"):Promise.resolve(null),
 ]);
 const names=Array.isArray(agentsRes?.data)?agentsRes.data as Array<{id:string;name:string}>:[];
 return <main className="page-container max-w-5xl space-y-6 py-8 sm:py-12" data-testid="support-ticket-thread">
  <Link href={canStaff?"/admin/support":"/support/tickets"} className="inline-flex items-center gap-2 text-sm font-bold text-primary hover:underline">
   <ArrowLeft className="size-4" aria-hidden/> Back to {canStaff?"support desk":"your tickets"}
  </Link>
  <header className="overflow-hidden rounded-[1.5rem] border border-orange-500/20 bg-[#17191b] p-6 text-white sm:p-9">
   <p className="text-xs font-black uppercase tracking-widest text-orange-300">{ticket.category} / Reference {ticket.id.slice(0,8)}</p>
   <h1 className="mt-3 text-2xl font-black tracking-tight sm:text-4xl">{ticket.subject}</h1>
   <div className="mt-4 flex flex-wrap gap-3 text-xs text-zinc-300">
    <span className="rounded-md bg-white/10 px-3 py-1.5 font-bold">{ticket.status.replaceAll("_"," ")}</span>
    <span>Opened {new Date(ticket.created_at).toLocaleString("en-US")}</span>
   </div>
  </header>
  <div className="grid gap-5 lg:grid-cols-[1.2fr_.8fr]">
   <section aria-labelledby="ticket-conversation-title" className="space-y-4">
    <h2 id="ticket-conversation-title" className="flex items-center gap-2 text-xl font-black"><MessageSquare className="size-5 text-primary" aria-hidden/> Conversation</h2>
    {messagesRes.error?<p role="alert" className="rounded-xl border border-destructive/25 p-4 text-sm text-destructive">Conversation is temporarily unavailable. Do not resend until it loads.</p>:
     <ol className="space-y-3">
      {(messagesRes.data??[] as Message[]).map(message=><li key={message.id}
       className={message.author_id===ticket.customer_id?"rounded-2xl border bg-card p-4 shadow-sm":"rounded-2xl border border-orange-500/25 bg-orange-500/5 p-4"}>
       <div className="flex flex-wrap justify-between gap-2 text-xs">
        <span className="font-black">{message.author_id===ticket.customer_id?"Customer":"BidBlitz staff"}</span>
        <time className="text-muted-foreground" dateTime={message.created_at}>{new Date(message.created_at).toLocaleString("en-US")}</time>
       </div>
       <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-7">{message.body}</p>
      </li>)}
     </ol>}
    {!messagesRes.error && !["RESOLVED","CLOSED"].includes(ticket.status)&&<TicketReplyForm ticketId={ticket.id}/>}
    {["RESOLVED","CLOSED"].includes(ticket.status)&&
     <p className="rounded-lg border bg-muted/30 p-4 text-xs text-muted-foreground">This conversation is closed to new replies. Open a new ticket for further assistance.</p>}
   </section>
   <div className="space-y-4">
    {canStaff&&(notesRes?.error||agentsRes?.error)?
     <p role="alert" className="rounded-xl border border-destructive/25 bg-destructive/5 p-4 text-xs text-destructive">Internal support state is unavailable. Staff changes are blocked.</p>:
     canStaff&&<StaffSupportActions ticketId={ticket.id} status={ticket.status as "OPEN"|"IN_REVIEW"|"WAITING_CUSTOMER"|"RESOLVED"|"CLOSED"}
       priority={ticket.priority} assignedTo={ticket.assigned_to} agents={names}/>}
    {canStaff&&!notesRes?.error&&<section className="rounded-2xl border bg-card p-5">
     <h2 className="flex items-center gap-2 text-sm font-black"><LockKeyhole className="size-4 text-primary" aria-hidden/> Confidential staff notes</h2>
     {(notesRes?.data??[] as Note[]).length===0?<p className="mt-3 text-xs text-muted-foreground">No confidential notes have been added.</p>:
      <ul className="mt-3 space-y-3">{(notesRes?.data??[] as Note[]).map(n=><li key={n.id} className="rounded-lg bg-muted/35 p-3">
       <p className="whitespace-pre-wrap break-words text-xs leading-5">{n.body}</p>
       <p className="mt-2 text-[11px] text-muted-foreground">{new Date(n.created_at).toLocaleString("en-US")}</p>
      </li>)}</ul>}
    </section>}
    <p className="rounded-xl border p-4 text-xs leading-6 text-muted-foreground">
      Support messages do not replace official dispute evidence, provider settlement statements or required identity verification.
    </p>
   </div>
  </div>
 </main>;
}
