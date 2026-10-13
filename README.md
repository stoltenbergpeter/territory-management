# Sales Territory Phone Management

A GitHub Pages-compatible single-page app for business users to review and apply Sales territory phone assignments in Genesys Cloud.

This version is intentionally static: `index.html`, `assets/css/styles.css`, `assets/js/config.js`, and `assets/js/app.js`. There is no Flask, Python server, database, or secret storage because GitHub Pages only hosts static HTML/CSS/JavaScript.

## What Works On GitHub Pages

- Static Bootstrap 5 single-page UI.
- Genesys OAuth Authorization Code with PKCE from the browser.
- Genesys API calls from browser JavaScript using the signed-in user's token.
- Division selector from public config.
- Phone-number-centered assignment table. The territory phone number is the row identity, and the assigned Genesys user can be changed.
- Search by phone, extension, assigned user, email, and Genesys user ID. The Dashboard also shows every loaded `PHONE` profile and primary-contact entry, including ordinary and mobile contacts.
- Inline assignment edit and local review queue before changes go live.
- Scheduled effective date/time for each assignment.
- Safe paired update flow that preflights current owner and target versions, adds a Direct Routing DID and its tagged extension contact, removes only the prior app-managed pair when needed, and verifies the full pair with a final GET.
- A Direct Routing DID is a `PHONE` / `WORK2` address with `integration: "directrouting"`. Its extension is a separate, extension-only, `directrouting`-tagged `PHONE` contact in the configured reserved slot (`WORK4` by default), because Genesys does not permit `address` and `extension` on one contact.
- Updates preserve email addresses, ordinary phone numbers, primary-contact data, and unrelated extensions. The app does not infer ownership from a matching extension value or overwrite an ordinary contact merely because a new DID is added.
- Mock mode for testing without Genesys credentials.
- Local browser audit log and CSV export.
- A separate Settings workflow to attach an already-provisioned Direct Routing DID to one specific user and append it to an Architect Call Route. It uses a current-version user PATCH followed by a current-version Call Route PUT, verifies both writes, retries version conflicts, and records partial success if only the user update completes.
- Browser-local territory-phone inventory: add an already-provisioned DID and required extension, assign the pair through the existing review flow, and export it for shared deployment.
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
- The app does not look up or validate a DID pool. Numbers must be provisioned and governed through your organization's Direct Routing/telephony process before they are attached to a user or Call Route.

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
   - updating user contact information,
   - reading and updating the intended Architect Call Route.

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
    directRoutingExtensionContactType: "WORK4",
    callRouteId: "YOUR_ARCHITECT_CALL_ROUTE_UUID",
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

`directRoutingExtensionContactType` reserves an otherwise-unused `PHONE` contact type for the extension half of each Direct Routing pair. The default is `WORK4`; `WORK3` and `OTHER` are supported alternatives. If the chosen slot already contains an ordinary phone or extension, the app stops rather than overwriting it—choose an unused option in configuration or resolve that profile manually.

`territoryPhoneNumbers` is optional but recommended. It lets the app keep known territory numbers visible even when they are currently unassigned in Genesys. Each configured territory DID should include its extension: assigning the DID adds that exact DID-and-extension pair to the selected user.

## Add a Direct Routing Phone and Call Route DNIS

Use **Settings → Add Direct Routing Phone** when an already-provisioned DID needs to be added to one specific user and to an Architect Call Route:

1. Set `callRouteId` in `assets/js/config.js` to the production Architect Call Route UUID, or enter the route UUID in the form for a one-off change.
2. Choose a loaded target user or enter the target Genesys user UUID, then enter the DID in exact E.164 format and its required extension.
3. Confirm the Call Route UUID. The configured `phoneCountryCode` is used for the user's new `PHONE` / `WORK2` / `directrouting` address.
4. If the user already has a different Direct Routing DID, explicitly select **Replace a different existing Direct Routing DID**. Without that selection, the app blocks the change rather than silently replacing the DID.
5. Review the confirmation. The app first adds the DID-and-extension pair to the user profile, then appends only the DID to the Call Route's `dnis` list.

This workflow deliberately does **not** call a DID-pool API or decide whether a carrier number is available. It only prevents duplicate work on the target user and target Call Route. It sends the user contact update first; if the Call Route update fails afterward, it records `PARTIAL_SUCCESS` in the local audit log and does not automatically roll back the user. Re-run the same request after resolving the Call Route issue: user and route membership checks make the retry safe.

The browser calls these Genesys REST endpoints with the signed-in user's PKCE token:

```text
GET/PATCH /api/v2/users/{userId}
GET/PUT   /api/v2/architect/ivrs/{callRouteId}
```

