import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";

describe("production browser security policy", () => {
  it("sets privacy and anti-embedding headers on all routes", async () => {
    const entries = await nextConfig.headers?.();
    expect(entries).toBeDefined();
    const all = (entries ?? []).flatMap((entry) => entry.headers);
    const headers = new Map(all.map((entry) => [entry.key.toLowerCase(), entry.value]));
    expect(headers.get("x-frame-options")).toBe("DENY");
    expect(headers.get("x-content-type-options")).toBe("nosniff");
    expect(headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
    expect(headers.get("permissions-policy")).toContain("camera=()");
    const csp = headers.get("content-security-policy") ?? "";
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).not.toContain("'unsafe-eval'");
  });
});
