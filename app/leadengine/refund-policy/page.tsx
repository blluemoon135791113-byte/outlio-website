import type { Metadata } from "next";
import Link from "next/link";

import Nav from "../../components/Nav";
import Footer from "../../components/Footer";

export const metadata: Metadata = {
  title: "Lead Engine Refund Policy | Outlio",
  description:
    "Outlio Lead Engine offers a free trial before purchase. Paid subscription fees and Credits are non-refundable, subject to applicable law.",
  alternates: {
    canonical: "https://outlio.io/leadengine/refund-policy",
  },
  robots: {
    index: true,
    follow: true,
  },
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-12">
      <h2 className="text-2xl font-semibold tracking-tight">{title}</h2>
      <div className="mt-4 space-y-4 leading-relaxed text-ink/80">{children}</div>
    </section>
  );
}

function Callout({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-[var(--radius-lg)] border border-border bg-panel p-5 text-[15px] leading-relaxed">
      {children}
    </div>
  );
}

export default function LeadEngineRefundPolicy() {
  return (
    <>
      <Nav surface="leadengine" />
      <main className="mx-auto w-full max-w-3xl px-6 py-20 sm:py-28">
        <p className="text-[13px] font-semibold uppercase tracking-[0.22em] text-accent">
          Outlio &middot; Lead Engine &middot; Legal
        </p>
        <h1 className="mt-4 text-4xl font-bold uppercase tracking-tight sm:text-5xl">
          Lead Engine Refund Policy
        </h1>
        <p className="mt-4 text-sm text-muted">Last updated: Saturday, 22 August 2026</p>

        <div className="mt-10 space-y-4 leading-relaxed text-ink/80">
          <p>
            This Refund Policy applies only to Outlio Lead Engine, our software-as-a-service
            product (the &ldquo;Service&rdquo;). It forms part of the{" "}
            <Link href="/leadengine/terms" className="font-medium text-accent">
              Lead Engine Terms of Service
            </Link>
            . Outlio&apos;s done-for-you services are governed by separate terms.
          </p>
          <Callout>
            <strong>Paid fees are non-refundable.</strong> We provide a 3-day free trial with 10
            Credits and no payment card required so you can evaluate the Service before purchasing.
          </Callout>
        </div>

        <Section title="1. Free Trial">
          <ul className="list-disc space-y-2 pl-5">
            <li>The free trial lasts 3 days and includes 10 Credits.</li>
            <li>No payment card is required, and the trial does not automatically become a paid plan.</li>
            <li>
              The trial is limited to one per person, business, and network, as described in the{" "}
              <Link href="/leadengine/terms" className="font-medium text-accent">
                Lead Engine Terms
              </Link>
              .
            </li>
            <li>
              Trial Credits have no cash value, cannot be transferred, and cannot be exchanged for
              money or extended after the trial ends.
            </li>
          </ul>
        </Section>

        <Section title="2. No Refunds on Paid Plans">
          <p>
            Once you purchase a paid plan, the payment is final and non-refundable. We do not
            provide refunds, prorated refunds, or account credits for:
          </p>
          <ul className="list-disc space-y-2 pl-5">
            <li>Partly used billing periods or early cancellation.</li>
            <li>Unused or expired Credits.</li>
            <li>Failure to use the Service during a billing period.</li>
            <li>Plan downgrades, account deletion, or changes in your business needs.</li>
            <li>
              Results that are accurate to the source data but are commercially disappointing or
              do not produce the business outcome you expected.
            </li>
            <li>
              Problems caused by your files, account configuration, internet connection, third-party
              platforms, or use that breaches our Terms.
            </li>
          </ul>
        </Section>

        <Section title="3. Cancellation">
          <p>
            You may cancel your subscription at any time from your account settings. Cancellation
            prevents the next renewal and takes effect at the end of the current billing period. You
            may continue using the Service and any remaining Credits until then. Cancellation does
            not refund the current billing period.
          </p>
          <p>
            Deleting your account is immediate and irreversible. Account deletion does not cancel
            or reverse a completed payment and does not create a right to a refund.
          </p>
        </Section>

        <Section title="4. Failed Runs and Service Errors">
          <p>
            If an extraction run consumes Credits but fails because of a verified fault in the
            Service, we will restore the Credits consumed by that failed run. A Credit restoration
            is not a cash refund and does not extend your billing period.
          </p>
          <p>
            We do not restore Credits where the run completed, where no charge was made, or where
            the problem resulted from invalid input, unsupported data, a third-party service, or a
            breach of the Lead Engine Terms.
          </p>
        </Section>

        <Section title="5. Incorrect or Duplicate Charges">
          <p>
            If you believe a charge was duplicated, unauthorized, or made in error, contact us
            promptly with the account email, charge date, amount, and payment reference. We will
            investigate and correct verified billing errors. Correcting an erroneous charge is not
            a discretionary refund under this Policy.
          </p>
        </Section>

        <Section title="6. Rights Required by Law">
          <p>
            Nothing in this Policy excludes or limits any cancellation, refund, or other consumer
            right that cannot lawfully be excluded. If applicable law requires us to provide a
            refund despite this Policy, we will provide the legally required remedy.
          </p>
        </Section>

        <Section title="7. Policy Changes">
          <p>
            We may update this Policy from time to time. Material changes will apply prospectively
            and will be communicated as required by law. The date above shows when this Policy was
            last updated.
          </p>
        </Section>

        <Section title="8. Contact">
          <p>
            Questions or billing-error reports: {" "}
            <a href="mailto:husnain@outlio.io" className="font-semibold text-accent">
              husnain@outlio.io
            </a>
          </p>
        </Section>
      </main>
      <Footer />
    </>
  );
}
