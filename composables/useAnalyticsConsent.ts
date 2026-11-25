export type AnalyticsConsent = "unknown" | "accepted" | "necessary";

export interface PrivacyPolicyVersionInfo {
  version: string;
  effectiveAt: string;
}

const storageKey = "site-analytics-consent";
const consentVersionKey = "site-analytics-consent-version";

export function useAnalyticsConsent() {
  const consent = useState<AnalyticsConsent>(
    "site-analytics-consent",
    () => "unknown",
  );
  const settingsOpen = useState(
    "site-analytics-settings-open",
    () => true,
  );
  const policyVersion = useState<string>(
    "site-analytics-policy-version",
    () => "",
  );
  const needsConsent = useState<boolean>("site-needs-consent", () => false);
  const serverVersion = useState<PrivacyPolicyVersionInfo | null>(
    "site-server-policy-version",
    () => null,
  );

  function initializeConsent() {
    try {
      const saved = localStorage.getItem(storageKey);
      const savedVersion = localStorage.getItem(consentVersionKey);
      consent.value =
        saved === "accepted" || saved === "necessary" ? saved : "unknown";
      policyVersion.value = savedVersion || "";
      settingsOpen.value = consent.value === "unknown";
    } catch (error) {
      console.error("Не удалось прочитать настройки cookie.", error);
      consent.value = "unknown";
      settingsOpen.value = true;
    }
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
    needsConsent.value = false;
    if (wasAccepted && value !== "accepted") window.location.reload();
  }

  function resetConsent() {
    try {
      localStorage.removeItem(storageKey);
      localStorage.removeItem(consentVersionKey);
    } catch (error) {
      console.error("Не удалось сбросить настройки cookie.", error);
    }
    consent.value = "unknown";
    policyVersion.value = "";
    settingsOpen.value = true;
    needsConsent.value = true;
  }

  function markConsentGiven(version: string) {
    try {
      localStorage.setItem(consentVersionKey, version);
    } catch (error) {
      console.error("Не удалось сохранить версию согласия.", error);
    }
    policyVersion.value = version;
  }

  function acceptConsent(version: string) {
    markConsentGiven(version);
    setConsent("accepted");
    needsConsent.value = false;
  }

  function rejectConsent(version: string) {
    markConsentGiven(version);
    setConsent("necessary");
    needsConsent.value = false;
  }

  function checkConsent() {
    const current = serverVersion.value?.version;
    if (!current) return;

    if (consent.value === "unknown") {
      needsConsent.value = true;
      return;
    }
    if (policyVersion.value && policyVersion.value !== current) {
      resetConsent();
      return;
    }
    if (!policyVersion.value) {
      markConsentGiven(current);
    }
    needsConsent.value = false;
  }

  function openSettings() {
    settingsOpen.value = true;
  }

  return {
    consent,
    settingsOpen,
    policyVersion,
    needsConsent,
    serverVersion,
    initializeConsent,
    setConsent,
    resetConsent,
    markConsentGiven,
    acceptConsent,
    rejectConsent,
    checkConsent,
    openSettings,
  };
}