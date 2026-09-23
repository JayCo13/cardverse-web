import PokemonClient from './pokemon-client';
import { CatalogPreviewSection } from '@/components/seo/catalog-preview-section';
import { CATEGORY_ANSWERS, CategoryAnswerSection } from '@/components/seo/category-answer';

export const dynamic = 'force-dynamic';

export default function Page() {
  return <>
    <PokemonClient />
    <CatalogPreviewSection categories={[3, 85]} />
    <CategoryAnswerSection answer={CATEGORY_ANSWERS.pokemon} />
  </>;
}
