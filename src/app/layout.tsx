import type { Metadata } from "next";
import { Cormorant_Garamond, Manrope } from "next/font/google";
import { commonSaltLakeSearchIntents, saltLakePhotographerKeywords, siteUrl } from "@/lib/seo";
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
  metadataBase: new URL(siteUrl),
  title: {
    default: "Xan's Eye Photography | Salt Lake City Photographer",
    template: "%s | Xan's Eye Photography",
  },
  description:
    "Salt Lake City photographer for weddings, engagements, elopements, newborns, content creation, social media, and movie set photography.",
  keywords: [...saltLakePhotographerKeywords, ...commonSaltLakeSearchIntents],
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    url: siteUrl,
    title: "Xan's Eye Photography | Salt Lake City Photographer",
    description:
      "Salt Lake City wedding, engagement, elopement, newborn, social media, and commercial photography by Xan's Eye Photography.",
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
    title: "Xan's Eye Photography | Salt Lake City Photographer",
    description:
      "Salt Lake City photographer for weddings, newborn, content, social media, and movie set photography.",
    images: ["/xanseye-link-thumbnail.png"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
};

const localBusinessJsonLd = {
  "@context": "https://schema.org",
  "@type": "ProfessionalService",
  "@id": `${siteUrl}#xanseye-photography`,
  name: "Xan's Eye Photography",
  url: siteUrl,
  image: `${siteUrl}/xanseye-link-thumbnail.png`,
  areaServed: [
    {
      "@type": "City",
      name: "Salt Lake City",
      sameAs: "https://en.wikipedia.org/wiki/Salt_Lake_City",
    },
    {
      "@type": "State",
      name: "Utah",
      sameAs: "https://en.wikipedia.org/wiki/Utah",
    },
  ],
  address: {
    "@type": "PostalAddress",
    addressLocality: "Salt Lake City",
    addressRegion: "UT",
    addressCountry: "US",
  },
  sameAs: ["https://instagram.com/xanseye", "https://instagram.com/restoringphotography"],
  knowsAbout: [
    "Salt Lake City content photographer",
    "Salt Lake City social media photographer",
    "movie set photographer",
    "Salt Lake City newborn photographer",
    "Salt Lake City wedding photographer",
    "engagement Salt Lake City photographer",
    "elopement Salt Lake City photographer",
    "family photography",
    "commercial photography",
    "branding photography",
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${displayFont.variable} ${bodyFont.variable}`}>
      <body>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(localBusinessJsonLd) }}
        />
        {children}
      </body>
    </html>
  );
}
