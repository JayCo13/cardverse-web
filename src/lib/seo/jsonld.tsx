import type { Card } from '@/lib/types';
import {
  LOGO_PATH, ORGANIZATION, SITE_DESCRIPTION_VI, SITE_NAME, SITE_URL, absoluteUrl, socialProfiles,
} from './site';

/**
 * Structured data is what Google's rich results, the AI Overview and the
 * answer engines (ChatGPT, Perplexity, Gemini) read to understand an entity
 * without parsing the page. Every builder here returns plain JSON so the same
 * object can be rendered in a server component or inspected in a test.
 */
type JsonLdObject = Record<string, unknown>;

export function JsonLd({ data }: { data: JsonLdObject | JsonLdObject[] }) {
  // `<` is escaped so a name containing `</script>` cannot break out of the tag.
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} />;
}

export function organizationJsonLd(): JsonLdObject {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    '@id': `${SITE_URL}/#organization`,
    name: SITE_NAME,
    legalName: ORGANIZATION.legalName,
    url: SITE_URL,
    logo: absoluteUrl(LOGO_PATH),
    description: SITE_DESCRIPTION_VI,
    email: ORGANIZATION.email,
    telephone: ORGANIZATION.phone,
    address: { '@type': 'PostalAddress', ...ORGANIZATION.address },
    areaServed: 'VN',
    sameAs: socialProfiles(),
    contactPoint: {
      '@type': 'ContactPoint',
      contactType: 'customer support',
      email: ORGANIZATION.email,
      telephone: ORGANIZATION.phone,
      availableLanguage: ['vi', 'en', 'ja'],
    },
  };
}

export function websiteJsonLd(): JsonLdObject {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    '@id': `${SITE_URL}/#website`,
    name: SITE_NAME,
    url: SITE_URL,
    inLanguage: 'vi',
    publisher: { '@id': `${SITE_URL}/#organization` },
    potentialAction: {
      '@type': 'SearchAction',
      target: { '@type': 'EntryPoint', urlTemplate: `${SITE_URL}/buy?q={search_term_string}` },
      'query-input': 'required name=search_term_string',
    },
  };
}

export type BreadcrumbItem = { name: string; path: string };

export function breadcrumbJsonLd(items: BreadcrumbItem[]): JsonLdObject {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: absoluteUrl(item.path),
    })),
  };
}

export type FaqItem = { question: string; answer: string };

export function faqJsonLd(items: FaqItem[]): JsonLdObject {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map((item) => ({
      '@type': 'Question',
      name: item.question,
      acceptedAnswer: { '@type': 'Answer', text: item.answer },
    })),
  };
}

/** Listing conditions are stored in either language (see `CardCondition`). */
const NEW_CONDITIONS = new Set(['Mint', 'Hoàn hảo']);

function availabilityFor(status: Card['status']): string {
  switch (status) {
    case 'sold': return 'https://schema.org/SoldOut';
    case 'expired': return 'https://schema.org/Discontinued';
    case 'in_transaction': return 'https://schema.org/LimitedAvailability';
    default: return 'https://schema.org/InStock';
  }
}

/**
 * A marketplace listing as a Product with one Offer. Prices on the marketplace
 * are stored in VND. Auctions and razzes carry no fixed price, so they get a
 * Product without an Offer rather than a made-up one — Google penalises offers
 * that do not match what the page shows.
 */
export function productJsonLd(card: Card): JsonLdObject {
  const images = [card.imageUrl, ...(card.imageUrls ?? [])].filter(Boolean);
  const product: JsonLdObject = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    '@id': `${SITE_URL}/cards/${card.id}#product`,
    name: card.name,
    image: images,
    description: card.description || `${card.name} — ${card.category}${card.setName ? `, ${card.setName}` : ''}. Rao bán trên ${SITE_NAME}.`,
    category: card.category,
    url: `${SITE_URL}/cards/${card.id}`,
  };
  if (card.publisher) product.brand = { '@type': 'Brand', name: card.publisher };
  if (card.listingType === 'sale' && typeof card.price === 'number' && card.price > 0) {
    product.offers = {
      '@type': 'Offer',
      url: `${SITE_URL}/cards/${card.id}`,
      price: card.price,
      priceCurrency: 'VND',
      availability: availabilityFor(card.status),
      itemCondition: card.condition && NEW_CONDITIONS.has(card.condition)
        ? 'https://schema.org/NewCondition'
        : 'https://schema.org/UsedCondition',
      seller: card.sellerName
        ? { '@type': 'Person', name: card.sellerName, url: `${SITE_URL}/users/${card.sellerId}` }
        : { '@id': `${SITE_URL}/#organization` },
    };
  }
  return product;
}
