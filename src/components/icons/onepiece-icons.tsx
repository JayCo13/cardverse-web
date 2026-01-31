"use client";

import React from "react";

interface IconProps extends React.SVGProps<SVGSVGElement> {
    size?: number | string;
}

// Straw Hat (Luffy's signature)
export const StrawHatIcon: React.FC<IconProps> = ({ size = 24, className, ...props }) => (
    <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="currentColor"
        className={className}
        {...props}
    >
        <path d="M12 2C8.5 2 5.5 4 4 7H20C18.5 4 15.5 2 12 2Z" />
        <path d="M2 8C2 8 2 10 3 11C4 12 5 12 5 12H19C19 12 20 12 21 11C22 10 22 8 22 8H2Z" />
        <path d="M4 12V13C4 14 5 15 6 15H18C19 15 20 14 20 13V12" stroke="currentColor" strokeWidth="1.5" fill="none" />
        <ellipse cx="12" cy="9" rx="8" ry="2" opacity="0.3" />
    </svg>
);

// Devil Fruit Icon
export const DevilFruitIcon: React.FC<IconProps> = ({ size = 24, className, ...props }) => (
    <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="currentColor"
        className={className}
        {...props}
    >
        <path d="M12 3C12 3 10 4 9 5C8 6 7.5 7 8 8C7 8 6 9 6 10C6 12 7 13 8 14C8 15 8 16 9 17C10 18 11 19 12 20C13 19 14 18 15 17C16 16 16 15 16 14C17 13 18 12 18 10C18 9 17 8 16 8C16.5 7 16 6 15 5C14 4 12 3 12 3Z" />
        <circle cx="10" cy="10" r="1" opacity="0.6" />
        <circle cx="14" cy="10" r="1" opacity="0.6" />
        <circle cx="12" cy="13" r="1" opacity="0.6" />
        <path d="M12 3V1M9 4L7 2M15 4L17 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
    </svg>
);

// Jolly Roger (Pirate Flag)
export const JollyRogerIcon: React.FC<IconProps> = ({ size = 24, className, ...props }) => (
    <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="currentColor"
        className={className}
        {...props}
    >
        <circle cx="12" cy="10" r="7" />
        <circle cx="9" cy="9" r="1.5" fill="black" />
        <circle cx="15" cy="9" r="1.5" fill="black" />
        <path d="M8 13C8 13 10 15 12 15C14 15 16 13 16 13" stroke="black" strokeWidth="1.5" fill="none" strokeLinecap="round" />
        <path d="M5 17L8 14M19 17L16 14" strokeWidth="2" stroke="currentColor" strokeLinecap="round" />
        <path d="M5 17L3 19M19 17L21 19M3 19L5 21M21 19L19 21" strokeWidth="2" stroke="currentColor" strokeLinecap="round" />
    </svg>
);

// Anchor Icon (Luffy's arm tattoo)
export const OnePieceAnchorIcon: React.FC<IconProps> = ({ size = 24, className, ...props }) => (
    <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="currentColor"
        className={className}
        {...props}
    >
        <circle cx="12" cy="4" r="2" />
        <path d="M12 6V18" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
        <path d="M12 18C12 18 12 22 8 22C4 22 4 18 4 18" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" fill="none" />
        <path d="M12 18C12 18 12 22 16 22C20 22 20 18 20 18" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" fill="none" />
        <path d="M8 10H16" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
);

// Log Pose Icon (Navigation)
export const LogPoseIcon: React.FC<IconProps> = ({ size = 24, className, ...props }) => (
    <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="currentColor"
        className={className}
        {...props}
    >
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" fill="none" />
        <circle cx="12" cy="12" r="6" opacity="0.3" />
        <circle cx="12" cy="12" r="2" />
        <path d="M12 6V4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <path d="M12 20V18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <path d="M6 12H4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <path d="M20 12H18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <path d="M12 12L16 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
);

// Treasure Chest Icon
export const TreasureChestIcon: React.FC<IconProps> = ({ size = 24, className, ...props }) => (
    <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="currentColor"
        className={className}
        {...props}
    >
        <path d="M3 10H21V20C21 21 20 22 19 22H5C4 22 3 21 3 20V10Z" />
        <path d="M3 10C3 7 5 5 8 5H16C19 5 21 7 21 10" stroke="currentColor" strokeWidth="2" fill="none" />
        <rect x="10" y="13" width="4" height="3" rx="0.5" fill="gold" />
        <circle cx="12" cy="14.5" r="1" fill="black" opacity="0.5" />
        <path d="M2 10H22" stroke="currentColor" strokeWidth="2" />
    </svg>
);

// Berries (One Piece Currency) Icon
export const BerriesIcon: React.FC<IconProps> = ({ size = 24, className, ...props }) => (
    <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="currentColor"
        className={className}
        {...props}
    >
        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" fill="none" />
        <text x="12" y="17" textAnchor="middle" fontSize="14" fontWeight="bold" fill="currentColor">B</text>
        <path d="M7 8H17" stroke="currentColor" strokeWidth="1.5" />
        <path d="M7 16H17" stroke="currentColor" strokeWidth="1.5" />
    </svg>
);

// Wanted Poster Icon
export const WantedPosterIcon: React.FC<IconProps> = ({ size = 24, className, ...props }) => (
    <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="currentColor"
        className={className}
        {...props}
    >
        <rect x="3" y="2" width="18" height="20" rx="1" stroke="currentColor" strokeWidth="2" fill="none" />
        <rect x="6" y="6" width="12" height="8" rx="0.5" opacity="0.3" />
        <path d="M6 17H18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <path d="M6 19H14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <text x="12" y="5" textAnchor="middle" fontSize="3" fontWeight="bold" fill="currentColor">WANTED</text>
    </svg>
);

// Den Den Mushi (Snail Phone) Icon
export const DenDenMushiIcon: React.FC<IconProps> = ({ size = 24, className, ...props }) => (
    <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="currentColor"
        className={className}
        {...props}
    >
        <ellipse cx="12" cy="14" rx="7" ry="5" />
        <circle cx="9" cy="8" r="2" opacity="0.8" />
        <circle cx="15" cy="8" r="2" opacity="0.8" />
        <path d="M9 8C9 8 8 4 9 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" />
        <path d="M15 8C15 8 16 4 15 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" />
        <circle cx="9" cy="3" r="1" />
        <circle cx="15" cy="3" r="1" />
        <ellipse cx="10" cy="14" rx="1" ry="0.7" fill="black" opacity="0.5" />
        <ellipse cx="14" cy="14" rx="1" ry="0.7" fill="black" opacity="0.5" />
        <path d="M11 16C11 16 12 17 13 16" stroke="black" strokeWidth="0.8" fill="none" opacity="0.5" />
    </svg>
);

// Grand Line Icon (Wavy path)
export const GrandLineIcon: React.FC<IconProps> = ({ size = 24, className, ...props }) => (
    <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        className={className}
        {...props}
    >
        <path d="M2 12C4 8 6 16 8 12C10 8 12 16 14 12C16 8 18 16 20 12C22 8 22 12 22 12" />
        <circle cx="4" cy="12" r="1" fill="currentColor" />
        <circle cx="12" cy="12" r="1.5" fill="currentColor" />
        <circle cx="20" cy="12" r="1" fill="currentColor" />
    </svg>
);

export default {
    StrawHatIcon,
    DevilFruitIcon,
    JollyRogerIcon,
    OnePieceAnchorIcon,
    LogPoseIcon,
    TreasureChestIcon,
    BerriesIcon,
    WantedPosterIcon,
    DenDenMushiIcon,
    GrandLineIcon,
};
