export default function SettingsLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Chrome is applied per-route: the personal surface renders the Orca client
  // full-bleed with its own sidebar, while the remaining pages keep the CoDev
  // settings sidebar.
  return children;
}
