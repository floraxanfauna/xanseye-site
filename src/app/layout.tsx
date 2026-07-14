import type { Metadata } from "next";
import { Cormorant_Garamond, Manrope } from "next/font/google";
import "./globals.css";

const displayFont = Cormorant_Garamond({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const bodyFont = Manrope({
  variable: "--font-body",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://xanseye.com"),
  title: "Xan's Eye Photography",
  description: "Wedding, family, newborn, and branding photography in Austin, Georgetown, and beyond.",
  openGraph: {
    type: "website",
    url: "https://xanseye.com",
    title: "Xan's Eye Photography",
    description: "Wedding, family, newborn, and branding photography in Austin, Georgetown, and beyond.",
    siteName: "Xan's Eye Photography",
    images: [
      {
        url: "/xanseye-link-thumbnail.png",
        width: 1535,
        height: 1024,
        alt: "Xan's Eye Photography",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Xan's Eye Photography",
    description: "Wedding, family, newborn, and branding photography in Austin, Georgetown, and beyond.",
    images: ["/xanseye-link-thumbnail.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${displayFont.variable} ${bodyFont.variable}`}>
      <body>{children}</body>
    </html>
  );
}
