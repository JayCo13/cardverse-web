import { accountRoute, getAccountRouteContext } from '@/lib/account-route';
import { collectionPublisher, normalizeCollectionCategory } from '@/lib/collection-card';
import { createServiceSupabaseClient } from '@/lib/supabase/service';
import { NextRequest, NextResponse } from 'next/server';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TCG_FIELDS = 'product_id,name,image_url,set_name,rarity,number,category_id,market_price';

type CollectionRow = {
  id: string;
  title: string;
  image_url: string | null;
  category: string | null;
  rarity: string | null;
  set_name: string | null;
  catalog_product_id: number | null;
  catalog_soccer_id: number | null;
};

type CatalogRow = {
  product_id: number;
  name: string;
  image_url: string | null;
  set_name: string | null;
  rarity: string | null;
  number: string | null;
  category_id: number;
  market_price: number | null;
};

type SoccerCatalogRow = {
  id: number;
  brand: string;
  year: number;
  set_name: string;
  player: string;
  card_number: string | null;
  parallel: string;
};

function toCatalogPick(row: CatalogRow) {
  return {
    kind: 'tcgcsv' as const,
    productId: row.product_id,
    name: row.name,
    setName: row.set_name,
    number: row.number,
    language: row.category_id === 85 ? 'jp' as const : 'en' as const,
    imageUrl: row.image_url,
    rarity: row.rarity,
    marketPrice: row.market_price,
  };
}

async function handlePOST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: 'Invalid collection card' }, { status: 400 });

  const { supabase, user } = await getAccountRouteContext(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data, error } = await supabase
    .from('user_collections')
    .select('id,title,image_url,category,rarity,set_name,catalog_product_id,catalog_soccer_id')
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle();

  if (error) {
    console.error('[Collection listing source] Read failed:', error.message);
    return NextResponse.json({ error: 'Không tải được thẻ trong bộ sưu tập.' }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: 'Collection card not found' }, { status: 404 });

  const collection = data as CollectionRow;
  const category = normalizeCollectionCategory(collection.category);
  const base = {
    id: collection.id,
    name: collection.title,
    category,
    publisher: collectionPublisher(category),
    setName: collection.set_name || '',
    imageUrl: collection.image_url || '',
    rarity: collection.rarity,
  };

  const service = createServiceSupabaseClient();

  if (category === 'Bóng đá') {
    if (!collection.catalog_soccer_id) {
      return NextResponse.json({ ...base, catalogPick: null, resolution: 'not_required' });
    }

    const { data: soccerData, error: soccerError } = await service
      .from('soccer_cards')
      .select('id,brand,year,set_name,player,card_number,parallel')
      .eq('id', collection.catalog_soccer_id)
      .maybeSingle();
    if (soccerError) console.error('[Collection listing source] Soccer lookup failed:', soccerError.message);
    if (!soccerData) {
      return NextResponse.json({ ...base, catalogPick: null, resolution: 'unresolved' });
    }

    const soccer = soccerData as SoccerCatalogRow;
    const name = `${soccer.player}${soccer.parallel && soccer.parallel !== 'Base' ? ` (${soccer.parallel})` : ''}`;
    const setName = `${soccer.year} ${soccer.brand} ${soccer.set_name}`.trim();
    return NextResponse.json({
      ...base,
      name,
      setName,
      catalogPick: {
        kind: 'soccer',
        soccerId: soccer.id,
        name,
        setName,
        number: soccer.card_number,
        language: null,
        imageUrl: collection.image_url,
        rarity: collection.rarity,
      },
      resolution: 'linked',
    });
  }

  if (category !== 'Pokémon' && category !== 'One Piece') {
    return NextResponse.json({ ...base, catalogPick: null, resolution: 'not_required' });
  }

  const categoryIds = category === 'One Piece' ? [68] : [3, 85];
  let catalogRow: CatalogRow | null = null;

  if (collection.catalog_product_id) {
    const { data: linked } = await service
      .from('tcgcsv_products')
      .select(TCG_FIELDS)
      .eq('product_id', collection.catalog_product_id)
      .in('category_id', categoryIds)
      .maybeSingle();
    catalogRow = linked as CatalogRow | null;
  }

  if (!catalogRow && collection.image_url) {
    const { data: imageMatches } = await service
      .from('tcgcsv_products')
      .select(TCG_FIELDS)
      .eq('image_url', collection.image_url)
      .in('category_id', categoryIds)
      .limit(2);
    if (imageMatches?.length === 1) catalogRow = imageMatches[0] as CatalogRow;
  }

  if (!catalogRow) {
    const { data: titleMatches } = await service
      .from('tcgcsv_products')
      .select(TCG_FIELDS)
      .eq('name', collection.title)
      .in('category_id', categoryIds)
      .limit(2);
    if (titleMatches?.length === 1) catalogRow = titleMatches[0] as CatalogRow;
  }

  if (!catalogRow) {
    return NextResponse.json({ ...base, catalogPick: null, resolution: 'unresolved' });
  }

  const identityChanged = collection.catalog_product_id !== catalogRow.product_id;
  if (identityChanged) {
    const { error: updateError } = await supabase
      .from('user_collections')
      .update({
        category,
        catalog_product_id: catalogRow.product_id,
        set_name: catalogRow.set_name,
        card_number: catalogRow.number,
        language: catalogRow.category_id === 85 ? 'jp' : 'en',
      } as never)
      .eq('id', collection.id)
      .eq('user_id', user.id);
    if (updateError) console.error('[Collection listing source] Identity update failed:', updateError.message);
  }

  return NextResponse.json({
    ...base,
    name: catalogRow.name,
    setName: catalogRow.set_name || base.setName,
    imageUrl: catalogRow.image_url || base.imageUrl,
    rarity: catalogRow.rarity || base.rarity,
    catalogPick: toCatalogPick(catalogRow),
    resolution: identityChanged ? 'resolved' : 'linked',
  });
}

export const POST = accountRoute(handlePOST);
