window.TERRITORY_APP_CONFIG = {
    appName: "Sales Territory Phone Management",

    // GitHub Pages is static hosting. This client ID is public by design.
    // Create a Genesys OAuth client with Authorization Code Grant with PKCE.
    mockGenesys: true,
    // Production is us_east_1; use us_west_2 for the lab division.
    genesysRegion: "us_east_1",
    genesysClientId: "",
    redirectUri: `${window.location.origin}${window.location.pathname}`,
    oauthScope: "",
    phoneCountryCode: "US",

    // A dedicated, otherwise-unused PHONE contact type for the extension half
    // of a Direct Routing DID/extension pair. The app tags this contact with
    // integration: "directrouting" and will never overwrite an ordinary
    // contact that occupies the configured slot.
    directRoutingExtensionContactType: "WORK4",

    // The Architect Call Route (IVR) that should receive new Direct Routing
    // DIDs. Leave this blank until the production Call Route ID is known; the
    // live Settings workflow requires a valid ID before making a change.
    callRouteId: "",
    // Used only when mockGenesys is true, so the live default above cannot
    // accidentally point at a sample resource.
    mockCallRouteId: "00000000-0000-4000-8000-000000000001",

    defaultDivisionId: "sales-west",
    allowedDivisions: [
        { id: "sales-west", name: "Sales West" },
        { id: "sales-east", name: "Sales East" },
        { id: "enterprise", name: "Enterprise Accounts" }
    ],

    // Optional DID inventory. These numbers remain visible as territory rows
    // even when unassigned. Each DID should include its paired `extension`;
    // assigning it writes separate, tagged DID and extension profile contacts.
    // Export browser-local additions from Settings and merge them here to share them.
    territoryPhoneNumbers: [
        { phone: "+14155550101", extension: "4101", divisionId: "sales-west", divisionName: "Sales West" },
        { phone: "+14155550102", extension: "4102", divisionId: "sales-west", divisionName: "Sales West" },
        { phone: "+14155550103", extension: "4103", divisionId: "sales-west", divisionName: "Sales West" },
        { phone: "+14155550104", extension: "4104", divisionId: "sales-west", divisionName: "Sales West" },
        { phone: "+12125550101", extension: "5101", divisionId: "sales-east", divisionName: "Sales East" },
        { phone: "+12125550102", extension: "5102", divisionId: "sales-east", divisionName: "Sales East" },
        { phone: "+13125550101", extension: "6101", divisionId: "enterprise", divisionName: "Enterprise Accounts" }
    ],

    pageSize: 10
};
