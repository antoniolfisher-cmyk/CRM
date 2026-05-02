import { Link } from 'react-router-dom'

export default function Terms() {
  return (
    <div className="min-h-screen bg-white py-12 px-4">
      <div className="max-w-4xl mx-auto">
        <div className="mb-8">
          <Link to="/" className="text-blue-600 hover:text-blue-800 text-sm font-medium">&larr; Back to App</Link>
        </div>

        <h1 className="text-3xl font-bold text-gray-900 mb-2">Terms of Service</h1>
        <p className="text-sm text-gray-500 mb-10">Effective Date: May 1, 2026</p>

        <div className="prose prose-gray max-w-none space-y-8 text-gray-700 leading-relaxed">

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">1. Acceptance of Terms</h2>
            <p>By accessing or using SellerPulse ("Service"), operated by SellerPulse LLC ("Company," "we," "us," or "our") at sellers-pulse.com, you agree to be bound by these Terms of Service ("Terms"). If you do not agree to these Terms, do not use the Service. These Terms constitute a legally binding agreement between you and the Company.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">2. Description of Service</h2>
            <p>SellerPulse is a software-as-a-service (SaaS) customer relationship management platform designed for Amazon FBA (Fulfillment by Amazon) sellers. The Service provides tools for managing seller accounts, tracking inventory, monitoring orders, automating follow-ups, repricing, and analyzing sales performance via integration with the Amazon Selling Partner API (SP-API). Features are subject to change at our discretion.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">3. User Accounts</h2>
            <p>You must register for an account to use the Service. You agree to provide accurate, current, and complete information during registration and to keep your account information updated. You are responsible for maintaining the confidentiality of your login credentials and for all activity that occurs under your account. You must notify us immediately at support@sellers-pulse.com if you suspect unauthorized access to your account. The Company is not liable for any loss or damage arising from your failure to protect your credentials.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">4. Acceptable Use</h2>
            <p>You agree not to use the Service to:</p>
            <ul className="list-disc pl-6 mt-2 space-y-1">
              <li>Violate any applicable laws, regulations, or Amazon's Seller Policies or Terms of Service.</li>
              <li>Transmit malicious code, viruses, or any software that may harm the Service or its users.</li>
              <li>Attempt to gain unauthorized access to any part of the Service or its infrastructure.</li>
              <li>Scrape, crawl, or systematically extract data from the Service without prior written consent.</li>
              <li>Use the Service in any manner that could impair, overburden, or damage our servers or networks.</li>
              <li>Resell, sublicense, or otherwise commercialize the Service without authorization.</li>
            </ul>
            <p className="mt-2">We reserve the right to suspend or terminate accounts that violate this section.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">5. Payment and Billing</h2>
            <p>The Service is offered on a subscription basis. By subscribing, you authorize the Company to charge your payment method via Stripe on a recurring basis at the rate applicable to your selected plan. All fees are stated in U.S. dollars and are exclusive of applicable taxes, which you are responsible for paying.</p>
            <p className="mt-2"><strong>No Refunds.</strong> All payments are non-refundable. We do not provide refunds or credits for partial subscription periods, unused features, or plan downgrades. You may cancel your subscription at any time; cancellation takes effect at the end of the current billing period and you retain access through that date.</p>
            <p className="mt-2">We reserve the right to change subscription pricing upon reasonable notice. Continued use of the Service after a price change constitutes acceptance of the new pricing.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">6. Intellectual Property</h2>
            <p>The Service, including all software, designs, trademarks, logos, and content created by the Company, is owned by or licensed to SellerPulse LLC and is protected by applicable intellectual property laws. These Terms do not grant you any ownership rights in the Service. You are granted a limited, non-exclusive, non-transferable, revocable license to access and use the Service solely for your internal business purposes during your subscription term.</p>
            <p className="mt-2">You retain ownership of any data you upload or provide to the Service. By using the Service, you grant us a limited license to process your data as necessary to provide and improve the Service.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">7. Data and Privacy</h2>
            <p>Your use of the Service is also governed by our <a href="/privacy" className="text-blue-600 hover:text-blue-800 underline">Privacy Policy</a>, which is incorporated into these Terms by reference. By using the Service, you consent to the collection and use of your data as described in the Privacy Policy.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">8. Termination</h2>
            <p>You may terminate your account at any time through your account settings. The Company may suspend or terminate your account immediately, without prior notice or liability, if you breach these Terms or if we reasonably determine your use poses a risk to the Service or other users. Upon termination, your right to access the Service ceases immediately. Provisions that by their nature should survive termination will survive, including Sections 5, 6, 9, and 10.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">9. Limitation of Liability</h2>
            <p>TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, THE COMPANY AND ITS OFFICERS, DIRECTORS, EMPLOYEES, AND AGENTS SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, INCLUDING LOSS OF PROFITS, DATA, OR GOODWILL, ARISING OUT OF OR IN CONNECTION WITH YOUR USE OF OR INABILITY TO USE THE SERVICE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGES.</p>
            <p className="mt-2">IN NO EVENT SHALL THE COMPANY'S TOTAL CUMULATIVE LIABILITY EXCEED THE GREATER OF (A) THE AMOUNTS YOU PAID TO THE COMPANY IN THE TWELVE (12) MONTHS PRECEDING THE CLAIM OR (B) ONE HUNDRED U.S. DOLLARS ($100).</p>
            <p className="mt-2">THE SERVICE IS PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTIES OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, OR NON-INFRINGEMENT.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">10. Governing Law and Disputes</h2>
            <p>These Terms are governed by the laws of the State of Delaware, without regard to its conflict of law principles. Any dispute arising under these Terms shall be resolved exclusively in the state or federal courts located in Delaware, and you consent to personal jurisdiction in such courts. You waive any right to a jury trial and agree that any claims must be brought in an individual capacity, not as a class action.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">11. Changes to Terms</h2>
            <p>We reserve the right to modify these Terms at any time. When we make material changes, we will update the effective date at the top of this page and, where appropriate, notify you by email or in-app notice. Your continued use of the Service after any changes take effect constitutes your acceptance of the revised Terms. If you do not agree to the updated Terms, you must stop using the Service and cancel your subscription.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">12. Contact Information</h2>
            <p>If you have questions about these Terms, please contact us at:</p>
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
