"use client";

import Script from "next/script";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api, errorText, type AuthConfig, type Role } from "@/lib/api";
import { roleLabel } from "@/lib/format";

function safeNext(next: string | null) {
  // กัน open redirect: รับเฉพาะ path ภายในเว็บ
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

function LoginInner() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const [cfg, setCfg] = useState<AuthConfig | null>(null);
  const [gisReady, setGisReady] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const btnRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api<AuthConfig>("/api/auth/config").then(setCfg).catch((e) => setError(errorText(e)));
    // ถ้าเข้าระบบอยู่แล้ว ข้ามหน้านี้
    api("/api/me").then(() => router.replace(next)).catch(() => {});
  }, [router, next]);

  const onCredential = useCallback(
    async (r: { credential: string }) => {
      setBusy(true);
      setError("");
      try {
        await api("/api/auth/google", { method: "POST", json: { credential: r.credential } });
        router.replace(next);
      } catch (e) {
        setError(errorText(e));
        setBusy(false);
      }
    },
    [router, next],
  );

  useEffect(() => {
    if (!gisReady || !cfg?.googleClientId || !btnRef.current || !window.google) return;
    window.google.accounts.id.initialize({
      client_id: cfg.googleClientId,
      callback: onCredential,
      hd: cfg.allowedDomain || undefined,
      ux_mode: "popup",
    });
    window.google.accounts.id.renderButton(btnRef.current, {
      theme: "outline",
      size: "large",
      shape: "pill",
      text: "signin_with",
      locale: "th",
      width: Math.min(340, btnRef.current.clientWidth || 340),
    });
  }, [gisReady, cfg, onCredential]);

  return (
    <div className="login">
      {cfg?.googleClientId && (
        <Script src="https://accounts.google.com/gsi/client" strategy="afterInteractive" onReady={() => setGisReady(true)} />
      )}
      <div className="card">
        <div className="row" style={{ gap: 12 }}>
          <div className="avatar" style={{ background: "#c9a0be", borderRadius: 12 }} aria-hidden>ค</div>
          <div className="stack" style={{ gap: 0 }}>
            <h1 style={{ fontSize: 22 }}>ระบบเบิกค่ารักษาพยาบาล</h1>
            <span className="muted small">ยื่นเรื่อง ติดตามสถานะ และตรวจอนุมัติ</span>
          </div>
        </div>

        {cfg?.googleClientId ? (
          <div className="stack">
            <span className="muted small">
              เข้าสู่ระบบด้วยบัญชี Google{cfg.allowedDomain ? ` ขององค์กร (@${cfg.allowedDomain})` : ""}
            </span>
            <div ref={btnRef} style={{ minHeight: 44 }} aria-busy={busy} />
          </div>
        ) : cfg && !cfg.devLogin ? (
          <div className="alert warn">ผู้ดูแลระบบยังไม่ได้ตั้งค่า Google Sign-in (GOOGLE_CLIENT_ID)</div>
        ) : null}

        {error && <div className="alert danger" role="alert">{error}</div>}

        {cfg?.devLogin && <DevLogin next={next} />}

        <p className="small muted" style={{ margin: 0 }}>
          ข้อมูลการรักษาเป็นข้อมูลส่วนบุคคลที่อ่อนไหวตาม PDPA ระบบจะบันทึกทุกการเปิดดูเอกสาร
        </p>
      </div>
    </div>
  );
}

// เข้าระบบแบบทดสอบ (เปิดด้วย DEV_LOGIN=true ที่ backend เท่านั้น)
function DevLogin({ next }: { next: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("employee@example.com");
  const [role, setRole] = useState<Role>("employee");
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api("/api/auth/dev", { method: "POST", json: { email, role, name: "" } });
      router.replace(next);
    } catch (err) {
      setError(errorText(err));
    }
  }

  return (
    <form onSubmit={submit} className="stack" style={{ borderTop: "1px dashed var(--line-strong)", paddingTop: 16 }}>
      <span className="chip warn" style={{ alignSelf: "flex-start" }}>โหมดทดสอบ — ปิดก่อนใช้งานจริง</span>
      <div className="field">
        <label htmlFor="dev-email">อีเมล</label>
        <input id="dev-email" className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </div>
      <div className="field">
        <label htmlFor="dev-role">บทบาท</label>
        <select id="dev-role" className="select" value={role} onChange={(e) => {
          const r = e.target.value as Role;
          setRole(r);
          setEmail(`${r}@example.com`);
        }}>
          {(Object.keys(roleLabel) as Role[]).map((r) => (
            <option key={r} value={r}>{roleLabel[r]}</option>
          ))}
        </select>
      </div>
      {error && <div className="alert danger" role="alert">{error}</div>}
      <button className="btn primary" type="submit">เข้าระบบแบบทดสอบ</button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="center-msg">กำลังโหลด…</div>}>
      <LoginInner />
    </Suspense>
  );
}
