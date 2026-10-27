'use client';

import { useEffect } from 'react';
import { isNativeApp, listenForNotificationTaps, refreshPushRegistration } from '@/lib/native-push';

// Mounted once in the root layout. In the iOS app it re-registers the push
// token on launch and handles notification taps; on the website it does
// nothing.
export default function AppPushBoot() {
  useEffect(() => {
    if (!isNativeApp()) return;
    listenForNotificationTaps().catch(() => {});
    refreshPushRegistration().catch(() => {});
  }, []);
  return null;
}
