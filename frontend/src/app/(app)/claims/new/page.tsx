"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, errorText, type Ticket } from "@/lib/api";
import { ocrPatch, uploadDoc } from "@/lib/upload";
import { IconBack, IconCamera } from "@/components/Icons";

// ขั้นแรกของการยื่นเรื่อง: ถ่าย/เลือกใบเสร็จ → สร้างร่าง → ให้ AI อ่าน → ไปหน้าตรวจทาน
export default function NewClaim() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string>("");
  const [error, setError] = useState("");

  async function start(file?: File) {
    if (busy) return;
    setError("");
    try {
      setBusy("กำลังสร้างเรื่อง…");
      const t = await api<Ticket>("/api/tickets", { method: "POST", json: {} });
      if (file) {
        setBusy("กำลังอัปโหลดและอ่านใบเสร็จ…");
        const res = await uploadDoc(t.id, "receipt", file);
        if (res.ocr) {
          const patch = ocrPatch(t, res.ocr);
          if (Object.keys(patch).length) {
            await api(`/api/tickets/${t.id}`, { method: "PATCH", json: patch });
          }
        }
      }
      router.replace(`/claims/${t.id}/edit`);
    } catch (e) {
      setError(errorText(e));
      setBusy("");
    }
  }

  return (
    <>
      <div className="topbar">
        <Link href="/claims" className="iconbtn" aria-label="กลับ"><IconBack /></Link>
        <div className="title">
          <h1>ยื่นเรื่องใหม่</h1>
          <span className="muted small">ขั้น 1 จาก 3 — แนบใบเสร็จ</span>
        </div>
      </div>

      <div className="card stack" style={{ alignItems: "center", textAlign: "center", padding: "36px 20px", gap: 16 }}>
        <div style={{ width: 72, height: 72, borderRadius: 20, background: "var(--brand-soft)", color: "var(--brand)", display: "grid", placeItems: "center" }}>
          <IconCamera size={36} />
        </div>
        <h2>ถ่ายรูปหรือเลือกไฟล์ใบเสร็จ</h2>
        <p className="muted" style={{ margin: 0, maxWidth: 420 }}>
          รองรับ JPG, PNG, WEBP และ PDF ระบบจะอ่านชื่อสถานพยาบาล วันที่ และยอดเงินมากรอกให้ แล้วคุณตรวจทานก่อนส่ง
        </p>
        <input
          ref={fileRef}
          type="file"
          accept="image/*,application/pdf"
          capture="environment"
          className="sr-only"
          id="receipt-file"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) start(f);
          }}
        />
        <label htmlFor="receipt-file" className="btn primary big" style={{ maxWidth: 360 }} aria-disabled={!!busy}>
          <IconCamera size={22} />
          {busy || "ถ่ายรูป / เลือกไฟล์ใบเสร็จ"}
        </label>
        <button type="button" className="btn" onClick={() => start()} disabled={!!busy}>
          กรอกข้อมูลเองก่อน แล้วค่อยแนบไฟล์
        </button>
        {error && <div className="alert danger" role="alert">{error}</div>}
      </div>
    </>
  );
}
