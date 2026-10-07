"use client";

import { useEffect } from "react";
import { initTelemetry } from "@/lib/telemetry";

/** Installs global error/unhandled-rejection reporting once per page load. */
export default function Telemetry() {
  useEffect(() => {
    initTelemetry();
  }, []);
  return null;
}
