export type AnalyticsConsent = "unknown" | "accepted" | "necessary";

const storageKey = "site-analytics-consent";

export function useAnalyticsConsent() {
  const consent = useState<AnalyticsConsent>(
    "site-analytics-consent",
    () => "unknown",
  );
  const settingsOpen = useState(
    "site-analytics-settings-open",
    () => true,
  );

  function initializeConsent() {
    try {
      const saved = localStorage.getItem(storageKey);
      consent.value =
        saved === "accepted" || saved === "necessary" ? saved : "unknown";
    } catch (error) {
      console.error("Не удалось прочитать настройки cookie.", error);
      consent.value = "unknown";
    }
    settingsOpen.value = consent.value === "unknown";
  }

  function setConsent(value: Exclude<AnalyticsConsent, "unknown">) {
    const wasAccepted = consent.value === "accepted";
    try {
      localStorage.setItem(storageKey, value);
    } catch (error) {
      console.error("Не удалось сохранить настройки cookie.", error);
    }
    consent.value = value;
    settingsOpen.value = false;
    if (wasAccepted && value !== "accepted") window.location.reload();
  }

  function openSettings() {
    settingsOpen.value = true;
  }

  return { consent, settingsOpen, initializeConsent, setConsent, openSettings };
}
