# AbilityMade

AbilityMade is a bilingual storefront for handmade gifts and artwork-based products created by disabled artisans.

## Local development

The site requires Node.js 20 or newer.

```sh
npm start
```

The local server runs at `http://localhost:3000` by default.

## Newsletter configuration

Newsletter subscriptions are stored as Resend contacts in a dedicated segment. Before enabling the form in production:

1. In the Resend dashboard, create a segment named **AbilityMade Newsletter**.
2. Copy the segment ID.
3. Configure these environment variables in the hosting service:
   - `RESEND_API_KEY`: a full-access Resend API key that can manage contacts and send email.
   - `RESEND_NEWSLETTER_SEGMENT_ID`: the new newsletter segment ID.
   - `PURCHASE_REQUEST_FROM`: the existing verified Resend sender used for purchase requests and newsletter confirmation emails.
   - `PURCHASE_REQUEST_TO`: the AbilityMade inbox that receives purchase requests and new-subscriber notifications (defaults to `AbilityMade@gmail.com`).
4. Restart or redeploy the server after saving the variables.

Each signup sends a localized confirmation to the subscriber and a new-subscriber notification to the AbilityMade inbox. Confirmation delivery failures are logged without removing the saved contact.

To send a newsletter, create a Broadcast in Resend, select the **AbilityMade Newsletter** segment, include an unsubscribe link, and send immediately or schedule it.
