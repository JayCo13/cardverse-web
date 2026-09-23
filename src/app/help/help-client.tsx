"use client";

import React, { useState } from 'react';
import { Search, Mail } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useLocalization } from "@/context/localization-context";
import { Card } from "@/components/ui/card";
import Link from "next/link";
import { JsonLd, faqJsonLd } from '@/lib/seo/jsonld';
import { helpFaqs } from './faqs';

export default function HelpClient() {
  const { locale, t } = useLocalization();
  const [searchQuery, setSearchQuery] = useState('');

  const faqs = helpFaqs(t);

  const filteredFaqs = faqs.filter(
    (faq) =>
      faq.question.toLowerCase().includes(searchQuery.toLowerCase()) ||
      faq.answer.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <>
      <JsonLd key={locale} data={faqJsonLd(faqs)} />
      <div className="flex flex-1 flex-col bg-background">
        <main className="flex-1">
          <div className="container mx-auto px-4 py-16">
            <div className="max-w-3xl mx-auto space-y-12">
              <div className="text-center space-y-6">
                <h1 className="text-4xl font-bold tracking-tight mb-4">
                  {t('page_help_title')}
                </h1>
                <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
                  {t('page_help_desc')}
                </p>
              </div>

              {/* Support Cards Section */}
              <div className="flex justify-center mb-12 max-w-sm mx-auto">
                {/* Email Support Card */}
                <Link href="/contact" className="block group w-full">
                  <Card className="p-6 h-full border-border/50 bg-background/50 hover:bg-muted/50 transition-colors backdrop-blur-sm shadow-sm dark:shadow-none">
                    <div className="flex flex-col items-center text-center space-y-4">
                      <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center text-primary group-hover:scale-110 transition-transform">
                        <Mail className="h-6 w-6" />
                      </div>
                      <div>
                        <h3 className="text-lg font-semibold">{t('contact_get_in_touch')}</h3>
                        <p className="text-sm text-muted-foreground mt-1">
                          {t('contact_email_value')}
                        </p>
                      </div>
                    </div>
                  </Card>
                </Link>
              </div>

              {/* Search */}
              <div className="max-w-xl mx-auto mb-12 relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                <Input
                  className="pl-10 h-12 text-lg bg-background"
                  placeholder={t('help_search_placeholder')}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>

              {/* FAQs */}
              <div className="max-w-3xl mx-auto mb-16">
                <h2 className="text-2xl font-semibold mb-6 text-center">
                  {t('help_faq_title')}
                </h2>
                <div className="w-full">
                  {filteredFaqs.map((faq, index) => (
                    <details key={index} open className="group border-b border-border py-4">
                      <summary className="cursor-pointer text-left font-medium text-lg">{faq.question}</summary>
                      <p className="mt-3 text-muted-foreground text-base">{faq.answer}</p>
                    </details>
                  ))}
                </div>
              </div>

            </div>
          </div>
        </main>
      </div>
    </>
  );
}
