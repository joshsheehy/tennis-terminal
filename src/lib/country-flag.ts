// Flag emoji for the three-letter nation codes entry lists use.
//
// Lists are read by scanning, and a flag is recognised far faster than "URU"
// or "KAZ". Regional-indicator emoji need ISO 3166-1 alpha-2, but every tennis
// source publishes alpha-3 (and a few IOC codes that differ from ISO), so the
// mapping has to be explicit.

const ALPHA3_TO_ALPHA2: Record<string, string> = {
  ALG: 'DZ', ANG: 'AO', ARG: 'AR', ARM: 'AM', AUS: 'AU', AUT: 'AT', AZE: 'AZ',
  BAH: 'BS', BAR: 'BB', BDI: 'BI', BEL: 'BE', BIH: 'BA', BLR: 'BY', BOL: 'BO',
  BRA: 'BR', BUL: 'BG', CAN: 'CA', CHI: 'CL', CHN: 'CN', CIV: 'CI', COL: 'CO',
  CRC: 'CR', CRO: 'HR', CYP: 'CY', CZE: 'CZ', DEN: 'DK', DOM: 'DO', ECU: 'EC',
  EGY: 'EG', ESA: 'SV', ESP: 'ES', EST: 'EE', FIN: 'FI', FRA: 'FR', GBR: 'GB',
  GEO: 'GE', GER: 'DE', GRE: 'GR', GUA: 'GT', HKG: 'HK', HUN: 'HU', INA: 'ID',
  IND: 'IN', IRI: 'IR', IRL: 'IE', ISR: 'IL', ITA: 'IT', JAM: 'JM', JOR: 'JO',
  JPN: 'JP', KAZ: 'KZ', KOR: 'KR', KSA: 'SA', KUW: 'KW', LAT: 'LV', LBN: 'LB',
  LTU: 'LT', LUX: 'LU', MAR: 'MA', MDA: 'MD', MEX: 'MX', MKD: 'MK', MNE: 'ME',
  MON: 'MC', NED: 'NL', NOR: 'NO', NZL: 'NZ', PAK: 'PK', PAR: 'PY', PER: 'PE',
  PHI: 'PH', POL: 'PL', POR: 'PT', PUR: 'PR', QAT: 'QA', ROU: 'RO', RSA: 'ZA',
  RUS: 'RU', SLO: 'SI', SRB: 'RS', SUI: 'CH', SVK: 'SK', SWE: 'SE', THA: 'TH',
  TPE: 'TW', TUN: 'TN', TUR: 'TR', UAE: 'AE', UKR: 'UA', URU: 'UY', USA: 'US',
  UZB: 'UZ', VEN: 'VE', VIE: 'VN', ZIM: 'ZW',
};

/**
 * Flag emoji for a nation code, or null when it cannot be mapped.
 *
 * Returns null rather than a placeholder so callers can fall back to the raw
 * code — showing a wrong flag is worse than showing none.
 */
export function flagFor(code: string | null | undefined): string | null {
  if (!code) return null;
  const upper = code.trim().toUpperCase();
  const alpha2 = upper.length === 2 ? upper : ALPHA3_TO_ALPHA2[upper];
  if (!alpha2 || !/^[A-Z]{2}$/.test(alpha2)) return null;
  return String.fromCodePoint(
    ...[...alpha2].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65)
  );
}
