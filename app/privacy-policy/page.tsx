import type { Metadata } from "next";
import LegalReader from "@/components/LegalReader";

/**
 * Kept as a route because inbound links already point here, but no longer holds
 * its own copy of the text.
 *
 * The page this replaces was written by hand and had drifted into contradicting
 * the product: it told readers that coins were "earned-only… there is no web
 * checkout" after coin packs shipped, named two different contact addresses
 * from the ones in the terms, and was English-only where the law requires
 * Arabic. Two independent copies of the same commitments is the defect, not the
 * one copy that happened to be out of date.
 *
 * It now renders from `lib/legal-documents.ts` — the same source a customer's
 * consent record points at — so there is one set of words and it cannot diverge.
 */
export const metadata: Metadata = {
  title: "Privacy Policy · MS-ROOMS",
  description: "How MS-ROOMS collects, uses, and deletes your data.",
  alternates: { canonical: "/legal#privacy" },
};

export default function PrivacyPolicyPage() {
  return <LegalReader only="privacy" />;
}