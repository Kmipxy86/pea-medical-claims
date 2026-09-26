"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/components/Session";
import { isStaff } from "@/lib/format";

// หน้าแรก: พนักงานไป "เรื่องของฉัน" เจ้าหน้าที่ไป "คิวงาน"
export default function Home() {
  const { user } = useSession();
  const router = useRouter();
  useEffect(() => {
    router.replace(isStaff(user.role) ? "/queue" : "/claims");
  }, [user, router]);
  return null;
}
