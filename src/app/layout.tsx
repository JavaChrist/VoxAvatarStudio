import type { Metadata, Viewport } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import type { ReactNode } from "react";
import { ServiceWorkerRegister } from "@/features/update/ServiceWorkerRegister";
import { UpdatePrompt } from "@/features/update/UpdatePrompt";
import { ModalProvider } from "@/ui/modal/ModalProvider";
import "./globals.css";

export const metadata: Metadata = {
  title: "VoxAvatar Studio",
  description: "Vidéos courtes présentées par Chris, du script à l'export MP4.",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/favicon.svg", type: "image/svg+xml" },
    ],
    apple: [
      { url: "/apple-touch-icon.png", sizes: "180x180" },
      { url: "/apple-touch-icon-3d.png", sizes: "192x192" },
    ],
  },
  appleWebApp: { capable: true, title: "VoxAvatar", statusBarStyle: "black" },
};

export const viewport: Viewport = {
  themeColor: "#0b0b0c",
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="min-h-dvh bg-black">
        <ModalProvider>
          {children}
          <UpdatePrompt />
          <ServiceWorkerRegister />
        </ModalProvider>
      </body>
    </html>
  );
}
