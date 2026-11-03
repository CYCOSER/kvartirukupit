export type AdminExclusions = { text: string; values: Record<string, string[]> };
export type AdminExclusionField = {
  key: string;
  label: string;
  options: { value: string; label: string }[];
};

export const emptyAdminExclusions = (): AdminExclusions => ({ text: '', values: {} });

export function matchesAdminExclusions(
  exclusions: AdminExclusions,
  text: string,
  values: Record<string, string | null | undefined>,
): boolean {
  const normalized = text.toLocaleLowerCase('ru');
  const phrases = exclusions.text.toLocaleLowerCase('ru').split(/[;\r\n]+/).map(value => value.trim()).filter(Boolean);
  return !phrases.some(phrase => normalized.includes(phrase)) &&
    !Object.entries(exclusions.values).some(([key, excluded]) =>
      values[key] != null && excluded.includes(values[key]!),
    );
}
