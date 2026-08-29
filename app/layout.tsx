import type { Metadata } from "next";
import { headers } from "next/headers";
import { Caveat, DM_Sans } from "next/font/google";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { serializeJsonLd } from "@/lib/json-ld";
import { APP_ORIGIN, isAppHost } from "@/lib/site";
import SmoothScroll from "./components/SmoothScroll";
import "./globals.css";
import "lenis/dist/lenis.css";

const GOOGLE_TAG_MANAGER_ID = "GTM-WK5M6CDJ";

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

const agencyMetadata: Metadata = {
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
    /*
     * Dimensions must match the file. The previous entry claimed 1200x630 while
     * pointing at a 1080x1080 logo, so every platform reserved a 1.91:1 box and
     * cropped the sides off the logo.
     */
    images: [
      {
        url: 'https://outlio.io/social/og-card.png',
        width: 640,
        height: 335,
        alt: 'Outlio — outbound sales systems for B2B SaaS and tech startups',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    // X handles allow only letters, digits and underscores, so a dot can never
    // resolve to an account. '@outlio.io' silently dropped the attribution.
    site: '@OutlioLeadGen',
    title: 'Client acquisition is no more a bottleneck',
    description:
      'We scale B2B SaaS & Tech Startups with tailored outreach; Powered by our Lead-Engine',
    images: [
      {
        url: 'https://outlio.io/social/og-card.png',
        alt: 'Outlio — outbound sales systems for B2B SaaS and tech startups',
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

const appMetadata: Metadata = {
  metadataBase: new URL(APP_ORIGIN),
  title: {
    default: "Outlio Lead Engine | B2B Data & Business Intelligence Software",
    template: "%s",
  },
  description:
    "B2B software for extracting, enriching, organizing, scoring, and exporting source-backed lead and company data.",
  applicationName: "Outlio Lead Engine",
  keywords: [
    "B2B data extraction software",
    "lead enrichment software",
    "business intelligence software",
    "lead data organization",
    "Sales Navigator data export",
  ],
  creator: "Outlio Lead Engine",
  publisher: "Outlio",
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  alternates: { canonical: APP_ORIGIN },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: APP_ORIGIN,
    siteName: "Outlio Lead Engine",
    title: "Outlio Lead Engine | B2B Data & Business Intelligence Software",
    description:
      "Extract, enrich, organize, score, and export source-backed B2B lead and company data.",
    images: [{
      url: "/social/og-card.png",
      width: 640,
      height: 335,
      alt: "Outlio Lead Engine B2B data and business intelligence software",
    }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Outlio Lead Engine | B2B Data Software",
    description:
      "Source-backed B2B data extraction, enrichment, organization, scoring, and export software.",
    images: ["/social/og-card.png"],
  },
  icons: {
    icon: "/icon.png",
    shortcut: "/icon.png",
    apple: "/icon.png",
  },
};

export async function generateMetadata(): Promise<Metadata> {
  return isAppHost((await headers()).get("host")) ? appMetadata : agencyMetadata;
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const appSurface = isAppHost((await headers()).get("host"));
  const jsonLd = appSurface ? {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'Outlio Lead Engine',
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Web',
    url: APP_ORIGIN,
    description:
      'B2B software for extracting, enriching, organizing, scoring, and exporting source-backed lead and company data.',
    offers: {
      '@type': 'AggregateOffer',
      priceCurrency: 'USD',
      lowPrice: '28',
      highPrice: '69',
      offerCount: '3',
      url: `${APP_ORIGIN}/pricing`,
    },
    provider: {
      '@type': 'Organization',
      name: 'Outlio',
    },
  } : {
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
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
})(window,document,'script','dataLayer','${GOOGLE_TAG_MANAGER_ID}');`,
          }}
        />
      </head>
      <body className="min-h-full flex flex-col">
        <noscript>
          <iframe
            src={`https://www.googletagmanager.com/ns.html?id=${GOOGLE_TAG_MANAGER_ID}`}
            height="0"
            width="0"
            className="hidden invisible"
            title="Google Tag Manager"
          />
        </noscript>
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