For the user PATCH, the app sends the current `version` and complete current `addresses`, limited to writable contact fields. It adds or updates the direct-routing DID plus its tagged extension contact, without removing ordinary phone or extension entries. `primaryContactInfo` is displayed but not PATCHed because Genesys auto-populates it from `addresses`. For the Call Route PUT, the app starts with a fresh GET and sends only the route's writable fields (`name`, `division`, `description`, `version`, `dnis`, flow references, and `scheduleGroup`) with the **DID only** appended once. Both mutations retry a `409` conflict by re-reading and rebuilding their payloads, then finish with a verifying GET.

## Add a Territory Phone From Settings

Use **Settings → Browser-Local Territory Inventory** to add an already-provisioned Direct Routing DID without editing code:

1. Choose a configured division.
2. Enter the DID in exact E.164 format, such as `+19165551234`.
3. Enter the required extension. It travels with the DID when the assignment is applied.
4. Select **Add Territory Phone**. The app refreshes permitted owner records before the DID can be staged, then shows the number in the Dashboard for that division.
5. Select **Export for Deployment**, merge the downloaded JSON entries into `territoryPhoneNumbers` in `assets/js/config.js`, and redeploy to make them shared and authoritative.

The Settings form rejects a DID already in the deployed or browser-local inventory, including one in another division, and it will not re-scope a DID with an open staged, scheduled, applying, or failed assignment. A browser-local row can be removed with confirmation if it has no open assignment; remove and re-add it to correct a typo. Adding inventory makes no Genesys write API call and does not create a Direct Routing DID, provision a carrier number, or create an extension. Do those tasks through your organization's Direct Routing/telephony administration process first. When an inventory DID is assigned, the app writes a tagged DID contact and a separate tagged extension contact while preserving unrelated contacts.

The app searches active and inactive users in every configured allowed division to locate an existing DID owner before reassignment. User searches set `enforcePermissions: true`; a DID held outside the configured or authorized scope must be cleared by an administrator before it can be reassigned.

Set `genesysRegion` before signing in or making API requests. Production uses `us_east_1`; the lab division uses `us_west_2`.

## Python SDK Reference and Browser REST Payloads

The accompanying quick reference documents the Python SDK. Its models use Python property names such as `page_size`, `page_number`, `primary_contact_info`, `media_type`, and `country_code`.

This app calls the Genesys Cloud REST API directly from browser JavaScript, so its JSON payloads must use the REST camel-case names: `pageSize`, `pageNumber`, `primaryContactInfo`, `mediaType`, and `countryCode`. It does not create a `PureCloudPlatformClientV2` client.

The reference's call-forwarding operations are not part of this browser application. A call-forwarding feature would need its own UI and REST calls for `GET` and `PATCH /api/v2/users/{userId}/callforwarding`.

## Direct Routing Phone Payload

When applying an assignment, the DID and extension are one logical pair, represented by two app-managed profile contacts. The Direct Routing `PHONE` / `WORK2` contact stores the E.164 DID. Its separate extension-only `PHONE` contact uses `integration: "directrouting"` and the configured reserved type (`WORK4` by default). This is required because a Genesys contact cannot contain both `address` and `extension`. Existing ordinary phone numbers and extensions remain in their lists.

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

For example, the profile receives a tagged extension contact in addition to the DID contact:

```json
{
  "addresses": [
    {
      "mediaType": "PHONE",
      "type": "WORK4",
      "extension": "1234567",
      "integration": "directrouting"
    },
    {
      "address": "+19164636173",
      "display": "+1 916-463-6173",
      "mediaType": "PHONE",
      "type": "WORK2",
      "countryCode": "US",
      "integration": "directrouting"
    }
  ]
}
```

Existing email addresses, primary contact information, ordinary phone numbers, and unrelated extensions remain in their respective lists. Use the current `version` returned by `GET /api/v2/users/{userId}` in the `PATCH /api/v2/users/{userId}` payload, then issue a final GET to verify the full DID-and-extension pair. When moving a DID, remove only the DID and its `directrouting`-tagged extension contact from the old user before adding it to the new user.

The separate **Add Direct Routing Phone** workflow uses the same paired contact shape and sends `{ version, addresses }`. It does not check a DID pool and requires explicit consent before replacing a different Direct Routing DID on the target user. It adds only the E.164 DID—not the extension—to the Architect Call Route.

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
- `callRouteId` is the intended Architect Call Route UUID, or operators know the authorized one-off route UUID to enter.
- Genesys roles can read and update that Call Route as well as update user contact information.
- Direct Routing DIDs are provisioned and approved outside this app; the app performs no DID-pool validation.
- Business users understand that local audit/review/schedule data is browser-local.
- A backend is added if shared approvals, unattended scheduling, or durable audit retention become required.
