import type { ReactNode } from "react";
import "./styles.css";
export const metadata = { title: "JeriFlow — ambiente de desenvolvimento", robots: { index: false, follow: false } };
export default function Layout({ children }: { children: ReactNode }) {
  return <html lang="pt-BR"><body>{children}</body></html>;
}
