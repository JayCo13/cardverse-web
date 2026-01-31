"use client";

import { useLocalization } from "@/context/localization-context";
import { TrendingUp, MoreHorizontal, Search } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export function RightPanel() {
    const { t } = useLocalization();

    return (
        <div className="hidden xl:flex flex-col w-80 fixed right-0 top-16 bottom-0 p-4 overflow-y-auto border-l border-white/5 bg-black/20 backdrop-blur-sm">
            <div className="mb-6 relative">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                    placeholder={t('search_forum') || "Search forum..."}
                    className="pl-9 bg-white/5 border-white/10 rounded-full focus-visible:ring-primary/50"
                />
            </div>

            <Card className="bg-[#1a1b1e] border-white/5 mb-6">
                <CardHeader className="flex flex-row items-center justify-between p-4 pb-2">
                    <CardTitle className="text-sm font-bold text-gray-200">{t('trends_for_you') || 'Trends for you'}</CardTitle>
                </CardHeader>
                <CardContent className="p-4">
                    <p className="text-xs text-muted-foreground italic">{t('coming_soon') || 'Coming soon...'}</p>
                </CardContent>
            </Card>

            <div className="text-xs text-muted-foreground space-y-2 px-1">
                <p>
                    <span className="font-semibold text-gray-400">Reputation System:</span> You need 90% legit rate to post. Keep trading cleanly to maintain access!
                </p>
            </div>
        </div>
    );
}
