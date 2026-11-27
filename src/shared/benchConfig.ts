export type SupportedLocale = 'en' | 'zh-HK';
export type PresetIndex = 1 | 2 | 3 | 4 | 5;
export type ViewMode = 'bench' | 'schematic';

export const DEFAULT_SEED_U64 = 4201n;
export const MASK_64 = 0xFFFF_FFFF_FFFF_FFFFn;
export const GOLDEN_GAMMA = 0x9E37_79B9_7F4A_7C15n;
export const STAR_MULT = 0x2545_F491_4F6C_DD1Dn;
const INV_2_POW_53 = 1.0 / 9007199254740992.0; // 2^-53

/**
 * Bit-exact port of collima/crates/collima-core/src/synthetic.rs:7-35
 * with explicit zero-lock guard when seed === 0x9E3779B97F4A7C15n (11400714819323198485).
 */
export class Rng64 {
  private s: bigint;

  constructor(seed: bigint | number = DEFAULT_SEED_U64) {
    const cleanSeed =
      typeof seed === 'bigint' ? seed & MASK_64 : BigInt(Math.trunc(seed)) & MASK_64;
    const raw = cleanSeed ^ GOLDEN_GAMMA;
    this.s = raw === 0n ? GOLDEN_GAMMA : raw;
  }

  getState(): bigint {
    return this.s;
  }

  setState(state: bigint): void {
    const masked = state & MASK_64;
    this.s = masked === 0n ? GOLDEN_GAMMA : masked;
  }

  clone(): Rng64 {
    const copy = new Rng64(DEFAULT_SEED_U64);
    copy.setState(this.s);
    return copy;
  }

  nextU64(): bigint {
    let x = this.s;
    x = (x ^ (x >> 12n)) & MASK_64;
    x = (x ^ ((x << 25n) & MASK_64)) & MASK_64;
    x = (x ^ (x >> 27n)) & MASK_64;
    this.s = x;
    return (x * STAR_MULT) & MASK_64;
  }

  nextF64(): number {
    return Number(this.nextU64() >> 11n) * INV_2_POW_53;
  }

  range(min: number, max: number): number {
    return min + (max - min) * this.nextF64();
  }

  normal(): number {
    const u1 = Math.max(this.nextF64(), 1e-12);
    const u2 = this.nextF64();
    return Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(Math.PI * 2.0 * u2);
  }
}

export function parseLocaleParam(raw: string | null | undefined): SupportedLocale {
  if (!raw) return 'en';
  const norm = raw.trim().toLowerCase();
  if (
    norm === 'zh-hk' ||
    norm === 'zh-tw' ||
    norm === 'zh-hant' ||
    norm === 'hk' ||
    norm === 'zh'
  ) {
    return 'zh-HK';
  }
  return 'en';
}

/**
 * Parses decimal or 0x-prefixed hex u64 seed.
 * Rejects empty, negative, non-integer, or garbage inputs back to DEFAULT_SEED_U64 (4201n); masks non-negative BigInts with & 0xFFFFFFFFFFFFFFFFn.
 */
export function parseSeedU64(raw: string | null | undefined): bigint {
  if (raw == null) return DEFAULT_SEED_U64;
  const trimmed = raw.trim();
  if (trimmed === '' || trimmed.startsWith('-')) return DEFAULT_SEED_U64;
  if (!/^(?:0[xX][0-9a-fA-F]+|\d+)$/.test(trimmed)) return DEFAULT_SEED_U64;
  try {
    const val = BigInt(trimmed);
    if (val < 0n) return DEFAULT_SEED_U64;
    return val & MASK_64;
  } catch {
    return DEFAULT_SEED_U64;
  }
}

export function parsePresetIndex(raw: string | null | undefined): PresetIndex {
  if (raw == null || raw.trim() === '') return 1;
  const n = Number(raw.trim());
  if (!Number.isFinite(n) || Number.isNaN(n)) return 1;
  const clamped = Math.min(5, Math.max(1, Math.trunc(n)));
  return clamped as PresetIndex;
}

export function parsePrintFlag(raw: string | null | undefined): boolean {
  if (!raw) return false;
  const norm = raw.trim().toLowerCase();
  return norm === '1' || norm === 'true' || norm === 'yes' || norm === 'on';
}

export function parseHudPinnedFlag(raw: string | null | undefined): boolean {
  if (!raw) return false;
  const norm = raw.trim().toLowerCase();
  return norm === 'pin' || norm === 'pinned';
}

export interface BootUrlConfig {
  lang: SupportedLocale;
  seed: bigint;
  seedString: string;
  preset: PresetIndex;
  printMode: boolean;
  viewMode: ViewMode;
  hudPinned: boolean;
}

export function parseBootUrlConfig(search: string = typeof window !== 'undefined' ? window.location.search : ''): BootUrlConfig {
  const params = new URLSearchParams(search);
  const lang = parseLocaleParam(params.get('lang'));
  const seed = parseSeedU64(params.get('seed'));
  const preset = parsePresetIndex(params.get('preset'));
  const printMode = parsePrintFlag(params.get('print'));
  const rawMode = (params.get('mode') ?? '').trim().toLowerCase();
  const viewMode: ViewMode = printMode || rawMode === 'schematic' ? 'schematic' : 'bench';
  const hudPinned = parseHudPinnedFlag(params.get('hud'));
  return {
    lang,
    seed,
    seedString: seed.toString(10),
    preset,
    printMode,
    viewMode,
    hudPinned,
  };
}

/**
 * Resolves AudioWorklet module URL cleanly at both '/' and '/caustic-collimation/?lang=en'.
 */
export function resolveWorkletUrl(workletFileName: string): string {
  const cleanName = workletFileName.replace(/^\/+/, '');
  const baseUrl =
    typeof import.meta.env !== 'undefined' && typeof import.meta.env.BASE_URL === 'string'
      ? import.meta.env.BASE_URL
      : './';
  const rawRelative = `${baseUrl}worklets/${cleanName}`;
  return new URL(rawRelative, document.baseURI).href;
}

export const ARCHIVAL_LITHO_PALETTE = {
  PAPER_LITHO_ALABASTER_HEX: '#F6F4EF',
  PAPER_LITHO_ALABASTER_RGB: [0.9647, 0.9569, 0.9373] as const,
  PAPER_ALABASTER_LIN: [0.921582, 0.904661, 0.863157] as const,
  INK_PINE_SOOT_HEX: '#141619',
  INK_PINE_SOOT_RGB: [0.0784, 0.0863, 0.0980] as const,
  SIGMA_PINE_SOOT: [4.88084, 4.72522, 4.48629] as const,
  INK_PRUSSIAN_BLUE_HEX: '#1B3B5F',
  INK_PRUSSIAN_BLUE_RGB: [0.1059, 0.2314, 0.3725] as const,
  SIGMA_PRUSSIAN_BLUE: [4.43183, 3.02941, 2.02059] as const,
  INK_CINNABAR_HEX: '#C83E2B',
  INK_CINNABAR_RGB: [0.7843, 0.2431, 0.1686] as const,
  SIGMA_CINNABAR: [0.46724, 2.93279, 3.57600] as const,
  INK_MINERAL_OCHRE_HEX: '#9E6B2B',
  INK_MINERAL_OCHRE_RGB: [0.6196, 0.4196, 0.1686] as const,
  SIGMA_MINERAL_OCHRE: [0.99153, 1.81694, 3.57600] as const,
} as const;
