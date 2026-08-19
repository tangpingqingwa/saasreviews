import { randomUUID } from "node:crypto";
import type { SaasReviewsDb } from "../db.js";
import type { UsageData, UsageDay } from "../types.js";

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

type UsageRow = {
  day: string;
  credits: number;
  requests: number;
};

export function parseUsageDay(value: string | undefined): string | null {
  if (value === undefined || value === "") {
    return null;
  }
  const match = DAY.exec(value);
  if (match === null) {
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return `${match[1]}-${match[2]}-${match[3]}`;
}

export function utcDay(iso = new Date().toISOString()): string {
  return iso.slice(0, 10);
}

export function defaultUsageWindow(now = new Date()): { from: string; to: string } {
  const to = utcDay(now.toISOString());
  const start = new Date(now);
  start.setUTCDate(start.getUTCDate() - 29);
  return { from: utcDay(start.toISOString()), to };
}

export function recordUsageEvent(
  db: SaasReviewsDb,
  input: {
    keyId: string;
    route: string;
    credits: number;
    cached: boolean;
    errorCode?: string;
    createdAt?: string;
  },
): void {
  db.prepare(
    `INSERT INTO usage_events (id, key_id, route, credits, cached, error_code, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    `evt_${randomUUID()}`,
    input.keyId,
    input.route,
    input.credits,
    input.cached ? 1 : 0,
    input.errorCode ?? null,
    input.createdAt ?? new Date().toISOString(),
  );
}

export function listUsageDays(
  db: SaasReviewsDb,
  keyId: string,
  from: string,
  to: string,
): UsageData {
  const rows = db
    .prepare<[string, string, string], UsageRow>(
      `SELECT substr(created_at, 1, 10) AS day,
              COALESCE(SUM(credits), 0) AS credits,
              COUNT(*) AS requests
         FROM usage_events
        WHERE key_id = ?
          AND substr(created_at, 1, 10) >= ?
          AND substr(created_at, 1, 10) <= ?
        GROUP BY day
        ORDER BY day ASC`,
    )
    .all(keyId, from, to);

  const byDay = new Map<string, UsageDay>();
  for (const row of rows) {
    byDay.set(row.day, {
      date: row.day,
      credits: row.credits,
      requests: row.requests,
    });
  }

  const days: UsageDay[] = [];
  for (const date of eachUtcDay(from, to)) {
    days.push(byDay.get(date) ?? { date, credits: 0, requests: 0 });
  }
  return { from, to, days };
}

function eachUtcDay(from: string, to: string): string[] {
  const start = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(`${to}T00:00:00.000Z`);
  const out: string[] = [];
  for (let cursor = start; cursor.getTime() <= end.getTime(); ) {
    out.push(utcDay(cursor.toISOString()));
    cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
  }
  return out;
}
