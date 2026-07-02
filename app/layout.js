import "./globals.css";

export const metadata = {
  title: "Chilli Farm IoT",
  description: "Field Control Dashboard",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
