import type { Metadata } from "next";
import Link from "next/link";

import Nav from "../../components/Nav";
import Footer from "../../components/Footer";

export const metadata: Metadata = {
  title: "Lead Engine Privacy Policy | Outlio",
  description:
    "How Outlio Lead Engine handles account data, uploaded files, and the personal data of individuals whose details appear in them.",
  alternates: {
    canonical: "https://app.outlio.io/leadengine/privacy",
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

function Table({
  head,
  rows,
}: {
  head: string[];
  rows: React.ReactNode[][];
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left text-sm">
        <thead>
          <tr>
            {head.map((h) => (
              <th
                key={h}
                className="border-b border-border pb-2 pr-4 align-bottom font-semibold text-ink"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((cells, i) => (
            <tr key={i}>
              {cells.map((c, j) => (
                <td key={j} className="border-b border-border py-3 pr-4 align-top text-ink/80">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function LeadEnginePrivacy() {
  return (
    <>
      <Nav surface="leadengine" />
      <main className="mx-auto w-full max-w-3xl px-6 py-20 sm:py-28">
        <p className="text-[13px] font-semibold uppercase tracking-[0.22em] text-accent">
          Outlio &middot; Lead Engine &middot; Legal
        </p>
        <h1 className="mt-4 text-4xl font-bold uppercase tracking-tight sm:text-5xl">
          Lead Engine Privacy Policy
        </h1>
        <p className="mt-4 text-sm text-muted">Last updated: Monday, 10 August 2026</p>

        <div className="mt-10 space-y-4 leading-relaxed text-ink/80">
          <p>
            This policy explains how Outlio (&ldquo;we,&rdquo; &ldquo;us,&rdquo;
            &ldquo;our&rdquo;) handles personal data in Outlio Lead Engine (the
            &ldquo;Service&rdquo;). It covers both the people who hold Lead Engine accounts and the
            people whose professional details appear inside the files those account holders upload.
          </p>
          <p>
            It applies only to Lead Engine. Our website and our done-for-you outbound and video
            services are covered by the{" "}
            <Link href="/privacy" className="font-medium text-accent">
              main Outlio Privacy Policy
            </Link>
            .
          </p>
        </div>

        <Section title="1. The Short Version">
          <Callout>
            <ul className="list-disc space-y-2 pl-5">
              <li>
                We never connect to LinkedIn, and never ask for or hold your LinkedIn password,
                cookies, or session. We only read a page you opened yourself — uploaded as a file,
                or captured with our extension during a session you started.
              </li>
              <li>
                Your uploaded files and extracted records are deleted on a schedule set by your
                plan, or sooner if you clear them.
              </li>
              <li>
                <strong>One thing does outlive that:</strong> a short duplicate-detection key per
                record, so we can tell you who you have already seen. It is pseudonymous, not
                anonymous. Section 5 explains precisely what it contains.
              </li>
              <li>We do not sell personal data, and we do not train AI models on your data.</li>
            </ul>
          </Callout>
        </Section>

        <Section title="2. Our Role, and Yours">
          <p>Two different kinds of personal data flow through the Service, with different roles:</p>
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <strong>Account data</strong> — your name, email, and how you use the Service. For
              this, Outlio is the <strong>controller</strong>. We decide why and how it is
              processed.
            </li>
            <li>
              <strong>Data inside uploaded files</strong> — the professional details of the people
              in your search results. For this, <strong>you are the controller</strong> and Outlio
              acts as your <strong>processor</strong>. You choose which files to upload, why, and
              what happens to the output. We only process on your instructions.
            </li>
          </ul>
          <p>
            Because you are the controller of that second category, you are responsible for having a
            lawful basis to process it, for meeting transparency obligations to those individuals,
            and for responding to their requests. Section 12 sets out the terms on which we process
            it for you.
          </p>
        </Section>

        <Section title="3. Account Data We Collect">
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <strong>Registration and verification details</strong> — name, work email, phone
              number, country, company, and your own LinkedIn profile URL.
            </li>
            <li>
              <strong>Authentication data</strong> — a hashed password held by our authentication
              provider, email verification state, and session records. We never see your password in
              readable form.
            </li>
            <li>
              <strong>Billing data</strong> — plan, credit balance, invoices, and transaction
              history. Card details are handled by our payment processor and never reach our
              servers.
            </li>
            <li>
              <strong>Support correspondence</strong> — messages you send us.
            </li>
          </ul>
        </Section>

        <Section title="4. Uploaded Files and Extracted Records">
          <p>
            When you upload a file, we store the file itself in a private bucket and, once
            processed, the structured records extracted from it. Extracted records may include a
            person&apos;s name, job title, employer, location, profile URL, public summary line, and
            time in role or at the company.
          </p>
          <ul className="list-disc space-y-2 pl-5">
            <li>
              Files are stored under a server-generated path. Your filename is never used to build a
              storage path.
            </li>
            <li>
              <strong>Uploaded files are never rendered in a browser.</strong> They are parsed
              server-side only, which means uploaded content cannot execute against you or us.
            </li>
            <li>
              <strong>We never infer, enrich, or invent values.</strong> A field absent from your
              file is stored as empty. We do not append emails, phone numbers, or any data from
              other sources.
            </li>
            <li>
              If a file contains authentication material such as cookies or tokens, it is stripped
              and never stored.
            </li>
            <li>
              Files and extracted records are deleted per the schedule in Section 7, or immediately
              when you clear them.
            </li>
          </ul>
        </Section>

        <Section title="4a. The Browser Extension">
          <p>
            The extension is an optional alternative to uploading files. It reads a page you have
            already opened and sends it to the same processing pipeline. What it does and does not
            do:
          </p>
          <Table
            head={["Behaviour", "Detail"]}
            rows={[
              [
                "Only while a session is active",
                <>
                  It reads nothing until you press Start Capture, and stops the moment you press
                  Finish. A badge on the toolbar shows whenever a session is running.
                </>,
              ],
              [
                "Only supported pages",
                <>Restricted to lead search-results pages. It has no access to any other site.</>,
              ],
              [
                "Only page content",
                <>
                  The page HTML, its address, and a page number. <strong>Never</strong> your
                  passwords, cookies, session tokens, saved logins, payment details, or browsing
                  history.
                </>,
              ],
              [
                "It never navigates for you",
                <>
                  No automatic clicking, paging, messaging or filtering. You browse; it observes
                  only the page you chose to capture.
                </>,
              ],
              [
                "Retention",
                <>
                  Captured pages follow the same schedule as uploaded files in Section 8, and you
                  can clear them at any time.
                </>,
              ],
            ]}
          />
          <p>
            Disconnecting a browser under Settings → Browser Extension revokes its access
            immediately. You can also delete the extension outright; neither affects leads you have
            already exported.
          </p>
        </Section>

        <Section title="5. Duplicate-Detection Keys — Read This One">
          <p>
            The Service tells you when a person appears in a new upload that you have already seen
            before. To do that after the underlying records are deleted, we keep one short key per
            record. <strong>These keys are retained for the life of your account.</strong>
          </p>
          <p>
            <strong>Every key is a one-way SHA-256 hash.</strong> Whichever details the source file
            contained, they are hashed before storage and the original text is never written down:
          </p>
          <Table
            head={["What identified the person", "What we store", "Readable personal data?"]}
            rows={[
              [
                "A LinkedIn member identifier",
                <>a one-way hash of it</>,
                <>No</>,
              ],
              [
                "A name, job title, and employer",
                <>a one-way hash of the three together</>,
                <>No</>,
              ],
              [
                "A name and employer",
                <>a one-way hash of the two together</>,
                <>No</>,
              ],
              [
                "Neither of the above",
                <>a one-way hash of the whole record</>,
                <>No</>,
              ],
            ]}
          />
          <Callout>
            <p>
              <strong>We want to be exact about this, because it matters.</strong> A hash carries no
              readable name, employer or profile link, and cannot be turned back into one. But it is
              still <em>pseudonymous</em>, not anonymous: the same person produces the same hash
              every time, so it singles them out. Under the GDPR pseudonymous data is still personal
              data, and we treat it that way rather than calling it anonymous.
            </p>
            <p className="mt-3">
              We keep them for one purpose only: telling you that you have seen someone before. They
              are never used to build a profile, are never shared, are never sold, and are scoped to
              your account alone. They are deleted when you delete your account, and we will erase
              them on request — see Sections 10 and 11.
            </p>
          </Callout>
        </Section>

        <Section title="6. Anti-Abuse and Technical Data">
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <strong>Trial-eligibility signals.</strong> To enforce one free trial per person, we
              store a keyed one-way hash derived from the network address used at sign-up, a signed
              first-party browser token, and keyed hashes of normalised account identifiers. We do
              not store the raw network address or a raw device fingerprint in these records. They
              are removed when the associated account is deleted.
            </li>
            <li>
              <strong>Security and rate-limit logs.</strong> Timestamps, event types, and hashed
              identifiers used to detect abuse and to rate-limit sign-in, upload, export, and admin
              routes.
            </li>
            <li>
              <strong>Operational logs.</strong> Error and performance records from our hosting and
              database providers. We never log lead records, file contents, tokens, signed URLs, or
              cookies.
            </li>
            <li>
              <strong>Admin audit logs.</strong> Every administrative action on an account is
              recorded, append-only, for accountability.
            </li>
          </ul>
        </Section>

        <Section title="7. Why We Process Data, and Our Legal Bases">
          <Table
            head={["Purpose", "Data", "Legal basis (UK/EU GDPR)"]}
            rows={[
              [
                "Providing the Service",
                "Account data, uploaded files, extracted records",
                "Performance of a contract (Art. 6(1)(b))",
              ],
              [
                "Duplicate detection",
                "Duplicate-detection keys",
                "Performance of a contract; legitimate interests (Art. 6(1)(b), (f))",
              ],
              [
                "Billing and tax",
                "Billing data",
                "Contract; legal obligation (Art. 6(1)(b), (c))",
              ],
              [
                "Preventing fraud and trial abuse",
                "Anti-abuse signals",
                "Legitimate interests (Art. 6(1)(f))",
              ],
              [
                "Security, and keeping the Service running",
                "Logs, audit records",
                "Legitimate interests; legal obligation (Art. 6(1)(f), (c))",
              ],
              [
                "Service and security notices",
                "Account data",
                "Contract; legitimate interests (Art. 6(1)(b), (f))",
              ],
            ]}
          />
          <p>
            Where we rely on legitimate interests, we have balanced those interests against your
            rights and concluded the processing is proportionate. You may object at any time — see
            Section 10.
          </p>
          <p>
            <strong>We do not sell personal data</strong>, and we do not share it for cross-context
            behavioural advertising, as those terms are defined under the CCPA/CPRA.{" "}
            <strong>We do not use your data to train AI or machine learning models.</strong>
          </p>
        </Section>

        <Section title="8. How Long We Keep Things">
          <Table
            head={["Data", "Retention"]}
            rows={[
              [
                "Uploaded files and extracted records",
                <>
                  Deleted on your plan&apos;s schedule — 3 days on the free trial, 30 days on Lead
                  Engine, 90 days on Pro, 365 days on Pro + Hubble — or immediately when you clear them.
                </>,
              ],
              [
                "Generated CSV exports",
                <>Removed on the same schedule as the extraction that produced them.</>,
              ],
              [
                "Duplicate-detection keys",
                <>
                  <strong>For the life of the account.</strong> Deleted with the account, or earlier
                  on request.
                </>,
              ],
              ["Account and profile data", <>Until you delete your account.</>],
              [
                "Anti-abuse signals",
                <>While the account exists; removed when the account is deleted.</>,
              ],
              [
                "Billing records",
                <>Up to 7 years, where tax and accounting law requires it.</>,
              ],
              [
                "Security and admin audit logs",
                <>Up to 12 months, or longer where needed for a live investigation.</>,
              ],
            ]}
          />
        </Section>

        <Section title="9. Who We Share Data With">
          <p>
            We use a small number of infrastructure providers. Each is bound by a data processing
            agreement and may use data only to provide its service to us.
          </p>
          <Table
            head={["Provider", "What it does", "Where"]}
            rows={[
              ["Supabase", "Database, authentication, file storage", "EU / US"],
              ["Vercel", "Application hosting and delivery", "Global edge"],
              ["Resend", "Transactional email — verification, password reset, notices", "EU / US"],
              ["Stripe", "Payment processing, where card payment is enabled", "EU / US"],
              ["Calendly", "Scheduling, if you book a call with us", "US"],
            ]}
          />
          <p>
            We also disclose data where legally required, to enforce our terms, or in connection
            with a merger or acquisition — in which case we will give notice before your data
            becomes subject to a different policy. An up-to-date list of sub-processors is available
            at{" "}
            <a href="mailto:husnain@outlio.io" className="font-medium text-accent">
              husnain@outlio.io
            </a>
            .
          </p>
        </Section>

        <Section title="10. Your Rights as an Account Holder">
          <p>
            Depending on where you live, you may have the right to access, correct, delete, port,
            restrict, or object to our processing of your personal data, and to withdraw consent
            where we rely on it. UK and EU residents may also lodge a complaint with their local
            supervisory authority. California residents have equivalent rights under the CCPA/CPRA,
            and will not be discriminated against for exercising them.
          </p>
          <p>
            You can delete your account and its data yourself from your account settings. For
            anything else, email{" "}
            <a href="mailto:husnain@outlio.io" className="font-medium text-accent">
              husnain@outlio.io
            </a>
            . We respond within 30 days.
          </p>
        </Section>

        <Section title="11. If Your Details Appeared in Someone Else's Upload">
          <p>
            You may be reading this because your professional details were processed through Lead
            Engine by one of our customers. Here is the accurate picture:
          </p>
          <ul className="list-disc space-y-2 pl-5">
            <li>
              We did not collect your data from LinkedIn or from anywhere else. Our customer saved a
              page they were already viewing under their own account, and uploaded that file.
            </li>
            <li>
              <strong>That customer is the data controller</strong> for your data. They decided to
              process it and are the right party for questions about why. If you ask us who they
              are, we will tell you, unless doing so is unlawful.
            </li>
            <li>
              Your details are deleted from our systems on the schedule in Section 8. A
              duplicate-detection key as described in Section 5 may persist in that customer&apos;s
              account.
            </li>
          </ul>
          <p>
            <strong>You can ask us directly to erase your data.</strong> Email{" "}
            <a href="mailto:husnain@outlio.io" className="font-medium text-accent">
              husnain@outlio.io
            </a>{" "}
            with the name and profile URL that identify you. We will delete any matching extracted
            records and duplicate-detection keys across all customer accounts, and confirm when it
            is done. We will not ask you to justify the request, and we will not charge for it.
          </p>
        </Section>

        <Section title="12. Processing Terms (Data Processing Addendum)">
          <p>
            This Section applies where Outlio acts as processor for personal data in your uploaded
            files, and forms part of our{" "}
            <Link href="/leadengine/terms" className="font-medium text-accent">
              Lead Engine Terms of Service
            </Link>
            . We will:
          </p>
          <ul className="list-disc space-y-2 pl-5">
            <li>
              Process that data only on your documented instructions, which your use of the Service
              constitutes, and for no independent purpose of our own.
            </li>
            <li>
              Apply appropriate technical and organisational measures, as described in Section 13.
            </li>
            <li>
              Bind everyone with access to a duty of confidentiality.
            </li>
            <li>
              Engage sub-processors only as listed in Section 9, under equivalent obligations, and
              give notice before adding a new one.
            </li>
            <li>
              Assist you, so far as is reasonable, with data subject requests, impact assessments,
              and regulator engagement.
            </li>
            <li>
              Notify you without undue delay, and in any case within 72 hours, on becoming aware of
              a personal data breach affecting your data.
            </li>
            <li>
              Delete the data on termination, subject to the retention in Section 8, and make
              available the information needed to demonstrate compliance.
            </li>
          </ul>
          <p>
            <strong>Subject matter:</strong> extraction of structured records from files you upload.{" "}
            <strong>Duration:</strong> your subscription, plus the retention periods in Section 8.{" "}
            <strong>Categories of data subject:</strong> the business professionals appearing in
            your files. <strong>Categories of data:</strong> name, job title, employer, location,
            public profile URL, public summary line, tenure.
          </p>
          <p>
            International transfers are made under the EU Standard Contractual Clauses and the UK
            International Data Transfer Addendum where required. A separate signed DPA is available
            on request.
          </p>
        </Section>

        <Section title="13. Security">
          <ul className="list-disc space-y-2 pl-5">
            <li>Data is encrypted in transit and at rest by our infrastructure providers.</li>
            <li>
              Every database table enforces row-level security, so one customer cannot read
              another&apos;s data.
            </li>
            <li>
              Uploaded files sit in a private bucket. They are reachable only through short-lived
              signed URLs, and never over a public path.
            </li>
            <li>Uploads are validated by inspecting file content, not by trusting the extension.</li>
            <li>
              Authorisation is enforced server-side on every request. Administrative access requires
              multi-factor authentication, and there is no self-service route to it.
            </li>
            <li>Sign-in, upload, export, and admin routes are rate-limited.</li>
          </ul>
          <p>
            No system is perfectly secure. If you believe you have found a vulnerability, please
            report it to{" "}
            <a href="mailto:husnain@outlio.io" className="font-medium text-accent">
              husnain@outlio.io
            </a>{" "}
            rather than disclosing it publicly, and we will work with you.
          </p>
        </Section>

        <Section title="14. Cookies">
          <p>
            Lead Engine uses <strong>essential cookies only</strong> — to keep you signed in, to
            protect against cross-site request forgery, and to enforce trial eligibility. There are
            no third-party analytics, advertising, or tracking cookies in the product. Blocking
            essential cookies will prevent sign-in from working.
          </p>
        </Section>

        <Section title="15. Children">
          <p>
            The Service is for business use and is not directed at anyone under 18. We do not
            knowingly collect data from children, and you must not upload files containing data
            about them. If you believe a child&apos;s data has reached us, contact us and we will
            delete it.
          </p>
        </Section>

        <Section title="16. Changes to This Policy">
          <p>
            We may update this policy. The date at the top always reflects the current version. For
            material changes affecting your rights, we will give notice by email or in the product
            before they take effect.
          </p>
        </Section>

        <Section title="17. Contact">
          <p>
            Privacy questions, data requests, and erasure requests:{" "}
            <a href="mailto:husnain@outlio.io" className="font-semibold text-accent">
              husnain@outlio.io
            </a>
          </p>
          <p>
            Outlio is the data controller for account data. If you are in the UK or EU and are not
            satisfied with our response, you may complain to your local data protection authority.
          </p>
        </Section>
      </main>
      <Footer surface="leadengine" />
    </>
  );
}
