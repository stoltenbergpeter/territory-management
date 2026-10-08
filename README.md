# Sales Territory Phone Management

A GitHub Pages-compatible single-page app for business users to review and apply Sales territory phone assignments in Genesys Cloud.

This version is intentionally static: `index.html`, `assets/css/styles.css`, `assets/js/config.js`, and `assets/js/app.js`. There is no Flask, Python server, database, or secret storage because GitHub Pages only hosts static HTML/CSS/JavaScript.

## What Works On GitHub Pages

- Static Bootstrap 5 single-page UI.
- Genesys OAuth Authorization Code with PKCE from the browser.
- Genesys API calls from browser JavaScript using the signed-in user's token.
- Division selector from public config.
- Phone-number-centered assignment table. The territory phone number is the row identity, and the assigned Genesys user can be changed.
- Search by phone, extension, assigned user, email, and Genesys user ID.
- Inline assignment edit and local review queue before changes go live.
- Scheduled effective date/time for each assignment.
- Safe update flow that preflights the current owner and target versions, requires matching target extension contacts, removes the previous assignee's matching DID when needed, and verifies each change with a final GET.
- The internal extension remains the user's phone `WORK` address and primary phone contact; a Direct Routing DID is a separate phone `WORK2` address with `integration: "directrouting"`.
- Updates preserve email addresses, the primary extension, and other unrelated contact entries.
- Mock mode for testing without Genesys credentials.
- Local browser audit log and CSV export.
- Browser-local territory-phone inventory: add an already-provisioned DID, give it an optional display extension, assign it through the existing review flow, and export it for shared deployment.
- URL query parameters displayed on the dashboard, with a few known params wired into filters.

## URL Parameters

The page reads query string parameters from the URL and displays them in the **URL Parameters** panel on the dashboard. Any non-sensitive parameter is shown, so links can carry lightweight context like a note, source, campaign, or customer name.

Known parameters also drive the UI:

- `division`, `divisionId`, or `division_id`: preselects a configured division.
- `search`, `q`, `phone`, `user`, or `email`: prefills the dashboard search box.
- `view` or `tab`: opens `dashboard`, `review`, `audit`, or `settings`.
- `audit`, `auditSearch`, or `audit_search`: prefills the audit log search box.
- `status`, `auditStatus`, or `audit_status`: preselects an audit status such as `STAGED` or `APPLIED`.

Examples:

```text
https://your-org.github.io/territory-management/?division=sales-west&search=avery&note=renewal
https://your-org.github.io/territory-management/?view=audit&audit=4101&status=APPLIED
```

OAuth and security callback fields such as `code`, `state`, and token-like parameters are intentionally hidden from the display.

## Important Limits

GitHub Pages cannot run backend code. That means:

- Do not use client secrets.
- Do not use Client Credentials OAuth.
- Do not store durable shared approvals, server-side schedules, or audit logs unless you add a backend later.
- Role enforcement must come from Genesys Cloud permissions and division access.
- The local review queue, schedule queue, and audit log are stored in the user's browser only.
- Browser-local territory inventory is also per browser and site origin. It can be cleared with browser data and is not visible to colleagues until it is exported, merged into configuration, and redeployed.
- Scheduled changes are applied only when the app is open at or after the effective time.

For a shared approval workflow, reliable unattended scheduling, durable audit retention, or centralized role mapping, add a small backend later.

The supplied Genesys Cloud Python SDK reference uses Client Credentials for trusted server-side code. That flow requires a client secret and must not be moved into this browser app. This app continues to use Authorization Code with PKCE and the signed-in user's permissions.

## Configure Genesys OAuth

1. In Genesys Cloud, create an OAuth client.
2. Use **Authorization Code Grant with PKCE**.
3. Add your GitHub Pages URL as an authorized redirect URI, for example:

   ```text
   https://your-org.github.io/territory-management/
   ```

4. Do not put a client secret in this app.
5. Grant the users appropriate Genesys roles/scopes for:
   - reading/searching users,
   - reading the selected divisions,
   - updating user contact information.

Genesys permissions and division scopes are the real security boundary for this static app.

## Configure The App

Edit [assets/js/config.js](assets/js/config.js):

```js
window.TERRITORY_APP_CONFIG = {
    mockGenesys: false,
    genesysRegion: "us_east_1",
    genesysClientId: "YOUR_PUBLIC_PKCE_CLIENT_ID",
    redirectUri: "https://your-org.github.io/territory-management/",
    phoneCountryCode: "US",
    defaultDivisionId: "YOUR_DIVISION_ID",
    allowedDivisions: [
        { id: "YOUR_DIVISION_ID", name: "Sales" }
    ],
    territoryPhoneNumbers: [
        { phone: "+15551234567", extension: "4567", divisionId: "YOUR_DIVISION_ID", divisionName: "Sales" }
    ]
};
```

The client ID is public in a browser app. Never add a client secret.

