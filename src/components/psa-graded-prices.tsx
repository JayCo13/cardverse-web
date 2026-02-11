'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Image from 'next/image';
import { Medal, CaretDown, CaretUp, X } from '@phosphor-icons/react';
import { useLocalization } from '@/context/localization-context';

interface PsaPrice {
    id: number;
    product_id: number;
    ebay_id: string;
    name: string;
    image_url: string | null;
    grader: string;
    grade: string;
    price: number; // in cents
    ebay_url: string | null;
    created_at: string;
}

interface PsaGradedPricesProps {
    productId: number;
    productName?: string;
    isScanned?: boolean;
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

// Format price from cents to dollars
function formatPrice(cents: number): string {
    return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Grade color mapping
function getGradeColor(grade: string): string {
    const gradeNum = parseFloat(grade);
    if (gradeNum >= 10) return 'text-yellow-400';
    if (gradeNum >= 9) return 'text-emerald-400';
    if (gradeNum >= 8) return 'text-blue-400';
    return 'text-gray-400';
}

function getGradeGradient(grade: string): string {
    const gradeNum = parseFloat(grade);
    if (gradeNum >= 10) return 'from-yellow-500/20 to-yellow-500/5 border-yellow-500/30 hover:border-yellow-500/50';
    if (gradeNum >= 9) return 'from-emerald-500/20 to-emerald-500/5 border-emerald-500/30 hover:border-emerald-500/50';
    if (gradeNum >= 8) return 'from-blue-500/20 to-blue-500/5 border-blue-500/30 hover:border-blue-500/50';
    return 'from-gray-500/20 to-gray-500/5 border-gray-500/30 hover:border-gray-500/50';
}

export function PSAGradedPrices({ productId, productName, isScanned = false, hideHeader = false }: PsaGradedPricesProps & { hideHeader?: boolean }) {
    const { t } = useLocalization();
    const [psaPrices, setPsaPrices] = useState<PsaPrice[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [isExpanded, setIsExpanded] = useState(true);
    const [selectedImage, setSelectedImage] = useState<{ url: string; name: string; grade: string; price: number } | null>(null);
    const [activeTab, setActiveTab] = useState('10');

    // Close modal on Escape key
    useEffect(() => {
        const handleEsc = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setSelectedImage(null);
        };
        if (selectedImage) {
            document.addEventListener('keydown', handleEsc);
            document.body.style.overflow = 'hidden';
        }
        return () => {
            document.removeEventListener('keydown', handleEsc);
            document.body.style.overflow = '';
        };
    }, [selectedImage]);

    useEffect(() => {
        async function fetchPsaPrices() {
            if (!isScanned) return;
            if (!productId || !SUPABASE_URL) {
                setIsLoading(false);
                return;
            }

            try {
                const url = `${SUPABASE_URL}/rest/v1/pokemon_psa_prices?` +
                    `product_id=eq.${productId}&` +
                    `order=grade.desc,price.asc&` +
                    `limit=50`; // Increased limit to ensure we have enough data for tabs

                const response = await fetch(url, { headers: { 'apikey': SUPABASE_KEY } });
                if (!response.ok) throw new Error('Failed to fetch PSA prices');
                const data = await response.json();
                setPsaPrices(data);
            } catch (err) {
                console.error('Error fetching PSA prices:', err);
                setError('Failed to load graded prices');
            } finally {
                setIsLoading(false);
            }
        }
        fetchPsaPrices();
    }, [productId, isScanned]);

    // Group prices by grade
    const groupedPrices = React.useMemo(() => {
        const groups: { [grade: string]: PsaPrice[] } = {};
        psaPrices.forEach(p => {
            if (!groups[p.grade]) groups[p.grade] = [];
            groups[p.grade].push(p);
        });
        return groups;
    }, [psaPrices]);

    // Get lowest price per grade
    const lowestPriceByGrade = React.useMemo(() => {
        const lowest: { [grade: string]: PsaPrice } = {};
        Object.entries(groupedPrices).forEach(([grade, prices]) => {
            lowest[grade] = prices.reduce((min, p) => p.price < min.price ? p : min, prices[0]);
        });
        return lowest;
    }, [groupedPrices]);

    // Render logic
    if (!isScanned) {
        return (
            <div className="mt-6 p-8 bg-gradient-to-br from-white/5 to-transparent rounded-2xl border border-white/10 text-center group cursor-default">
                <div className="w-16 h-16 rounded-2xl bg-orange-500/10 flex items-center justify-center mx-auto mb-4 border border-orange-500/20 group-hover:scale-110 transition-transform duration-300">
                    <Medal className="w-8 h-8 text-orange-500" weight="duotone" />
                </div>
                <h3 className="text-white font-bold text-xl mb-2">{t('psa_scan_to_see')}</h3>
                <p className="text-gray-400 max-w-xs mx-auto text-sm leading-relaxed">
                    {t('psa_scan_description')}
                </p>
            </div>
        );
    }

    if (isLoading) {
        return (
            <div className="mt-6 space-y-4">
                <div className="h-40 bg-white/5 rounded-2xl animate-pulse" />
                <div className="h-20 bg-white/5 rounded-xl animate-pulse" />
                <div className="h-20 bg-white/5 rounded-xl animate-pulse" />
            </div>
        );
    }

    if (error || psaPrices.length === 0) {
        if (psaPrices.length === 0 && !error) {
            return (
                <div className="mt-6 p-8 bg-white/5 rounded-2xl border border-white/10 text-center">
                    <Medal className="w-12 h-12 text-gray-600 mx-auto mb-3" weight="duotone" />
                    <p className="text-gray-400">{t('psa_no_data')}</p>
                </div>
            );
        }
        return null;
    }

    const availableGrades = ['10', '9'];

    // Filter listings based on active tab
    const filteredListings = groupedPrices[activeTab] || [];

    const displayCount = (isExpanded || activeTab !== 'all') ? filteredListings.length : 3;

    return (
        <div className="mt-8">
            {/* Header - Conditionally rendered */}
            {!hideHeader && (
                <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-yellow-500/10 rounded-lg border border-yellow-500/20">
                            <Medal className="w-5 h-5 text-yellow-500" weight="fill" />
                        </div>
                        <div>
                            <h2 className="text-white font-bold text-lg leading-none">{t('psa_graded_prices')}</h2>
                            <div className="flex items-center gap-2 mt-1">
                                <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-white/10 text-gray-300 border border-white/5">
                                    {t('psa_listings_count').replace('{count}', psaPrices.length.toString())}
                                </span>
                                <span className="text-xs text-gray-500">Real-time market data</span>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Custom Tabs - Centered without 'All' option */}
            <div className="flex items-center justify-center gap-4 mb-6">
                {availableGrades.map(grade => {
                    const count = groupedPrices[grade]?.length || 0;
                    if (count === 0) return null;

                    return (
                        <button
                            key={grade}
                            onClick={() => setActiveTab(grade)}
                            className={`px-6 py-2 rounded-full text-base font-bold whitespace-nowrap transition-all flex items-center gap-2 ${activeTab === grade
                                ? `bg-gradient-to-r ${getGradeGradient(grade).split(' ')[0]} text-white border border-white/20 shadow-lg shadow-${grade === '10' ? 'yellow' : 'emerald'}-500/20`
                                : 'bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white'
                                }`}
                        >
                            <span>PSA {grade}</span>
                            <span className={`px-1.5 py-0.5 rounded text-[10px] ml-1 ${activeTab === grade ? 'bg-black/20 text-white' : 'bg-white/10 text-gray-400'}`}>
                                {count}
                            </span>
                        </button>
                    );
                })}
            </div>

            {/* Listings List */}
            <div className="space-y-3">
                {filteredListings.slice(0, displayCount).map((psa, index) => (
                    <div
                        key={`${psa.ebay_id}-${index}`}
                        onClick={() => psa.image_url && setSelectedImage({
                            url: psa.image_url,
                            name: psa.name,
                            grade: psa.grade,
                            price: psa.price
                        })}
                        className={`group relative flex items-center p-3 rounded-xl border border-white/5 bg-white/[0.02] hover:bg-white/[0.06] hover:border-white/10 transition-all duration-200 ${psa.image_url ? 'cursor-pointer' : ''}`}
                    >
                        {/* Image Thumbnail */}
                        <div className="relative w-16 h-20 flex-shrink-0 bg-black/40 rounded-lg overflow-hidden border border-white/5 group-hover:border-white/20 transition-colors">
                            {psa.image_url ? (
                                <Image
                                    src={psa.image_url}
                                    alt={psa.name}
                                    fill
                                    className="object-contain p-1 group-hover:scale-110 transition-transform duration-500"
                                    sizes="64px"
                                />
                            ) : (
                                <div className="w-full h-full flex items-center justify-center text-gray-700">
                                    <Medal className="w-6 h-6" />
                                </div>
                            )}
                        </div>

                        {/* Details */}
                        <div className="flex-1 min-w-0 ml-4 grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2 sm:gap-4 items-center">
                            <div>
                                <div className="flex items-center gap-2 mb-1">
                                    <span className={`text-sm font-bold px-2 py-0.5 rounded-md bg-white/5 border border-white/5 ${getGradeColor(psa.grade)}`}>
                                        PSA {psa.grade}
                                    </span>
                                </div>
                                <h4 className="text-gray-300 text-sm font-medium leading-snug line-clamp-2 group-hover:text-white transition-colors">
                                    {psa.name}
                                </h4>
                            </div>

                            <div className="flex items-center justify-end gap-4 mt-2 sm:mt-0 w-full sm:w-auto">
                                <span className="text-white font-bold text-lg whitespace-nowrap">
                                    {formatPrice(psa.price)}
                                </span>
                            </div>
                        </div>
                    </div>
                ))}
            </div>

            {/* Expand/Collapse Button - Only show if there are more items and we are in 'all' tab (or force show all in specific tabs) */}
            {activeTab === 'all' && filteredListings.length > 3 && (
                <button
                    onClick={() => setIsExpanded(!isExpanded)}
                    className="w-full mt-4 py-3 text-sm font-medium text-gray-400 hover:text-white flex items-center justify-center gap-2 transition-colors border-t border-white/5 hover:bg-white/5 rounded-b-xl"
                >
                    {isExpanded ? (
                        <>
                            <CaretUp className="w-4 h-4" />
                            {t('psa_show_less')}
                        </>
                    ) : (
                        <>
                            <CaretDown className="w-4 h-4" />
                            {t('psa_view_details')}
                        </>
                    )}
                </button>
            )}

            {/* Image Modal */}
            {selectedImage && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-md p-4 animate-in fade-in duration-200"
                    onClick={() => setSelectedImage(null)}
                >
                    <div
                        className="relative w-full max-w-lg bg-transparent flex flex-col items-center justify-center p-4"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Close Button - Floating Overlay */}
                        <button
                            onClick={() => setSelectedImage(null)}
                            className="absolute top-2 right-2 z-50 p-2 rounded-full bg-black/50 hover:bg-black/70 text-white transition-colors backdrop-blur-sm"
                        >
                            <X className="w-6 h-6" />
                        </button>

                        {/* Modal Image - Full View */}
                        <div className="relative w-full h-[80vh] sm:h-[85vh]">
                            <Image
                                src={selectedImage.url}
                                alt={selectedImage.name}
                                fill
                                className="object-contain drop-shadow-2xl"
                                sizes="(max-width: 768px) 100vw, 800px"
                                priority
                            />
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
