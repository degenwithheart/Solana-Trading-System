import crypto from "node:crypto";
import type { Db } from "../db";

export type RiskLedger = {
  id: string;
  date: string;
  realizedPnlSol: number;
  circuitBreakerTrips: number;
};

export class RiskLedgerRepo {
  constructor(private readonly db: Db) {}

  getOrCreate(date: string): RiskLedger {
    const row = this.db.prepare("SELECT * FROM risk_ledger WHERE date = ?").get(date) as any;
    if (row) {
      return {
        id: row.id,
        date: row.date,
        realizedPnlSol: Number(row.realized_pnl_sol),
        circuitBreakerTrips: Number(row.circuit_breaker_trips)
      };
    }
    const id = crypto.randomUUID();
    this.db
      .prepare("INSERT INTO risk_ledger(id, date, realized_pnl_sol, circuit_breaker_trips) VALUES(?, ?, 0, 0)")
      .run(id, date);
    return { id, date, realizedPnlSol: 0, circuitBreakerTrips: 0 };
  }

  addRealizedPnl(date: string, delta: number): void {
    this.getOrCreate(date);
    this.db.prepare("UPDATE risk_ledger SET realized_pnl_sol = realized_pnl_sol + ? WHERE date = ?").run(delta, date);
  }

  tripCircuitBreaker(date: string): void {
    this.getOrCreate(date);
    this.db
      .prepare("UPDATE risk_ledger SET circuit_breaker_trips = circuit_breaker_trips + 1 WHERE date = ?")
      .run(date);
  }

  read(date: string): RiskLedger {
    return this.getOrCreate(date);
  }
}

