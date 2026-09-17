import type { ReactNode } from "react";
export const metadata = { title: "JeriFlow — ambiente de desenvolvimento", robots: { index: false, follow: false } };
export default function Layout({ children }: { children: ReactNode }) {
  return <html lang="pt-BR"><body style={{fontFamily:"system-ui",maxWidth:900,margin:"40px auto",padding:24}}>{children}</body></html>;
}
