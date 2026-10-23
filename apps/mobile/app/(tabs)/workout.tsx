import { OnWeb } from "@/components/on-web";
import { useI18n } from "@/lib/i18n";

// Native screen: workout — see docs/ANDROID_PLAN.md §9 for the phase that builds it.
export default function Workout() {
  const { t } = useI18n();
  return <OnWeb title={t.mobile.tabs.workout} path="/workout" />;
}
