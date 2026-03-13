"use client";

import { useLocalization } from "@/context/localization-context";
import { Footer } from "@/components/layout/footer";
import { Header } from "@/components/layout/header";
import { ThemeProvider } from "next-themes";

export default function TermsPage() {
  const { t } = useLocalization();

  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <div className="flex min-h-screen flex-col bg-background">
        <Header />
        <main className="flex-1">
          <div className="container mx-auto px-4 py-16">
            <div className="max-w-4xl mx-auto space-y-12">
              <div className="space-y-4">
                <h1 className="text-4xl md:text-5xl font-bold tracking-tight">
                  {t('page_terms_title')}
                </h1>
                <p className="text-xl text-muted-foreground">
                  {t('terms_last_updated')} {new Date().toLocaleDateString()}
                </p>
              </div>

              <div className="prose prose-neutral dark:prose-invert max-w-none space-y-8">
                <section>
                  <h2 className="text-2xl font-semibold mb-4">{t('terms_section_1_title')}</h2>
                  <p className="text-muted-foreground leading-relaxed whitespace-pre-line">
                    {t('terms_section_1_desc')}
                  </p>
                </section>

                <section>
                  <h2 className="text-2xl font-semibold mb-4">{t('terms_section_2_title')}</h2>
                  <p className="text-muted-foreground leading-relaxed whitespace-pre-line mb-4">
                    {t('terms_section_2_desc')}
                  </p>
                </section>

                <section>
                  <h2 className="text-2xl font-semibold mb-4">{t('terms_section_3_title')}</h2>
                  <p className="text-muted-foreground leading-relaxed whitespace-pre-line mb-4">
                    {t('terms_section_3_desc')}
                  </p>
                </section>

                <section>
                  <h2 className="text-2xl font-semibold mb-4">{t('terms_section_4_title')}</h2>
                  <p className="text-muted-foreground leading-relaxed whitespace-pre-line mb-4">
                    {t('terms_section_4_desc')}
                  </p>
                </section>

                <section>
                  <h2 className="text-2xl font-semibold mb-4">{t('terms_section_5_title')}</h2>
                  <p className="text-muted-foreground leading-relaxed whitespace-pre-line mb-4">
                    {t('terms_section_5_desc')}
                  </p>
                </section>

                <section>
                  <h2 className="text-2xl font-semibold mb-4">{t('terms_section_6_title')}</h2>
                  <p className="text-muted-foreground leading-relaxed whitespace-pre-line">
                    {t('terms_section_6_desc')}
                  </p>
                </section>
                
                <section>
                  <h2 className="text-2xl font-semibold mb-4">{t('terms_section_7_title')}</h2>
                  <p className="text-muted-foreground leading-relaxed whitespace-pre-line">
                    {t('terms_section_7_desc')}
                  </p>
                </section>
              </div>

            </div>
          </div>
        </main>
        <Footer />
      </div>
    </ThemeProvider>
  );
}
