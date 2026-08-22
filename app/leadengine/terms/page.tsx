import type { Metadata } from "next";
import Link from "next/link";

import Nav from "../../components/Nav";
import Footer from "../../components/Footer";

export const metadata: Metadata = {
  title: "Lead Engine Terms of Service | Outlio",
  description:
    "The terms governing use of Outlio Lead Engine, the software that turns saved Sales Navigator results pages into structured CSV files.",
  alternates: {
    canonical: "https://app.outlio.io/leadengine/terms",
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

export default function LeadEngineTerms() {
  return (
    <>
      <Nav surface="leadengine" />
      <main className="mx-auto w-full max-w-3xl px-6 py-20 sm:py-28">
        <p className="text-[13px] font-semibold uppercase tracking-[0.22em] text-accent">
          Outlio &middot; Lead Engine &middot; Legal
        </p>
        <h1 className="mt-4 text-4xl font-bold uppercase tracking-tight sm:text-5xl">
          Lead Engine Terms of Service
        </h1>
        <p className="mt-4 text-sm text-muted">Last updated: Monday, 10 August 2026</p>

        <div className="mt-10 space-y-4 leading-relaxed text-ink/80">
          <p>
            These Lead Engine Terms of Service (&ldquo;Terms&rdquo;) are a contract between Outlio
            (&ldquo;Outlio,&rdquo; &ldquo;we,&rdquo; &ldquo;us,&rdquo; &ldquo;our&rdquo;) and the
            person or company that creates a Lead Engine account (&ldquo;you,&rdquo;
            &ldquo;Customer&rdquo;). They govern your access to and use of Outlio Lead Engine (the
            &ldquo;Service&rdquo;).
          </p>
          <p>
            By creating an account, uploading a file, or paying for a plan, you agree to these
            Terms. If you are agreeing on behalf of a company, you confirm you have authority to
            bind that company. If you do not agree, do not use the Service.
          </p>
          <p>
            These Terms apply <strong>only</strong> to Lead Engine. Outlio&apos;s done-for-you
            outbound, lead generation, and video production services are governed separately by our{" "}
            <Link href="/terms" className="font-medium text-accent">
              main Terms and Conditions
            </Link>
            . Where both apply, these Terms control for Lead Engine.
          </p>
        </div>

        <Section title="1. Definitions">
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <strong>Uploaded File</strong> — an HTML file you save from your own browser and
              choose to upload to the Service.
            </li>
            <li>
              <strong>Extracted Data</strong> — the structured records the Service produces by
              reading an Uploaded File, including any CSV you download.
            </li>
            <li>
              <strong>Credits</strong> — the prepaid units consumed when you run an extraction.
            </li>
            <li>
              <strong>Duplicate-Detection Key</strong> — the short identifier the Service keeps
              after Extracted Data is cleared, so that a person already seen is not counted twice.
              See Section 11 and our{" "}
              <Link href="/leadengine/privacy" className="font-medium text-accent">
                Lead Engine Privacy Policy
              </Link>
              .
            </li>
          </ul>
        </Section>

        <Section title="2. Eligibility and Accounts">
          <ul className="list-disc space-y-2 pl-5">
            <li>
              The Service is for business and professional use only. You must be at least 18 years
              old.
            </li>
            <li>
              Access is granted by approval. We may accept or decline any account request, and we
              are not obliged to give a reason.
            </li>
            <li>
              You must provide accurate registration details and keep them current. You are
              responsible for all activity under your account and for keeping your credentials
              secure.
            </li>
            <li>
              Accounts are for a single named user. Sharing one account across multiple people, or
              reselling access, is not permitted without a written agreement with us.
            </li>
          </ul>
        </Section>

        <Section title="3. What the Service Does — and Does Not Do">
          <p>
            Lead Engine is a file converter. It reads a file that is already on your computer and
            turns it into a spreadsheet. That boundary is deliberate and material to these Terms:
          </p>
          <Callout>
            <ul className="list-disc space-y-2 pl-5">
              <li>
                The Service <strong>never connects to LinkedIn</strong>. It sends no requests to
                LinkedIn&apos;s servers and operates no crawler, bot, browser extension, or
                automated browser.
              </li>
              <li>
                The Service <strong>never asks for, stores, or uses</strong> your LinkedIn
                password, cookies, or session tokens, and has no ability to sign in as you.
              </li>
              <li>
                The <strong>only</strong> input the Service ever reads is a page you opened
                yourself — either a file you upload, or a page you capture with our browser
                extension during a capture session you started.
              </li>
              <li>
                The extension <strong>never navigates for you</strong>. It does not click, page
                through results, open profiles, send messages, or change filters. You move between
                pages yourself, and it only reads a page once you have chosen to capture.
              </li>
            </ul>
          </Callout>
          <p>
            Opening a page, and choosing to upload or capture it, are actions <strong>you</strong>{" "}
            take on your own device using your own browser. The Service does not perform them for
            you and cannot do so. Outside an active capture session the extension reads nothing.
          </p>
        </Section>

        <Section title="4. Your Files, Your Responsibility">
          <p>By uploading a file, you represent and warrant that:</p>
          <ul className="list-disc space-y-2 pl-5">
            <li>
              You obtained the file lawfully, through your own authorised access, and you have the
              right to upload it and to have us process it.
            </li>
            <li>
              You have a valid legal basis to process the personal data it contains for your
              intended purpose, and you will comply with all applicable data protection law,
              including the GDPR, the UK GDPR, and the CCPA/CPRA where they apply to you.
            </li>
            <li>
              You will comply with all applicable marketing and unsolicited-communication laws,
              including CAN-SPAM, PECR, and equivalent rules in your target markets, when you use
              Extracted Data.
            </li>
            <li>
              Your use of the file does not breach any contract, terms of service, or acceptable use
              policy that binds you — including the LinkedIn User Agreement. See Section 5.
            </li>
            <li>
              The file contains no special-category or sensitive personal data (such as health,
              biometric, racial or ethnic origin, political opinion, religion, trade union
              membership, sex life or sexual orientation data), no government identifiers, no
              payment card data, and no data about anyone under 18.
            </li>
          </ul>
          <p>
            <strong>
              As between you and Outlio, you are the party responsible for what is in your files
              and for what you do with Extracted Data.
            </strong>{" "}
            We do not review, verify, or approve your files before processing them.
          </p>
        </Section>

        <Section title="5. Third-Party Platforms and Account Risk">
          <p>
            Outlio has no relationship or agreement with LinkedIn Corporation. Your relationship
            with LinkedIn is governed entirely by your own agreement with them.
          </p>
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <strong>You are responsible for reviewing the LinkedIn User Agreement</strong> and
              any other platform terms that apply to you, and for deciding whether your intended use
              is permitted under them.
            </li>
            <li>
              <strong>You accept all risk of platform action.</strong> Saving, exporting, or
              otherwise handling data from a third-party platform may result in warnings,
              restrictions, feature limits, suspension, or permanent termination of your account on
              that platform. Outlio is not responsible or liable for any such action, and no refund
              or credit is due if it occurs.
            </li>
            <li>
              Outlio is not a law firm and does not provide legal or compliance advice. Nothing on
              our website, in our documentation, or in these Terms is legal advice. You should take
              your own advice on the obligations that apply to your business and your region.
            </li>
          </ul>
        </Section>

        <Section title="6. Acceptable Use">
          <p>You may not use the Service to:</p>
          <ul className="list-disc space-y-2 pl-5">
            <li>
              Process files you did not obtain lawfully, or that you are not authorised to process.
            </li>
            <li>
              Build, sell, license, or otherwise distribute lists of personal data to third parties
              as a product, or operate a data brokerage using Extracted Data.
            </li>
            <li>
              Send unlawful, deceptive, harassing, or bulk unsolicited communications, or to target
              individuals on the basis of a protected characteristic.
            </li>
            <li>
              Stalk, profile, harass, discriminate against, or endanger any individual, or to
              enable anyone else to do so.
            </li>
            <li>
              Circumvent, disable, or interfere with any security feature, rate limit, credit
              accounting, usage limit, or access control in the Service.
            </li>
            <li>
              Reverse engineer, decompile, scrape, or copy the Service, or use it to build a
              competing product.
            </li>
            <li>
              Upload malware, or files designed to exploit, overload, or disrupt our systems.
            </li>
            <li>Violate any applicable law, or any third party&apos;s rights.</li>
          </ul>
          <p>
            We may suspend or terminate access immediately, without refund, for any breach of this
            Section.
          </p>
        </Section>

        <Section title="7. Credits, Plans, and Billing">
          <ul className="list-disc space-y-2 pl-5">
            <li>
              Plans are prepaid and allocate a number of Credits per billing period. Current plans,
              prices, and Credit allocations are shown on our{" "}
              <Link href="/leadengine/pricing" className="font-medium text-accent">
                pricing page
              </Link>{" "}
              and are incorporated into these Terms.
            </li>
            <li>
              <strong>Credits are consumed by leads, not by files.</strong> An extraction is
              charged per block of leads, where the block size is set by your plan, and the count
              is taken across the whole run rather than file by file. Downloading a CSV of a
              completed extraction costs nothing.
            </li>
            <li>
              <strong>Credits are charged after a run is processed</strong>, once the number of
              leads it found is known, and never before. Any figure shown before you start a run is
              an estimate based on full pages, not a price.
            </li>
            <li>
              If a run would cost more Credits than you have left, it is rejected in full: nothing
              is charged and no results are delivered. We will tell you how many Credits the run
              needed. Your balance can never go negative.
            </li>
            <li>
              Credits are not refunded for results you consider commercially disappointing. If a run
              fails because of a fault on our side, we will restore the Credits it consumed.
            </li>
            <li>
              Credits have no cash value, are not transferable, and expire at the end of the billing
              period in which they were granted unless your plan states otherwise.
            </li>
            <li>
              Fees are billed in advance and exclude taxes. You are responsible for any VAT, sales
              tax, or withholding that applies. Payment may be collected through a third-party
              payment processor or by invoice.
            </li>
            <li>
              We may change prices or plan contents on 30 days&apos; notice, effective from your
              next billing period. Continuing to use the Service after that date means you accept
              the change.
            </li>
            <li>
              If payment fails or is overdue, we may suspend access until it is resolved.
            </li>
          </ul>
        </Section>

        <Section title="8. Free Trial">
          <ul className="list-disc space-y-2 pl-5">
            <li>
              The free trial grants a limited number of Credits for a limited number of days, as
              shown at checkout. A payment method is required. Unless you cancel
              before the trial ends, the subscription automatically begins and
              Paddle charges the monthly or annual price shown at checkout.
            </li>
            <li>
              <strong>One trial per person, business, and network.</strong> To enforce this we
              retain anti-abuse signals described in our{" "}
              <Link href="/leadengine/privacy" className="font-medium text-accent">
                Lead Engine Privacy Policy
              </Link>
              . Creating multiple trial accounts, or using a VPN, proxy, or additional email
              addresses to obtain further trials, is a breach of these Terms and may result in
              termination.
            </li>
            <li>
              Trial data is subject to a shorter retention period than paid plans, and may be
              deleted when the trial ends. Export anything you need before then.
            </li>
            <li>
              The trial is provided as-is, with no availability or support commitment.
            </li>
          </ul>
        </Section>

        <Section title="9. Cancellation and Refunds">
          <ul className="list-disc space-y-2 pl-5">
            <li>
              You may cancel at any time from your account settings. Cancellation takes effect at
              the end of the current billing period. You keep access, and any remaining Credits,
              until then.
            </li>
            <li>
              <strong>Fees already paid are non-refundable</strong>, including for partly used
              periods and unused Credits, except where a refund is required by law or where we have
              failed to provide the Service through our own fault.
            </li>
            <li>
              Consumers in the UK, EU, and other jurisdictions with statutory cancellation rights
              retain those rights. Nothing in this Section limits them.
            </li>
            <li>
              Deleting your account is immediate and irreversible, and does not itself trigger a
              refund.
            </li>
          </ul>
          <p>
            Read the standalone{" "}
            <Link href="/leadengine/refund-policy" className="font-medium text-accent">
              Lead Engine Refund Policy
            </Link>{" "}
            for the complete billing and refund rules.
          </p>
        </Section>

        <Section title="10. Ownership of Your Data">
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <strong>You own your Uploaded Files and your Extracted Data.</strong> We claim no
              ownership over them.
            </li>
            <li>
              You grant us a limited, non-exclusive licence to host, process, and transmit them for
              the sole purpose of providing the Service to you, and for no other purpose.
            </li>
            <li>
              We do not sell your data, and we do not use your Uploaded Files or Extracted Data to
              train machine learning models or to build any other product.
            </li>
            <li>
              We may use aggregated, statistical information about Service usage — for example
              counts of jobs processed or error rates — provided it identifies neither you nor any
              individual.
            </li>
          </ul>
        </Section>

        <Section title="11. Data Retention and Deletion">
          <ul className="list-disc space-y-2 pl-5">
            <li>
              Uploaded Files and Extracted Data are retained for the period attached to your plan,
              then deleted automatically. You can clear an extraction earlier at any time from the
              dashboard.
            </li>
            <li>
              <strong>Duplicate-Detection Keys outlive Extracted Data by design.</strong> When you
              clear an extraction, we keep a short key for each record so that future uploads can
              tell you which people you have already seen. These keys are retained for the life of
              your account. They are pseudonymous, not anonymous — Section 5 of our{" "}
              <Link href="/leadengine/privacy" className="font-medium text-accent">
                Lead Engine Privacy Policy
              </Link>{" "}
              describes exactly what they contain and how to have them erased.
            </li>
            <li>
              Deleting your account removes your Uploaded Files, Extracted Data, and
              Duplicate-Detection Keys. We may retain billing records and audit logs where law
              requires it.
            </li>
          </ul>
        </Section>

        <Section title="12. Our Intellectual Property">
          <p>
            The Service — including its software, parsers, interface, documentation, and brand — is
            owned by Outlio and protected by intellectual property law. These Terms grant you a
            limited, revocable, non-exclusive, non-transferable right to use the Service during your
            subscription, and nothing more. All rights not expressly granted are reserved.
          </p>
          <p>
            If you send us feedback or suggestions, we may use them without obligation or
            compensation to you.
          </p>
        </Section>

        <Section title="13. Trademarks and No Affiliation">
          <Callout>
            <p>
              <strong>
                Outlio is not affiliated with, endorsed by, sponsored by, or in any way officially
                connected to LinkedIn Corporation or Microsoft Corporation.
              </strong>{" "}
              &ldquo;LinkedIn&rdquo; and &ldquo;Sales Navigator&rdquo; are trademarks of LinkedIn
              Corporation. We refer to them only to describe, accurately and factually, the kind of
              file the Service reads. No sponsorship or endorsement is claimed or implied.
            </p>
          </Callout>
        </Section>

        <Section title="14. Availability, Changes, and Support">
          <ul className="list-disc space-y-2 pl-5">
            <li>
              We aim for high availability but do not commit to an uptime service level. The Service
              may be unavailable for maintenance, updates, or reasons outside our control.
            </li>
            <li>
              We may add, change, or remove features. If we materially reduce a core feature of a
              paid plan, we will give reasonable notice.
            </li>
            <li>
              <strong>The Service depends on the structure of the files you upload.</strong> That
              structure is controlled by a third party and can change without notice. If it changes,
              extraction may return fewer fields, or fail, until we ship an update. We will make
              reasonable efforts to restore it, but we do not guarantee that any given file will
              ever parse successfully.
            </li>
            <li>Support is provided by email on a commercially reasonable basis.</li>
          </ul>
        </Section>

        <Section title="15. Suspension and Termination">
          <ul className="list-disc space-y-2 pl-5">
            <li>
              We may suspend or terminate your access immediately if you breach these Terms, if your
              use creates legal risk or risk to the Service or other customers, if payment is
              overdue, or if required by law.
            </li>
            <li>
              You may stop using the Service and delete your account at any time.
            </li>
            <li>
              On termination, your right to use the Service ends immediately. Export your data
              first — we are not obliged to retain it after termination.
            </li>
            <li>
              Sections 4, 5, 10, 12, 13, 16, 17, 18, and 20 survive termination.
            </li>
          </ul>
        </Section>

        <Section title="16. Disclaimers">
          <p>
            To the maximum extent permitted by law, the Service is provided &ldquo;as is&rdquo; and
            &ldquo;as available,&rdquo; without warranties of any kind, express or implied,
            including merchantability, fitness for a particular purpose, and non-infringement.
          </p>
          <p>
            We do not warrant that the Service will be uninterrupted or error-free, that any file
            will parse successfully, or that Extracted Data will be accurate, complete, or current.
            Extracted Data reflects only what appeared in the file you uploaded at the moment you
            saved it. <strong>We never infer, enrich, or invent missing values</strong> — a field
            that was not in your file is returned empty. You are responsible for verifying Extracted
            Data before relying on it.
          </p>
        </Section>

        <Section title="17. Limitation of Liability">
          <p>
            To the maximum extent permitted by law, Outlio&apos;s total aggregate liability for all
            claims arising out of or relating to the Service is limited to the greater of (a) the
            fees you paid to Outlio for the Service in the three months before the event giving rise
            to the claim, or (b) one hundred US dollars.
          </p>
          <p>
            Outlio is not liable for indirect, incidental, special, consequential, punitive, or
            exemplary damages, or for lost profits, lost revenue, lost data, lost goodwill, or
            reputational harm — including, without limitation, any loss arising from suspension or
            termination of your account on a third-party platform as described in Section 5, or from
            any regulatory action or claim arising from your use of Extracted Data.
          </p>
          <p>
            Nothing in these Terms excludes liability for fraud, for death or personal injury caused
            by negligence, or for anything else that cannot lawfully be excluded.
          </p>
        </Section>

        <Section title="18. Indemnity">
          <p>
            You will defend, indemnify, and hold harmless Outlio and its officers, employees, and
            contractors from any claim, demand, investigation, loss, liability, damage, fine, or
            cost (including reasonable legal fees) arising out of or relating to:
          </p>
          <ul className="list-disc space-y-2 pl-5">
            <li>the files you upload and how you obtained them;</li>
            <li>your use of Extracted Data, including any outreach you send;</li>
            <li>
              your breach of these Terms, of any third-party platform terms, or of any applicable
              law, including data protection and marketing law;
            </li>
            <li>
              any claim by an individual whose personal data you processed through the Service, or
              by a data protection authority in connection with that processing.
            </li>
          </ul>
        </Section>

        <Section title="19. Privacy and Data Protection">
          <p>
            Our handling of personal data is described in the{" "}
            <Link href="/leadengine/privacy" className="font-medium text-accent">
              Lead Engine Privacy Policy
            </Link>
            , which forms part of these Terms. Where we process personal data contained in your
            Uploaded Files, we do so on your instructions as your processor, on the terms set out in
            Section 12 of that policy. A separate signed data processing agreement is available on
            request at{" "}
            <a href="mailto:husnain@outlio.io" className="font-medium text-accent">
              husnain@outlio.io
            </a>
            .
          </p>
        </Section>

        <Section title="20. Governing Law and Disputes">
          <p>
            These Terms are governed by the laws of the State of Delaware, USA, without regard to
            conflict-of-law principles. Disputes will first be addressed through good-faith
            negotiation; if unresolved within 30 days, they will be settled by binding arbitration
            in Delaware. Either party may seek injunctive relief in any court of competent
            jurisdiction to protect its intellectual property or confidential information.
          </p>
          <p>
            If you are a consumer resident in the UK or EU, this Section does not deprive you of the
            protection of the mandatory laws of your country of residence, or of your right to bring
            proceedings in your local courts.
          </p>
        </Section>

        <Section title="21. General">
          <ul className="list-disc space-y-2 pl-5">
            <li>
              These Terms, together with the Privacy Policy and your plan details, are the entire
              agreement between us for the Service.
            </li>
            <li>
              If any provision is held unenforceable, the rest remains in force.
            </li>
            <li>
              Our failure to enforce a provision is not a waiver of it.
            </li>
            <li>
              You may not assign these Terms without our written consent. We may assign them in
              connection with a merger, acquisition, or sale of assets.
            </li>
            <li>
              We may update these Terms. For material changes we will give reasonable notice by
              email or in the product. Continued use after the effective date means you accept them.
            </li>
          </ul>
        </Section>

        <Section title="22. Contact">
          <p>
            Questions about these Terms:{" "}
            <a href="mailto:husnain@outlio.io" className="font-semibold text-accent">
              husnain@outlio.io
            </a>
          </p>
        </Section>
      </main>
      <Footer surface="leadengine" />
    </>
  );
}
