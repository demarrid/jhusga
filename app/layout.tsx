import type { Metadata, Viewport } from "next";
import { Source_Serif_4, Work_Sans } from "next/font/google";
import Footer from "./(components)/Footer";
import Header from "./(components)/Header";
import "./globals.css";

import {
  DEFAULT_DESCRIPTION,
  OG_IMAGE,
  SITE_NAME,
  SITE_TITLE,
  TITLE_TEMPLATE,
  siteUrl,
} from "@/lib/seo";

const sourceSerif4 = Source_Serif_4({
  variable: "--font-source-serif-4",
  subsets: ["latin"],
});

const workSans = Work_Sans({
  variable: "--font-work-sans",
  subsets: ["latin"],
});

/**
 * The defaults every page starts from. See lib/seo.ts.
 *
 * Pages set their own title and description through `pageMetadata`; what
 * lives here is only what is true of the whole site. Open Graph deliberately
 * carries no title or description of its own: Next falls back to the page's
 * resolved title and description, so a document shared in a chat shows that
 * document's name rather than the site's.
 */
export const metadata: Metadata = {
  metadataBase: siteUrl(),
  title: {
    default: SITE_TITLE,
    template: TITLE_TEMPLATE,
  },
  description: DEFAULT_DESCRIPTION,
  applicationName: SITE_NAME,
  // PNG first: Slack and some search engines show a site's favicon beside
  // its name in a preview, and not all of them will read an .ico.
  icons: {
    icon: [
      { url: "/favicon-96x96.png", sizes: "96x96", type: "image/png" },
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/favicon.ico", sizes: "any" },
    ],
    shortcut: "/favicon.ico",
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  manifest: "/site.webmanifest",
  openGraph: {
    type: "website",
    locale: "en_US",
    siteName: SITE_NAME,
    url: "/",
    images: [OG_IMAGE],
  },
  twitter: {
    card: "summary",
  },
};

/** Hopkins Heritage Blue, which Discord uses as the stripe beside an embed. */
export const viewport: Viewport = {
  themeColor: "#002d72",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${sourceSerif4.variable} ${workSans.variable} antialiased`}
    >
      <body className="min-h-dvh flex flex-col bg-background text-foreground light">
        <Header />
        <main className="flex-1">{children}</main>
        <Footer />
      </body>
    </html >
  );
}