`territoryPhoneNumbers` is optional but recommended. It lets the app keep known territory numbers visible even when they are currently unassigned in Genesys. Its optional `extension` value is a display fallback for an unassigned DID; assigning a DID preserves the selected user's existing extension.

## Add a Territory Phone From Settings

Use **Settings → Browser-Local Territory Inventory** to add an already-provisioned Direct Routing DID without editing code:

1. Choose a configured division.
2. Enter the DID in exact E.164 format, such as `+19165551234`.
3. Optionally enter a display extension. This is shown only while the DID is unassigned; it does not create or change a Genesys extension.
4. Select **Add Territory Phone**. The app refreshes permitted owner records before the DID can be staged, then shows the number in the Dashboard for that division.
5. Select **Export for Deployment**, merge the downloaded JSON entries into `territoryPhoneNumbers` in `assets/js/config.js`, and redeploy to make them shared and authoritative.

The Settings form rejects a DID already in the deployed or browser-local inventory, including one in another division, and it will not re-scope a DID with an open staged, scheduled, applying, or failed assignment. A browser-local row can be removed with confirmation if it has no open assignment; remove and re-add it to correct a typo. Adding inventory makes no Genesys write API call and does not create a Direct Routing DID, provision a carrier number, or create an extension. Do those tasks through your organization's Direct Routing/telephony administration process first. The app can only attach an already-provisioned DID to a user who already has matching `PHONE` / `WORK` and `PHONE` / `PRIMARY` extension contacts.

The app searches active and inactive users in every configured allowed division to locate an existing DID owner before reassignment. User searches set `enforcePermissions: true`; a DID held outside the configured or authorized scope must be cleared by an administrator before it can be reassigned.

Set `genesysRegion` before signing in or making API requests. Production uses `us_east_1`; the lab division uses `us_west_2`.

## Python SDK Reference and Browser REST Payloads

The accompanying quick reference documents the Python SDK. Its models use Python property names such as `page_size`, `page_number`, `primary_contact_info`, `media_type`, and `country_code`.

This app calls the Genesys Cloud REST API directly from browser JavaScript, so its JSON payloads must use the REST camel-case names: `pageSize`, `pageNumber`, `primaryContactInfo`, `mediaType`, and `countryCode`. It does not create a `PureCloudPlatformClientV2` client.

The reference's call-forwarding operations are not part of this assignment-only application. A call-forwarding feature would need its own UI and REST calls for `GET` and `PATCH /api/v2/users/{userId}/callforwarding`.

## Direct Routing Phone Payload

When applying an assignment, retain the user's internal extension as the `PHONE` / `WORK` address. Retain the primary extension as the `PHONE` / `PRIMARY` entry in `primaryContactInfo`. The DID is a separate `PHONE` / `WORK2` Direct Routing address; replace the existing Direct Routing `WORK2` entry instead of adding another one.

```json
{
  "address": "+19164636173",
  "display": "+1 916-463-6173",
  "mediaType": "PHONE",
  "type": "WORK2",
  "countryCode": "US",
  "integration": "directrouting"
}
```

For example, the extension contacts remain separate from the DID:

```json
{
  "addresses": [
    {
      "display": "1234567",
      "mediaType": "PHONE",
      "type": "WORK",
      "extension": "1234567"
    },
    {
      "address": "+19164636173",
      "display": "+1 916-463-6173",
      "mediaType": "PHONE",
      "type": "WORK2",
      "countryCode": "US",
      "integration": "directrouting"
    }
  ],
  "primaryContactInfo": [
    {
      "display": "1234567",
      "mediaType": "PHONE",
      "type": "PRIMARY",
      "extension": "1234567"
    }
  ]
}
```

Existing email addresses, primary email contacts, and unrelated contacts must remain in their respective lists. Use the current `version` returned by `GET /api/v2/users/{userId}` in the `PATCH /api/v2/users/{userId}` payload, then issue a final GET to verify the assignment. When moving a DID, remove it from the old user before adding it to the new user.

## Run Locally

Mock mode works by opening `index.html` directly, but OAuth redirects are easier to test from a local web server:

```powershell
py -m http.server 8000
```

Then open:

```text
http://localhost:8000/
```

For local Genesys OAuth testing, add `http://localhost:8000/` to the OAuth client's authorized redirect URIs.

## Deploy To GitHub Pages

1. Push this repository to GitHub.
2. Go to repository **Settings > Pages**.
3. Set source to the branch and root folder that contain `index.html`.
4. Wait for Pages to publish.
5. Add the published URL to the Genesys OAuth client's authorized redirect URIs.
6. Set `mockGenesys: false` in [assets/js/config.js](assets/js/config.js).

## Production Checklist

- GitHub Pages HTTPS enabled.
- `mockGenesys` set to `false`.
- OAuth client uses Authorization Code with PKCE.
- Redirect URI exactly matches the Pages URL.
- No client secret in the repository.
- Genesys roles are least privilege.
- Genesys roles are scoped to the allowed divisions.
- Business users understand that local audit/review/schedule data is browser-local.
- A backend is added if shared approvals, unattended scheduling, or durable audit retention become required.
