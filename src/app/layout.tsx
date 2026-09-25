import type { Metadata } from "next";
import "./globals.css";
import { REPO_URL } from "../lib/site";

export const metadata: Metadata = {
  title: "StockPay",
  description: "Pay a Solana Pay request from tokenized stocks (SPYx, NVDAx, TSLAx) and get paid in USDC. An open-source hackathon prototype.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>
        {children}
        <footer style={{ maxWidth: 640, margin: "2rem auto", padding: "0 1rem", fontFamily: "system-ui, sans-serif", fontSize: 14 }}>
          <p>
            StockPay is an open-source prototype built for a hackathon. It is not offered as a service and is not registered with any
            regulator. It never holds funds or keys. Not financial advice.{" "}
            <a href={REPO_URL} target="_blank" rel="noreferrer" style={{ textDecoration: "underline" }}>
              Source on GitHub
            </a>
          </p>
        </footer>
      </body>
    </html>
  );
}
