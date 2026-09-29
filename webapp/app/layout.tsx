import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Sportlaadpalen — laadpunten en sportlocaties in Nederland",
  description:
    "Dashboard met alle publieke laadpunten in Nederland en de vraag: hoeveel sportlocaties hebben nog geen laadpunt? Bekijk het op de kaart.",
  openGraph: {
    title: "Sportlaadpalen",
    description:
      "Alle laadpunten in Nederland + sportlocaties zonder laadpunt op een interactieve kaart.",
    type: "website",
    locale: "nl_NL",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="nl">
      <body className="antialiased">{children}</body>
    </html>
  );
}