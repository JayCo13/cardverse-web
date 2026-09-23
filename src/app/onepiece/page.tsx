import OnePieceClient from './onepiece-client';
import { CatalogPreviewSection } from '@/components/seo/catalog-preview-section';
import { CATEGORY_ANSWERS, CategoryAnswerSection } from '@/components/seo/category-answer';

export const dynamic = 'force-dynamic';

export default function Page() {
  return <>
    <OnePieceClient />
    <CatalogPreviewSection categories={[68]} />
    <CategoryAnswerSection answer={CATEGORY_ANSWERS.onepiece} />
  </>;
}
