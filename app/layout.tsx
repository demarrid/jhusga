import type { Metadata } from "next";
import { Geist, Source_Serif_4 } from "next/font/google";
import Footer from "./(components)/Footer";
import Header from "./(components)/Header";
import "./globals.css";

const sourceSerif4 = Source_Serif_4({
  variable: "--font-source-serif-4",
  subsets: ["latin"],
});

const geistSans = Geist({
  variable: "--font-geist",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Student Government Association at JHU",
  description: "Alternative website for the Student Government Association at Johns Hopkins University.",
  icons: {
    icon: '/favicon.ico',
    shortcut: '/favicon.ico',
    apple: '/favicon.ico',
  },
  manifest: '/site.webmanifest',
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: 'https://sgajhu.edu',
    siteName: 'SGA at JHU',
    title: 'SGA at JHU',
    description: 'Alternative website for the Student Government Association at Johns Hopkins University.',
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${sourceSerif4.variable} ${geistSans.variable} antialiased`}
    >
      <body className="min-h-dvh flex flex-col bg-background text-foreground light">
        <Header />
        <main className="flex-1">{children}</main>
        <Footer />
      </body>
    </html >
  );
}
