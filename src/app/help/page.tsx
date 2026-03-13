"use client";

import React, { useState } from 'react';
import { Footer } from "@/components/layout/footer";
import { Header } from "@/components/layout/header";
import { ThemeProvider } from "next-themes";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Search, Mail } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useLocalization } from "@/context/localization-context";
import { Card } from "@/components/ui/card";
import Link from "next/link";

export default function HelpCenterPage() {
  const { t } = useLocalization();
  const [searchQuery, setSearchQuery] = useState('');

  // Define FAQs using translation keys
  const faqs = [
    {
      question: t('help_faq_1_q'),
      answer: t('help_faq_1_a'),
    },
    {
      question: t('help_faq_2_q'),
      answer: t('help_faq_2_a'),
    },
    {
      question: t('help_faq_3_q'),
      answer: t('help_faq_3_a'),
    },
    {
      question: t('help_faq_4_q'),
      answer: t('help_faq_4_a'),
    },
    {
      question: t('help_faq_5_q'),
      answer: t('help_faq_5_a'),
    },
    {
      question: t('help_faq_6_q'),
      answer: t('help_faq_6_a'),
    },
    {
      question: t('help_faq_7_q'),
      answer: t('help_faq_7_a'),
    },
    {
      question: t('help_faq_8_q'),
      answer: t('help_faq_8_a'),
    },
    {
      question: t('help_faq_9_q'),
      answer: t('help_faq_9_a'),
    },
    {
      question: t('help_faq_11_q'),
      answer: t('help_faq_11_a'),
    },
    {
      question: t('help_faq_12_q'),
      answer: t('help_faq_12_a'),
    },
    {
      question: t('help_faq_13_q'),
      answer: t('help_faq_13_a'),
    },
    {
      question: t('help_faq_14_q'),
      answer: t('help_faq_14_a'),
    },
    {
      question: t('help_faq_15_q'),
      answer: t('help_faq_15_a'),
    },
  ];

  const filteredFaqs = faqs.filter(
    (faq) =>
      faq.question.toLowerCase().includes(searchQuery.toLowerCase()) ||
      faq.answer.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <div className="flex min-h-screen flex-col bg-background">
        <Header />
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
                <Accordion type="single" collapsible className="w-full">
                  {filteredFaqs.map((faq, index) => (
                    <AccordionItem key={index} value={`item-${index}`}>
                      <AccordionTrigger className="text-left font-medium text-lg">{faq.question}</AccordionTrigger>
                      <AccordionContent className="text-muted-foreground text-base">
                        {faq.answer}
                      </AccordionContent>
                    </AccordionItem>
                  ))}
                </Accordion>
              </div>

            </div>
          </div>
        </main>
        <Footer />
      </div>
    </ThemeProvider>
  );
}
