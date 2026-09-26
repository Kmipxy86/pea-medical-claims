"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api, errorText, type DocType, type TicketDetail, type Relation, type TreatmentType } from "@/lib/api";
import { docLabel, money, relationLabel } from "@/lib/format";
import { ocrPatch, uploadDoc } from "@/lib/upload";
import { IconBack, IconInfo, IconPlus } from "@/components/Icons";

type Form = {
  relation: Relation;
  patientName: string;
  treatmentType: TreatmentType;
  hospital: string;
  receiptNo: string;
  treatmentDate: string;
  amountRequested: string;
};

// ตรวจทานข้อมูล + แนบเอกสาร + ส่งเรื่อง (ใช้ได้ทั้งตอนเป็นร่าง และตอนถูกขอข้อมูลเพิ่ม)
export default function EditClaim() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [d, setD] = useState<TicketDetail | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [addType, setAddType] = useState<DocType>("receipt");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const detail = await api<TicketDetail>(`/api/tickets/${id}`);
    setD(detail);
    const t = detail.ticket;
    setForm({
      relation: t.relation,
      patientName: t.patientName,
      treatmentType: t.treatmentType,
      hospital: t.hospital,
      receiptNo: t.receiptNo,
      treatmentDate: t.treatmentDate ?? "",
      amountRequested: t.amountRequested ? String(t.amountRequested) : "",
    });
    const missing = detail.analysis.missingDocs;
    setAddType(missing[0] ?? "other");
    return detail;
  }, [id]);

  useEffect(() => {
    load().catch((e) => setError(errorText(e)));
  }, [load]);

  // ผลอ่านใบเสร็จล่าสุด ใช้แสดงป้าย "AI กรอก" ข้างช่อง
  const ocr = useMemo(() => [...(d?.attachments ?? [])].reverse().find((a) => a.docType === "receipt" && a.ocr)?.ocr ?? null, [d]);

  const locked = d != null && d.ticket.status !== "draft" && d.ticket.status !== "need_info";
  useEffect(() => {
    if (locked) router.replace(`/claims/${id}`);
  }, [locked, router, id]);

  if (!d || !form || locked) {
    return error ? <div className="alert danger">{error}</div> : <div className="center-msg">กำลังโหลด…</div>;
  }
  const t = d.ticket;

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm({ ...form, [k]: v });

  function payload() {
    return {
      relation: form!.relation,
      patientName: form!.patientName,
      treatmentType: form!.treatmentType,
      hospital: form!.hospital.trim(),
      receiptNo: form!.receiptNo.trim(),
      treatmentDate: form!.treatmentDate,
      amountRequested: Number(form!.amountRequested.replace(/,/g, "")) || 0,
    };
  }

  async function save(quiet = false) {
    setError("");
    setBusy("กำลังบันทึก…");
    try {
      await api(`/api/tickets/${t.id}`, { method: "PATCH", json: payload() });
      await load();
      if (!quiet) setBusy("บันทึกร่างแล้ว");
      setTimeout(() => setBusy(""), 1500);
    } catch (e) {
      setError(errorText(e));
      setBusy("");
      throw e;
    }
  }

  async function onFile(file: File) {
    setError("");
    setBusy(addType === "receipt" ? "กำลังอัปโหลดและอ่านใบเสร็จ…" : "กำลังอัปโหลด…");
    try {
      await api(`/api/tickets/${t.id}`, { method: "PATCH", json: payload() });
      const res = await uploadDoc(t.id, addType, file);
      const fresh = await load();
      if (res.ocr) {
        const patch = ocrPatch(fresh.ticket, res.ocr);
        if (Object.keys(patch).length) {
          await api(`/api/tickets/${t.id}`, { method: "PATCH", json: patch });
          await load();
        }
      }
      setBusy("");
    } catch (e) {
      setError(errorText(e));
      setBusy("");
    }
  }

  async function remove(attId: number) {
    setError("");
    try {
      await api(`/api/attachments/${attId}`, { method: "DELETE" });
      await load();
    } catch (e) {
      setError(errorText(e));
    }
  }

  async function submit() {
    try {
      await save(true);
      setBusy("กำลังส่งเรื่อง…");
      await api(`/api/tickets/${t.id}/transition`, { method: "POST", json: { action: "submit" } });
      router.replace(`/claims/${t.id}`);
    } catch (e) {
      setError(errorText(e));
      setBusy("");
    }
  }

  const aiHint = (field: keyof NonNullable<typeof ocr>, value: string) => {
    if (!ocr || ocr[field] == null) return null;
    const same = String(ocr[field]) === value || Number(ocr[field]) === Number(value.replace(/,/g, ""));
    const conf = ocr.confidence?.[field as string];
    if (!same) return <span className="hint" style={{ color: "var(--warn)" }}>AI อ่านได้: {String(ocr[field])}</span>;
    return <span className="hint">AI กรอก{conf != null ? ` · มั่นใจ ${Math.round(conf * 100)}%` : ""}</span>;
  };
  const aiClass = (field: keyof NonNullable<typeof ocr>, value: string) =>
    ocr && ocr[field] != null && String(ocr[field]) === value ? "input ai" : "input";

  const missing = d.analysis.missingDocs;
  const lastRequest = t.status === "need_info" ? [...d.comments].reverse().find((c) => !c.mine) : undefined;

  return (
    <>
      <div className="topbar">
        <Link href={t.status === "draft" ? "/claims" : `/claims/${t.id}`} className="iconbtn" aria-label="กลับ"><IconBack /></Link>
        <div className="title">
          <h1>{t.status === "draft" ? "ตรวจทานและส่งเรื่อง" : "แก้ไขตามที่เจ้าหน้าที่ขอ"}</h1>
          <span className="muted small mono">{t.code}</span>
        </div>
      </div>

      {lastRequest && (
        <div className="alert warn" role="status">
          <IconInfo />
          <span><strong>เจ้าหน้าที่ขอ:</strong> {lastRequest.body}</span>
        </div>
      )}

      <section className="card stack" aria-label="เอกสารแนบ">
        <h2>เอกสารแนบ</h2>
        <div className="files">
          {d.attachments.map((a) => (
            <div key={a.id} className="file">
              <a
                className="thumb"
                href={`/api/attachments/${a.id}`}
                target="_blank"
                rel="noreferrer"
                style={a.contentType.startsWith("image/") ? { backgroundImage: `url(/api/attachments/${a.id})` } : undefined}
                aria-label={`เปิด ${a.filename}`}
              >
                {a.contentType === "application/pdf" ? "PDF" : ""}
              </a>
              <strong>{docLabel[a.docType]}</strong>
              <span className="muted" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.filename}</span>
              <button type="button" className="x" aria-label={`ลบ ${a.filename}`} onClick={() => remove(a.id)}>×</button>
            </div>
          ))}
          <div className="stack" style={{ gap: 6 }}>
            <label htmlFor="add-type" className="sr-only">ประเภทเอกสารที่จะแนบ</label>
            <select id="add-type" className="select" style={{ minHeight: 40, fontSize: 14, width: 180 }} value={addType} onChange={(e) => setAddType(e.target.value as DocType)}>
              {(Object.keys(docLabel) as DocType[]).map((k) => (
                <option key={k} value={k}>{docLabel[k]}{missing.includes(k) ? " (ต้องแนบ)" : ""}</option>
              ))}
            </select>
            <input
              id="add-file"
              type="file"
              accept="image/*,application/pdf"
              className="sr-only"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) onFile(f);
              }}
            />
            <label htmlFor="add-file" className="drop" style={{ width: 180, minHeight: 72 }}>
              <IconPlus size={20} />
              เพิ่มไฟล์
            </label>
          </div>
        </div>
        {missing.length > 0 ? (
          <div className="alert warn">
            <IconInfo />
            <span>
              ต้องแนบเพิ่มก่อนส่ง: <strong>{missing.map((m) => docLabel[m]).join(", ")}</strong>
            </span>
          </div>
        ) : (
          <div className="alert ok">เอกสารครบตามสิทธิ์แล้ว</div>
        )}
      </section>

      <section className="card stack" aria-label="ข้อมูลการเบิก">
        <h2>ข้อมูลการเบิก</h2>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="relation">ผู้ป่วยเป็น</label>
            <select id="relation" className="select" value={form.relation} onChange={(e) => set("relation", e.target.value as Relation)}>
              {(Object.keys(relationLabel) as Relation[]).map((r) => (
                <option key={r} value={r}>{relationLabel[r]}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="patient">ชื่อผู้ป่วย</label>
            <input id="patient" className="input" value={form.patientName} onChange={(e) => set("patientName", e.target.value)} />
          </div>
          <div className="field full">
            <label htmlFor="hosp">สถานพยาบาล {aiHint("hospital", form.hospital)}</label>
            <input id="hosp" className={aiClass("hospital", form.hospital)} value={form.hospital} onChange={(e) => set("hospital", e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="date">วันที่รักษา {aiHint("treatmentDate", form.treatmentDate)}</label>
            <input id="date" type="date" className={aiClass("treatmentDate", form.treatmentDate)} value={form.treatmentDate} onChange={(e) => set("treatmentDate", e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="type">ประเภท {aiHint("treatmentType", form.treatmentType)}</label>
            <select id="type" className={`select${ocr?.treatmentType === form.treatmentType ? " ai" : ""}`} value={form.treatmentType} onChange={(e) => set("treatmentType", e.target.value as TreatmentType)}>
              <option value="OPD">ผู้ป่วยนอก (OPD)</option>
              <option value="IPD">ผู้ป่วยใน (IPD)</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="receipt">เลขที่ใบเสร็จ {aiHint("receiptNo", form.receiptNo)}</label>
            <input id="receipt" className={aiClass("receiptNo", form.receiptNo)} value={form.receiptNo} onChange={(e) => set("receiptNo", e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="amt">ยอดตามใบเสร็จ (บาท) {aiHint("totalAmount", form.amountRequested)}</label>
            <input
              id="amt"
              inputMode="decimal"
              className={`${ocr?.totalAmount != null && Number(form.amountRequested) === ocr.totalAmount ? "input ai" : "input"} mono`}
              style={{ fontSize: 18 }}
              value={form.amountRequested}
              onChange={(e) => set("amountRequested", e.target.value.replace(/[^\d.,]/g, ""))}
            />
          </div>
        </div>
        {d.analysis.entitlement && (
          <div className="card tight" style={{ background: "var(--surface-2)" }}>
            <span className="small muted">คาดว่าเบิกได้ตามสิทธิ์ (คำนวณจากข้อมูลที่บันทึกล่าสุด)</span>
            <div className="row" style={{ alignItems: "baseline" }}>
              <strong style={{ fontSize: 20, color: "var(--ok)" }}>{money(d.analysis.entitlement.estimate)} ฿</strong>
              <span className="spacer small muted">วงเงินคงเหลือ {money(d.analysis.entitlement.remaining)} ฿</span>
            </div>
          </div>
        )}
      </section>

      {error && <div className="alert danger" role="alert">{error}</div>}

      <div className="actionbar sticky">
        <button type="button" className="btn" onClick={() => save().catch(() => {})} disabled={!!busy}>
          {busy === "บันทึกร่างแล้ว" ? "บันทึกแล้ว ✓" : "บันทึกร่าง"}
        </button>
        <button type="button" className="btn primary" onClick={submit} disabled={!!busy || missing.length > 0}>
          {busy && busy !== "บันทึกร่างแล้ว" ? busy : missing.length > 0 ? `แนบ${docLabel[missing[0]]}ก่อนส่ง` : t.status === "need_info" ? "ส่งกลับให้เจ้าหน้าที่" : "ส่งเรื่อง"}
        </button>
      </div>
      <div className="actionbar-spacer" aria-hidden />
    </>
  );
}
