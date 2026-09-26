"use client";

import { useCallback, useEffect, useState } from "react";
import { api, errorText, type DocType, type Relation, type Role, type TreatmentType, type User } from "@/lib/api";
import { docLabel, relationLabel, roleLabel, thDateTime } from "@/lib/format";
import { useSession } from "@/components/Session";

type Rule = {
  id: number;
  relation: Relation;
  treatmentType: TreatmentType;
  annualLimit: number;
  reimbursePct: number;
  requiredDocs: DocType[];
};

type Audit = {
  id: number;
  actorName: string | null;
  action: string;
  ticketCode: string | null;
  detail: string;
  ip: string;
  createdAt: string;
};

const RULE_DOCS: DocType[] = ["receipt", "medical_certificate", "expense_summary", "relationship_proof"];

export default function Admin() {
  const [tab, setTab] = useState<"users" | "rules" | "audit">("users");
  return (
    <>
      <div className="topbar">
        <div className="title">
          <h1>ตั้งค่าระบบ</h1>
          <span className="muted small">จัดการสิทธิ์ผู้ใช้ กฎวงเงิน และดูบันทึกการใช้งาน</span>
        </div>
      </div>
      <div className="tabs-line" role="group" aria-label="หมวด">
        <button type="button" aria-pressed={tab === "users"} onClick={() => setTab("users")}>ผู้ใช้และบทบาท</button>
        <button type="button" aria-pressed={tab === "rules"} onClick={() => setTab("rules")}>กฎสิทธิ์ &amp; วงเงิน</button>
        <button type="button" aria-pressed={tab === "audit"} onClick={() => setTab("audit")}>Audit log</button>
      </div>
      {tab === "users" && <Users />}
      {tab === "rules" && <Rules />}
      {tab === "audit" && <AuditLog />}
    </>
  );
}

