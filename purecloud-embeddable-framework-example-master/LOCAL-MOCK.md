# Local mock

This project now runs as a credential-free simulation by default. It preserves the original host-page controls and their `postMessage` contract, but replaces the remote Genesys Cloud iframe with a local mock client.

## Run it

From this folder, run:

```powershell
node mock-server.js
```

Then open [http://localhost:3000/](http://localhost:3000/).

No `npm install`, TLS certificate, OAuth client, or Genesys Cloud login is needed for mock mode. The server binds only to `127.0.0.1` and uses HTTP on an unprivileged port.

## Try the flow

1. Use **Simulate inbound call** in the embedded mock, then use **pickup**, **hold**, or **disconnect** on the host page.
2. Use the mock's **Request contact search** control to see its result arrive from the host-page contact-search payload.
3. Click **Open call log** to populate the `openCallLog` and `processCallLog` event payloads on the host page.
4. Exercise Click-to-Dial, status, views, notifications, associations, and attributes from the original host controls; the mock records each action in its activity log.

## Use the original live iframe

The real `crm=framework-local-secure` client does **not** load the library from port 3000. It always requests `https://localhost/framework.js` on port 443. Start the separate, loopback-only HTTPS adapter from this folder:

```powershell
node mock-server.js live
```

Then open [https://localhost/example.html?mode=live](https://localhost/example.html?mode=live). The `local-network-access` iframe permission is included for current Chromium browsers.

On first use, Chrome or Edge may ask whether the embedded Genesys client can access localhost. Allow that prompt for this local test; the current Local Network Access model is permission-based, so CORS or legacy Private Network Access headers do not override a denied permission.

Do not double-click `src/example.html` or open it with a `file:///` URL. The live client must load `framework.js` from the HTTPS localhost server, not from the file system.

The adapter serves the included `src/framework.js` at the fixed URL the live client requires. Live mode now uses `dedicatedLoginWindow=true`, so Genesys authentication opens in a separate top-level window instead of attempting to frame `login.usw2.pure.cloud`. Allow that pop-up when your browser requests it.

The OAuth client must be configured for the correct Genesys Cloud region and authorize both of these redirect URIs for the dedicated login flow:

```text
https://apps.usw2.pure.cloud/crm/index.html
https://apps.usw2.pure.cloud/crm/authWindow.html
```

Enter those URLs exactly—without `?crm=...`, `?dedicatedLoginWindow=true`, a trailing slash, `mypurecloud.com`, or `localhost`. For a current OAuth client, use **Code Authorization / PKCE** and do not put a client secret in this browser project. The client ID in `src/framework.js` must belong to that same US West organization; the key remains `usw2.pure.cloud` (without `apps.`).

If the organization uses SSO, an administrator may need to enable pop-out authentication for embedded iframes. Do not attempt to weaken the login page's CSP; `frame-ancestors 'none'` is intentional.

The bundled certificate is valid for `localhost`, but is signed by the archive's private development CA. A browser will reject it until its issuer is trusted. Do not import that CA into your trusted-root store unless you have verified its provenance and your organization's security policy allows it; an organization-approved local development certificate is the safer choice.

The live adapter intentionally binds only to `127.0.0.1` and port 443. It does not expose the sample on your network.
