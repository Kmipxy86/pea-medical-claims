/** @type {import('next').NextConfig} */
const apiUrl = process.env.API_URL || "http://localhost:8080";

const nextConfig = {
  output: "standalone",
  poweredByHeader: false,
  // ให้เบราว์เซอร์เรียก /api ที่โดเมนเดียวกับหน้าเว็บ แล้ว Next.js ส่งต่อไป Go backend
  // (cookie ของการเข้าระบบจึงเป็น first-party และไม่ต้องเปิด CORS)
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${apiUrl}/api/:path*` }];
  },
};

export default nextConfig;
