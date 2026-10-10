"use client";

import { useState,useTransition } from "react";
import { useRouter } from "next/navigation";
import { CircleDollarSign,Receipt,Check,ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { recordCompanyCostAction,changeCompanyCostAction } from "@/server/actions/company-costs";
import { COST_CATEGORIES,nextCostStatuses,type CostInput } from "@/lib/finance/costs";

const input="h-11 w-full rounded-lg border bg-background px-3 text-sm shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";
export function RecordCompanyCost() {
 const router=useRouter();const [busy,start]=useTransition();
 const [form,setForm]=useState<CostInput>({description:"",category:"OPERATIONS",payee:"",amountUsd:"",incurredOn:""});
 const [feedback,setFeedback]=useState<string|null>(null);const [ok,setOk]=useState(false);
 function field<K extends keyof CostInput>(key:K,value:CostInput[K]){setForm(s=>({...s,[key]:value}));}
 function submit(e:React.FormEvent<HTMLFormElement>){
  e.preventDefault();setFeedback(null);
  start(async()=>{
   try{
    const r=await recordCompanyCostAction(form);
    setFeedback(r.ok?"Company cost recorded. This is bookkeeping only; no funds moved.":r.message);
    setOk(r.ok);
    if(r.ok){setForm({description:"",category:"OPERATIONS",payee:"",amountUsd:"",incurredOn:""});router.refresh();}
   }catch{setOk(false);setFeedback("Unable to verify this entry. Refresh before creating it again.");}
  });
 }
 return <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
  <div className="border-b bg-muted/20 p-5 sm:p-7">
   <p className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-primary"><CircleDollarSign className="size-4" aria-hidden/> Company finances</p>
   <h2 className="mt-2 text-xl font-black tracking-tight">Record a business cost</h2>
   <p className="mt-2 text-xs leading-5 text-muted-foreground">Include staff pay, marketing, hosting and provider charges. This never takes money from a seller balance.</p>
  </div>
  <form method="post" onSubmit={submit} className="grid gap-4 p-5 sm:grid-cols-2 sm:p-7">
   <label className="space-y-1.5 text-xs font-bold sm:col-span-2">Expense description
    <input className={input} required minLength={5} maxLength={180} value={form.description} onChange={e=>field("description",e.target.value)} placeholder="October customer support hours" disabled={busy}/>
   </label>
   <label className="space-y-1.5 text-xs font-bold">Category
    <select className={input} value={form.category} disabled={busy} onChange={e=>field("category",e.target.value as CostInput["category"])}>
     {COST_CATEGORIES.map(c=><option value={c} key={c}>{c.replaceAll("_"," ")}</option>)}
    </select>
   </label>
   <label className="space-y-1.5 text-xs font-bold">Vendor or employee label
    <input className={input} required minLength={2} maxLength={120} value={form.payee} onChange={e=>field("payee",e.target.value)} disabled={busy} placeholder="Part-time staff"/>
   </label>
   <label className="space-y-1.5 text-xs font-bold">Amount (USD)
    <input inputMode="decimal" className={input} required placeholder="32.50" maxLength={20} value={form.amountUsd} disabled={busy} onChange={e=>field("amountUsd",e.target.value)}/>
   </label>
   <label className="space-y-1.5 text-xs font-bold">Incurred on (optional)
    <input type="date" className={input} value={form.incurredOn} disabled={busy} onChange={e=>field("incurredOn",e.target.value)}/>
   </label>
   <div className="sm:col-span-2 space-y-3">
    <Button type="submit" disabled={busy} className="min-h-11"><Receipt className="mr-2 size-4" aria-hidden/>{busy?"Recording…":"Save cost record"}</Button>
    {feedback && <p role={ok?"status":"alert"} className={ok?"text-sm font-semibold text-emerald-700 dark:text-emerald-300":"text-sm text-destructive"}>{feedback}</p>}
   </div>
  </form>
 </section>;
}

export function CompanyCostAction({id,status}:{id:string;status:string}){
 const [next,setNext]=useState<string|null>(null);const [reference,setReference]=useState("");const [note,setNote]=useState("");
 const [busy,start]=useTransition();const [message,setMessage]=useState<string|null>(null);const [ok,setOk]=useState(false);
 const router=useRouter();const options=nextCostStatuses(status);
 if(options.length===0) return <span className="text-xs text-muted-foreground">Final state</span>;
 function commit(){
  if(!next)return;
  start(async()=>{try{
   const result=await changeCompanyCostAction({id,status:next,reference,note});
   setOk(result.ok);setMessage(result.ok?"Status saved to audit. No transfer initiated.":result.message);
   if(result.ok){setNext(null);setReference("");setNote("");router.refresh();}
  }catch{setOk(false);setMessage("Unable to verify the update. Reload before retrying.");}});
 }
 return <div className="space-y-3">
  {!next?<div className="flex flex-wrap gap-2">{options.map(v=><Button key={v} size="sm" variant="outline" type="button" onClick={()=>{setNext(v);setMessage(null);}}>{v==="PAID"?"Record outside payment":v==="INCURRED"?"Mark incurred":"Void record"}</Button>)}</div>:
   <div className="space-y-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3">
    <p className="flex gap-2 text-xs font-bold"><ShieldAlert className="size-4 shrink-0" aria-hidden/>Confirm {next.toLowerCase()} for this company cost.</p>
    {next==="PAID"&&<label className="space-y-1 text-xs font-bold">External payment reference (required)
      <input className={input} value={reference} minLength={6} maxLength={180} onChange={e=>setReference(e.target.value)} placeholder="Statement or transaction reference"/>
     </label>}
    <label className="space-y-1 text-xs font-bold">Audit note (optional)
     <Textarea value={note} onChange={e=>setNote(e.target.value)} rows={2} maxLength={1000}/>
    </label>
    <p className="text-xs text-muted-foreground">This records an attestation only. It does not initiate a Linkwa or EcoCash payment.</p>
    <div className="flex gap-2">
     <Button size="sm" disabled={busy || (next==="PAID"&&reference.trim().length<6)} onClick={commit}><Check className="mr-2 size-4" aria-hidden/>{busy?"Saving…":"Confirm"}</Button>
     <Button size="sm" variant="outline" disabled={busy} onClick={()=>setNext(null)}>Cancel</Button>
    </div>
   </div>}
  {message&&<p role={ok?"status":"alert"} className={ok?"text-xs font-bold text-emerald-700 dark:text-emerald-300":"text-xs text-destructive"}>{message}</p>}
 </div>;
}
