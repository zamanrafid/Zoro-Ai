export function ZoroLogo({ size = 40 }: { size?: number }) {
  return (
    <span className="inline-flex items-center gap-3">
      <svg width={size} height={size} viewBox="0 0 64 64" role="img" aria-label="ZORO AI logo">
        <defs>
          <linearGradient id="zg" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#3B82F6" />
            <stop offset="1" stopColor="#8B5CF6" />
          </linearGradient>
        </defs>
        <rect x="2" y="2" width="60" height="60" rx="14" fill="#111827" stroke="url(#zg)" strokeWidth="2.5" />
        <path d="M18 20 H46 L28 32 H44" fill="none" stroke="url(#zg)" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M20 44 H44" stroke="url(#zg)" strokeWidth="6" strokeLinecap="round" />
        <circle cx="46" cy="42" r="3.4" fill="#8B5CF6" />
      </svg>
      <span className="leading-tight">
        <span className="block text-lg font-extrabold tracking-wide">
          ZORO <span className="grad-text">AI</span>
        </span>
        <span className="block text-[11px] text-muted">One Prompt. Consistent Characters. Cinematic Videos.</span>
      </span>
    </span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const color =
    status === "succeeded"
      ? "border-emerald-500/40 text-emerald-300"
      : status === "failed"
        ? "border-red-500/40 text-red-300"
        : status === "processing"
          ? "border-blue-500/40 text-blue-300"
          : status === "cancelled"
            ? "border-slate-500/40 text-slate-300"
            : "border-amber-500/40 text-amber-300";
  return <span className={`badge ${color}`}>{status}</span>;
}

export function Empty({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-700 p-8 text-center">
      <p className="font-semibold text-slate-200">{title}</p>
      <p className="mt-1 text-sm text-muted">{hint}</p>
    </div>
  );
}
