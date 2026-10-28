import "server-only";
import { createClient } from "@/lib/supabase/server";
import { parseSalesAccount, parseCollectionChecks } from "@/lib/finance/sales-account";

export async function readMySalesAccount() {
  const supabase = await createClient();
  // Identity and all sums are resolved together by the caller's database session.
  const { data, error } = await supabase.rpc("my_sales_account");
  const account = error ? null : parseSalesAccount(data);
  return account ? { ok: true as const, account } : {
    ok: false as const, message: "Your sales balance could not be verified. Please reload or contact BidBlitz support.",
  };
}

export async function readCollectionChecks(transactionIds: string[]) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("staff_collection_checks", { p_transaction_ids: transactionIds });
  return error ? null : parseCollectionChecks(data, transactionIds);
}
