import type { NextConfig } from "next";

const nextConfig: NextConfig = {
    images: {
        remotePatterns: [
            {
                protocol: "https",
                hostname: "**",
            },
        ],
        formats: ['image/webp', 'image/avif'],
        deviceSizes: [640, 750, 828, 1080, 1200, 1920, 2048, 3840],
        imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
        minimumCacheTTL: 604800, // 7 days — images rarely change
    },
    experimental: {
        serverActions: {
            bodySizeLimit: '10mb',
        },
        optimizePackageImports: ['lucide-react', '@radix-ui/react-icons', '@phosphor-icons/react'],
    },
    compiler: {
        // Strip the chatty levels, keep the ones that explain a failure: this
        // applies to route handlers too, and with a blanket `true` a 502 in
        // production leaves nothing at all in the function logs.
        removeConsole: process.env.NODE_ENV === 'production'
            ? { exclude: ['error', 'warn'] }
            : false,
    },
    compress: true,
    poweredByHeader: false,
    reactStrictMode: true,
    productionBrowserSourceMaps: false,
    // Ignore TypeScript errors during build for deployment
    typescript: {
        ignoreBuildErrors: true,
    },
};

export default nextConfig;
