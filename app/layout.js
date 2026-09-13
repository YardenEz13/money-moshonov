import { ClerkProvider } from "@clerk/nextjs";
import { Fredoka, Secular_One } from "next/font/google";
import RegisterSW from "@/components/RegisterSW";
import "./globals.css";

const display = Secular_One({
  variable: "--font-secular",
  subsets: ["hebrew", "latin"],
  weight: "400",
});
const body = Fredoka({
  variable: "--font-fredoka",
  subsets: ["hebrew", "latin"],
});

export const metadata = {
  title: "מהלך · פנקס",
  description: "פנקס הוצאות שנרשם במשפט אחד",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "פנקס", statusBarStyle: "default" },
  icons: { apple: "/apple-touch-icon.png" },
};

export const viewport = {
  themeColor: "#EAF0E2",
  viewportFit: "cover",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }) {
  return (
    <html lang="he" dir="rtl" className={`${display.variable} ${body.variable} h-full`}>
      <body className="min-h-full flex flex-col">
        <ClerkProvider>{children}</ClerkProvider>
        <RegisterSW />
      </body>
    </html>
  );
}
