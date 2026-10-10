"use client";

import { useState,useTransition } from "react";
import { useRouter } from "next/navigation";
import { LifeBuoy,MessageCirclePlus,Send,ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
 openSupportTicketAction,replySupportTicketAction,
 staffUpdateSupportTicketAction,staffAddSupportNoteAction
} from "@/server/actions/support-tickets";

const input="h-11 w-full rounded-lg border bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";
type Category="ACCOUNT"|"AUCTION"|"LISTING"|"PAYMENT"|"PAYOUT"|"SAFETY"|"OTHER";
type Status="OPEN"|"IN_REVIEW"|"WAITING_CUSTOMER"|"RESOLVED"|"CLOSED";
type Priority="NORMAL"|"HIGH"|"URGENT";
export function NewSupportTicketForm(){
 const router=useRouter();const [busy,start]=useTransition();
 const [category,setCategory]=useState<Category>("OTHER"),[subject,setSubject]=useState(""),[body,setBody]=useState("");
 const [error,setError]=useState<string|null>(null);
 function submit(e:React.FormEvent<HTMLFormElement>){
  e.preventDefault();setError(null);
  start(async()=>{try{const r=await openSupportTicketAction({category,subject,body});
   if(!r.ok){setError(r.message);return;}
   router.push(`/support/tickets/${r.id}`);router.refresh();
  }catch{setError("Ticket outcome could not be confirmed. Check your ticket list before retrying.");}});
 }
 return <form method="post" onSubmit={submit} className="grid gap-4 rounded-2xl border bg-card p-5 shadow-sm sm:grid-cols-2 sm:p-7">
  <div className="sm:col-span-2">
   <p className="flex gap-2 text-xs font-black uppercase tracking-[.15em] text-primary"><LifeBuoy className="size-4" aria-hidden/> Customer helpdesk</p>
   <h2 className="mt-2 text-xl font-black">Open a support ticket</h2>
   <p className="mt-2 text-xs text-muted-foreground">Never share passwords, PINs or wallet credentials. For an active safety emergency, contact local authorities directly.</p>
  </div>
  <label className="space-y-1.5 text-xs font-bold">Category
   <select className={input} value={category} onChange={e=>setCategory(e.target.value as Category)} disabled={busy}>
    {(["ACCOUNT","AUCTION","LISTING","PAYMENT","PAYOUT","SAFETY","OTHER"] as Category[]).map(c=><option key={c} value={c}>{c.replaceAll("_"," ")}</option>)}
   </select>
  </label>
  <label className="space-y-1.5 text-xs font-bold">Subject
   <input required minLength={5} maxLength={160} className={input} placeholder="Issue with my auction" value={subject} onChange={e=>setSubject(e.target.value)} disabled={busy}/>
  </label>
  <label className="space-y-1.5 text-xs font-bold sm:col-span-2">Tell us what happened
   <Textarea required minLength={10} maxLength={4000} rows={5} value={body} onChange={e=>setBody(e.target.value)}
    placeholder="Tell us the auction or payment reference and what you need help with. Don't include private keys or PINs." disabled={busy}/>
  </label>
  <div className="space-y-2 sm:col-span-2">
   <Button type="submit" disabled={busy}><MessageCirclePlus className="mr-2 size-4" aria-hidden/>{busy?"Opening…":"Create support ticket"}</Button>
   {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}
  </div>
 </form>;
}

export function TicketReplyForm({ticketId}:{ticketId:string}){
 const router=useRouter();const [body,setBody]=useState(""),[busy,start]=useTransition();
 const [feedback,setFeedback]=useState<{ok:boolean;message:string}|null>(null);
 function submit(e:React.FormEvent<HTMLFormElement>){
  e.preventDefault();start(async()=>{try{
    const r=await replySupportTicketAction({ticketId,body});
    setFeedback(r.ok?{ok:true,message:"Your message is now in the ticket timeline."}:{ok:false,message:r.message});
    if(r.ok){setBody("");router.refresh();}
   }catch{setFeedback({ok:false,message:"Message outcome unclear. Refresh before resending."});}});
 }
 return <form method="post" onSubmit={submit} className="space-y-3 rounded-xl border bg-card p-4">
  <label className="block text-sm font-bold" htmlFor={`ticket-reply-${ticketId}`}>Add a reply</label>
  <Textarea id={`ticket-reply-${ticketId}`} required minLength={2} maxLength={4000} rows={4} disabled={busy} value={body}
   onChange={e=>setBody(e.target.value)} placeholder="What additional details or evidence can you share?"/>
  <Button type="submit" disabled={busy||body.trim().length<2}><Send className="mr-2 size-4" aria-hidden/>{busy?"Sending…":"Send reply"}</Button>
  {feedback&&<p role={feedback.ok?"status":"alert"} className={feedback.ok?"text-xs text-emerald-700 dark:text-emerald-300":"text-xs text-destructive"}>{feedback.message}</p>}
 </form>;
}

