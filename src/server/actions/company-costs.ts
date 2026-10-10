"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { hasPermission } from "@/server/permissions";
import { prepareCost } from "@/lib/finance/costs";

type Outcome = { ok: true; status: string } | { ok: false; message: string };
async function financeClient() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user && await hasPermission(user.id,"finance.costs.manage") ? supabase : null;
}
export async function recordCompanyCostAction(input: unknown): Promise<Outcome> {
  const cost = prepareCost(input);
  if (!cost) return { ok: false, message: "Enter a valid payee, description, category, date and USD amount." };
  const supabase = await financeClient();
  if (!supabase) return { ok:false, message:"Finance expense editor permission required." };
  const { data, error } = await supabase.rpc("staff_create_company_cost",{
    p_description: cost.description,p_category:cost.category,p_amount_minor:cost.amountMinor,
    p_payee_label:cost.payee,p_incurred_on:cost.incurredOn
  });
  if (error || data?.ok!==true) return { ok:false, message:"Could not record the expense. No money was transferred." };
  revalidatePath("/admin/finance/costs");
  return { ok:true,status:data.status };
}
const changeSchema = z.object({
  id:z.string().uuid(),status:z.enum(["INCURRED","PAID","VOIDED"]),
  reference:z.string().trim().max(180).optional().default(""),
  note:z.string().trim().max(1000).optional().default("")
}).strict();
export async function changeCompanyCostAction(input:unknown):Promise<Outcome>{
  const parsed=changeSchema.safeParse(input);
  if(!parsed.success)return {ok:false,message:"Invalid cost change request."};
  if(parsed.data.status==="PAID" && parsed.data.reference.length<6)
    return {ok:false,message:"A confirmed outside payment reference is required to record PAID."};
  const supabase=await financeClient();
  if(!supabase)return {ok:false,message:"Finance editor permission required."};
  const {data,error}=await supabase.rpc("staff_transition_company_cost",{
    p_cost_id:parsed.data.id,p_status:parsed.data.status,
    p_external_reference:parsed.data.reference || null,p_note:parsed.data.note
  });
  if(error||data?.ok!==true)return {ok:false,message:"Cost status rejected. No automatic payment was attempted."};
  revalidatePath("/admin/finance/costs");
  return {ok:true,status:data.status};
}
