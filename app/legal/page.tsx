import type { Metadata } from "next";
import LegalReader from "@/components/LegalReader";

/**
 * All three legal documents, publicly readable and bilingual.
 *
 * Reachable without signing in, which is the point: someone deciding whether to
 * register has to be able to read what they would be agreeing to first, and
 * Egyptian consumer law expects consumer-facing documents to be available
 * before a transaction rather than after.
 */
export const metadata: Metadata = {
  title: "Terms & Policies · MS-ROOMS",
  description:
    "MS-ROOMS Terms of Service, Privacy Policy and Community Guidelines, in English and Arabic.",
};

export default function LegalPage() {
  return <LegalReader />;
}