"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { hasPermission } from "@/server/permissions";

const reviewSchema=z.object({
 reviewId:z.string().uuid(),
 decision:z.enum(["APPROVED","REJECTED","CHANGES_REQUESTED"]),
 reason:z.string().trim().max(1000).default("")
}).strict();
type Outcome={ok:true;decision:string}|{ok:false;message:string};

export async function staffDecideListingAction(input:unknown):Promise<Outcome>{
 const parsed=reviewSchema.safeParse(input);
 if(!parsed.success)return {ok:false,message:"Invalid review request."};
 const {decision,reason,reviewId}=parsed.data;
 if(decision!=="APPROVED"&&reason.length<5)return {ok:false,message:"Explain the rejection or changes in at least 5 characters."};
 const supabase=await createClient();
 const {data:{user}}=await supabase.auth.getUser();
 if(!user)return {ok:false,message:"Sign in first."};
 const permission=decision==="APPROVED"?"listings.approve":decision==="REJECTED"?"listings.reject":"listings.request_changes";
 if(!await hasPermission(user.id,permission))return {ok:false,message:"Your role cannot make that decision."};
 const {data,error}=await supabase.rpc("staff_decide_listing_review",{
  p_review_id:reviewId,p_decision:decision,p_reason:reason||null
 });
 if(error||data?.ok!==true){
  return {ok:false,message:error?.message?.includes("self_review_forbidden")?
   "Staff cannot approve their own listings. Assign another reviewer.":
   "The review was refused or was already decided. Refresh the queue."};
 }
 revalidatePath("/admin/listings");
 revalidatePath("/admin/command");
 revalidatePath("/browse");
 revalidatePath("/");
 return {ok:true,decision};
}
