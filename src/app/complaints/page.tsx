"use client";

import { LegalDocument } from "@/components/legal-document";
import { COMPLAINTS_SECTIONS } from "@/lib/legal";

export default function ComplaintsPage() {
  return (
    <LegalDocument
      titleKey="page_complaints_title"
      introKey="complaints_intro"
      updatedKey="complaints_last_updated"
      sections={COMPLAINTS_SECTIONS}
      currentHref="/complaints"
    />
  );
}
