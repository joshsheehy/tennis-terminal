'use client';

import { useEffect, useState } from 'react';

// One units setting for the whole site — distances in the Builder, weather and
// elevation in the Conditions blocks, on the Builder and the itinerary. The
// viewer's choice if they've made one on this device, otherwise their region.

const STORAGE_KEY = 'units';
const CHANGE_EVENT = 'tenniscuts:units';

// Where localStorage is blocked, a choice still holds for the visit.
let sessionChoice: boolean | null = null;
// The setting as last read in this page. A component that mounts later (an
// info card opened after load) starts from it, so it doesn't flash °C before
// switching to °F. Server renders and the first mount start metric, matching
// the server HTML for hydration.
let lastKnown: boolean | null = null;

export function detectImperial(): boolean {
  if (typeof navigator === 'undefined') return false;
  const langs = navigator.languages?.length ? navigator.languages : [navigator.language];
  return langs.some((l) => {
    try {
      const region = new Intl.Locale(l).maximize().region;
      return region === 'US' || region === 'LR' || region === 'MM';
    } catch {
      return /-(US|LR|MM)\b/i.test(l);
    }
  });
}

function readImperial(): boolean {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'imperial') return true;
    if (saved === 'metric') return false;
  } catch {
    // storage blocked
  }
  return sessionChoice ?? detectImperial();
}

function currentImperial(): boolean {
  lastKnown = readImperial();
  return lastKnown;
}

/** Whether to show °F / ft / mi; re-renders when the setting changes anywhere on the page. */
export function useImperial(): boolean {
  const [imperial, setImperial] = useState(() => lastKnown ?? false);
  useEffect(() => {
    const sync = () => setImperial(currentImperial());
    sync();
    window.addEventListener(CHANGE_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(CHANGE_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);
  return imperial;
}

export function setImperialPreference(imperial: boolean): void {
  sessionChoice = imperial;
  try {
    localStorage.setItem(STORAGE_KEY, imperial ? 'imperial' : 'metric');
  } catch {
    // sessionChoice covers this visit
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}
