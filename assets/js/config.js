window.TERRITORY_APP_CONFIG = {
    appName: "Sales Territory Phone Management",

    // GitHub Pages is static hosting. This client ID is public by design.
    // Create a Genesys OAuth client with Authorization Code Grant with PKCE.
    mockGenesys: true,
    // Production is us_east_1; use us_west_2 for the lab division.
    genesysRegion: "us_west_2",
    genesysClientId: "409225b8-66a3-407c-92ad-fa386bad3e79",
    redirectUri: `${window.location.origin}${window.location.pathname}`,
    oauthScope: "",
    phoneCountryCode: "US",

    defaultDivisionId: "sales-west",
    allowedDivisions: [
        { id: "ec3e6f92-8bae-420a-b8fc-cb575bc6cd13", name: "Home" },
        { id: "08406715-fa1b-48a9-b48e-4079ddca5223", name: "Putnam" },
        { id: "enterprise", name: "Enterprise Accounts" }
    ],

    // Optional DID inventory. These numbers remain visible as territory rows
    // even when unassigned. `extension` is only a display fallback; assigning a
    // DID preserves the selected user's existing PHONE/WORK extension.
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
