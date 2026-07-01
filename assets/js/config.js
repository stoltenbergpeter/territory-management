window.TERRITORY_APP_CONFIG = {
    appName: "Sales Territory Phone Management",

    // GitHub Pages is static hosting. This client ID is public by design.
    // Create a Genesys OAuth client with Authorization Code Grant with PKCE.
    mockGenesys: true,
    genesysRegion: "us_east_1",
    genesysClientId: "",
    redirectUri: `${window.location.origin}${window.location.pathname}`,
    oauthScope: "",
    phoneCountryCode: "US",
    phoneIntegration: "directrouting",

    defaultDivisionId: "sales-west",
    allowedDivisions: [
        { id: "sales-west", name: "Sales West" },
        { id: "sales-east", name: "Sales East" },
        { id: "enterprise", name: "Enterprise Accounts" }
    ],

    // Optional inventory. These phone numbers remain visible as territory rows
    // even when no Genesys user is currently assigned to them.
    territoryPhoneNumbers: [
        { phone: "+14155550101", extension: "4101", divisionId: "sales-west", divisionName: "Sales West" },
        { phone: "+14155550102", extension: "4102", divisionId: "sales-west", divisionName: "Sales West" },
        { phone: "+14155550103", extension: "4103", divisionId: "sales-west", divisionName: "Sales West" },
        { phone: "+14155550104", extension: "4104", divisionId: "sales-west", divisionName: "Sales West" },
        { phone: "+12125550101", extension: "5101", divisionId: "sales-east", divisionName: "Sales East" },
        { phone: "+12125550102", extension: "5102", divisionId: "sales-east", divisionName: "Sales East" },
        { phone: "+13125550101", extension: "6101", divisionId: "enterprise", divisionName: "Enterprise Accounts" }
    ],

    pageSize: 10,
    minExtensionLength: 2,
    maxExtensionLength: 10
};
