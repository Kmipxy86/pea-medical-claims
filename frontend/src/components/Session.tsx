"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { api, ApiError, type User } from "@/lib/api";

type SessionValue = { user: User; logout: () => Promise<void> };
const SessionContext = createContext<SessionValue | null>(null);

export function useSession(): SessionValue {
  const v = useContext(SessionContext);
  if (!v) throw new Error("useSession ต้องใช้ภายใน SessionProvider");
  return v;
}

// ตรวจว่าเข้าระบบอยู่หรือไม่ ถ้าไม่ พาไปหน้า /login พร้อมจำหน้าที่จะกลับมา
export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    api<User>("/api/me")
      .then(setUser)
      .catch((e) => {
        if (e instanceof ApiError && e.status === 401) {
          router.replace(`/login?next=${encodeURIComponent(pathname)}`);
        }
      });
  }, [router, pathname]);

  const logout = useCallback(async () => {
    await api("/api/auth/logout", { method: "POST" }).catch(() => {});
    window.google?.accounts.id.disableAutoSelect();
    router.replace("/login");
  }, [router]);

  if (!user) return <div className="center-msg">กำลังโหลด…</div>;
  return <SessionContext.Provider value={{ user, logout }}>{children}</SessionContext.Provider>;
}

// ชนิดของ Google Identity Services (โหลดจาก accounts.google.com/gsi/client)
declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (o: {
            client_id: string;
            callback: (r: { credential: string }) => void;
            hd?: string;
            ux_mode?: "popup" | "redirect";
          }) => void;
          renderButton: (el: HTMLElement, o: Record<string, unknown>) => void;
          disableAutoSelect: () => void;
        };
      };
    };
  }
}
