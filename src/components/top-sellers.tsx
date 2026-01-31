
"use client";

import Image from "next/image";
import { sellers } from "@/lib/sellers";
import { useLocalization } from "@/context/localization-context";
import { Card } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { Trophy } from "lucide-react";

export function TopSellers() {
  const { t, locale } = useLocalization();

  return (
    <section id="top-sellers" className="py-16 md:py-24 bg-transparent">
      <div className="container mx-auto px-4">
        <div className="flex justify-center items-center gap-4 mb-12 glowing-text">
          <Trophy className="h-8 w-8" />
          <h2 className="text-3xl md:text-4xl font-bold text-center" style={{ fontFamily: "'Quantico', sans-serif" }}>
            {t('top_sellers_title')}
          </h2>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 md:gap-6">
          {sellers.map((seller) => (
            <div
              key={seller.id}
              className="group transition-all duration-300 hover:shadow-xl hover:-translate-y-1"
            >
              <Card className="flex items-center p-3 space-x-4 bg-card/50 hover:bg-muted/50 transition-colors">
                <Avatar className="h-12 w-12 border-2 border-primary/50">
                  <AvatarImage src={seller.avatar} alt={seller.name} data-ai-hint={seller.imageHint} />
                  <AvatarFallback>{seller.name.charAt(0)}</AvatarFallback>
                </Avatar>
                <div className="overflow-hidden">
                  <p className="font-semibold truncate">{seller.name}</p>
                  <p className="text-sm text-muted-foreground">{seller.sales} ETH</p>
                </div>
              </Card>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
