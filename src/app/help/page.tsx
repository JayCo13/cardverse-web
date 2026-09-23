import HelpClient from './help-client';

/**
 * HelpClient server-renders the Vietnamese FAQ and matching JSON-LD, then
 * updates both together when a visitor changes languages.
 */
export default function HelpCenterPage() {
  return <HelpClient />;
}
