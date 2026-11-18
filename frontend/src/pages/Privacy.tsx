import { useEffect } from 'react';

export default function PrivacyPage() {
  useEffect(() => {
    if (window.location.hash) {
      document.getElementById(window.location.hash.slice(1))?.scrollIntoView();
    }
  }, []);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-3xl mx-auto px-6 py-16">
        <h1 className="text-3xl font-bold mb-2">Privacy Policy</h1>
        <p className="text-sm text-muted-foreground mb-10">Last updated: September 2026</p>

        <section className="space-y-8 text-sm leading-relaxed">
          <div>
            <h2 className="text-lg font-semibold mb-2">1. Information We Collect</h2>
            <p>
              GenXCRM collects information you provide directly, including name, email address,
              phone number, and business details when you register or use our services. We also
              collect lead data submitted through integrated sources such as Facebook Lead Ads,
              Google Ads, Google Forms, and manual imports.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold mb-2">2. How We Use Your Information</h2>
            <p>We use collected information to:</p>
            <ul className="list-disc pl-5 mt-2 space-y-1">
              <li>Provide and operate the GenXCRM platform</li>
              <li>Assign and manage sales leads within your organisation</li>
              <li>Send transactional emails and notifications</li>
              <li>Generate reports and analytics for your business</li>
              <li>Process payments and manage billing</li>
            </ul>
          </div>

          <div>
            <h2 className="text-lg font-semibold mb-2">3. Facebook Data</h2>
            <p>
              When you connect Facebook Lead Ads, GenXCRM accesses lead data (name, email,
              phone) from your Facebook Page forms via the Meta Graph API. This data is stored
              securely within your organisation's account and is never shared with third parties.
              You may disconnect Facebook at any time from the Integrations settings page.
            </p>
          </div>

          <div id="google-user-data">
            <h2 className="text-lg font-semibold mb-2">4. Google Forms and Google Drive Data</h2>
            <p>
              GenXCRM lets you connect your Google account so that forms you send to your leads
              (for example, a student details form during registration) feed their answers back
              into GenXCRM. This section explains how we handle the Google user data involved.
            </p>
            <p className="mt-3 font-medium">What we access</p>
            <ul className="list-disc pl-5 mt-2 space-y-1">
              <li>
                We request a single Google permission, <code>drive.file</code> ("See, edit,
                create and delete only the specific Google Drive files you use with this app").
                It gives GenXCRM access only to the Google Forms and Google Sheets that you
                choose in Google's file picker, or that GenXCRM creates for you (for example a
                sheet for your form's responses). We cannot see any other file in your Google
                Drive.
              </li>
              <li>
                From the form you choose, we read its questions and the responses your leads
                submit, and we add one short-answer question titled "Lead ID" so that each
                response can be matched to the right lead.
              </li>
              <li>
                To the sheet you choose, we add one row for each response, plus the lead's name
                and the name of the person it is assigned to.
              </li>
              <li>
                We also store the name of the Google account you connected so you can see which
                account is linked.
              </li>
            </ul>
            <p className="mt-3 font-medium">How we use it</p>
            <p className="mt-2">
              We use this data only to provide these features to you: showing form responses in
              GenXCRM (registration and lead details), attaching them to
              the right lead, and writing them to your sheet. We do not use Google user data for
              advertising, we do not sell it, and we do not use it to develop, improve or train
              generalised artificial intelligence or machine-learning models. We do not allow
              people to read your Google user data unless you ask us to, it is needed for
              security or to investigate abuse, or the law requires it.
            </p>
            <p className="mt-3 font-medium">Storage and protection</p>
            <p className="mt-2">
              The access token GenXCRM receives from Google is encrypted before storage. Form
              responses are stored within your organisation's account, visible only to users in
              your organisation according to their role, and are kept and deleted as described
              in Section 6.
            </p>
            <p className="mt-3 font-medium">Sharing</p>
            <p className="mt-2">
              We do not transfer Google user data to third parties except as needed to provide
              and operate the service (for example, our hosting provider), to comply with the
              law, or as part of a merger or sale of the business, in which case you will be
              informed.
            </p>
            <p className="mt-3 font-medium">Your control</p>
            <p className="mt-2">
              You can disconnect Google at any time from Integrations, Google Forms, Disconnect.
              This revokes GenXCRM's access at Google and deletes the stored token, and syncing
              stops. You can also remove GenXCRM's access from your Google account at{' '}
              <a
                href="https://myaccount.google.com/permissions"
                className="underline"
                target="_blank"
                rel="noopener noreferrer"
              >
                myaccount.google.com/permissions
              </a>
              . Responses already imported remain part of your organisation's lead data until you
              ask for deletion as described in Section 6.
            </p>
            <p className="mt-3">
              GenXCRM's use and transfer to any other app of information received from Google
              APIs will adhere to the{' '}
              <a
                href="https://developers.google.com/terms/api-services-user-data-policy"
                className="underline"
                target="_blank"
                rel="noopener noreferrer"
              >
                Google API Services User Data Policy
              </a>
              , including the Limited Use requirements.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold mb-2">5. Data Sharing</h2>
            <p>
              We do not sell, trade, or rent your personal information to third parties.
              We may share data with service providers (payment processors, email providers)
              solely to operate the platform, under strict confidentiality agreements.
            </p>
          </div>

          <div id="data-deletion">
            <h2 className="text-lg font-semibold mb-2">6. Data Retention and Deletion</h2>
            <p>
              To request deletion of your account and associated data, email{' '}
              <a href="mailto:support@genxcrm.co.in" className="underline">
                support@genxcrm.co.in
              </a>{' '}
              from your registered account email address with the subject "Delete My Account".
              Within 30 days we will anonymise all personally identifiable information (name,
              email, phone) associated with your account. Organisation-level business data
              (leads, communications, reports) is retained for 90 days after account closure
              before permanent deletion, as required for legal and audit purposes.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold mb-2">7. Security</h2>
            <p>
              We use industry-standard encryption (TLS in transit, AES-256 at rest) to protect
              your data. Access tokens for third-party integrations are encrypted before storage.
              We conduct regular security reviews and follow OWASP best practices.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold mb-2">8. Contact</h2>
            <p>
              For privacy-related questions or deletion requests, contact us at{" "}
              <a href="mailto:privacy@genxcrm.co.in" className="underline">
                privacy@genxcrm.co.in
              </a>
              .
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
