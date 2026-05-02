import { Link } from 'react-router-dom'

export default function Privacy() {
  return (
    <div className="min-h-screen bg-white py-12 px-4">
      <div className="max-w-4xl mx-auto">
        <div className="mb-8">
          <Link to="/" className="text-blue-600 hover:text-blue-800 text-sm font-medium">&larr; Back to App</Link>
        </div>

        <h1 className="text-3xl font-bold text-gray-900 mb-2">Privacy Policy</h1>
        <p className="text-sm text-gray-500 mb-10">Effective Date: May 1, 2026</p>

        <div className="prose prose-gray max-w-none space-y-8 text-gray-700 leading-relaxed">

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">1. Introduction</h2>
            <p>SellerPulse LLC ("Company," "we," "us," or "our") operates sellers-pulse.com and the SellerPulse platform (the "Service"). This Privacy Policy explains how we collect, use, store, and protect information about you when you use our Service. By using the Service, you agree to the practices described in this policy.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">2. Information We Collect</h2>
            <p><strong>Account Information:</strong> When you register, we collect your name, email address, business name, and password (stored as a secure hash).</p>
            <p className="mt-2"><strong>Amazon SP-API Credentials:</strong> To connect your Amazon seller account, we collect and store your Amazon SP-API credentials (including refresh tokens and seller identifiers). These credentials are encrypted at rest using AES-256 encryption and are used solely to retrieve your Amazon data on your behalf.</p>
            <p className="mt-2"><strong>Usage Data:</strong> We automatically collect information about how you interact with the Service, including pages visited, features used, timestamps, IP addresses, browser type, and device information. This data is used to operate, improve, and secure the Service.</p>
            <p className="mt-2"><strong>Payment Information:</strong> Payment processing is handled entirely by Stripe. We do not store your full credit card number, CVV, or other sensitive payment details on our servers. We receive and store non-sensitive billing information such as the last four digits of your card, card brand, and billing address as returned by Stripe.</p>
            <p className="mt-2"><strong>Support Communications:</strong> If you contact us for support, we retain records of those communications to help resolve your issue and improve our service.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">3. How We Use Your Information</h2>
            <p>We use the information we collect to:</p>
            <ul className="list-disc pl-6 mt-2 space-y-1">
              <li>Provide, operate, and maintain the Service.</li>
              <li>Authenticate your identity and manage your account.</li>
              <li>Retrieve and display your Amazon seller data via the SP-API.</li>
              <li>Process payments and manage your subscription through Stripe.</li>
              <li>Send transactional emails (e.g., account confirmation, billing receipts, password resets).</li>
              <li>Monitor for errors and diagnose technical issues.</li>
              <li>Comply with legal obligations and enforce our Terms of Service.</li>
              <li>Improve and develop new features based on aggregate, anonymized usage patterns.</li>
            </ul>
            <p className="mt-2">We do not sell your personal information to third parties.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">4. How We Store and Protect Your Data</h2>
            <p><strong>Encryption at Rest:</strong> Sensitive data, including Amazon SP-API credentials and personal account information, is encrypted at rest using AES-256.</p>
            <p className="mt-2"><strong>Encryption in Transit:</strong> All data transmitted between your browser and our servers is protected by TLS (Transport Layer Security).</p>
            <p className="mt-2"><strong>Access Controls:</strong> Access to production systems and customer data is restricted to authorized personnel on a need-to-know basis.</p>
            <p className="mt-2">Despite our security measures, no method of transmission or storage is 100% secure. We cannot guarantee absolute security and are not responsible for unauthorized access that is beyond our reasonable control.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">5. Third-Party Services</h2>
            <p>We share data with the following third-party services as necessary to operate the Service:</p>
            <ul className="list-disc pl-6 mt-2 space-y-1">
              <li><strong>Stripe</strong> — Payment processing and subscription management. (<a href="https://stripe.com/privacy" target="_blank" rel="noreferrer" className="text-blue-600 hover:text-blue-800">Stripe Privacy Policy</a>)</li>
              <li><strong>SendGrid / Resend</strong> — Transactional email delivery for account and billing notifications.</li>
              <li><strong>Sentry</strong> — Application error monitoring. Error reports may include anonymized stack traces and session context.</li>
              <li><strong>Amazon SP-API</strong> — We communicate with Amazon's Selling Partner API on your behalf using credentials you provide. Your data is subject to Amazon's applicable policies.</li>
              <li><strong>Keepa</strong> — Product and pricing data lookups used within the Service. Only product identifiers (e.g., ASIN) are shared, not personal information.</li>
            </ul>
            <p className="mt-2">We do not share your personal data with any other third parties except as required by law or with your explicit consent.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">6. Cookies</h2>
            <p>We use session cookies to maintain your authenticated session while you are logged in to the Service. These cookies are strictly necessary for the Service to function and are deleted when you close your browser or log out. We do not use tracking cookies, advertising cookies, or any third-party analytics cookies. No cookie consent banner is required for session-only cookies under applicable law.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">7. Data Retention</h2>
            <p>We retain your account data for as long as your account is active. If you cancel your subscription, we retain your data for up to 90 days to allow for account recovery, after which it is deleted or anonymized from our live systems. Backup copies may persist for up to an additional 30 days. Aggregated, anonymized usage statistics may be retained indefinitely.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">8. Your Rights</h2>
            <p>Depending on your location, you may have the following rights regarding your personal data:</p>
            <ul className="list-disc pl-6 mt-2 space-y-1">
              <li><strong>Access:</strong> Request a copy of the personal data we hold about you.</li>
              <li><strong>Correction:</strong> Request correction of inaccurate or incomplete data.</li>
              <li><strong>Erasure (GDPR Right to be Forgotten):</strong> Request deletion of your personal data. You can initiate account deletion directly from your account Settings page, or by contacting us at support@sellers-pulse.com.</li>
              <li><strong>Data Portability:</strong> Request an export of your data in a commonly used format.</li>
              <li><strong>Objection / Restriction:</strong> Object to or request restriction of certain processing activities.</li>
            </ul>
            <p className="mt-2">To exercise any of these rights, contact us at <a href="mailto:support@sellers-pulse.com" className="text-blue-600 hover:text-blue-800">support@sellers-pulse.com</a>. We will respond within 30 days.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">9. Children's Privacy</h2>
            <p>The Service is not directed to individuals under the age of 18. We do not knowingly collect personal information from minors. If we become aware that we have collected information from a minor, we will delete it promptly.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">10. Changes to This Policy</h2>
            <p>We may update this Privacy Policy from time to time. When we make material changes, we will update the effective date at the top of this page and notify you via email or in-app notice where appropriate. Your continued use of the Service after the updated policy takes effect constitutes your acceptance of the changes.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">11. Contact Us</h2>
            <p>If you have questions, concerns, or requests regarding this Privacy Policy or your personal data, please contact us:</p>
            <div className="mt-2 pl-4 border-l-4 border-gray-200">
              <p className="font-medium">SellerPulse LLC</p>
              <p>sellers-pulse.com</p>
              <p>Email: <a href="mailto:support@sellers-pulse.com" className="text-blue-600 hover:text-blue-800">support@sellers-pulse.com</a></p>
            </div>
          </section>

        </div>

        <div className="mt-12 pt-8 border-t border-gray-200 text-center">
          <Link to="/" className="text-blue-600 hover:text-blue-800 text-sm font-medium">&larr; Back to App</Link>
        </div>
      </div>
    </div>
  )
}
