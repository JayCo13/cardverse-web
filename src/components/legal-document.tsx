"use client";

import Link from "next/link";
import { useLocalization } from "@/context/localization-context";
import type { TranslationKey } from "@/lib/i18n";
import { LEGAL_LAST_UPDATED, LEGAL_PAGES, type LegalSection } from "@/lib/legal";

/**
 * Shared shell for the three legal documents (terms, privacy, complaints).
 *
 * The pages were three copies of the same markup with the section list inlined,
 * so adding a section meant editing JSX. Here the section list is data and the
 * copy lives entirely in `src/lib/i18n/*.ts`.
 *
 * Note there is no nested `next-themes` ThemeProvider. The old terms and privacy
 * pages each mounted one with `defaultTheme="system" enableSystem`, which takes
 * over the `class` on <html> — the root layout hard-codes `className="dark"`, so
 * on a machine set to light those two pages alone dropped out of the dark theme.
 */
export function LegalDocument({
  titleKey,
  introKey,
  updatedKey,
  sections,
  currentHref,
}: {
  titleKey: TranslationKey;
  introKey: TranslationKey;
  updatedKey: TranslationKey;
  sections: LegalSection[];
  currentHref: string;
}) {
  const { t, locale } = useLocalization();

  // `locale` is the app language tag (vi-VN / en-US / ja-JP), which is exactly
  // what toLocaleDateString wants, so the date reads the way the rest of the
  // page does rather than following the browser.
  const updatedOn = new Date(`${LEGAL_LAST_UPDATED}T00:00:00`).toLocaleDateString(locale);

  return (
    <div className="flex flex-1 flex-col bg-background">
      <main className="flex-1">
        <div className="container mx-auto px-4 py-16">
          <div className="mx-auto max-w-4xl space-y-12">
            <div className="space-y-4">
              <h1 className="text-4xl font-bold tracking-tight md:text-5xl">{t(titleKey)}</h1>
              <p className="text-lg leading-relaxed text-muted-foreground md:text-xl">
                {t(introKey)}
              </p>
              <p className="text-sm text-muted-foreground/80">
                {t(updatedKey)} {updatedOn}
              </p>

              {/* A reader who lands on one document usually needs the other two:
                  the terms point at the complaint mechanism for deadlines, and
                  the complaint page points back for the fee and escrow rules. */}
              <nav className="flex flex-wrap gap-2 pt-2">
                {LEGAL_PAGES.map((page) =>
                  page.href === currentHref ? (
                    <span
                      key={page.href}
                      aria-current="page"
                      className="rounded-full border border-border bg-card px-3 py-1 text-sm font-medium"
                    >
                      {t(page.label)}
                    </span>
                  ) : (
                    <Link
                      key={page.href}
                      href={page.href}
                      className="rounded-full border border-border px-3 py-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
                    >
                      {t(page.label)}
                    </Link>
                  ),
                )}
              </nav>
            </div>

            <div className="max-w-none space-y-8">
              {sections.map((section) => (
                <section key={section.title} className="space-y-3">
                  <h2 className="text-2xl font-semibold">{t(section.title)}</h2>
                  <p className="whitespace-pre-line leading-relaxed text-muted-foreground">
                    {t(section.desc)}
                  </p>
                </section>
              ))}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
