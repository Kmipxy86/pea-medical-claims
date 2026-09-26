"use client";

import Link from "next/link";
import { useSession } from "@/components/Session";
import { roleLabel, isStaff } from "@/lib/format";
import { IconLogout } from "@/components/Icons";

// หน้าโปรไฟล์ (ใช้บนมือถือ เพราะเมนูด้านข้างที่มีปุ่มออกจากระบบแสดงเฉพาะบน PC)
export default function Profile() {
  const { user, logout } = useSession();
  return (
    <>
      <div className="topbar"><h1>โปรไฟล์</h1></div>
      <section className="card stack">
        <div className="row" style={{ gap: 14 }}>
          <div className="avatar" style={{ width: 56, height: 56, fontSize: 22 }}>
            {user.picture ? <img src={user.picture} alt="" referrerPolicy="no-referrer" /> : (user.name || user.email).slice(0, 1)}
          </div>
          <div className="stack" style={{ gap: 0 }}>
            <strong style={{ fontSize: 18 }}>{user.name || "—"}</strong>
            <span className="muted small">{user.email}</span>
          </div>
        </div>
        <div className="row"><span className="muted">บทบาท</span><span className="spacer">{roleLabel[user.role]}</span></div>
        <div className="row"><span className="muted">รหัสพนักงาน</span><span className="spacer">{user.employeeCode || "—"}</span></div>
      </section>
      {isStaff(user.role) && (
        <div className="stack">
          <Link className="btn" href="/claims">เรื่องเบิกของฉันเอง</Link>
          <Link className="btn" href="/dashboard">รายงานภาพรวม</Link>
          {user.role === "admin" && <Link className="btn" href="/admin">ตั้งค่าระบบ</Link>}
        </div>
      )}
      <button type="button" className="btn danger" onClick={logout}>
        <IconLogout /> ออกจากระบบ
      </button>
    </>
  );
}
