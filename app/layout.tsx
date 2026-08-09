import type { Metadata } from "next";
import { Caveat, DM_Sans } from "next/font/google";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { serializeJsonLd } from "@/lib/json-ld";
import SmoothScroll from "./components/SmoothScroll";
import "./globals.css";
import "lenis/dist/lenis.css";

const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-dm-sans",
  display: "swap",
});

const caveat = Caveat({
  subsets: ["latin"],
  variable: "--font-caveat",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Outlio | Proven Sales Systems For Tech Startups and SaaS",
  description:
    "We do research first sales outreach for Tech startups, SaaS startups, and agencies || All human written",
  icons: {
    icon: '/icon.png',
    shortcut: '/icon.png',
    apple: '/icon.png',
  },
  keywords: [
    "outbound sales",
    "lead generation",
    "appointment setting",
    "SaaS explainer videos",
    "motion graphics",
    "sales funnel",
    "tech startup sales",
    "B2B lead generation",
    "cold email campaigns",
    "LinkedIn outreach",
    "sales systems",
    "growth accelerator",
    "outbound sales agency",
    "research-first outreach"
  ],
  authors: [{ name: "Husnain Rafiq", url: "https://www.linkedin.com/in/husnain-rafiq-343179290/" }],
  creator: "Outlio",
  publisher: "Outlio",
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: 'https://outlio.io',
    siteName: 'Outlio',
    title: 'Outlio | Proven Sales Systems For Tech Startups and SaaS',
    description: 'We do research first sales outreach for Tech startups, SaaS startups, and agencies || All human written',
    images: [
      {
        url: 'https://outlio.io/outlio-og-image.png',
        width: 1200,
        height: 630,
        alt: 'Outlio - Proven Sales Systems',
      },
    ],
  },
  twitter: {
    card: 'summary',
    site: '@outlio',
    title: 'OUTLIO',
    description: 'Client acquisition is no more a problem.',
    images: [
      {
        url: 'https://cdn.imgchest.com/files/ba56a4b5767e.png',
        alt: 'Sales appollo SAAS outlio appointment setting value agency picture',
      },
    ],
  },
  alternates: {
    canonical: 'https://outlio.io',
  },
  verification: {
    google: 'your-google-verification-code',
    yandex: 'your-yandex-verification-code',
  },
  other: {
    // Meta Business Manager domain verification. Emits:
    // <meta name="facebook-domain-verification" content="…" />
    'facebook-domain-verification': 'ss238e8hnhulelvvh1c3z15nomghtj',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'Outlio',
    description: 'Research-first sales outreach for Tech startups, SaaS startups, and agencies',
    url: 'https://outlio.io',
    logo: 'https://outlio.io/outlio logo.png',
    foundingDate: '2024',
    founders: [
      {
        '@type': 'Person',
        name: 'Husnain Rafiq',
        jobTitle: 'Founder',
        sameAs: [
          'https://www.linkedin.com/in/husnain-rafiq-343179290/',
          'https://x.com/husnain_rfq',
          'https://www.instagram.com/husnain.outlio/',
        ],
      },
      {
        '@type': 'Person',
        name: 'Abdul Saboor',
        jobTitle: 'Co-Founder',
        sameAs: [
          'https://www.linkedin.com/in/abdulsaboor2004/',
          'https://x.com/abdulsaboor2004',
        ],
      },
    ],
    address: {
      '@type': 'PostalAddress',
      addressCountry: 'US',
    },
    contactPoint: {
      '@type': 'ContactPoint',
      email: 'husnain@outlio.io',
      contactType: 'Customer Service',
    },
    sameAs: [
      'https://www.linkedin.com/company/outlio',
      'https://x.com/outlio',
    ],
    service: [
      {
        '@type': 'Service',
        name: 'Outbound Sales Systems',
        description: 'Human-written, research-first outbound for tech startups and SaaS',
        provider: {
          '@type': 'Organization',
          name: 'Outlio',
        },
        areaServed: 'Worldwide',
        serviceType: 'Lead Generation',
      },
      {
        '@type': 'Service',
        name: 'Appointment Setting',
        description: 'B2B appointment setting and sales pipeline development',
        provider: {
          '@type': 'Organization',
          name: 'Outlio',
        },
        areaServed: 'Worldwide',
        serviceType: 'Business Services',
      },
      {
        '@type': 'Service',
        name: 'SaaS Explainer Videos',
        description: 'Motion graphic explainer videos and ad creatives for SaaS',
        provider: {
          '@type': 'Organization',
          name: 'Outlio',
        },
        areaServed: 'Worldwide',
        serviceType: 'Video Production',
      },
    ],
  };

  return (
    <html
      lang="en"
      className={`${dmSans.variable} ${caveat.variable} ${GeistSans.variable} ${GeistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }}
        />
        <SmoothScroll />
        {children}
      </body>
    </html>
  );
}
