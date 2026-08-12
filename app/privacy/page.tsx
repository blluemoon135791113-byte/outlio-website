import type { Metadata } from "next";
import Nav from "../components/Nav";
import Footer from "../components/Footer";
import Breadcrumbs from "../components/Breadcrumbs";

export const metadata: Metadata = {
  title: "Privacy Policy | Outlio",
  description: "How Outlio collects, uses, and protects data. Our commitment to privacy and data security for clients and prospects.",
  alternates: {
    canonical: 'https://outlio.io/privacy',
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

export default function PrivacyPolicy() {
  return (
    <>
      <Nav />
      <Breadcrumbs />
      <main className="mx-auto w-full max-w-3xl px-6 py-20 sm:py-28">
        <p className="text-[13px] font-semibold uppercase tracking-[0.22em] text-accent">
          Outlio &middot; Legal
        </p>
        <h1 className="mt-4 text-4xl font-bold uppercase tracking-tight sm:text-5xl">
          Privacy Policy
        </h1>
        <p className="mt-4 text-sm text-muted">Last updated: Sunday, 9 August 2026</p>

        <p className="mt-10 leading-relaxed text-ink/80">
          Outlio (&ldquo;we,&rdquo; &ldquo;us,&rdquo; &ldquo;our&rdquo;) respects your privacy. This
          Privacy Policy explains what data we collect, how we use it, and your rights — whether
          you're a visitor to our website, a client, or a prospect contacted through a campaign we
          run on behalf of a client.
        </p>

        <Section title="1. Who This Applies To">
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <strong>Website visitors</strong> — anyone browsing our website or using our
              contact/booking forms.
            </li>
            <li>
              <strong>Clients</strong> — businesses that purchase our Services.
            </li>
            <li>
              <strong>Prospects</strong> — individuals contacted through outreach campaigns we run
              on behalf of a client. If you received a message from us and are wondering why, see
              Section 5.
            </li>
          </ul>
        </Section>

        <Section title="2. Data We Collect">
          <p>
            <strong>From website visitors:</strong>
          </p>
          <ul className="list-disc space-y-2 pl-5">
            <li>
              Contact details you submit (name, email, company, message) via forms or booking tools.
            </li>
            <li>
              Basic analytics data (pages visited, browser type, approximate location) via cookies
              and analytics tools.
            </li>
          </ul>
          <p>
            <strong>From clients:</strong>
          </p>
          <ul className="list-disc space-y-2 pl-5">
            <li>
              Business information needed to run your campaign: company details, ICP, offer details,
              billing information.
            </li>
            <li>
              Access credentials or delegated access to accounts you provide for campaign execution
              (e.g., LinkedIn, email, ad platforms).
            </li>
          </ul>
          <p>
            <strong>From Lead Engine account holders:</strong>
          </p>
          <ul className="list-disc space-y-2 pl-5">
            <li>
              Account and verification details you submit, including your name, work email, phone
              number, and LinkedIn profile URL.
            </li>
            <li>
              Files you choose to upload and the lead data extracted from them, until you clear the
              data or the applicable retention period ends.
            </li>
            <li>
              A keyed, one-way hash derived from the signup network address. We do not store the raw
              address in the trial eligibility record. The hash is used to prevent repeated free-trial
              accounts from the same network.
            </li>
            <li>
              A signed, first-party browser token and keyed, one-way hashes of normalized account
              identifiers. These pseudonymous records help prevent a VPN or changed network from
              resetting free-trial eligibility while the account exists. We do not store a raw
              device fingerprint in these records, and the claims are removed when the associated
              account is deleted.
            </li>
          </ul>
          <p>
            <strong>From prospects (people we contact on behalf of clients):</strong>
          </p>
          <ul className="list-disc space-y-2 pl-5">
            <li>
              Publicly available professional information: name, job title, company, and publicly
              listed business email or social profile — sourced from professional networks, company
              websites, or public sources.
            </li>
            <li>Any reply or engagement data, if you respond to a message.</li>
          </ul>
        </Section>

        <Section title="3. How We Use Data">
          <ul className="list-disc space-y-2 pl-5">
            <li>To deliver the Services: run outreach, report results, manage your account.</li>
            <li>To operate our website and respond to inquiries.</li>
            <li>To prevent duplicate free trials, fraud, and abuse of the Lead Engine service.</li>
            <li>
              To improve our targeting and messaging (using aggregated or anonymized data).
            </li>
            <li>To meet legal and accounting obligations.</li>
          </ul>
          <p>We do not sell personal data to third parties.</p>
        </Section>

        <Section title="4. Data Sharing">
          <p>We share data only with:</p>
          <ul className="list-disc space-y-2 pl-5">
            <li>
              Tools we use to operate (CRM, email/outreach platforms, automation tools, analytics
              providers) — bound by their own data protection terms.
            </li>
            <li>
              Our clients, when the data relates to their campaign (e.g., prospect replies, campaign
              performance).
            </li>
            <li>Authorities, if required by law.</li>
          </ul>
        </Section>

        <Section title="5. Cold Outreach & Your Rights as a Prospect">
          <p>
            If you've received a message from us on behalf of a client, we processed limited,
            typically publicly available professional contact information for a legitimate business
            outreach purpose. You can ask to be removed from any campaign at any time by replying
            &ldquo;unsubscribe&rdquo; or &ldquo;remove&rdquo; to the message, or by emailing us at{" "}
            <a href="mailto:husnain@outlio.io" className="font-medium text-accent">
              husnain@outlio.io
            </a>
            . We will honor removal requests within a reasonable time. Clients running campaigns
            through us remain responsible for ensuring their own outreach practices comply with
            applicable law in their target markets (see our Terms and Conditions, Section 8).
          </p>
        </Section>

        <Section title="6. Data Retention">
          <p>
            We keep data only as long as needed to deliver the Services, meet legal obligations, or
            resolve disputes, and delete or anonymize it afterward.
          </p>
          <p>
            Trial eligibility hashes remain associated with an active account to prevent duplicate
            free trials. When that account is deleted, its network, device, and identity claims are
            removed. A new account may then be created from the same network. If a shared office,
            household, school, or other shared network is blocked incorrectly, contact us for a
            manual review.
          </p>
        </Section>

        <Section title="7. Data Security">
          <p>
            We use reasonable technical and organizational measures to protect data, including
            access controls and secure tools. No system is 100% secure, and we can't guarantee
            absolute security.
          </p>
        </Section>

        <Section title="8. Cookies">
          <p>
            Our website may use cookies and similar technologies for basic analytics and
            functionality. You can control cookies through your browser settings.
          </p>
        </Section>

        <Section title="9. Your Rights">
          <p>
            Depending on your location, you may have the right to access, correct, delete, or
            restrict the use of your personal data. To exercise these rights, contact us at{" "}
            <a href="mailto:husnain@outlio.io" className="font-medium text-accent">
              husnain@outlio.io
            </a>
            .
          </p>
        </Section>

        <Section title="10. Children's Privacy">
          <p>
            Our Services are intended for businesses and professionals. We do not knowingly collect
            data from anyone under 18.
          </p>
        </Section>

        <Section title="11. Changes to This Policy">
          <p>
            We may update this Privacy Policy from time to time. The &ldquo;Last updated&rdquo; date
            at the top reflects the most recent version.
          </p>
        </Section>

        <Section title="12. Contact">
          <p>
            Questions about this policy or a data request? Email us at:{" "}
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
