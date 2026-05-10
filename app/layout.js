import "./globals.css";

export const metadata = {
  title: "Notebook RAG",
  description: "Document-grounded RAG assistant"
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
