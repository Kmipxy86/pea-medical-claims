"use client";

import { useEffect, useState } from "react";
import { api, errorText, type Status } from "@/lib/api";
import { money, statusLabel, statusTone } from "@/lib/format";

type Stats = {
  byStatus: Partial<Record<Status, number>>;
  overdue: number;
  dueSoon: number;
  flagged: number;
  avgCycleHours: number | null;
  paidThisMonth: number;
  months: { month: string; requested: number; paid: number }[];
};

const monthFmt = new Intl.DateTimeFormat("th-TH", { month: "short" });

// Dashboard: แสดงเฉพาะตัวเลขรวม ไม่มีข้อมูลการรักษารายบุคคล (PDPA)
export default function Dashboard() {
  const [s, setS] = useState<Stats | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api<Stats>("/api/stats").then(setS).catch((e) => setError(errorText(e)));
  }, []);

  if (!s) return error ? <div className="alert danger">{error}</div> : <div className="center-msg">กำลังโหลด…</div>;
  const max = Math.max(1, ...s.months.flatMap((m) => [m.requested, m.paid]));
  const order: Status[] = ["pending_review", "in_review", "need_info", "pending_approval", "approved", "paid", "rejected"];

  return (
    <>
      <div className="topbar">
        <div className="title">
          <h1>รายงานภาพรวม</h1>
          <span className="muted small">ตัวเลขรวมเท่านั้น — ไม่แสดงข้อมูลการรักษารายบุคคล</span>
        </div>
      </div>

      <div className="kpis">
        <div className="kpi"><span className="small muted">เวลาเฉลี่ย ยื่น → ได้รับเงิน</span><span className="v">{s.avgCycleHours != null ? `${(s.avgCycleHours / 24).toFixed(1)} วัน` : "–"}</span></div>
        <div className="kpi"><span className="small muted">จ่ายแล้วเดือนนี้ (บาท)</span><span className="v" style={{ fontSize: 22 }}>{money(s.paidThisMonth)}</span></div>
        <div className="kpi danger"><span className="small muted">เกิน SLA</span><span className="v">{s.overdue}</span></div>
        <div className="kpi warn"><span className="small">ใกล้เกิน SLA</span><span className="v">{s.dueSoon}</span></div>
      </div>

      <div className="grid-2" style={{ alignItems: "start" }}>
        <section className="card stack">
          <h2 style={{ margin: 0 }}>ยอดขอเบิก vs ยอดจ่าย 6 เดือนล่าสุด</h2>
          <div className="legend">
            <span style={{ ["--c" as string]: "#c9a0be" }}>ขอเบิก</span>
            <span style={{ ["--c" as string]: "var(--brand)" }}>จ่ายแล้ว</span>
          </div>
          <div className="chart" role="img" aria-label="กราฟแท่งยอดขอเบิกและยอดจ่ายรายเดือน">
            {s.months.map((m) => (
              <div key={m.month} className="col">
                <div className="bars">
                  <span className="b1" style={{ height: `${(m.requested / max) * 100}%` }} title={`ขอเบิก ${money(m.requested)}`} />
                  <span className="b2" style={{ height: `${(m.paid / max) * 100}%` }} title={`จ่าย ${money(m.paid)}`} />
                </div>
                <span className="small muted">{monthFmt.format(new Date(m.month + "-01T00:00:00"))}</span>
              </div>
            ))}
          </div>
          <div className="table-wrap">
            <table className="plain">
              <thead><tr><th>เดือน</th><th style={{ textAlign: "right" }}>ขอเบิก</th><th style={{ textAlign: "right" }}>จ่ายแล้ว</th></tr></thead>
              <tbody>
                {s.months.map((m) => (
                  <tr key={m.month}><td>{m.month}</td><td className="num">{money(m.requested)}</td><td className="num">{money(m.paid)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card stack">
          <h2 style={{ margin: 0 }}>จำนวนเรื่องตามสถานะ</h2>
          {order.map((st) => (
            <div key={st} className="row">
              <span className={`chip ${statusTone[st]}`}>{statusLabel[st]}</span>
              <span className="spacer mono">{s.byStatus[st] ?? 0}</span>
            </div>
          ))}
          <div className="row" style={{ borderTop: "1px solid var(--line)", paddingTop: 10 }}>
            <span>AI ติดธงอันตราย (เรื่องที่ยังไม่ปิด)</span>
            <span className="spacer mono" style={{ color: "var(--danger)" }}>{s.flagged}</span>
          </div>
        </section>
      </div>
    </>
  );
}
