import { MedicalImageResult } from '../types/deck';

/**
 * Synthetic SVG generation has been permanently disabled.
 * All medical images must be fetched from real, verified internet sources
 * (Google Search Grounding / LITFL / Radiopaedia / Wikimedia Commons / Wikipedia / Open-i)
 * or provided directly by the user via URL / upload.
 */
export const HIGH_PRECISION_MEDICAL_ATLAS: MedicalImageResult[] = [];

export function matchMedicalAtlasImages(_queryText: string): MedicalImageResult[] {
  return [];
}
