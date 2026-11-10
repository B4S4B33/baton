export const metadata = {
  title: "Knowledge Handover",
  description: "Review and approve project handover claims",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}