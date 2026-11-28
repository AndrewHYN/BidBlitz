import { beforeEach, describe, expect, it, vi } from "vitest";
const { rpc, from } = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ rpc, from }), hasAdminCredentials: () => true,
}));
import { dispatchEmailOutbox, queueEmail, retryDelayMs } from "./sender";
const baseJob = { id:"job-1", recipient:"buyer@example.com", template_key:"won",
  payload:{title:"Radio",auctionId:"a-1",amount:"$30.00",name:"Buyer"},
  idempotency_key:"won:auction:a-1", attempts:1, delivery_uncertain:false };
const update = vi.fn();
beforeEach(() => {
  vi.unstubAllGlobals(); rpc.mockReset(); from.mockReset(); update.mockReset();
  process.env.RESEND_API_KEY="re_test"; process.env.EMAIL_FROM="BidBlitz <mail@example.com>";
  rpc.mockResolvedValue({data:[baseJob],error:null});
  const chain={eq:vi.fn().mockReturnThis(),select:vi.fn(async()=>({data:[{id:"job-1"}],error:null}))};
  update.mockReturnValue(chain); from.mockReturnValue({update});
});
describe("email reliability",()=>{
  it("does not send without credentials",async()=>{
    delete process.env.RESEND_API_KEY; const fetcher=vi.fn();vi.stubGlobal("fetch",fetcher);
    expect((await dispatchEmailOutbox(1)).held).toBe("no-resend-credentials");expect(fetcher).not.toHaveBeenCalled();
  });
  it("does not claim with an unconfigured sender",async()=>{
    delete process.env.EMAIL_FROM;expect((await dispatchEmailOutbox(1)).held).toBe("no-valid-sender");expect(rpc).not.toHaveBeenCalled();
  });
  it("rejects invalid enqueues",async()=>{
    expect(await queueEmail({to:"invalid",template:"won",idempotencyKey:"k"})).toBeNull();expect(from).not.toHaveBeenCalled();
  });
  it("claims the requested job only and records provider ID",async()=>{
    const fetcher=vi.fn(async()=>({ok:true,json:async()=>({id:"provider-1"})}));vi.stubGlobal("fetch",fetcher);
    expect((await dispatchEmailOutbox(1,"job-1")).sent).toBe(1);
    expect(rpc).toHaveBeenCalledWith("claim_email_jobs_v2",{p_limit:1,p_job_id:"job-1"});
    expect(update).toHaveBeenCalledWith(expect.objectContaining({status:"SENT",provider_message_id:"provider-1"}));
    expect(fetcher).toHaveBeenCalledWith("https://api.resend.com/emails",expect.objectContaining({headers:expect.objectContaining({"Idempotency-Key":baseJob.idempotency_key})}));
  });
  it("defers rate limits and stops the batch",async()=>{
    vi.stubGlobal("fetch",vi.fn(async()=>({ok:false,status:429,headers:new Headers({"retry-after":"120"})})));
    expect((await dispatchEmailOutbox(10)).held).toBe("provider-rate-limit");
    expect(rpc).toHaveBeenCalledTimes(1);expect(update).toHaveBeenCalledWith(expect.objectContaining({status:"QUEUED",delivery_uncertain:false,last_error:"resend 429"}));
  });
  it("marks network failure as uncertain",async()=>{
    vi.stubGlobal("fetch",vi.fn(async()=>{throw new Error("timeout")}));
    expect((await dispatchEmailOutbox(1)).failed).toBe(1);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({status:"QUEUED",delivery_uncertain:true}));
  });
  it("does not send when recipient lookup fails",async()=>{
    rpc.mockResolvedValueOnce({data:[{...baseJob,template_key:"outbid"}],error:null}).mockResolvedValueOnce({data:null,error:{message:"lookup failed"}});
    const fetcher=vi.fn();vi.stubGlobal("fetch",fetcher);
    expect((await dispatchEmailOutbox(1)).failed).toBe(1);expect(fetcher).not.toHaveBeenCalled();
  });
  it("respects disabled optional notifications",async()=>{
    rpc.mockResolvedValueOnce({data:[{...baseJob,template_key:"outbid"}],error:null}).mockResolvedValueOnce({data:"u-1",error:null});
    from.mockImplementation((table:string)=>table==="notification_preferences"?{select:()=>({eq:()=>({maybeSingle:async()=>({data:{outbid:false},error:null})})})}:{update});
    const fetcher=vi.fn();vi.stubGlobal("fetch",fetcher);
    expect((await dispatchEmailOutbox(1)).skipped).toBe(1);expect(fetcher).not.toHaveBeenCalled();
  });
  it("backs off exponentially and respects retry-after",()=>{
    expect(retryDelayMs(1)).toBe(60000);expect(retryDelayMs(3)).toBe(240000);expect(retryDelayMs(1,"120")).toBe(120000);
  });
});
