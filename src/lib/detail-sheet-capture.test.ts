import { describe, expect, it } from 'vitest';
import { captureSheet } from './detail-sheet-capture';

// Lines from Yokohama's 2026 detail sheet, as extractRowText returns them (cells joined by tabs).
const YOKOHAMA = [
  'Keio University Mamushidani Tennis Courts\tSURFACE:\tOutdoor Hard\tLAUNDRY:\tOn-site',
  '4-1-1 Hiyoshi, Kohoku-Ku\tSURFACE BRAND:\tDecoturf\tLAUNDRY COST:\tApprox. US $3.50 (¥500) per bag',
  'Yokohama-Shi 223-0061, Kanagawa\tBALL:\tDunlop AO\tFOOD:\tCatering subcontractor, Buffet style',
  'T: +81 455 622 989\tThursday 19 November\tDEPOSIT:\tPractice balls: US $7 (¥1000)',
  'TOURNAMENT DIRECTOR\tSotaro Hara\tT: +81 455 622 989\tkeiochallengermanager@googlegroups.com',
  'HOTEL RESERVATIONS\tShogo Sanada\tT: +81 455 622 989\tkeiochallenger.hospitality@gmail.com',
  'ATP Supervisor\tKaito Imai\tT: +81 80 4166 1177\tkaito.imai@yahoo.com',
  'Primary Hotel:\tRichmond Hotel Premier Musashikosugi - Yokohama',
  'T: +81 444 300 076\tBreakfast:\tIncluded for all',
  'Nearest Airport:\tHaneda Tokyo International Airport (HND). Airport pickup is NOT provided.',
  'Tournament Website\twww.keiochallenger.jp',
].join('\n');

describe('captureSheet', () => {
  const capture = captureSheet(YOKOHAMA);

  it('keeps every labelled field, hotel and transport included', () => {
    expect(capture.fields).toMatchObject({
      SURFACE: 'Outdoor Hard',
      'SURFACE BRAND': 'Decoturf',
      BALL: 'Dunlop AO',
      LAUNDRY: 'On-site',
      'LAUNDRY COST': 'Approx. US $3.50 (¥500) per bag',
      FOOD: 'Catering subcontractor, Buffet style',
      DEPOSIT: 'Practice balls: US $7 (¥1000)',
      'Primary Hotel': 'Richmond Hotel Premier Musashikosugi - Yokohama',
      Breakfast: 'Included for all',
      'Nearest Airport': 'Haneda Tokyo International Airport (HND). Airport pickup is NOT provided.',
    });
  });

  it('lists contacts by role with their phone and email', () => {
    expect(capture.contacts).toEqual([
      { role: 'TOURNAMENT DIRECTOR', details: ['Sotaro Hara', 'T: +81 455 622 989', 'keiochallengermanager@googlegroups.com'] },
      { role: 'HOTEL RESERVATIONS', details: ['Shogo Sanada', 'T: +81 455 622 989', 'keiochallenger.hospitality@gmail.com'] },
      { role: 'ATP Supervisor', details: ['Kaito Imai', 'T: +81 80 4166 1177', 'kaito.imai@yahoo.com'] },
    ]);
  });

  it('collects every phone, email and link once', () => {
    expect(capture.phones).toEqual(['+81 455 622 989', '+81 80 4166 1177', '+81 444 300 076']);
    expect(capture.emails).toEqual(['keiochallengermanager@googlegroups.com', 'keiochallenger.hospitality@gmail.com', 'kaito.imai@yahoo.com']);
    expect(capture.links).toEqual(['www.keiochallenger.jp']);
    expect(capture.placeholder).toBe(false);
  });

  it('flags the not-yet-published placeholder', () => {
    expect(captureSheet('Tournament Information Not Yet Available').placeholder).toBe(true);
  });
});
