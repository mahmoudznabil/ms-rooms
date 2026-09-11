import { Suspense } from "react";
import CallScreen from "@/components/CallScreen";
import { Spinner } from "@/components/bits";

export const metadata = {
  title: "Call — MS-ROOMS",
  description: "Voice and video calls.",
};

export default function CallPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <CallScreen />
    </Suspense>
  );
}
