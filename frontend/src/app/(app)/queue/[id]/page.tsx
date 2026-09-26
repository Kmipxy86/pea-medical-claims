"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api, errorText, type ActionInfo, type TicketDetail } from "@/lib/api";
import { docLabel, money, relationLabel, slaText, statusLabel, thDate, thDateTime } from "@/lib/format";
import { StatusChip } from "@/components/TicketList";
import { Messages } from "@/components/Messages";
import { IconAlert, IconBack } from "@/components/Icons";

// หน้าตรวจเรื่องของเจ้าหน้าที่: เอกสารด้านซ้าย ข้อมูล + ผลตรวจของ AI + ปุ่มดำเนินการด้านขวา
export default function Review() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [d, setD] = useState<TicketDetail | null>(null);
  const [doc, setDoc] = useState<number | null>(null);
  const [pending, setPending] = useState<ActionInfo | null>(null);
  const [note, setNote] = useState("");
  const [amount, setAmount] = useState("");
  const [tab, setTab] = useState<"msg" | "history">("msg");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const res = await api<TicketDetail>(`/api/tickets/${id}`);
    setD(res);
    setDoc((cur) => cur ?? res.attachments[0]?.id ?? null);
    const est = res.analysis.entitlement?.estimate ?? res.ticket.amountRequested;
    setAmount(String(Math.min(est, res.ticket.amountRequested)));
  }, [id]);

  useEffect(() => {
    load().catch((e) => setError(errorText(e)));
  }, [load]);

  if (!d) return error ? <div className="alert danger">{error}</div> : <div className="center-msg">กำลังโหลด…</div>;
  const t = d.ticket;
  const a = d.analysis;
  const current = d.attachments.find((x) => x.id === doc);
  const receiptOcr = [...d.attachments].reverse().find((x) => x.docType === "receipt" && x.ocr)?.ocr ?? null;
  const sla = slaText(t.slaDue);
  const danger = a.flags.filter((f) => f.level === "danger");
  const warn = a.flags.filter((f) => f.level === "warn");

  async function run(ac: ActionInfo) {
    if ((ac.needNote || ac.needAmount) && pending?.name !== ac.name) {
      setPending(ac);
      setNote("");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api(`/api/tickets/${t.id}/transition`, {
        method: "POST",
        json: { action: ac.name, note, amount: ac.needAmount ? Number(amount) : undefined },
      });
      setPending(null);
      if (ac.name === "claim") await load();
      else router.push("/queue");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  const tone = (name: string) =>
    name === "forward" || name === "approve" || name === "pay" || name === "claim" ? "btn primary" : name === "request_info" || name === "return" ? "btn warn" : "btn danger";

  const Row = ({ label, mine, ocr, bad }: { label: string; mine: string; ocr?: string | null; bad?: boolean }) => (
    <>
      <span className="muted">{label}</span>
      <span className={bad ? "bad" : ""}>{mine || "—"}</span>
      <span>{receiptOcr ? (ocr ?? "อ่านไม่ได้") : "—"}</span>
    </>
  );

  return (
    <>
      <div className="topbar">
        <Link href="/queue" className="iconbtn" aria-label="กลับไปคิวงาน"><IconBack /></Link>
        <div className="title">
          <h1 className="mono" style={{ fontSize: 22 }}>{t.code}</h1>
          <span className="small muted">
            {t.requesterName} · {t.requesterEmail}
          </span>
        </div>
        <div className="row spacer" style={{ flexWrap: "wrap" }}>
          <StatusChip status={t.status} />
          {t.slaDue && <span className={`small ${sla.urgent ? "sla-urgent" : "muted"}`}>SLA {sla.text}</span>}
        </div>
      </div>

      <div className="review">
        <section className="viewer" aria-label="เอกสารแนบ">
          <div className="tabs" role="group" aria-label="เลือกเอกสาร">
            {d.attachments.map((x) => (
              <button key={x.id} type="button" aria-pressed={x.id === doc} onClick={() => setDoc(x.id)}>
                {docLabel[x.docType]}
              </button>
            ))}
          </div>
          <div className="doc">
            {!current && <div className="empty">ไม่มีเอกสารแนบ</div>}
            {current?.contentType.startsWith("image/") && (
              <a href={`/api/attachments/${current.id}`} target="_blank" rel="noreferrer" title="เปิดขนาดเต็ม">
                <img src={`/api/attachments/${current.id}`} alt={`${docLabel[current.docType]} ${current.filename}`} />
              </a>
            )}
            {current?.contentType === "application/pdf" && (
              <iframe src={`/api/attachments/${current.id}`} title={current.filename} />
            )}
          </div>
        </section>

        <div className="stack">
          {danger.length > 0 && (
            <div className="alert danger" role="status">
              <IconAlert />
              <div className="stack" style={{ gap: 2 }}>
                <strong>AI พบ {danger.length} จุดที่ควรตรวจละเอียด</strong>
                {danger.map((f) => <span key={f.code}>{f.message}</span>)}
              </div>
            </div>
          )}
          {warn.length > 0 && (
            <div className="alert warn">
              <IconAlert />
              <div className="stack" style={{ gap: 2 }}>{warn.map((f) => <span key={f.code}>{f.message}</span>)}</div>
            </div>
          )}

          <section className="card">
            <h2>ข้อมูลที่ยื่น เทียบกับผลอ่านใบเสร็จ</h2>
            <div className="cmp">
              <span className="h">ช่อง</span><span className="h">ผู้ยื่นกรอก</span><span className="h">AI อ่านได้</span>
              <Row label="สถานพยาบาล" mine={t.hospital} ocr={receiptOcr?.hospital} />
              <Row label="เลขที่ใบเสร็จ" mine={t.receiptNo} ocr={receiptOcr?.receiptNo} />
              <Row label="วันที่รักษา" mine={thDate(t.treatmentDate)} ocr={receiptOcr?.treatmentDate ? thDate(receiptOcr.treatmentDate) : null} />
              <Row label="ประเภท" mine={t.treatmentType} ocr={receiptOcr?.treatmentType} />
              <Row label="ยอดรวม" mine={money(t.amountRequested)} ocr={receiptOcr?.totalAmount != null ? money(receiptOcr.totalAmount) : null}
                bad={a.flags.some((f) => f.code === "amount_mismatch")} />
              <span className="muted">ผู้ป่วย</span><span>{t.patientName} ({relationLabel[t.relation]})</span><span>{receiptOcr?.patientName ?? "—"}</span>
            </div>
            {!receiptOcr && <p className="small muted" style={{ marginBottom: 0 }}>ยังไม่มีผลอ่านใบเสร็จอัตโนมัติ (ปิดใช้งานหรืออ่านไม่สำเร็จ)</p>}
          </section>

          <div className="grid-2">
            <section className="card stack" style={{ gap: 8 }}>
              <h2 style={{ margin: 0 }}>สิทธิ์และวงเงิน</h2>
              {a.entitlement ? (
                <>
                  <span className="small muted">ผู้ป่วย: {relationLabel[t.relation]} · สิทธิ์ {t.treatmentType}</span>
                  <div className="bar"><span style={{ width: `${Math.min(100, (a.entitlement.used / Math.max(1, a.entitlement.annualLimit)) * 100)}%` }} /></div>
                  <span className="small">ใช้ไป {money(a.entitlement.used)} จาก {money(a.entitlement.annualLimit)} บาท</span>
                  <strong style={{ color: "var(--ok)" }}>คาดว่าเบิกได้: {money(a.entitlement.estimate)} ฿</strong>
                </>
              ) : (
                <span className="muted small">ไม่พบกฎสิทธิ์สำหรับกรณีนี้</span>
              )}
            </section>
            <section className="card stack" style={{ gap: 8 }}>
              <h2 style={{ margin: 0 }}>เช็กลิสต์เอกสาร</h2>
              <ul className="checklist">
                {a.requiredDocs.map((r) => (
                  <li key={r}>
                    {a.missingDocs.includes(r) ? <span className="no">!</span> : <span className="yes">✓</span>}
                    {docLabel[r]}
                  </li>
                ))}
                <li>
                  {a.flags.some((f) => f.code.startsWith("duplicate")) ? <span className="no">!</span> : <span className="yes">✓</span>}
                  {a.flags.some((f) => f.code.startsWith("duplicate")) ? "พบใบเสร็จ/ไฟล์ที่อาจซ้ำ" : "ไม่พบใบเสร็จซ้ำในระบบ"}
                </li>
              </ul>
            </section>
          </div>

          {pending && (
            <section className="card stack" aria-label={pending.label}>
              <h2 style={{ margin: 0 }}>{pending.label}</h2>
              {pending.needAmount && (
                <div className="field">
                  <label htmlFor="amount">ยอดอนุมัติ (บาท) <span className="hint">ขอเบิก {money(t.amountRequested)}</span></label>
                  <input id="amount" className="input mono" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} />
                </div>
              )}
              <div className="field">
                <label htmlFor="note">
                  {pending.name === "request_info" ? "ข้อความถึงผู้ยื่น: ขออะไรเพิ่ม" : pending.name === "reject" ? "เหตุผลที่ไม่อนุมัติ (ผู้ยื่นจะเห็น)" : "หมายเหตุ"}
                  {!pending.needNote && <span className="hint">ไม่บังคับ</span>}
                </label>
                <textarea id="note" className="textarea" value={note} onChange={(e) => setNote(e.target.value)} />
              </div>
              <div className="actionbar">
                <button type="button" className="btn" onClick={() => setPending(null)}>ยกเลิก</button>
                <button type="button" className={tone(pending.name)} disabled={busy || (pending.needNote && !note.trim())} onClick={() => run(pending)}>
                  ยืนยัน{pending.label}
                </button>
              </div>
            </section>
          )}

          {d.actions.length > 0 && !pending && (
            <div className="actionbar sticky">
              {d.actions.map((ac) => (
                <button key={ac.name} type="button" className={tone(ac.name)} disabled={busy} onClick={() => run(ac)}>
                  {ac.label}
                </button>
              ))}
            </div>
          )}
          {d.actions.length === 0 && t.status !== "paid" && t.status !== "rejected" && (
            <div className="alert info">
              {t.status === "in_review" && t.assigneeName
                ? `เรื่องนี้ ${t.assigneeName} รับไว้ตรวจ`
                : `สถานะ "${statusLabel[t.status]}" — ไม่มีขั้นตอนที่คุณดำเนินการได้`}
            </div>
          )}
          {error && <div className="alert danger" role="alert">{error}</div>}

          <section className="card stack">
            <div className="tabs-line" role="group" aria-label="แสดง">
              <button type="button" aria-pressed={tab === "msg"} onClick={() => setTab("msg")}>ข้อความ ({d.comments.length})</button>
              <button type="button" aria-pressed={tab === "history"} onClick={() => setTab("history")}>ประวัติสถานะ</button>
            </div>
            {tab === "msg" ? (
              <Messages ticketId={t.id} comments={d.comments} staff onSent={() => load()} />
            ) : (
              <ul className="checklist">
                {d.history.map((h, i) => (
                  <li key={i} style={{ flexDirection: "column", gap: 0 }}>
                    <span>
                      <strong>{statusLabel[h.toStatus]}</strong> · {h.actorName ?? "ระบบ"}
                    </span>
                    <span className="small muted">{thDateTime(h.createdAt)}{h.note ? ` — ${h.note}` : ""}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <div className="actionbar-spacer" aria-hidden />
        </div>
      </div>
    </>
  );
}
