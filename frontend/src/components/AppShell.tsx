"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "./Session";
import { IconChart, IconDoc, IconHome, IconLogout, IconPlus, IconQueue, IconSettings, IconUser } from "./Icons";
import { roleLabel, isStaff } from "@/lib/format";
import type { Role } from "@/lib/api";

type NavItem = { href: string; label: string; short: string; icon: React.ReactNode; roles: Role[] | "all" };

const NAV: NavItem[] = [
  { href: "/claims", label: "เรื่องของฉัน", short: "หน้าหลัก", icon: <IconHome />, roles: "all" },
  { href: "/claims/new", label: "ยื่นเรื่องใหม่", short: "ยื่นเรื่อง", icon: <IconPlus />, roles: ["employee"] },
  { href: "/queue", label: "คิวงาน", short: "คิวงาน", icon: <IconQueue />, roles: ["reviewer", "approver", "finance", "admin"] },
  { href: "/dashboard", label: "รายงาน", short: "รายงาน", icon: <IconChart />, roles: ["reviewer", "approver", "finance", "admin"] },
  { href: "/admin", label: "ตั้งค่าสิทธิ์ & ผู้ใช้", short: "ตั้งค่า", icon: <IconSettings />, roles: ["admin"] },
];

function isActive(pathname: string, href: string) {
  if (href === "/claims") return pathname === "/claims" || /^\/claims\/\d+/.test(pathname);
  return pathname === href || pathname.startsWith(href + "/");
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, logout } = useSession();
  const pathname = usePathname();
  const items = NAV.filter((n) => n.roles === "all" || n.roles.includes(user.role));
  // เจ้าหน้าที่ให้ "คิวงาน" มาก่อน
  if (isStaff(user.role)) items.sort((a, b) => (a.href === "/queue" ? -1 : b.href === "/queue" ? 1 : 0));

  const initial = (user.name || user.email).slice(0, 1).toUpperCase();

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="logo" aria-hidden>ค</div>
          <div className="stack" style={{ gap: 0 }}>
            <strong>เบิกค่ารักษา</strong>
            <span className="small" style={{ color: "var(--nav-muted)" }}>Ticket Management</span>
          </div>
        </div>
        <nav aria-label="เมนูหลัก">
          {items.map((n) => (
            <Link key={n.href} href={n.href} aria-current={isActive(pathname, n.href) ? "page" : undefined}>
              {n.icon}
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="me">
          <div className="avatar">{user.picture ? <img src={user.picture} alt="" referrerPolicy="no-referrer" /> : initial}</div>
          <div className="stack small" style={{ gap: 0, minWidth: 0, flex: 1 }}>
            <strong style={{ color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{user.name || user.email}</strong>
            <span style={{ color: "var(--nav-muted)" }}>{roleLabel[user.role]}</span>
          </div>
          <button type="button" onClick={logout} aria-label="ออกจากระบบ" title="ออกจากระบบ">
            <IconLogout />
          </button>
        </div>
      </aside>

      <main className="main">{children}</main>

      <nav className="bottomnav" aria-label="เมนูหลัก">
        {items.slice(0, 3).map((n) => (
          <Link key={n.href} href={n.href} aria-current={isActive(pathname, n.href) ? "page" : undefined}>
            {n.icon}
            {n.short}
          </Link>
        ))}
        <Link href="/profile" aria-current={pathname === "/profile" ? "page" : undefined}>
          <IconUser />
          โปรไฟล์
        </Link>
      </nav>
    </div>
  );
}