export function StaffSupportActions({ticketId,status,priority,assignedTo,agents}:{
 ticketId:string;status:Status;priority:Priority;assignedTo:string|null;
 agents:Array<{id:string;name:string}>;
}){
 const router=useRouter();const [newStatus,setNewStatus]=useState<Status>(status);
 const [newPriority,setNewPriority]=useState<Priority>(priority),[agent,setAgent]=useState(assignedTo??"");
 const [note,setNote]=useState(""),[busy,start]=useTransition();
 const [feedback,setFeedback]=useState<{ok:boolean;message:string}|null>(null);
 function submit(type:"settings"|"note"){
  setFeedback(null);
  start(async()=>{try{
   const outcome=type==="settings"?
     await staffUpdateSupportTicketAction({ticketId,status:newStatus,priority:newPriority,assigneeId:agent||null}):
     await staffAddSupportNoteAction({ticketId,note});
   setFeedback(outcome.ok?{ok:true,message:type==="settings"?"Ticket workflow updated.":"Private note recorded."}:{ok:false,message:outcome.message});
   if(outcome.ok){setNote("");router.refresh();}
  }catch{setFeedback({ok:false,message:"Change outcome could not be verified; refresh before retrying."});}});
 }
 return <section className="space-y-4 rounded-2xl border border-orange-500/25 bg-card p-5 shadow-sm" data-testid="support-staff-operations">
  <div><p className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-primary"><ShieldCheck className="size-4" aria-hidden/> Staff-only tools</p>
    <h3 className="mt-2 text-lg font-black">Support operations</h3></div>
  <div className="grid gap-3 sm:grid-cols-3">
   <label className="space-y-1 text-xs font-bold">Status
    <select className={input} value={newStatus} onChange={e=>setNewStatus(e.target.value as Status)} disabled={busy}>
     {(["OPEN","IN_REVIEW","WAITING_CUSTOMER","RESOLVED","CLOSED"] as Status[]).map(s=><option key={s} value={s}>{s.replaceAll("_"," ")}</option>)}
    </select></label>
   <label className="space-y-1 text-xs font-bold">Priority
    <select className={input} value={newPriority} onChange={e=>setNewPriority(e.target.value as Priority)} disabled={busy}>
     {(["NORMAL","HIGH","URGENT"] as Priority[]).map(s=><option key={s} value={s}>{s}</option>)}
    </select></label>
   <label className="space-y-1 text-xs font-bold">Assigned agent
    <select className={input} value={agent} onChange={e=>setAgent(e.target.value)} disabled={busy}>
     <option value="">Unassigned</option>{agents.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}
    </select></label>
  </div>
  <Button disabled={busy} onClick={()=>submit("settings")}>Save ticket status & assignment</Button>
  <div className="space-y-2 border-t pt-4">
   <label htmlFor={`staff-note-${ticketId}`} className="text-sm font-bold">Confidential internal note</label>
   <Textarea id={`staff-note-${ticketId}`} disabled={busy} rows={3} maxLength={3000} value={note} onChange={e=>setNote(e.target.value)}
    placeholder="Investigation notes, follow-up plan or internal context. Never visible to the customer."/>
   <Button type="button" variant="outline" disabled={busy||note.trim().length<10} onClick={()=>submit("note")}>Record private note</Button>
   <p className="text-xs text-muted-foreground">Notes and assignments do not release money or resolve an active transaction dispute.</p>
  </div>
  {feedback&&<p role={feedback.ok?"status":"alert"} className={feedback.ok?"text-xs text-emerald-700 dark:text-emerald-300":"text-xs text-destructive"}>{feedback.message}</p>}
 </section>;
}
