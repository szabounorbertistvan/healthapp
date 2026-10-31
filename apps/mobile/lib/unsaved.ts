import { usePreventRemove } from "expo-router";
import { useState } from "react";
import { Alert } from "react-native";
import { useI18n } from "./i18n";

/**
 * While `dirty`, leaving the screen — Android's Back, the back link, a swipe —
 * first asks whether to throw away what was typed. Keep editing stays; Discard
 * lets the same navigation through.
 */
export function useConfirmLeave(dirty: boolean): void {
  const { t } = useI18n();
  const u = t.mobile.unsaved;
  // Discard turns the prevention off in the same handler that repeats the navigation (the hook's contract)
  const [discarded, setDiscarded] = useState(false);
  usePreventRemove(dirty && !discarded, ({ repeat }) => {
    Alert.alert(u.title, u.body, [
      { text: u.keep, style: "cancel" },
      { text: u.discard, style: "destructive", onPress: () => { setDiscarded(true); repeat(); } },
    ]);
  });
}
