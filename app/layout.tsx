import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Nemesis — Cardano Derivatives",
  description: "Perpetual markets, options, and private pre-trade intent on Cardano."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
