import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Телеграм-пульт — новости по вашей теме",
  description: "Задайте тему Telegram-канала: приложение найдёт новости и издателей, редактор подготовит выпуск.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru">
      <body className="antialiased">{children}</body>
    </html>
  );
}
