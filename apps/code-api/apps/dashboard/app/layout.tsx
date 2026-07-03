import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'engram-code',
  description: 'What is this codebase?',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-paper font-sans text-ink antialiased">
        {children}
      </body>
    </html>
  );
}
