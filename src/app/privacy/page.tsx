"use client";

import { LegalDocument } from "@/components/legal-document";
import { PRIVACY_SECTIONS } from "@/lib/legal";

export default function PrivacyPage() {
  return (
    <LegalDocument
      titleKey="page_privacy_title"
      introKey="privacy_intro"
      updatedKey="privacy_last_updated"
      sections={PRIVACY_SECTIONS}
      currentHref="/privacy"
    />
  );
}
