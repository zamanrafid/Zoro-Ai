import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ZORO AI — One Prompt. Consistent Characters. Cinematic Videos.",
  description: "Type one prompt, approve consistent characters, generate connected scenes, export cinematic video."
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-ink text-paper antialiased">
        <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(60%_50%_at_50%_0%,rgba(59,130,246,.18),transparent),radial-gradient(50%_40%_at_80%_10%,rgba(139,92,246,.14),transparent)]" />
        <div className="relative">{children}</div>
      </body>
    </html>
  );
}
