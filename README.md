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
- Safe update flow that fetches the latest Genesys users, checks versions, validates extension uniqueness, clears the previous assignee when needed, and patches only `addresses` and `primaryContactInfo`.
- Direct Routing phone updates include `integration: "directrouting"`, `mediaType: "PHONE"`, `type: "WORK"`, `countryCode`, and a formatted `display` value.
- Mock mode for testing without Genesys credentials.
- Local browser audit log and CSV export.

## Important Limits

GitHub Pages cannot run backend code. That means:

- Do not use client secrets.
- Do not use Client Credentials OAuth.
- Do not store durable shared approvals, server-side schedules, or audit logs unless you add a backend later.
- Role enforcement must come from Genesys Cloud permissions and division access.
- The local review queue, schedule queue, and audit log are stored in the user's browser only.
- Scheduled changes are applied only when the app is open at or after the effective time.

For a shared approval workflow, reliable unattended scheduling, durable audit retention, centralized role mapping, or extension pool validation beyond duplicate checks, add a small backend later.

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
    phoneIntegration: "directrouting",
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

`territoryPhoneNumbers` is optional but recommended. It lets the app keep known territory numbers visible even when they are currently unassigned in Genesys.

## Direct Routing Phone Payload

When applying an assignment, the app writes the assigned user's work phone as a Direct Routing phone entry:

```json
{
  "address": "+19164636173",
  "display": "+1 916-463-6173",
  "mediaType": "PHONE",
  "type": "WORK",
  "countryCode": "US",
  "integration": "directrouting"
}
```

The app applies the same phone metadata to `addresses` and `primaryContactInfo` so Genesys remains consistent.

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
