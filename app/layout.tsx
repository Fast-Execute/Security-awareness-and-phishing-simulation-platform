import type { ReactNode } from "react";

export const metadata = {
  title: "Security Awareness Platform",
  description: "Authorised phishing simulations and awareness training",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", margin: 0 }}>{children}</body>
    </html>
  );
}
