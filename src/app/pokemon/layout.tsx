// Force dynamic rendering for this route — the page uses useSearchParams()
export const dynamic = 'force-dynamic';

export default function PokemonLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
