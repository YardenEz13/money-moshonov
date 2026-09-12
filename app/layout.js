import { ClerkProvider } from "@clerk/nextjs";
import { Frank_Ruhl_Libre, Rubik } from "next/font/google";
import RegisterSW from "@/components/RegisterSW";
import "./globals.css";

const display = Frank_Ruhl_Libre({
  variable: "--font-frank",
  subsets: ["hebrew", "latin"],
  weight: ["400", "500", "700", "900"],
});
const body = Rubik({
  variable: "--font-rubik",
  subsets: ["hebrew", "latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata = {
  title: "מהלך · פנקס",
  description: "פנקס הוצאות שנרשם במשפט אחד",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "פנקס", statusBarStyle: "default" },
  icons: { apple: "/apple-touch-icon.png" },
};

export const viewport = {
  themeColor: "#F3EFE6",
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