function Users() {
  const { user: me } = useSession();
  const [users, setUsers] = useState<User[]>([]);
  const [error, setError] = useState("");
  const load = useCallback(() => {
    api<User[]>("/api/admin/users").then(setUsers).catch((e) => setError(errorText(e)));
  }, []);
  useEffect(load, [load]);

  async function update(id: number, patch: Partial<Pick<User, "role" | "active" | "employeeCode">>) {
    setError("");
    try {
      await api(`/api/admin/users/${id}`, { method: "PATCH", json: patch });
      load();
    } catch (e) {
      setError(errorText(e));
    }
  }

  return (
    <section className="card stack">
      <p className="small muted" style={{ margin: 0 }}>
        ผู้ใช้จะถูกสร้างอัตโนมัติเมื่อเข้าระบบด้วย Google ครั้งแรก (บทบาทเริ่มต้น: พนักงาน) แล้วผู้ดูแลกำหนดบทบาทที่นี่
      </p>
      {error && <div className="alert danger" role="alert">{error}</div>}
      <div className="table-wrap">
        <table className="plain">
          <thead>
            <tr><th>ชื่อ / อีเมล</th><th>รหัสพนักงาน</th><th>บทบาท</th><th>สถานะ</th><th>เข้าระบบล่าสุด</th></tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>
                  <strong>{u.name || "—"}</strong>
                  <div className="small muted">{u.email}</div>
                </td>
                <td>
                  <label className="sr-only" htmlFor={`code-${u.id}`}>รหัสพนักงานของ {u.email}</label>
                  <input
                    id={`code-${u.id}`}
                    className="input"
                    style={{ minHeight: 40, width: 120, fontSize: 14 }}
                    defaultValue={u.employeeCode}
                    onBlur={(e) => e.target.value !== u.employeeCode && update(u.id, { employeeCode: e.target.value })}
                  />
                </td>
                <td>
                  <label className="sr-only" htmlFor={`role-${u.id}`}>บทบาทของ {u.email}</label>
                  <select
                    id={`role-${u.id}`}
                    className="select"
                    style={{ minHeight: 40, fontSize: 14, width: 190 }}
                    value={u.role}
                    disabled={u.id === me.id}
                    onChange={(e) => update(u.id, { role: e.target.value as Role })}
                  >
                    {(Object.keys(roleLabel) as Role[]).map((r) => <option key={r} value={r}>{roleLabel[r]}</option>)}
                  </select>
                </td>
                <td>
                  <button type="button" className="btn" style={{ minHeight: 40 }} disabled={u.id === me.id} onClick={() => update(u.id, { active: !u.active })}>
                    {u.active ? "ใช้งานอยู่ · ระงับ" : "ระงับอยู่ · เปิดใช้"}
                  </button>
                </td>
                <td className="small muted">{u.lastLoginAt ? thDateTime(u.lastLoginAt) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Rules() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [saved, setSaved] = useState<number | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api<Rule[]>("/api/admin/rules").then(setRules).catch((e) => setError(errorText(e)));
  }, []);

  const patch = (id: number, p: Partial<Rule>) => setRules((rs) => rs.map((r) => (r.id === id ? { ...r, ...p } : r)));

  async function save(r: Rule) {
    setError("");
    try {
      await api(`/api/admin/rules/${r.id}`, {
        method: "PUT",
        json: { annualLimit: Number(r.annualLimit), reimbursePct: Number(r.reimbursePct), requiredDocs: r.requiredDocs },
      });
      setSaved(r.id);
      setTimeout(() => setSaved(null), 1500);
    } catch (e) {
      setError(errorText(e));
    }
  }

  return (
    <section className="card stack">
      <div className="alert warn">ค่าตั้งต้นเป็นตัวอย่าง โปรดปรับให้ตรงกับระเบียบสวัสดิการจริงก่อนเปิดใช้งาน</div>
      {error && <div className="alert danger" role="alert">{error}</div>}
      <div className="table-wrap">
        <table className="plain">
          <thead>
            <tr><th>ผู้ป่วย</th><th>ประเภท</th><th>วงเงินต่อปี (บาท)</th><th>เบิกได้ (%)</th><th>เอกสารที่ต้องแนบ</th><th></th></tr>
          </thead>
          <tbody>
            {rules.map((r) => (
              <tr key={r.id}>
                <td>{relationLabel[r.relation]}</td>
                <td>{r.treatmentType}</td>
                <td>
                  <input aria-label={`วงเงิน ${relationLabel[r.relation]} ${r.treatmentType}`} className="input mono" style={{ minHeight: 40, width: 130, fontSize: 14 }}
                    inputMode="decimal" value={r.annualLimit} onChange={(e) => patch(r.id, { annualLimit: Number(e.target.value.replace(/[^\d.]/g, "")) })} />
                </td>
                <td>
                  <input aria-label={`เปอร์เซ็นต์ ${relationLabel[r.relation]} ${r.treatmentType}`} className="input mono" style={{ minHeight: 40, width: 80, fontSize: 14 }}
                    inputMode="decimal" value={r.reimbursePct} onChange={(e) => patch(r.id, { reimbursePct: Number(e.target.value.replace(/[^\d.]/g, "")) })} />
                </td>
                <td>
                  <div className="stack" style={{ gap: 2 }}>
                    {RULE_DOCS.map((d) => (
                      <label key={d} className="row small" style={{ gap: 6, minHeight: 28 }}>
                        <input type="checkbox" checked={r.requiredDocs.includes(d)}
                          onChange={(e) => patch(r.id, { requiredDocs: e.target.checked ? [...r.requiredDocs, d] : r.requiredDocs.filter((x) => x !== d) })} />
                        {docLabel[d]}
                      </label>
                    ))}
                  </div>
                </td>
                <td><button type="button" className="btn primary" style={{ minHeight: 40 }} onClick={() => save(r)}>{saved === r.id ? "บันทึกแล้ว ✓" : "บันทึก"}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function AuditLog() {
  const [rows, setRows] = useState<Audit[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    api<Audit[]>("/api/admin/audit").then(setRows).catch((e) => setError(errorText(e)));
  }, []);
  return (
    <section className="card stack">
      <p className="small muted" style={{ margin: 0 }}>บันทึกการเข้าระบบ การเปิดดู/แก้ไขเรื่อง และไฟล์แนบ 300 รายการล่าสุด</p>
      {error && <div className="alert danger" role="alert">{error}</div>}
      <div className="table-wrap">
        <table className="plain">
          <thead><tr><th>เวลา</th><th>ผู้ใช้</th><th>การกระทำ</th><th>Ticket</th><th>รายละเอียด</th><th>IP</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="small" style={{ whiteSpace: "nowrap" }}>{thDateTime(r.createdAt)}</td>
                <td>{r.actorName ?? "—"}</td>
                <td className="mono small">{r.action}</td>
                <td className="mono small">{r.ticketCode ?? "—"}</td>
                <td className="small">{r.detail}</td>
                <td className="mono small">{r.ip}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
