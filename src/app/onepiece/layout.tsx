// Force dynamic rendering for this route — the page uses useSearchParams()
export const dynamic = 'force-dynamic';

export default function OnePieceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
