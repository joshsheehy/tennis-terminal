import type { Metadata } from 'next';
import type { CSSProperties } from 'react';

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description: 'What Tennis Cuts collects, why, and how to control it.',
};

const sectionStyle: CSSProperties = { margin: '0 0 24px' };
const h2Style: CSSProperties = {
  fontSize: 16,
  fontWeight: 700,
  margin: '0 0 8px',
  color: 'var(--text-strong)',
};
const pStyle: CSSProperties = {
  fontSize: 14,
  color: 'var(--text-secondary)',
  lineHeight: 1.6,
  margin: '0 0 8px',
};

export default function PrivacyPage() {
  return (
    <main className="page page--slim">
      <h1 className="page-title" style={{ marginBottom: 8 }}>
        Privacy Policy
      </h1>
      <p className="page-lede" style={{ marginBottom: 28, fontSize: 15 }}>
        Last updated October 27, 2026. Tennis Cuts (tenniscuts.com) is a schedule and
        entry-cutoff tracker for pro tennis. This page explains what we collect, why, and how to
        control it — in plain language, not legalese.
      </p>

      <section style={sectionStyle}>
        <h2 style={h2Style}>What we collect</h2>
        <p style={pStyle}>
          Most of the site — the schedule, cuts, tournament pages, the swing planner — needs no
          information from you at all.
        </p>
        <p style={pStyle}>
          If you sign up for <a href="/alerts">entry-deadline alerts</a>, we store the email
          address you give us, the tours/categories you picked, whether you opted into doubles
          advance-entry reminders, and which reminder windows you chose.
        </p>
        <p style={pStyle}>
          If you <a href="/login">create an account</a> to save tournaments, we store your email
          address, the tournaments you save, and when you last signed in. Signing in works with a
          one-time code we email you, so there are no passwords. To stop people from spamming
          sign-in emails, we also keep the IP address each code was requested from.
        </p>
        <p style={pStyle}>
          If you turn on push notifications in the TennisCuts iPhone app, we store the device
          token Apple gives us for your phone, linked to your account, so we can send the
          deadline alerts you chose there. Turning push off or signing out removes it.
        </p>
        <p style={pStyle}>
          We don&apos;t collect payment information (the site is free), and we don&apos;t collect
          location data.
        </p>
      </section>

      <section style={sectionStyle}>
        <h2 style={h2Style}>How we use it</h2>
        <p style={pStyle}>
          Solely to send the entry-deadline alert emails you asked for, to sign you in and show
          your saved schedule, and to run the site. We
          don&apos;t sell your email address or use it for marketing, and we don&apos;t use it for
          anything beyond what you signed up for.
        </p>
      </section>

      <section style={sectionStyle}>
        <h2 style={h2Style}>Who we share it with</h2>
        <p style={pStyle}>
          <strong>Resend</strong> — the email-delivery service that sends alert and sign-in
          emails on our behalf. It processes your address only to deliver that message.
        </p>
        <p style={pStyle}>
          <strong>Apple</strong> — delivers push notifications to the iPhone app. It receives
          your device token and the alert text, nothing else.
        </p>
        <p style={pStyle}>
          <strong>Railway</strong> — our hosting provider. Like virtually any hosted web app, it
          may log standard technical request information (e.g. IP address) for security and
          operational purposes.
        </p>
        <p style={pStyle}>
          We don&apos;t share your information with anyone else, and we don&apos;t run ads or
          third-party analytics/tracking on this site.
        </p>
      </section>

      <section style={sectionStyle}>
        <h2 style={h2Style}>Cookies &amp; local storage</h2>
        <p style={pStyle}>
          We don&apos;t use tracking cookies. If you sign in, we set one cookie that keeps you
          signed in for up to 90 days; it holds a random sign-in key and nothing else. Your
          light/dark theme preference is saved locally on your device and never sent to us.
        </p>
      </section>

      <section style={sectionStyle}>
        <h2 style={h2Style}>Your controls</h2>
        <p style={pStyle}>
          Every alert email includes an unsubscribe link and a manage-preferences link, each tied
          to a private link only you have — no login needed. Unsubscribing stops all future emails
          right away. If you&apos;d like your email address deleted outright rather than just
          marked inactive, contact us below and we&apos;ll remove it.
        </p>
        <p style={pStyle}>
          If you have an account, you can delete it any time from{' '}
          <a href="/account">My schedule</a>. That permanently erases your account, your saved
          tournaments, and your sign-in records right away. Alert emails are a separate signup
          and keep their own unsubscribe link.
        </p>
      </section>

      <section style={sectionStyle}>
        <h2 style={h2Style}>Changes</h2>
        <p style={pStyle}>
          As we add features — location-based trip planning, for example —
          we&apos;ll update this page to describe what&apos;s newly collected and why before those
          features ship.
        </p>
      </section>

      <p className="page-footnote">
        Questions about this policy or your data?{' '}
        <a href="mailto:josh@tenniscuts.com">josh@tenniscuts.com</a>
      </p>
    </main>
  );
}
