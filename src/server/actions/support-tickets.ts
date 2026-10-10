"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { hasPermission } from "@/server/permissions";

type Result={ok:true;id?:string;status?:string}|{ok:false;message:string};
const openSchema=z.object({
 category:z.enum(["ACCOUNT","AUCTION","LISTING","PAYMENT","PAYOUT","SAFETY","OTHER"]),
 subject:z.string().trim().min(5).max(160),
 body:z.string().trim().min(10).max(4000)
}).strict();
const replySchema=z.object({
 ticketId:z.string().uuid(),
 body:z.string().trim().min(2).max(4000)
}).strict();
const staffSchema=z.object({
 ticketId:z.string().uuid(),
 status:z.enum(["OPEN","IN_REVIEW","WAITING_CUSTOMER","RESOLVED","CLOSED"]),
 priority:z.enum(["NORMAL","HIGH","URGENT"]),
 assigneeId:z.string().uuid().nullable()
}).strict();
const noteSchema=z.object({ticketId:z.string().uuid(),note:z.string().trim().min(10).max(3000)}).strict();

async function requireUser(){
 const supabase=await createClient();
 const {data:{user}}=await supabase.auth.getUser();
 return user?{supabase,user}:null;
}
async function requireStaff(){
 const session=await requireUser();
 return session && await hasPermission(session.user.id,"support.manage")?session:null;
}
function fail(error?:string){
 if(error?.includes("ticket_rate_limited"))return "Too many new tickets. Please wait an hour before opening another.";
 if(error?.includes("ticket_closed"))return "This ticket is closed or resolved. Open another if you need more help.";
 if(error?.includes("not_authorised"))return "You are not permitted to access this ticket.";
 return "The support system could not verify this change. Reload before trying again.";
}
function invalidate(id:string){revalidatePath("/support/tickets");revalidatePath(`/support/tickets/${id}`);revalidatePath("/admin/support");revalidatePath(`/admin/support/${id}`);}
export async function openSupportTicketAction(value:unknown):Promise<Result>{
 const parsed=openSchema.safeParse(value);
 if(!parsed.success)return {ok:false,message:"Please provide a category, clear subject and description (at least 10 characters)."};
 const session=await requireUser();
 if(!session)return {ok:false,message:"Sign in to create a support ticket."};
 const {data,error}=await session.supabase.rpc("open_support_ticket",{
  p_category:parsed.data.category,p_subject:parsed.data.subject,p_body:parsed.data.body
 });
 if(error||data?.ok!==true||typeof data.id!=="string")return {ok:false,message:fail(error?.message)};
 invalidate(data.id);
 return {ok:true,id:data.id};
}
export async function replySupportTicketAction(value:unknown):Promise<Result>{
 const parsed=replySchema.safeParse(value);
 if(!parsed.success)return {ok:false,message:"Write a message between 2 and 4000 characters."};
 const session=await requireUser();
 if(!session)return {ok:false,message:"Sign in to reply."};
 const {data,error}=await session.supabase.rpc("reply_support_ticket",{
  p_ticket_id:parsed.data.ticketId,p_body:parsed.data.body
 });
 if(error||data?.ok!==true)return {ok:false,message:fail(error?.message)};
 invalidate(parsed.data.ticketId);return {ok:true,status:data.status};
}
export async function staffUpdateSupportTicketAction(value:unknown):Promise<Result>{
 const parsed=staffSchema.safeParse(value);
 if(!parsed.success)return {ok:false,message:"Select a valid status, priority and agent."};
 const session=await requireStaff();
 if(!session)return {ok:false,message:"Support team permission required."};
 const {data,error}=await session.supabase.rpc("staff_update_support_ticket",{
  p_ticket_id:parsed.data.ticketId,p_status:parsed.data.status,
  p_priority:parsed.data.priority,p_assigned_to:parsed.data.assigneeId
 });
 if(error||data?.ok!==true)return {ok:false,message:fail(error?.message)};
 invalidate(parsed.data.ticketId);return {ok:true,status:data.status};
}
export async function staffAddSupportNoteAction(value:unknown):Promise<Result>{
 const parsed=noteSchema.safeParse(value);
 if(!parsed.success)return {ok:false,message:"Private notes must be between 10 and 3000 characters."};
 const session=await requireStaff();
 if(!session)return {ok:false,message:"Support team permission required."};
 const {data,error}=await session.supabase.rpc("staff_add_support_note",{
  p_ticket_id:parsed.data.ticketId,p_note:parsed.data.note
 });
 if(error||data?.ok!==true)return {ok:false,message:fail(error?.message)};
 invalidate(parsed.data.ticketId);return {ok:true};
}
