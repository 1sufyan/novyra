import type { Metadata } from "next";
import { connection } from "next/server";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "NOVYRA Admin",
  robots: { index: false, follow: false },
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Every admin page renders per request, so each response carries its own CSP nonce.
  await connection();
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
