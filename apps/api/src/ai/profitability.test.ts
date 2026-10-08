
import { describe, expect, it } from "vitest";
import { analyzeProfit } from "./profitability.js";

describe("analyzeProfit", () => {
  it("computes bid suggestions from fixed commission", () => {
    const r = analyzeProfit({ fixedAmount: 10, currency: "USD" }, 2);
    expect(r.commission.method).toBe("fixed");
    expect(r.commission.commissionMin).toBe(10);
    // break-even CPC = 10 * 2 / 100 = 0.2
    expect(r.breakEvenCpc).toBe(0.2);
    expect(r.bids).toHaveLength(3);
    expect(r.bids[0].maxCpc).toBe(0.1); // conservative 50%
    expect(r.bids[1].maxCpc).toBe(0.14); // moderate 70%
    expect(r.bids[2].maxCpc).toBe(0.18); // aggressive 90%
  });

  it("computes commission range from price x pct", () => {
    const r = analyzeProfit(
      { priceMin: 50, priceMax: 100, commissionPctMin: 5, commissionPctMax: 10, currency: "USD" },
      2
    );
    expect(r.commission.method).toBe("range");
    expect(r.commission.commissionMin).toBe(2.5); // 50 * 5%
    expect(r.commission.commissionMax).toBe(10); // 100 * 10%
  });

  it("returns unknown when no commission input", () => {
    const r = analyzeProfit({}, 2);
    expect(r.commission.method).toBe("unknown");
    expect(r.breakEvenCpc).toBeNull();
    expect(r.bids.every((b) => b.maxCpc === null)).toBe(true);
  });

  it("produces profit/loss scenarios", () => {
    const r = analyzeProfit({ fixedAmount: 10, currency: "USD" }, 2);
    expect(r.scenarios).toHaveLength(3);
    // At 1% CVR with moderate CPC 0.14: revenue = 100*0.01*10 = 10, cost = 14 → loss
    expect(r.scenarios[0].verdict).toBe("loss");
    // At 4% CVR: revenue = 40, cost = 14 → profit
    expect(r.scenarios[2].verdict).toBe("profit");
  });
});
