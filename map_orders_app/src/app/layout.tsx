import type { Metadata } from "next";
import "@fontsource/roboto/300.css";
import "@fontsource/roboto/400.css";
import "@fontsource/roboto/500.css";
import "@fontsource/roboto/700.css";
import "leaflet/dist/leaflet.css";
import "leaflet-draw/dist/leaflet.draw.css";
import "./globals.css";
import { ThemeRegistry } from "@/shared/ui/ThemeRegistry";
import { StoreProvider } from "@/shared/store/StoreProvider";

export const metadata: Metadata = {
  title: "map_orders",
  description:
    "Инструмент подготовки входных данных для CP-SAT и визуализации маршрутов курьеров",
  icons: {
    icon: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru">
      <body>
        <StoreProvider>
          <ThemeRegistry>{children}</ThemeRegistry>
        </StoreProvider>
      </body>
    </html>
  );
}
