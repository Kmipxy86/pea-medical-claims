"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api, errorText, type TicketDetail } from "@/lib/api";
import { docLabel, money, relationLabel, thDate } from "@/lib/format";
import { useSession } from "@/components/Session";
import { StatusChip } from "@/components/TicketList";
import { Timeline } from "@/components/Timeline";
import { Messages } from "@/components/Messages";
import { IconBack, IconCalendar, IconInfo } from "@/components/Icons";

// หน้าติดตามสถานะของผู้ยื่นเรื่อง
export default function TrackClaim() {
  const { id } = useParams<{ id: string }>();
  const { user } = useSession();
  const [d, setD] = useState<TicketDetail | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    api<TicketDetail>(`/api/tickets/${id}`).then(setD).catch((e) => setError(errorText(e)));
  }, [id]);
  useEffect(load, [load]);

  if (!d) return error ? <div className="alert danger">{error}</div> : <div className="center-msg">กำลังโหลด…</div>;
  const t = d.ticket;
  const mine = t.requesterId === user.id;

  return (
    <>
      <div className="topbar">
        <Link href="/claims" className="iconbtn" aria-label="กลับ"><IconBack /></Link>
        <div className="title">
          <h1 className="mono" style={{ fontSize: 20 }}>{t.code}</h1>
          <span className="muted small">ยื่นเมื่อ {thDate(t.submittedAt ?? t.createdAt)}</span>
        </div>
        <span className="spacer"><StatusChip status={t.status} /></span>
      </div>

      {t.status === "need_info" && mine && (
        <div className="alert warn">
          <IconInfo />
          <div className="stack" style={{ gap: 8, flex: 1 }}>
            <span>เจ้าหน้าที่ขอข้อมูลหรือเอกสารเพิ่ม ดูรายละเอียดในข้อความด้านล่าง</span>
            <Link href={`/claims/${t.id}/edit`} className="btn warn" style={{ alignSelf: "flex-start" }}>แนบเอกสาร / แก้ไขข้อมูล</Link>
          </div>
        </div>
      )}

      <div className="grid-2" style={{ alignItems: "start" }}>
        <div className="stack">
          <section className="card stack" style={{ gap: 6 }}>
            <span className="small muted">
              {t.treatmentType} · {t.hospital || "—"} · ผู้ป่วย: {relationLabel[t.relation]}
            </span>
            <span className="mono" style={{ fontSize: 26 }}>{money(t.amountRequested)} ฿</span>
            {t.amountApproved != null && (
              <span className="small" style={{ color: "var(--ok)", fontWeight: 600 }}>อนุมัติ {money(t.amountApproved)} ฿</span>
            )}
            {d.analysis.eta && (
              <div className="row small" style={{ marginTop: 6, padding: "10px 12px", borderRadius: 12, background: "var(--brand-soft)", color: "var(--brand-ink)" }}>
                <IconCalendar size={18} />
                <span>คาดว่าได้รับเงินประมาณ <strong>{thDate(d.analysis.eta)}</strong></span>
              </div>
            )}
          </section>

          <section className="card" aria-label="สถานะ">
            <h2>สถานะ</h2>
            <Timeline status={t.status} history={d.history} />
          </section>
        </div>

        <div className="stack">
          <section className="card" aria-label="ข้อความ">
            <h2>ข้อความกับเจ้าหน้าที่</h2>
            <Messages ticketId={t.id} comments={d.comments} staff={false} onSent={load} />
          </section>

          <section className="card" aria-label="เอกสารแนบ">
            <h2>เอกสารแนบ</h2>
            <ul className="checklist">
              {d.attachments.map((a) => (
                <li key={a.id}>
                  <span className="yes">✓</span>
                  <a href={`/api/attachments/${a.id}`} target="_blank" rel="noreferrer">{docLabel[a.docType]} — {a.filename}</a>
                </li>
              ))}
              {d.analysis.missingDocs.map((m) => (
                <li key={m}><span className="no">!</span> ยังไม่ได้แนบ {docLabel[m]}</li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </>
  );
}
