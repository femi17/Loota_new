import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, DM_Sans } from "next/font/google";
import "./globals.css";

const bricolage = Bricolage_Grotesque({
  variable: "--font-bricolage",
  subsets: ["latin"],
  weight: ["600", "800"],
});

const dmSans = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Loota",
  description: "Crack riddles that point to real places, travel there on real roads by foot, bike, bus, train or plane, and race rivals for the keys. Real prizes; play from anywhere.",
};

export const viewport: Viewport = {
  themeColor: "#0f1420",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${bricolage.variable} ${dmSans.variable} h-full antialiased`}>
      {/* Browser extensions such as Grammarly add attributes to <body>; don't treat that as an error. */}
      <body className="min-h-full flex flex-col font-sans" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
