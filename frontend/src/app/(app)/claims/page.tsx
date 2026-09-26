"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, errorText, type Ticket } from "@/lib/api";
import { money, relationLabel, thDate } from "@/lib/format";
import { useSession } from "@/components/Session";
import { StatusChip } from "@/components/TicketList";
import { IconCamera } from "@/components/Icons";

type Ent = {
  relation: Ticket["relation"];
  treatmentType: Ticket["treatmentType"];
  annualLimit: number;
  used: number;
  remaining: number;
};

const STEPS: Ticket["status"][] = ["pending_review", "in_review", "pending_approval", "approved", "paid"];

export default function MyClaims() {
  const { user } = useSession();
  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const [ents, setEnts] = useState<Ent[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    api<Ticket[]>("/api/tickets").then(setTickets).catch((e) => setError(errorText(e)));
    api<Ent[]>("/api/me/entitlements").then(setEnts).catch(() => {});
  }, []);

  const mine = ents.filter((e) => e.relation === "self");
  const attention = tickets?.filter((t) => t.status === "need_info") ?? [];
  const others = tickets?.filter((t) => t.status !== "need_info") ?? [];

  return (
    <>
      <div className="topbar">
        <div className="title">
          <span className="muted small">สวัสดี</span>
          <h1>{user.name || user.email}</h1>
        </div>
      </div>

      <div className="grid-2">
        <section className="hero" aria-label="วงเงินคงเหลือ">
          <span className="muted small">วงเงินคงเหลือปีนี้ (ตนเอง)</span>
          {mine.length === 0 && <span className="muted small">กำลังโหลด…</span>}
          {mine.map((e) => (
            <div key={e.treatmentType} className="stack" style={{ gap: 6 }}>
              <div className="row">
                <span>{e.treatmentType === "OPD" ? "ผู้ป่วยนอก (OPD)" : "ผู้ป่วยใน (IPD)"}</span>
                <span className="spacer mono" style={{ fontSize: 20 }}>{money(e.remaining)} ฿</span>
              </div>
              <div className="bar" aria-hidden>
                <span style={{ width: `${Math.min(100, (e.used / Math.max(1, e.annualLimit)) * 100)}%` }} />
              </div>
              <span className="muted small">ใช้ไป {money(e.used)} จาก {money(e.annualLimit)} บาท</span>
            </div>
          ))}
        </section>

        <div className="stack" style={{ justifyContent: "center" }}>
            <Link href="/claims/new" className="btn primary big">
              <IconCamera size={22} />
              ถ่ายใบเสร็จ ยื่นเรื่องใหม่
            </Link>
            <span className="muted small" style={{ textAlign: "center" }}>
              ระบบจะอ่านใบเสร็จและบอกเอกสารที่ต้องแนบให้อัตโนมัติ
            </span>
        </div>
      </div>

      {error && <div className="alert danger" role="alert">{error}</div>}

      <div className="row">
        <h2>เรื่องของฉัน</h2>
        {tickets && <span className="spacer muted small">{tickets.length} เรื่อง</span>}
      </div>

      {tickets === null && <div className="muted">กำลังโหลด…</div>}
      {tickets?.length === 0 && (
        <div className="card muted" style={{ textAlign: "center" }}>ยังไม่มีเรื่องที่ยื่น</div>
      )}

      <div className="stack" style={{ gap: 10 }}>
        {[...attention, ...others].map((t) => (
          <Link
            key={t.id}
            href={t.status === "draft" ? `/claims/${t.id}/edit` : `/claims/${t.id}`}
            className="card tight stack"
            style={{
              gap: 6,
              textDecoration: "none",
              color: "var(--ink)",
              border: t.status === "need_info" ? "2px solid #c98a3a" : undefined,
            }}
          >
            <div className="row">
              <span className="mono small muted">{t.code}</span>
              <span className="spacer"><StatusChip status={t.status} /></span>
            </div>
            <div className="row" style={{ alignItems: "baseline" }}>
              <strong style={{ fontSize: 16 }}>
                {t.treatmentType} · {t.hospital || "ยังไม่ระบุสถานพยาบาล"}
              </strong>
              <span className="spacer mono">{money(t.amountRequested)}</span>
            </div>
            <span className="small muted">
              ผู้ป่วย: {relationLabel[t.relation]} · วันที่รักษา {thDate(t.treatmentDate)}
            </span>
            {t.status === "need_info" && (
              <span className="small" style={{ color: "var(--warn)" }}>เจ้าหน้าที่ขอข้อมูลเพิ่ม — แตะเพื่อดูและแนบเอกสาร</span>
            )}
            {t.status === "draft" && <span className="small muted">ยังไม่ได้ส่ง — แตะเพื่อทำต่อ</span>}
            {STEPS.includes(t.status) && t.status !== "paid" && (
              <div className="row" style={{ gap: 4 }} aria-hidden>
                {STEPS.map((s, i) => (
                  <span
                    key={s}
                    style={{
                      flex: 1,
                      height: 6,
                      borderRadius: 999,
                      background: i <= STEPS.indexOf(t.status) ? "var(--brand)" : "var(--line)",
                    }}
                  />
                ))}
              </div>
            )}
          </Link>
        ))}
      </div>
    </>
  );
}
