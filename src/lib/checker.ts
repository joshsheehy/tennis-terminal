import { CheckerResult, CheckerStatus, CutoffSnapshot } from './types';

function compareRank(
  rank: number | null | undefined,
  directCut: number | null | undefined,
  alternateCut: number | null | undefined
): CheckerStatus {
  if (!rank) return 'Out';
  if (!directCut && !alternateCut) return 'No cutoff data';
  if (directCut && rank <= directCut) return 'Direct Acceptance';
  if (alternateCut && rank <= alternateCut) return 'Via Alternate Spot';
  return 'Out';
}

export function buildSinglesResults(
  singlesRank: number,
  singlesMain: CutoffSnapshot | null,
  singlesQualifying: CutoffSnapshot | null
): CheckerResult[] {
  const mainStatus = compareRank(
    singlesRank,
    singlesMain?.last_direct_acceptance_rank,
    singlesMain?.last_alternate_rank
  );

  if (mainStatus === 'Direct Acceptance') {
    return [{ label: 'Singles Main', status: mainStatus }];
  }

  return [
    { label: 'Singles Main', status: mainStatus },
    {
      label: 'Singles Qualifying',
      status: compareRank(
        singlesRank,
        singlesQualifying?.last_direct_acceptance_rank,
        singlesQualifying?.last_alternate_rank
      ),
    },
  ];
}

export function buildDoublesResult(
  combinedDoublesRank: number,
  doublesMain: CutoffSnapshot | null,
  level: string
): CheckerResult {
  const isChallenger = level.toLowerCase().includes('challenger');

  if (isChallenger) {
    return {
      label: 'Doubles Main',
      status: compareRank(
        combinedDoublesRank,
        doublesMain?.challenger_doubles_advanced_cut_rank ?? doublesMain?.last_direct_acceptance_rank,
        doublesMain?.challenger_doubles_onsite_cut_rank ?? doublesMain?.last_alternate_rank
      ),
    };
  }

  return {
    label: 'Doubles Main',
    status: compareRank(
      combinedDoublesRank,
      doublesMain?.last_direct_acceptance_rank,
      doublesMain?.last_alternate_rank
    ),
  };
}
