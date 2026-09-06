"use client";

import { LegalDocument } from "@/components/legal-document";
import { TERMS_SECTIONS } from "@/lib/legal";

export default function TermsPage() {
  return (
    <LegalDocument
      titleKey="page_terms_title"
      introKey="terms_intro"
      updatedKey="terms_last_updated"
      sections={TERMS_SECTIONS}
      currentHref="/terms"
    />
  );
}
