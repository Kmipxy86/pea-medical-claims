// ไอคอนเส้น (stroke) ชุดเล็ก ๆ ใช้ currentColor เพื่อให้สีตามข้อความ
type P = { size?: number };
const base = (size = 20) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
});

export const IconHome = ({ size }: P) => (
  <svg {...base(size)}><path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" /></svg>
);
export const IconQueue = ({ size }: P) => (
  <svg {...base(size)}><path d="M4 6h16M4 12h16M4 18h10" /></svg>
);
export const IconDoc = ({ size }: P) => (
  <svg {...base(size)}><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 8h8M8 12h8M8 16h5" /></svg>
);
export const IconChart = ({ size }: P) => (
  <svg {...base(size)}><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></svg>
);
export const IconSettings = ({ size }: P) => (
  <svg {...base(size)}><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" /></svg>
);
export const IconPlus = ({ size }: P) => (
  <svg {...base(size)}><circle cx="12" cy="12" r="9" /><path d="M12 8v8M8 12h8" /></svg>
);
export const IconCamera = ({ size }: P) => (
  <svg {...base(size)}><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></svg>
);
export const IconBack = ({ size }: P) => (
  <svg {...base(size)} strokeWidth={2}><path d="M15 18l-6-6 6-6" /></svg>
);
export const IconAlert = ({ size }: P) => (
  <svg {...base(size)} strokeWidth={2}><path d="M12 3l10 18H2z" /><path d="M12 10v4M12 18h.01" /></svg>
);
export const IconInfo = ({ size }: P) => (
  <svg {...base(size)} strokeWidth={2}><circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16h.01" /></svg>
);
export const IconSend = ({ size }: P) => (
  <svg {...base(size)} strokeWidth={2}><path d="M4 12l16-8-6 16-2-7z" /></svg>
);
export const IconCalendar = ({ size }: P) => (
  <svg {...base(size)}><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></svg>
);
export const IconLogout = ({ size }: P) => (
  <svg {...base(size)}><path d="M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 17l-5-5 5-5M5 12h11" /></svg>
);
export const IconSearch = ({ size }: P) => (
  <svg {...base(size)} strokeWidth={2}><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
);
export const IconUser = ({ size }: P) => (
  <svg {...base(size)}><circle cx="12" cy="8" r="4" /><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" /></svg>
);
