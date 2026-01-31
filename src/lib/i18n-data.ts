
import type { CardCategory, CardCondition } from './types';

type CardTranslation = {
    id: string;
    name: string;
    category: CardCategory;
    condition: CardCondition;
}

export const cardsEN: CardTranslation[] = [
    { id: '1', name: 'Holo Charizard', category: 'Pokémon', condition: 'Near Mint' },
    { id: '2', name: 'Messi Rookie', category: 'Soccer', condition: 'Mint' },
    { id: '3', name: 'Black Lotus', category: 'Magic', condition: 'Good' },
    { id: '4', name: 'Illustrator Pikachu', category: 'Pokémon', condition: 'Mint' },
    { id: '5', name: 'Base Set Blastoise', category: 'Pokémon', condition: 'Excellent' },
    { id: '6', name: 'Ronaldo Signed', category: 'Soccer', condition: 'Near Mint' },
    { id: '7', name: 'Jace, the Mind Sculptor', category: 'Magic', condition: 'Played' },
    { id: '8', name: 'T206 Honus Wagner', category: 'Other', condition: 'Good' },
];

export const cardsVI: CardTranslation[] = [
    { id: '1', name: 'Charizard Holographic', category: 'Pokémon', condition: 'Gần như mới' },
    { id: '2', name: 'Tân binh Messi', category: 'Bóng đá', condition: 'Hoàn hảo' },
    { id: '3', name: 'Bông sen đen', category: 'Ma thuật', condition: 'Tốt' },
    { id: '4', name: 'Pikachu Họa sĩ', category: 'Pokémon', condition: 'Hoàn hảo' },
    { id: '5', name: 'Blastoise Bộ cơ bản', category: 'Pokémon', condition: 'Tuyệt vời' },
    { id: '6', name: 'Ronaldo có chữ ký', category: 'Bóng đá', condition: 'Gần như mới' },
    { id: '7', name: 'Jace, Nhà điêu khắc tâm trí', category: 'Ma thuật', condition: 'Đã qua sử dụng' },
    { id: '8', name: 'T206 Honus Wagner', category: 'Khác', condition: 'Tốt' },
];
