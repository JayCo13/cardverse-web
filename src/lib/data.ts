
import type { Card } from './types';
import { PlaceHolderImages } from './placeholder-images';

const getImage = (id: string) => {
  const image = PlaceHolderImages.find(img => img.id === id);
  if (!image) {
    const defaultImage = PlaceHolderImages.find(img => img.id === 'card-1')!;
    return { url: defaultImage.imageUrl, hint: defaultImage.imageHint };
  }
  return { url: image.imageUrl, hint: image.imageHint };
};

export const cards: Card[] = [
    {
        id: '1',
        name: 'Holo Charizard',
        imageUrl: getImage('card-1').url,
        imageHint: getImage('card-1').hint,
        category: 'Pokémon',
        condition: 'Near Mint',
        listingType: 'auction',
        currentBid: 1250.00,
        auctionEnds: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
        userId: 'user1',
        author: 'Leighton Kramer'
    },
    {
        id: '2',
        name: 'Messi Rookie',
        imageUrl: getImage('card-2').url,
        imageHint: getImage('card-2').hint,
        category: 'Soccer',
        condition: 'Mint',
        listingType: 'sale',
        price: 8500.00,
        userId: 'user2',
        author: 'Haylie Arcand'
    },
    {
        id: '3',
        name: 'Black Lotus',
        imageUrl: getImage('card-3').url,
        imageHint: getImage('card-3').hint,
        category: 'Magic',
        condition: 'Good',
        listingType: 'razz',
        ticketPrice: 100,
        razzEntries: 45,
        totalTickets: 100,
        userId: 'user3',
        author: 'Bowen Higgins'
    },
    {
        id: '4',
        name: 'Illustrator Pikachu',
        imageUrl: getImage('card-4').url,
        imageHint: getImage('card-4').hint,
        category: 'Pokémon',
        condition: 'Mint',
        listingType: 'sale',
        price: 5250.00,
        userId: 'user4',
        author: 'Saige Fuentes'
    },
    {
        id: '5',
        name: 'Base Set Blastoise',
        imageUrl: getImage('card-5').url,
        imageHint: getImage('card-5').hint,
        category: 'Pokémon',
        condition: 'Excellent',
        listingType: 'sale',
        price: 250.00,
        userId: 'user5',
        author: 'Sophie Mclain'
    },
    {
        id: '6',
        name: 'Ronaldo Signed',
        imageUrl: getImage('card-6').url,
        imageHint: getImage('card-6').hint,
        category: 'Soccer',
        condition: 'Near Mint',
        listingType: 'auction',
        currentBid: 550.00,
        auctionEnds: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
        userId: 'user6',
        author: 'Jeremy Burch'
    },
    {
        id: '7',
        name: 'Jace, the Mind Sculptor',
        imageUrl: getImage('card-7').url,
        imageHint: getImage('card-7').hint,
        category: 'Magic',
        condition: 'Played',
        listingType: 'sale',
        price: 45.00,
        userId: 'user7',
        author: 'Amelia Griffith'
    },
    {
        id: '8',
        name: 'T206 Honus Wagner',
        imageUrl: getImage('card-8').url,
        imageHint: getImage('card-8').hint,
        category: 'Other',
        condition: 'Good',
        listingType: 'razz',
        ticketPrice: 1000,
        razzEntries: 120,
        totalTickets: 250,
        userId: 'user8',
        author: 'Isabela Hart'
    },
];
