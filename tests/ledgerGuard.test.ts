import { describe, it, expect } from "vitest";
import { reconcileRows } from "../services/reconciliationService";
import { ledgerGuard } from "../services/ledgerGuard";

describe("Nedbank VAT rows are INFO and inert", () => {
    it("forces VAT amount to 0 when explicit columns exist", () => {
        const opening = "363.14";
        const rows = [
            { Date: "25/12/2025", Description: "MTN R5 Airtime", Debits: "5.00", Credits: "", Fees: "", Balance: "358.14" },
            { Date: "27/12/2025", Description: "VAT 26/11-26/12 = R35.70", Debits: "", Credits: "0.00", Fees: "", Balance: "358.14" },
            { Date: "27/12/2025", Description: "SERVICE FEE", Debits: "", Credits: "", Fees: "15.60*", Balance: "342.54" },
        ];

        const rec = reconcileRows(rows, opening);
        expect(rec[1].Amount).toBe(0);
        expect(rec[1]._math_reconciled).toBe(true);

        const health = ledgerGuard(rec, opening);
        expect(health.status).toBe("OK");
    });
});
