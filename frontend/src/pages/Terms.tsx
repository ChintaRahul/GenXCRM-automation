export default function TermsPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-3xl mx-auto px-6 py-16">
        <h1 className="text-3xl font-bold mb-2">Terms of Service</h1>
        <p className="text-sm text-muted-foreground mb-10">Last updated: September 2026</p>

        <section className="space-y-8 text-sm leading-relaxed">
          <div>
            <h2 className="text-lg font-semibold mb-2">1. Acceptance of Terms</h2>
            <p>
              By accessing or using GenXCRM, you agree to be bound by these Terms of Service.
              If you do not agree, do not use the platform.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold mb-2">2. Use of the Service</h2>
            <p>
              GenXCRM is a CRM platform for EdTech businesses. You may use it solely for lawful
              purposes related to managing your sales leads and customer relationships. You agree
              not to misuse the platform, attempt unauthorised access, or use it to process data
              you do not have rights to handle.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold mb-2">3. Accounts and Organisations</h2>
            <p>
              Each account belongs to an organisation. Organisation owners are responsible for
              all activity under their account. You must keep your credentials secure and notify
              us immediately of any unauthorised access.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold mb-2">4. Third-Party Integrations</h2>
            <p>
              GenXCRM integrates with third-party services (Meta, Google, Razorpay, Twilio,
              and others). Your use of those services is governed by their respective terms.
              We are not responsible for the availability or accuracy of third-party services.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold mb-2">5. Billing and Payments</h2>
            <p>
              Subscription fees are billed in advance on a monthly or annual basis. All fees
              are non-refundable except as required by applicable law. We reserve the right to
              suspend access for non-payment after a 7-day grace period.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold mb-2">6. Intellectual Property</h2>
            <p>
              GenXCRM and all associated software, designs, and content are the property of
              GenXCRM and its licensors. You retain ownership of your own data. You grant us
              a limited licence to store and process your data solely to provide the service.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold mb-2">7. Limitation of Liability</h2>
            <p>
              To the maximum extent permitted by law, GenXCRM shall not be liable for any
              indirect, incidental, or consequential damages arising from your use of the
              platform. Our total liability is limited to the fees paid by you in the 3 months
              preceding the claim.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold mb-2">8. Termination</h2>
            <p>
              Either party may terminate the agreement at any time. Upon termination, your
              access is revoked and your data is retained for 90 days before deletion,
              unless you request earlier erasure.
            </p>
          </div>

          <div id="plan-limits" className="scroll-mt-16">
            <h2 className="text-lg font-semibold mb-2">9. Plan Limits &amp; Fair Use</h2>
            <p className="mb-3">
              GenXCRM is offered on a free Trial and a paid Pro plan, each with its own resource
              limits. These limits are enforced automatically and may change as plans evolve;
              the current allowances are also shown on the Billing page.
            </p>
            <p className="mb-1 font-medium text-foreground">Trial (14 days)</p>
            <ul className="list-disc list-inside mb-3 space-y-0.5">
              <li>Up to 100 leads, 1 team, and 2 nurturing sequences</li>
              <li>1,000 emails per rolling 30-day cycle</li>
              <li>
                No WhatsApp messages through GenXCRM&apos;s shared WhatsApp number — WhatsApp
                sending on Trial requires connecting your own WhatsApp Business API account
              </li>
            </ul>
            <p className="mb-1 font-medium text-foreground">Pro plan</p>
            <ul className="list-disc list-inside mb-3 space-y-0.5">
              <li>Up to 10,000 leads, 10 teams, and 10 nurturing sequences; unlimited users (billed per seat)</li>
              <li>10,000 emails per rolling 30-day cycle</li>
              <li>
                1,000 WhatsApp messages as a one-time credit (it does not renew monthly) when
                sending through GenXCRM&apos;s shared WhatsApp number. Connecting your own
                WhatsApp Business API account removes this limit entirely. Once the one-time
                credit is used, further shared-number sending requires purchasing additional
                WhatsApp credits
              </li>
            </ul>
            <p>
              Reaching a limit blocks the specific action (e.g. creating another lead, or
              sending another email or WhatsApp message) until the next cycle, an upgrade, or
              an add-on purchase, as applicable. It never deletes existing data.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold mb-2">10. Contact</h2>
            <p>
              For questions about these terms, contact us at{" "}
              <a href="mailto:support@genxcrm.co.in" className="underline">
                support@genxcrm.co.in
              </a>
              .
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
