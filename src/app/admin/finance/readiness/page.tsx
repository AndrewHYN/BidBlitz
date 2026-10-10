import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Activity,ArrowLeft,AlertTriangle,CheckCircle2,KeyRound,ShieldCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { hasPermission } from "@/server/permissions";
import { AdminNav } from "@/components/dashboard/admin-nav";
import { readLinkwaEnvironment } from "@/server/payments/config";
import { fetchLinkwaBalance } from "@/server/payments/linkwa-payouts";
import { PaymentProviderRequestError } from "@/server/payments/provider";
import { formatMoney,money } from "@/lib/money";

export const metadata:Metadata={title:"Payment activation readiness",robots:{index:false,follow:false}};
export const dynamic="force-dynamic";
type Probe = {status:"passed"|"failed"|"unverified";detail:string};

export default async function PaymentReadinessPage(){
 const supabase=await createClient();const {data:{user}}=await supabase.auth.getUser();
 if(!user)redirect("/login?next=/admin/finance/readiness");
 const [canPayments,canTeam]=await Promise.all([
  hasPermission(user.id,"payments.view"),hasPermission(user.id,"admin.manage_team")
 ]);
 if(!canPayments)redirect("/");
 const env=readLinkwaEnvironment();
 let provider:Probe={status:"unverified",detail:"Provider readiness has not been checked."};
 let available:string|null=null;
 if(env.state!=="ready"||!env.config){
  provider={status:"failed",detail:"The production provider environment is incomplete. Review server-side Linkwa configuration."};
 }else{
  try{
   const balances=await fetchLinkwaBalance({apiKey:env.config.apiKey,baseUrl:env.config.baseUrl});
   const usd=balances.find(b=>b.currency==="USD");
   available=usd?formatMoney(money(usd.availableMinor,"USD")):null;
   provider={status:usd?"passed":"unverified",
    detail:usd?"Linkwa accepted a read-only API request. This does not prove a payment or payout has settled.":"The API responded but returned no USD balance bucket."};
  }catch(e){
   const status=e instanceof PaymentProviderRequestError?e.httpStatus:undefined;
   provider={status:"failed",detail:status===401?
    "The production Linkwa API rejected the currently deployed key (HTTP 401). Check that the new app credentials were included in this deployment.":
    status===403?"Linkwa denied the production API (HTTP 403). Confirm app entitlement with Linkwa.":
    status? `The provider returned HTTP ${status}. No transaction was attempted.`:
    "The read-only Linkwa API check was unreachable or invalid. No transaction was attempted."};
  }
 }
 const [settings,feeSettings,unreconciled,transactions]=await Promise.all([
  supabase.from("payment_settings").select("payments_enabled, automatic_payouts_enabled").maybeSingle(),
  supabase.from("fee_settings").select("fee_bps").maybeSingle(),
  supabase.from("seller_payouts").select("id",{count:"exact",head:true}).eq("status","PAYOUT_DUE"),
  supabase.from("transactions").select("id",{count:"exact",head:true}).in("status",["PAID","SETTLED"])
 ]);
 const enabled=!settings.error&&settings.data?.payments_enabled===true;
 const autoPayoutEnabled=!settings.error&&settings.data?.automatic_payouts_enabled===true;
 const due=unreconciled.error?null:unreconciled.count;
 const fee=feeSettings.error?null:feeSettings.data?.fee_bps;
 const checks=[
  {title:"Production API authorization",status:provider.status,detail:provider.detail},
  {title:"5% platform fee",status:fee===500?"passed":"failed",detail:fee===null?"Live fee configuration could not be read.":fee===500?"Live fee remains 500 basis points (5%).":"Live fee does not match the agreed 5%."},
  {title:"Payouts needing reconciliation",status:due===0?"passed":due===null?"unverified":"failed",
   detail:due===null?"Payout status query unavailable.":due===0?"No payout is currently marked PAYOUT_DUE.":"There are "+due+" payout(s) whose provider status or receipt needs reconciliation. These stay blocked individually and do not require pausing all new buyer checkouts."},
  {title:"Automatic Linkwa seller disbursements",status:autoPayoutEnabled?"passed":"unverified",
   detail:autoPayoutEnabled?"Automatic seller payouts are permitted, subject to live balance and delivery/dispute safety checks.":"Automatic seller payouts remain disabled. Finance staff can explicitly initiate an eligible Linkwa payout or reserve a separate SmileCash/EcoCash external wallet transfer."},
  {title:"Seller payout proof",status:"unverified" as const,
   detail:"Successful provider POST means instruction accepted, not seller receipt. External wallet transfers can only be closed with independently verified receipt evidence."},
  {title:"Webhook and buyer settlement",status:"unverified" as const,
   detail:"A signed production payment webhook and completed transaction are the final proof. API authentication alone is not proof a buyer payment has settled."},
 ];
 // Do not block unrelated NEW buyer collections because one OLD payout still
 // needs manual reconciliation. The seller payout itself remains blocked.
 const checkoutOperational=enabled && provider.status==="passed" && fee===500;
 return <main className="page-container space-y-7 py-8 sm:py-12" data-testid="payment-readiness">
  <header className="relative overflow-hidden rounded-[1.75rem] border border-orange-500/20 bg-[#151719] p-7 text-white shadow-xl sm:p-10">
   <p className="flex items-center gap-2 text-xs font-black uppercase tracking-[.18em] text-orange-300"><Activity className="size-4" aria-hidden/> BidBlitz / Launch safety</p>
   <h1 className="mt-4 text-3xl font-black tracking-[-.055em] sm:text-5xl">Payment readiness<span className="text-orange-400">.</span></h1>
   <p className="mt-3 max-w-2xl text-sm leading-7 text-zinc-300">A real-time, read-only diagnosis. This page never changes payment settings, creates a checkout or instructs a seller payout.</p>
   <div className="mt-5 flex flex-wrap gap-2">
    <span className={enabled?"rounded-lg bg-emerald-400/15 px-3 py-2 text-xs font-bold text-emerald-300":"rounded-lg bg-amber-400/15 px-3 py-2 text-xs font-bold text-amber-300"}>
     Payments: {enabled?"enabled":"paused"}
    </span>
    <span className="rounded-lg bg-white/10 px-3 py-2 text-xs font-bold">Release: {checkoutOperational?"buyer checkout live, verify real receipts":"checkout needs attention"}</span>
   </div>
  </header>
  <AdminNav active="finance" showTeam={canTeam}/>
  <Link href="/admin/finance" className="inline-flex items-center gap-2 text-sm font-bold text-primary hover:underline"><ArrowLeft className="size-4" aria-hidden/> Finance dashboard</Link>
  <section aria-label="Live payment and settlement checks" className="grid gap-3 md:grid-cols-2">
   {checks.map(c=>(
    <div key={c.title} className="rounded-2xl border bg-card p-5 shadow-sm">
     <div className="flex items-start gap-3">
      <span className={c.status==="passed"?"grid size-10 shrink-0 place-items-center rounded-lg bg-emerald-500/10 text-emerald-700 dark:text-emerald-300":"grid size-10 shrink-0 place-items-center rounded-lg bg-amber-500/10 text-amber-700 dark:text-amber-300"}>
       {c.status==="passed"?<CheckCircle2 className="size-5" aria-hidden/>:<AlertTriangle className="size-5" aria-hidden/>}
      </span>
      <div><p className="font-extrabold">{c.title}</p>
       <p className="mt-1 text-[11px] font-black uppercase tracking-widest text-muted-foreground">{c.status}</p>
       <p className="mt-2 text-sm leading-6 text-muted-foreground">{c.detail}</p>
      </div>
     </div>
    </div>
   ))}
  </section>
  {available&&<p className="rounded-xl border bg-card p-5 text-sm">Linkwa-reported available USD: <strong>{available}</strong>. This is not proof of SmileCash settlement or payout to the seller.</p>}
  <section className="space-y-3 rounded-2xl border bg-muted/20 p-5 sm:p-7">
   <h2 className="flex items-center gap-2 text-xl font-black"><KeyRound className="size-5 text-primary" aria-hidden/> Final activation rule</h2>
   <p className="text-sm leading-7">The owner has confirmed that business and legal arrangements are handled outside BidBlitz; this page does not independently verify them. Buyer checkout and seller disbursement have separate controls. Even with checkout enabled, reconcile every actual buyer collection against Linkwa and SmileCash statements, then pay the frozen seller proceeds through an eligible Linkwa API payout or an independently verified external SmileCash/EcoCash transfer. Old ambiguous payouts must not be retried automatically.</p>
   <p className="text-xs leading-6 text-muted-foreground">Linkwa reports payments may settle to the merchant SmileCash wallet rather than the Developer API balance. A zero Developer balance is not proof there was no buyer payment. Use the payout desk to reserve and record external seller transfers where appropriate.</p>
   <p className="flex items-center gap-2 text-xs font-bold text-muted-foreground"><ShieldCheck className="size-4" aria-hidden/> Live records are read-only on this page. Failed queries never imply a zero balance.</p>
  </section>
  <p className="text-xs text-muted-foreground">This page does not expose API keys or webhook secrets. Buyer transactions currently recorded in the selected database: {transactions.error?"unavailable":transactions.count??"unavailable"}.</p>
 </main>;
}
