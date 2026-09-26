"use client";

import { useState } from "react";
import { api, errorText, type Comment } from "@/lib/api";
import { thDateTime, roleLabel } from "@/lib/format";
import { IconSend } from "./Icons";

export function Messages({
  ticketId,
  comments,
  staff,
  onSent,
}: {
  ticketId: number;
  comments: Comment[];
  staff: boolean;
  onSent: () => void;
}) {
  const [body, setBody] = useState("");
  const [internal, setInternal] = useState(staff);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    setBusy(true);
    setError("");
    try {
      await api(`/api/tickets/${ticketId}/comments`, { method: "POST", json: { body, internal: staff && internal } });
      setBody("");
      onSent();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      {staff && (
        <div className="tabs-line" role="group" aria-label="ประเภทข้อความ">
          <button type="button" aria-pressed={internal} onClick={() => setInternal(true)}>ความเห็นภายใน</button>
          <button type="button" aria-pressed={!internal} onClick={() => setInternal(false)}>ข้อความถึงผู้ยื่น</button>
        </div>
      )}
      <div className="msgs">
        {comments.length === 0 && <span className="muted small">ยังไม่มีข้อความ</span>}
        {comments.map((c) => (
          <div key={c.id} className={`msg${c.mine ? " mine" : ""}${c.internal ? " internal" : ""}`}>
            {c.body}
            <span className="by">
              {c.internal ? "ภายใน · " : ""}
              {c.authorName} ({roleLabel[c.authorRole]}) · {thDateTime(c.createdAt)}
            </span>
          </div>
        ))}
      </div>
      <form onSubmit={send} className="row" style={{ alignItems: "flex-end" }}>
        <label htmlFor={`msg-${ticketId}`} className="sr-only">พิมพ์ข้อความ</label>
        <textarea
          id={`msg-${ticketId}`}
          className="textarea"
          rows={2}
          style={{ minHeight: 48 }}
          placeholder={staff ? (internal ? "บันทึกสำหรับเจ้าหน้าที่/ผู้อนุมัติ (ผู้ยื่นไม่เห็น)…" : "ข้อความถึงผู้ยื่น…") : "ถามเจ้าหน้าที่…"}
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
        <button type="submit" className="btn primary" aria-label="ส่งข้อความ" disabled={busy || !body.trim()} style={{ width: 48, padding: 0 }}>
          <IconSend />
        </button>
      </form>
      {error && <div className="alert danger" role="alert">{error}</div>}
    </div>
  );
}
