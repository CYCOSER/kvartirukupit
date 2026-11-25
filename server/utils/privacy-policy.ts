import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';

const DATA_DIR = join(process.cwd(), '.data');
const PRIVACY_VERSION_FILE = join(DATA_DIR, 'privacy-version.json');
const DEFAULT_VERSION = '2026-11-17';

export interface PrivacyPolicyVersion {
  version: string;
  effectiveAt: string;
  summary?: string;
  updatedBy?: string;
  updatedByName?: string;
}

export async function getPrivacyPolicyVersion(): Promise<PrivacyPolicyVersion> {
  try {
    const raw = await readFile(PRIVACY_VERSION_FILE, 'utf-8');
    return JSON.parse(raw) as PrivacyPolicyVersion;
  } catch {
    return { version: DEFAULT_VERSION, effectiveAt: new Date().toISOString() };
  }
}

export async function setPrivacyPolicyVersion(
  input: Partial<PrivacyPolicyVersion>,
  updatedBy: string,
  updatedByName: string,
): Promise<PrivacyPolicyVersion> {
  await mkdir(dirname(PRIVACY_VERSION_FILE), { recursive: true });
  const current = await getPrivacyPolicyVersion();
  const next: PrivacyPolicyVersion = {
    version: input.version || current.version,
    effectiveAt: input.effectiveAt || new Date().toISOString(),
    summary: input.summary,
    updatedBy,
    updatedByName,
  };
  await writeFile(PRIVACY_VERSION_FILE, JSON.stringify(next, null, 2), 'utf-8');
  return next;
}