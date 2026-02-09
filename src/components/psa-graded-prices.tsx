'use client';

import React, { useState, useEffect } from 'react';
import Image from 'next/image';
import { Medal, ArrowSquareOut, CaretDown, CaretUp } from '@phosphor-icons/react';

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

function getGradeBgColor(grade: string): string {
    const gradeNum = parseFloat(grade);
    if (gradeNum >= 10) return 'bg-yellow-500/20 border-yellow-500/30';
    if (gradeNum >= 9) return 'bg-emerald-500/20 border-emerald-500/30';
    if (gradeNum >= 8) return 'bg-blue-500/20 border-blue-500/30';
    return 'bg-gray-500/20 border-gray-500/30';
}

export function PSAGradedPrices({ productId, productName, isScanned = false }: PsaGradedPricesProps) {
    const [psaPrices, setPsaPrices] = useState<PsaPrice[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [isExpanded, setIsExpanded] = useState(true);

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
                    `limit=20`;

                const response = await fetch(url, {
                    headers: { 'apikey': SUPABASE_KEY }
                });

                if (!response.ok) {
                    throw new Error('Failed to fetch PSA prices');
                }

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

    // Calculate average price per grade
    const avgPriceByGrade = React.useMemo(() => {
        const avgs: { [grade: string]: number } = {};
        Object.entries(groupedPrices).forEach(([grade, prices]) => {
            const total = prices.reduce((sum, p) => sum + p.price, 0);
            avgs[grade] = Math.round(total / prices.length);
        });
        return avgs;
    }, [groupedPrices]);

    // Get lowest price per grade
    const lowestPriceByGrade = React.useMemo(() => {
        const lowest: { [grade: string]: PsaPrice } = {};
        Object.entries(groupedPrices).forEach(([grade, prices]) => {
            lowest[grade] = prices.reduce((min, p) => p.price < min.price ? p : min, prices[0]);
        });
        return lowest;
    }, [groupedPrices]);

    // Don't show if no data
    if (!isLoading && psaPrices.length === 0) {
        return null;
    }

    // Loading state
    if (isLoading) {
        return (
            <div className="mt-4 p-4 bg-white/5 rounded-xl border border-white/10">
                <div className="flex items-center gap-2 mb-3">
                    <Medal className="w-5 h-5 text-yellow-400" weight="fill" />
                    <span className="text-white font-semibold">PSA Graded Prices</span>
                </div>
                <div className="space-y-2">
                    {[1, 2, 3].map(i => (
                        <div key={i} className="h-12 bg-white/10 rounded-lg animate-pulse" />
                    ))}
                </div>
            </div>
        );
    }

    if (error) {
        return null;
    }

    if (!isScanned) {
        return (
            <div className="mt-4 p-4 lg:p-6 bg-white/5 rounded-xl border border-white/10 w-full max-w-full overflow-hidden flex flex-col items-center justify-center text-center group transition-colors hover:bg-white/10">
                <div className="w-12 h-12 rounded-full bg-orange-500/20 flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
                    <Medal className="w-6 h-6 text-orange-500" weight="fill" />
                </div>
                <h3 className="text-white font-bold text-lg">Scan to see PSA grades</h3>
                <p className="text-gray-400 text-sm mt-1 max-w-[200px]">
                    Scan this card using the camera to unlock detailed graded price history.
                </p>
            </div>
        );
    }

    const grades = Object.keys(groupedPrices).sort((a, b) => parseFloat(b) - parseFloat(a));
    const displayCount = isExpanded ? psaPrices.length : 3;

    return (
        <div className="mt-4 p-3 md:p-4 bg-white/5 rounded-xl border border-white/10 w-full max-w-full overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                    <Medal className="w-5 h-5 text-yellow-400" weight="fill" />
                    <span className="text-white font-semibold text-sm">PSA Graded Prices</span>
                    <span className="text-gray-500 text-xs">({psaPrices.length} listings)</span>
                </div>
            </div>

            {/* Grade Summary Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-3">
                {grades.slice(0, 3).map(grade => {
                    const lowest = lowestPriceByGrade[grade];
                    const count = groupedPrices[grade].length;
                    return (
                        <div
                            key={grade}
                            className={`p-2.5 sm:p-3 rounded-xl border ${getGradeBgColor(grade)} 
                                flex items-center justify-between sm:block sm:text-center w-full
                                transition-all duration-200 hover:bg-opacity-30 group/card`}
                        >
                            <div className={`text-lg font-bold ${getGradeColor(grade)}`}>
                                PSA {grade}
                            </div>
                            <div className="flex flex-col items-end sm:items-center">
                                <div className="text-white font-bold text-base sm:text-lg sm:mt-1">
                                    {formatPrice(lowest.price)}
                                </div>
                                <div className="text-gray-400 text-xs sm:mt-0.5">
                                    {count} listing{count > 1 ? 's' : ''}
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Detailed Listings (Expandable) */}
            {isExpanded && (
                <div className="space-y-2 mt-3 max-h-64 overflow-y-auto">
                    {psaPrices.slice(0, displayCount).map(psa => (
                        <a
                            key={psa.ebay_id}
                            href={psa.ebay_url || '#'}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-2.5 sm:gap-3 p-2 bg-white/5 hover:bg-white/10 rounded-lg transition-colors group w-full max-w-full overflow-hidden"
                        >
                            {/* Image */}
                            {psa.image_url && (
                                <div className="w-12 h-12 relative rounded overflow-hidden flex-shrink-0 bg-gray-800">
                                    <Image
                                        src={psa.image_url}
                                        alt={psa.name}
                                        fill
                                        className="object-contain"
                                        sizes="48px"
                                    />
                                </div>
                            )}

                            {/* Info */}
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                    <span className={`font-bold ${getGradeColor(psa.grade)}`}>
                                        PSA {psa.grade}
                                    </span>
                                    <span className="text-white font-semibold">
                                        {formatPrice(psa.price)}
                                    </span>
                                </div>
                                <div className="text-gray-400 text-xs truncate">
                                    {psa.name.slice(0, 50)}...
                                </div>
                            </div>

                            {/* Link Icon */}
                            <ArrowSquareOut className="w-4 h-4 text-gray-500 group-hover:text-white transition-colors flex-shrink-0" />
                        </a>
                    ))}
                </div>
            )}

            {/* Toggle Button */}
            <button
                onClick={() => setIsExpanded(!isExpanded)}
                className="w-full mt-3 py-2 text-sm text-gray-400 hover:text-white flex items-center justify-center gap-1 transition-colors"
            >
                {isExpanded ? (
                    <>
                        <CaretUp className="w-4 h-4" />
                        Show Less
                    </>
                ) : (
                    <>
                        <CaretDown className="w-4 h-4" />
                        View Details
                    </>
                )}
            </button>
        </div>
    );
}
