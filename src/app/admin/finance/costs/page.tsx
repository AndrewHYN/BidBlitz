import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft,Wallet,Receipt,ShieldCheck,Boxes } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { hasPermission } from "@/server/permissions";
import { AdminNav } from "@/components/dashboard/admin-nav";
import { RecordCompanyCost,CompanyCostAction } from "@/components/dashboard/company-costs";
import { FinanceTransferSlip } from "@/components/dashboard/finance-transfer-slip";
import { formatMoney,money } from "@/lib/money";

export const metadata:Metadata={title:"Company costs | BidBlitz",robots:{index:false,follow:false}};
type Cost = {
 id:string;description:string;category:string;payee_label:string|null;
 amount_minor:number|string;status:string;incurred_on:string|null;
 external_reference:string|null;created_at:string;
};
const statuses=["PLANNED","INCURRED","PAID","VOIDED"];
function showCost(value:unknown){try{return formatMoney(money(value as string|number,"USD"));}catch{return "Unavailable";}}

export default async function CompanyCostsPage(){
 const supabase=await createClient();const {data:{user}}=await supabase.auth.getUser();
 if(!user)redirect("/login?next=/admin/finance/costs");
 const [mayRead,mayWrite,mayTeam,mayPayouts]=await Promise.all([
  hasPermission(user.id,"finance.costs.view"),hasPermission(user.id,"finance.costs.manage"),
  hasPermission(user.id,"admin.manage_team"),hasPermission(user.id,"payouts.view")
 ]);
 if(!mayRead)redirect("/");
 const [listRes,summaryRes]=await Promise.all([
  supabase.from("company_operating_costs")
   .select("id,description,category,payee_label,amount_minor,status,incurred_on,external_reference,created_at")
   .order("created_at",{ascending:false}).limit(100),
  supabase.rpc("staff_company_cost_summary")
 ]);
 const rows=(listRes.data??[]) as Cost[];
 const summary=!summaryRes.error&&summaryRes.data&&typeof summaryRes.data==="object"
   ? summaryRes.data as Record<string,unknown>:null;
 return <main className="page-container space-y-7 py-8 sm:py-12" data-testid="company-costs-page">
  <header className="relative overflow-hidden rounded-[1.75rem] border border-orange-500/20 bg-[#17191b] p-7 text-white shadow-xl sm:p-10">
   <p className="text-xs font-extrabold uppercase tracking-[.2em] text-orange-300">BidBlitz / Executive finance</p>
   <h1 className="mt-4 text-4xl font-black tracking-[-.055em] sm:text-6xl">Cost control<span className="text-orange-400">.</span></h1>
   <p className="mt-3 max-w-2xl text-sm leading-7 text-zinc-300">Payroll provisions, marketing expenses, provider charges and running costs, kept completely separate from customer collections and seller money.</p>
  </header>
  <AdminNav active="finance" showTeam={mayTeam}/>
  <nav className="flex flex-wrap gap-3 text-sm font-bold">
   <Link href="/admin/finance" className="flex items-center gap-1 text-primary hover:underline"><ArrowLeft className="size-4" aria-hidden/> Finance headquarters</Link>
   {mayPayouts&&<Link href="/admin/finance/payouts" className="flex items-center gap-1 text-primary hover:underline"><Wallet className="size-4" aria-hidden/> Seller payout desk</Link>}
  </nav>
  {summary ? <section aria-label="Company cost totals" className="grid gap-3 sm:grid-cols-3">
   {([{key:"plannedMinor",label:"Planned company spend"},{key:"incurredMinor",label:"Recorded unpaid costs"},{key:"paidMinor",label:"Recorded externally paid"}] as const).map(item=>
    <div key={item.key} className="rounded-2xl border bg-card p-5 shadow-sm">
     <p className="text-xs font-black uppercase tracking-widest text-muted-foreground">{item.label}</p>
     <p className="mt-3 text-3xl font-black tabular-nums">{showCost(summary[item.key])}</p>
    </div>)}
   </section> :
   <p role="alert" className="rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive">Company cost totals unavailable. Do not assume your spending is zero.</p>}
  <p className="flex gap-2 rounded-xl border border-amber-500/25 bg-amber-500/5 p-4 text-sm leading-6">
   <ShieldCheck className="mt-1 size-5 shrink-0 text-amber-600" aria-hidden/>
   These records are <strong>company expenses, not seller liabilities</strong>. Marking paid records outside payment evidence; it never withdraws cash or pays an employee.
  </p>
  <section className="grid gap-3 sm:grid-cols-3" aria-label="Expense payment steps">
    {[
      {step:"01",title:"Record liability",detail:"Create the planned or incurred cost in your company ledger."},
      {step:"02",title:"Transfer externally",detail:"Copy the exact worksheet and send from company-owned funds after verifying the recipient."},
      {step:"03",title:"Attach proof",detail:"Only after the payee receives funds, record the actual provider reference as PAID."},
    ].map(item=><div key={item.step} className="rounded-xl border bg-card p-4">
      <p className="text-xs font-black text-primary">{item.step}</p>
      <h3 className="mt-2 font-extrabold">{item.title}</h3>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">{item.detail}</p>
    </div>)}
  </section>
  {mayWrite&&<RecordCompanyCost/>}
  <section className="space-y-4" aria-labelledby="cost-list-heading">
   <div className="flex items-end justify-between gap-4">
    <div><p className="text-xs font-black uppercase tracking-widest text-primary">Your books</p><h2 id="cost-list-heading" className="mt-1 text-2xl font-black tracking-tight">Expense register</h2></div>
    <span className="text-xs text-muted-foreground">Latest {rows.length} entries</span>
   </div>
   {listRes.error ?
    <p role="alert" className="rounded-xl border border-destructive/25 p-5 text-destructive">Expense records could not be loaded; do not assume an empty ledger.</p>:
    rows.length===0?
     <div className="rounded-2xl border bg-card p-8 text-center"><Boxes className="mx-auto size-8 text-muted-foreground" aria-hidden/><h3 className="mt-3 font-bold">Nothing recorded yet</h3><p className="mt-2 text-sm text-muted-foreground">Add the first hosting, salary or marketing cost when it occurs.</p></div>:
     <ul className="grid gap-3 xl:grid-cols-2">
      {rows.map(row=><li key={row.id} className="rounded-2xl border bg-card p-5 shadow-sm" data-testid="company-cost-row">
       <div className="flex flex-wrap justify-between gap-3">
        <div><p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">{row.category.replaceAll("_"," ")}</p>
         <h3 className="mt-1 text-lg font-extrabold">{row.description}</h3>
         <p className="mt-1 text-xs text-muted-foreground">{row.payee_label??"Payee unavailable"} · {new Date(row.created_at).toLocaleDateString("en-US")}</p>
        </div>
        <div className="text-right"><p className="text-xl font-black tabular-nums">{showCost(row.amount_minor)}</p>
         <span className={row.status==="PAID"?"text-xs font-bold text-emerald-700 dark:text-emerald-300":"text-xs font-bold text-muted-foreground"}>{statuses.includes(row.status)?row.status:"UNKNOWN"}</span></div>
       </div>
       {row.external_reference&&<p className="mt-3 break-all text-xs text-muted-foreground">External proof: {row.external_reference}</p>}
       {mayWrite&&row.status==="INCURRED"&&Number.isSafeInteger(Number(row.amount_minor))&&
          <div className="mt-4 border-t pt-4">
            <FinanceTransferSlip amountMinor={Number(row.amount_minor)} currency="USD"
              recipient={row.payee_label??"Payee verification required"}
              editableDestination rail="External EcoCash / SmileCash / bank"
              reference={row.id} reason={row.description} />
          </div>}
       {mayWrite&&<div className="mt-4 border-t pt-4"><CompanyCostAction id={row.id} status={row.status}/></div>}
      </li>)}
     </ul>}
  </section>
  <footer className="flex gap-2 rounded-xl border bg-muted/20 p-4 text-xs leading-5 text-muted-foreground"><Receipt className="mt-0.5 size-4 shrink-0" aria-hidden/> This expense register is a planning and evidence ledger, not a bookkeeping export, payroll processor, tax filing or bank reconciliation system.</footer>
 </main>;
}
