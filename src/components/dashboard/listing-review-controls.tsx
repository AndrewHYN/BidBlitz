"use client";

import { useState,useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2,ShieldAlert,XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { staffDecideListingAction } from "@/server/actions/staff-listing-review";
type Decision="APPROVED"|"REJECTED"|"CHANGES_REQUESTED";
const labels:Record<Decision,string>={APPROVED:"Approve listing",REJECTED:"Reject listing",CHANGES_REQUESTED:"Request changes"};
export function ListingReviewControls({reviewId,canApprove,canReject,canRequestChanges}:{
 reviewId:string;canApprove:boolean;canReject:boolean;canRequestChanges:boolean;
}){
 const router=useRouter();const [mode,setMode]=useState<Decision|null>(null);
 const [reason,setReason]=useState(""),[pending,start]=useTransition();
 const [message,setMessage]=useState<{ok:boolean;text:string}|null>(null);
 function act(){
  if(!mode||pending||(mode!=="APPROVED"&&reason.trim().length<5))return;
  setMessage(null);
  start(async()=>{try{
    const decision=mode;
    const outcome=await staffDecideListingAction({reviewId,decision,reason});
    setMessage({ok:outcome.ok,text:outcome.ok?
     `Listing ${outcome.decision.toLowerCase().replaceAll("_"," ")}; seller notified inside BidBlitz.`:outcome.message});
    if(outcome.ok){setMode(null);router.refresh();}
   }catch{setMessage({ok:false,text:"Decision outcome unclear. Reload the queue before acting again."});}
  });
 }
 return <div className="space-y-3" data-testid="staff-listing-controls">
  {!mode?<div className="flex flex-wrap gap-2">
    {canApprove&&<Button size="sm" type="button" onClick={()=>{setMode("APPROVED");setMessage(null);}}><CheckCircle2 className="mr-2 size-4" aria-hidden/> Approve</Button>}
    {canRequestChanges&&<Button size="sm" type="button" variant="outline" onClick={()=>{setMode("CHANGES_REQUESTED");setMessage(null);}}>Request changes</Button>}
    {canReject&&<Button size="sm" type="button" variant="outline" onClick={()=>{setMode("REJECTED");setMessage(null);}}><XCircle className="mr-2 size-4" aria-hidden/> Reject</Button>}
   </div>:
   <div className="space-y-3 rounded-xl border border-orange-500/25 bg-orange-500/5 p-4">
    <p className="flex items-start gap-2 text-xs font-bold"><ShieldAlert className="mt-0.5 size-4 shrink-0 text-orange-700 dark:text-orange-300" aria-hidden/>
     Confirm: {labels[mode]}. This changes the actual auction state and notifies the seller.</p>
    <label className="block text-xs font-bold" htmlFor={`listing-reason-${reviewId}`}>
      Review explanation {mode==="APPROVED"?"(optional)":"(required)"}
    </label>
    <Textarea id={`listing-reason-${reviewId}`} rows={3} maxLength={1000} value={reason} onChange={e=>setReason(e.target.value)} disabled={pending} placeholder="Give a clear and specific reason."/>
    <div className="flex flex-wrap gap-2">
     <Button size="sm" disabled={pending||(mode!=="APPROVED"&&reason.trim().length<5)} onClick={act}>{pending?"Saving…":labels[mode]}</Button>
     <Button size="sm" variant="outline" disabled={pending} onClick={()=>{setMode(null);setReason("");}}>Cancel</Button>
    </div>
   </div>}
  {message&&<p role={message.ok?"status":"alert"} className={message.ok?"text-xs font-bold text-emerald-700 dark:text-emerald-300":"text-xs font-bold text-destructive"}>{message.text}</p>}
 </div>;
}
