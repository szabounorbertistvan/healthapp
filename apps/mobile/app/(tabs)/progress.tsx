import { OnWeb } from "@/components/on-web";
import { useI18n } from "@/lib/i18n";

// Native screen: progress — see docs/ANDROID_PLAN.md §9 for the phase that builds it.
export default function Progress() {
  const { t } = useI18n();
  return <OnWeb title={t.mobile.tabs.progress} path="/progress" />;
}
