import { useMemo } from "react";
import type { HoverTerms } from "./previewTypes";

type HighlightSpan = { before: string; match: string; after: string };

function extendWithModifiers(lower: string, end: number, modifierTexts?: string[]): number {
  if (!modifierTexts || modifierTexts.length === 0) return end;
  let extendedEnd = end;
  for (const modText of modifierTexts) {
    const modLower = modText.toLowerCase();

    const searchStart = extendedEnd;
    const searchRegion = lower.slice(searchStart, searchStart + modLower.length + 5);
    const modIdx = searchRegion.indexOf(modLower);
    if (modIdx !== -1) {
      extendedEnd = searchStart + modIdx + modLower.length;
    }
  }
  return extendedEnd;
}

export function useHighlightedText(
  extractedInputText: string,
  hoveredTerms: HoverTerms | null,
): HighlightSpan | null {
  return useMemo(() => {
    if (!extractedInputText || !hoveredTerms) return null;

    const lower = extractedInputText.toLowerCase();
    const { sText, pText, oText, sentenceText, claimText, modifierTexts } = hoveredTerms;

    const maxSpan = extractedInputText.length * 0.7;
    let result: HighlightSpan | null = null;

    if (!result && claimText) {
      const ctLower = claimText.toLowerCase();
      const ctIdx = lower.indexOf(ctLower);
      if (ctIdx !== -1) {
        result = {
          before: extractedInputText.slice(0, ctIdx),
          match: extractedInputText.slice(ctIdx, ctIdx + claimText.length),
          after: extractedInputText.slice(ctIdx + claimText.length),
        };
      }
    }

    if (!result && sentenceText) {
      const stLower = sentenceText.toLowerCase();
      const stIdx = lower.indexOf(stLower);
      if (stIdx !== -1) {
        result = {
          before: extractedInputText.slice(0, stIdx),
          match: extractedInputText.slice(stIdx, stIdx + sentenceText.length),
          after: extractedInputText.slice(stIdx + sentenceText.length),
        };
      }
    }

    if (!result) {
      const full = `${sText} ${pText} ${oText}`.toLowerCase();
      if (full.length <= maxSpan) {
        const fullIdx = lower.indexOf(full);
        if (fullIdx !== -1) {

          const end = extendWithModifiers(lower, fullIdx + full.length, modifierTexts);
          result = {
            before: extractedInputText.slice(0, fullIdx),
            match: extractedInputText.slice(fullIdx, end),
            after: extractedInputText.slice(end),
          };
        }
      }
    }

    if (!result) {
      const pLower = pText.toLowerCase();
      const oLower = oText.toLowerCase();
      const sLower = sText.toLowerCase();

      const pIdx = lower.indexOf(pLower);
      if (pIdx !== -1) {
        const oIdx = lower.indexOf(oLower, pIdx);
        if (oIdx !== -1) {

          const end = extendWithModifiers(lower, oIdx + oLower.length, modifierTexts);

          const sIdx = lower.lastIndexOf(sLower, pIdx);
          if (sIdx !== -1 && (pIdx - sIdx) < 50) {
            const span = extractedInputText.slice(sIdx, end);
            if (span.length <= maxSpan) {
              result = {
                before: extractedInputText.slice(0, sIdx),
                match: span,
                after: extractedInputText.slice(end),
              };
            }
          }

        }
      }
    }

    if (result && extractedInputText.length >= 120 && result.match.length > extractedInputText.length * 0.9) {
      return null;
    }

    return result;
  }, [extractedInputText, hoveredTerms]);
}
