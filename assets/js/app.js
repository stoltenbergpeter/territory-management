(() => {
    "use strict";

    const CONFIG = window.TERRITORY_APP_CONFIG || {};
    const REGION_HOSTS = {
        us_east_1: ["https://api.mypurecloud.com", "https://login.mypurecloud.com"],
        us_west_2: ["https://api.usw2.pure.cloud", "https://login.usw2.pure.cloud"],
        ca_central_1: ["https://api.cac1.pure.cloud", "https://login.cac1.pure.cloud"],
        sa_east_1: ["https://api.sae1.pure.cloud", "https://login.sae1.pure.cloud"],
        eu_west_1: ["https://api.mypurecloud.ie", "https://login.mypurecloud.ie"],
        eu_west_2: ["https://api.euw2.pure.cloud", "https://login.euw2.pure.cloud"],
        eu_central_1: ["https://api.mypurecloud.de", "https://login.mypurecloud.de"],
        ap_south_1: ["https://api.aps1.pure.cloud", "https://login.aps1.pure.cloud"],
        ap_northeast_1: ["https://api.mypurecloud.jp", "https://login.mypurecloud.jp"],
        ap_northeast_2: ["https://api.apne2.pure.cloud", "https://login.apne2.pure.cloud"],
        ap_southeast_2: ["https://api.mypurecloud.com.au", "https://login.mypurecloud.com.au"]
    };
    const STORAGE = {
        token: "territory.token",
        changes: "territory.assignmentChanges",
        audit: "territory.assignmentAudit",
        legacyChanges: "territory.changes",
        legacyAudit: "territory.audit",
        // v7 fixtures model a DID and its extension as separate, tagged
        // contacts and include ordinary contacts for visibility testing.
        mockUsers: "territory.mockUsers.v7",
        mockCallRoutes: "territory.mockCallRoutes.v3",
        selectedDivision: "territory.selectedDivision",
        localTerritoryPhones: "territory.localTerritoryPhones.v1"
    };
    const DEFAULT_MOCK_CALL_ROUTE_ID = "00000000-0000-4000-8000-000000000001";
    const CALL_ROUTE_WRITABLE_FIELDS = [
        "name",
        "division",
        "description",
        "version",
        "dnis",
        "openHoursFlow",
        "closedHoursFlow",
        "holidayHoursFlow",
        "scheduleGroup"
    ];
    // Keep the browser PATCH aligned with the writable Contact fields in the
    // Genesys User model; search/read responses can contain server-managed
    // fields that must not be sent back.
    const USER_ADDRESS_WRITABLE_FIELDS = [
        "address",
        "display",
        "mediaType",
        "type",
        "extension",
        "countryCode",
        "integration"
    ];
    const DIRECT_ROUTING_EXTENSION_CONTACT_TYPES = ["WORK3", "WORK4", "OTHER"];
    const MAX_MUTATION_ATTEMPTS = 3;
    const MAX_VERIFICATION_ATTEMPTS = 4;
    const VERIFICATION_RETRY_DELAY_MS = 250;
    const AUTH_STATE_KEY = "territory.oauthState";
    const VERIFIER_KEY = "territory.pkceVerifier";
    const RETURN_HASH_KEY = "territory.returnHash";
    const HIDDEN_URL_PARAMS = new Set([
        "access_token",
        "client_secret",
        "code",
        "id_token",
        "password",
        "refresh_token",
        "state",
        "token"
    ]);

    const state = {
        service: null,
        currentUser: null,
        users: [],
        ownerUsers: [],
        localTerritoryPhones: [],
        ownerRecordsCurrent: false,
        page: 1,
        pageSize: Number(CONFIG.pageSize || 10),
        editingPhone: null,
        changes: normalizeStoredChanges(readJson(STORAGE.changes, readJson(STORAGE.legacyChanges, []))),
        audit: normalizeStoredAudit(readJson(STORAGE.audit, readJson(STORAGE.legacyAudit, []))),
        applyingDue: false,
        urlParams: new Map()
    };

    document.addEventListener("DOMContentLoaded", init);

    async function init() {
        CONFIG.allowedDivisions = Array.isArray(CONFIG.allowedDivisions) ? CONFIG.allowedDivisions : [];
        CONFIG.territoryPhoneNumbers = Array.isArray(CONFIG.territoryPhoneNumbers) ? CONFIG.territoryPhoneNumbers : [];
        CONFIG.callRouteId = String(CONFIG.callRouteId || "").trim();
        CONFIG.mockCallRouteId = isGenesysUuid(CONFIG.mockCallRouteId)
            ? String(CONFIG.mockCallRouteId).trim()
            : DEFAULT_MOCK_CALL_ROUTE_ID;
        const storedLocalTerritoryPhones = readJson(STORAGE.localTerritoryPhones, null);
        state.localTerritoryPhones = normalizeStoredTerritoryPhones(storedLocalTerritoryPhones);
        if (Array.isArray(storedLocalTerritoryPhones)
            && JSON.stringify(storedLocalTerritoryPhones) !== JSON.stringify(state.localTerritoryPhones)) {
            try {
                writeJson(STORAGE.localTerritoryPhones, state.localTerritoryPhones);
            } catch {
                // Inventory normalization remains in memory if browser storage is unavailable.
            }
        }
        state.urlParams = parseUrlParams();
        applyUrlViewParam(state.urlParams);
        state.service = CONFIG.mockGenesys ? new MockGenesysService(CONFIG) : new GenesysService(CONFIG);
        initViewSwitcher();
        wireEvents();
        populateDivisionControls();
        applyUrlParamsToControls(state.urlParams);
        renderSettings();
        renderUrlParams(state.urlParams);
        saveChanges();
        writeJson(STORAGE.audit, state.audit);

        try {
            await state.service.handleRedirectCallback();
            await hydrateUser();
            await loadUsers();
            applyDueScheduledChanges();
            setInterval(applyDueScheduledChanges, 30000);
            window.addEventListener("focus", applyDueScheduledChanges);
        } catch (error) {
            renderSignedOut();
            showToast(error.message, "danger");
        }
    }

    async function hydrateUser() {
        if (!CONFIG.mockGenesys && !state.service.isAuthenticated()) {
            renderSignedOut();
            return;
        }
        state.currentUser = await state.service.getCurrentUser();
        document.getElementById("currentUserLabel").textContent = state.currentUser.email || state.currentUser.name || "Signed in";
        document.getElementById("authModeLabel").textContent = CONFIG.mockGenesys ? "Mode: Mock Genesys" : "Mode: Genesys PKCE";
        document.getElementById("loginButton").classList.toggle("d-none", Boolean(state.currentUser));
        document.getElementById("logoutButton").classList.toggle("d-none", !state.currentUser);
        document.getElementById("modeBadge").innerHTML = CONFIG.mockGenesys
            ? `<i class="bi bi-info-circle"></i> Mock Mode`
            : `<i class="bi bi-shield-check"></i> Genesys Authenticated`;
    }

    function renderSignedOut() {
        state.currentUser = null;
        document.getElementById("currentUserLabel").textContent = "Not signed in";
        document.getElementById("authModeLabel").textContent = CONFIG.mockGenesys ? "Mode: Mock Genesys" : "Mode: Genesys PKCE";
        document.getElementById("loginButton").classList.remove("d-none");
        document.getElementById("logoutButton").classList.add("d-none");
        document.getElementById("usersTableBody").innerHTML = `<tr><td colspan="11" class="text-center py-5 text-muted">Sign in to load territory phone assignments.</td></tr>`;
        document.getElementById("usersTableSummary").textContent = "";
        document.getElementById("userPhoneContactsBody").innerHTML = `<tr><td colspan="4" class="text-center py-4 text-muted">Sign in to load user phone contacts.</td></tr>`;
    }

    function initViewSwitcher() {
        const views = [...document.querySelectorAll(".app-view")];
        const links = [...document.querySelectorAll("[data-view-link]")];
        const available = new Set(views.map((view) => view.dataset.view));

        function showView() {
            let target = (window.location.hash || "#dashboard").replace("#", "");
            if (!available.has(target)) target = "dashboard";
            views.forEach((view) => view.classList.toggle("d-none", view.dataset.view !== target));
            links.forEach((link) => link.classList.toggle("active", link.dataset.viewLink === target));
            renderReview();
            renderAudit();
        }

        window.addEventListener("hashchange", showView);
        showView();
    }

    function wireEvents() {
        document.getElementById("loginButton").addEventListener("click", async () => {
            if (CONFIG.mockGenesys) {
                await hydrateUser();
                await loadUsers();
                showToast("Signed in with mock Genesys.", "success");
                return;
            }
            try {
                await state.service.login();
            } catch (error) {
                showToast(error.message, "danger");
            }
        });

        document.getElementById("logoutButton").addEventListener("click", () => {
            state.service.logout();
            state.users = [];
            state.ownerUsers = [];
            state.ownerRecordsCurrent = false;
            renderSignedOut();
            showToast("Signed out.", "info");
        });

        document.getElementById("refreshUsersButton").addEventListener("click", () => loadUsers(true));
        document.getElementById("divisionSelect").addEventListener("change", () => {
            localStorage.setItem(STORAGE.selectedDivision, document.getElementById("divisionSelect").value);
            document.getElementById("territoryPhoneDivision").value = selectedDivisionId();
            state.page = 1;
            renderSettings();
            loadUsers(true);
        });
        document.getElementById("userSearchInput").addEventListener("input", debounce(() => {
            state.page = 1;
            renderAssignments();
        }));
        document.getElementById("usersPrevButton").addEventListener("click", () => {
            if (state.page > 1) {
                state.page -= 1;
                renderAssignments();
            }
        });
        document.getElementById("usersNextButton").addEventListener("click", () => {
            state.page += 1;
            renderAssignments();
        });

        document.getElementById("usersTableBody").addEventListener("click", handleAssignmentsClick);
        document.getElementById("reviewTableBody").addEventListener("click", handleReviewClick);
        document.getElementById("applyAllButton").addEventListener("click", applyAllDue);
        document.getElementById("auditUserFilter").addEventListener("input", debounce(renderAudit));
        document.getElementById("auditDivisionFilter").addEventListener("change", renderAudit);
        document.getElementById("auditStatusFilter").addEventListener("change", renderAudit);
        document.getElementById("exportAuditButton").addEventListener("click", exportAuditCsv);
        document.getElementById("clearAuditButton").addEventListener("click", clearAudit);
        document.getElementById("testGenesysButton").addEventListener("click", testConnection);
        document.getElementById("directRoutingPhoneForm").addEventListener("submit", addDirectRoutingPhone);
        document.getElementById("territoryPhoneForm").addEventListener("submit", addLocalTerritoryPhone);
        document.getElementById("exportLocalTerritoryPhonesButton").addEventListener("click", exportLocalTerritoryPhones);
        document.getElementById("settingsDivisionsBody").addEventListener("click", handleSettingsInventoryClick);
    }

    function populateDivisionControls() {
        const selected = localStorage.getItem(STORAGE.selectedDivision) || CONFIG.defaultDivisionId || CONFIG.allowedDivisions[0]?.id || "";
        const options = CONFIG.allowedDivisions.map((division) => `<option value="${escapeHtml(division.id)}">${escapeHtml(division.name)}</option>`).join("");
        document.getElementById("divisionSelect").innerHTML = options;
        document.getElementById("auditDivisionFilter").innerHTML = `<option value="">All</option>${options}`;
        document.getElementById("territoryPhoneDivision").innerHTML = options;
        if (CONFIG.allowedDivisions.some((division) => division.id === selected)) {
            document.getElementById("divisionSelect").value = selected;
            document.getElementById("territoryPhoneDivision").value = selected;
        }
    }

    function parseUrlParams() {
        const params = new Map();
        const searchParams = new URLSearchParams(window.location.search);
        searchParams.forEach((value, key) => {
            const normalizedKey = key.trim();
            if (!normalizedKey) return;
            if (!params.has(normalizedKey)) params.set(normalizedKey, []);
            params.get(normalizedKey).push(value);
        });
        return params;
    }

    function applyUrlViewParam(params) {
        const view = getUrlParam(params, ["view", "tab"]).toLowerCase();
        const availableViews = new Set(["dashboard", "review", "audit", "settings"]);
        if (availableViews.has(view)) {
            window.location.hash = view;
        }
    }

    function applyUrlParamsToControls(params) {
        const division = getUrlParam(params, ["division", "divisionId", "division_id"]);
        const divisionSelect = document.getElementById("divisionSelect");
        const divisionOption = findOptionByValue(divisionSelect, division);
        if (divisionOption) {
            divisionSelect.value = divisionOption.value;
            document.getElementById("territoryPhoneDivision").value = divisionOption.value;
        }

        const search = getUrlParam(params, ["search", "q", "phone", "user", "email"]);
        if (search) {
            document.getElementById("userSearchInput").value = search;
        }

        const auditSearch = getUrlParam(params, ["audit", "auditSearch", "audit_search"]);
        if (auditSearch) {
            document.getElementById("auditUserFilter").value = auditSearch;
        }

        const auditStatus = getUrlParam(params, ["status", "auditStatus", "audit_status"]);
        const auditStatusOption = findOptionByValue(document.getElementById("auditStatusFilter"), auditStatus);
        if (auditStatusOption) {
            document.getElementById("auditStatusFilter").value = auditStatusOption.value;
        }
    }

    function renderUrlParams(params) {
        const container = document.getElementById("urlParamsSummary");
        if (!container) return;

        const allEntries = [...params.entries()];
        const visibleEntries = allEntries.filter(([key]) => !isHiddenUrlParam(key));
        const hiddenCount = allEntries.length - visibleEntries.length;
        const applied = appliedUrlParamSummaries(params);
        const hiddenNote = hiddenCount
            ? `<div class="url-hidden-note mt-2">Hidden ${hiddenCount} OAuth or security parameter${hiddenCount === 1 ? "" : "s"} from this display.</div>`
            : "";

        if (!visibleEntries.length) {
            container.innerHTML = `
                <div class="url-empty">No displayable URL parameters found.</div>
                ${hiddenNote}`;
            return;
        }

        container.innerHTML = `
            <div class="url-param-list">
                ${visibleEntries.map(([key, values]) => `
                    <div class="url-param-item">
                        <span class="url-param-key">${escapeHtml(key)}</span>
                        <span class="url-param-values">${renderUrlParamValues(values)}</span>
                    </div>`).join("")}
            </div>
            ${applied.length ? `<div class="url-applied mt-3">${applied.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</div>` : ""}
            ${hiddenNote}`;
    }

    function renderUrlParamValues(values) {
        return values.map((value) => `<code>${escapeHtml(value || "(empty)")}</code>`).join("");
    }

    function appliedUrlParamSummaries(params) {
        const summaries = [];
        const view = getUrlParam(params, ["view", "tab"]);
        const division = getUrlParam(params, ["division", "divisionId", "division_id"]);
        const search = getUrlParam(params, ["search", "q", "phone", "user", "email"]);
        const auditSearch = getUrlParam(params, ["audit", "auditSearch", "audit_search"]);
        const auditStatus = getUrlParam(params, ["status", "auditStatus", "audit_status"]);

        if (view) summaries.push(`View: ${view}`);
        if (division && findOptionByValue(document.getElementById("divisionSelect"), division)) summaries.push(`Division filter: ${division}`);
        if (search) summaries.push(`Search: ${search}`);
        if (auditSearch) summaries.push(`Audit search: ${auditSearch}`);
        if (auditStatus && findOptionByValue(document.getElementById("auditStatusFilter"), auditStatus)) summaries.push(`Audit status: ${auditStatus}`);
        return summaries;
    }

    function getUrlParam(params, names) {
        const lookup = names.map((name) => name.toLowerCase());
        for (const [key, values] of params.entries()) {
            if (lookup.includes(key.toLowerCase())) {
                return values.find((value) => value !== "") || values[0] || "";
            }
        }
        return "";
    }

    function findOptionByValue(select, value) {
        if (!select || !value) return null;
        return [...select.options].find((option) => option.value.toLowerCase() === String(value).toLowerCase()) || null;
    }

    function isHiddenUrlParam(key) {
        const normalized = String(key || "").toLowerCase();
        return HIDDEN_URL_PARAMS.has(normalized) || normalized.includes("token") || normalized.includes("secret");
    }

    async function loadUsers(force = false) {
        if (!state.currentUser) {
            state.ownerRecordsCurrent = false;
            renderSignedOut();
            return false;
        }
        const divisionId = selectedDivisionId();
        if (!divisionId) {
            state.ownerRecordsCurrent = false;
            document.getElementById("usersTableBody").innerHTML = `<tr><td colspan="11" class="text-center py-5 text-muted">Configure at least one division in assets/js/config.js.</td></tr>`;
            return false;
        }

        state.ownerRecordsCurrent = false;
        const refreshButton = document.getElementById("refreshUsersButton");
        refreshButton.disabled = true;
        refreshButton.innerHTML = `<span class="spinner-border spinner-border-sm me-2"></span>Refreshing`;
        document.getElementById("usersTableBody").innerHTML = `<tr><td colspan="11" class="text-center py-5 text-muted"><span class="spinner-border spinner-border-sm me-2"></span>Loading assignments...</td></tr>`;

        try {
            const ownerDivisionIds = [...new Set([
                divisionId,
                ...CONFIG.allowedDivisions.map((division) => division.id).filter(Boolean)
            ])];
            const userGroups = await Promise.all(ownerDivisionIds.map((id) => {
                return state.service.searchUsersByDivision(id, ["active", "inactive"]);
            }));
            const searchedOwnersById = new Map();
            userGroups.flat().forEach((user) => {
                if (user?.id) searchedOwnersById.set(user.id, user);
            });
            // The search endpoint can omit contact collections. Fetch each
            // permitted user's full profile before rendering phones/extensions
            // or deciding who currently owns a territory DID.
            const fullOwnerRecords = await mapWithConcurrency(
                [...searchedOwnersById.values()],
                8,
                (user) => state.service.getUser(user.id)
            );
            const ownersById = new Map();
            fullOwnerRecords.forEach((user) => {
                const normalized = state.service.normalizeUser(user);
                if (normalized.id) ownersById.set(normalized.id, normalized);
            });
            state.ownerUsers = [...ownersById.values()];
            state.users = state.ownerUsers.filter((user) => {
                return user.division_id === divisionId && (!user.state || user.state.toLowerCase() === "active");
            });
            state.ownerRecordsCurrent = true;
            state.page = force ? 1 : state.page;
            renderAssignments();
            renderDirectRoutingUserSuggestions();
            showToast(`Loaded ${state.users.length} assignable users, checked ${state.ownerUsers.length} owner records, and found ${buildAssignments().length} territory phones.`, "success");
            return true;
        } catch (error) {
            state.ownerRecordsCurrent = false;
            document.getElementById("usersTableBody").innerHTML = `<tr><td colspan="11" class="text-center py-5 text-danger">${escapeHtml(error.message)}</td></tr>`;
            showToast(error.message, "danger");
            return false;
        } finally {
            refreshButton.disabled = false;
            refreshButton.innerHTML = `<i class="bi bi-arrow-repeat"></i> Refresh from Genesys`;
        }
    }

    function renderAssignments() {
        const body = document.getElementById("usersTableBody");
        const search = document.getElementById("userSearchInput").value.trim().toLowerCase();
        const assignments = buildAssignments();
        const filtered = assignments.filter((assignment) => {
            const haystack = [
                assignment.phone,
                assignment.extension,
                assignment.current_user_name,
                assignment.current_user_email,
                assignment.current_user_id,
                assignment.current_user_phone_contacts_text,
                assignment.division_name
            ].join(" ").toLowerCase();
            return !search || haystack.includes(search);
        });
        const totalPages = Math.max(1, Math.ceil(filtered.length / state.pageSize));
        state.page = Math.min(Math.max(state.page, 1), totalPages);
        const start = (state.page - 1) * state.pageSize;
        const pageRows = filtered.slice(start, start + state.pageSize);

        if (!pageRows.length) {
            body.innerHTML = `<tr><td colspan="11" class="text-center py-5 text-muted">No territory phone assignments found.</td></tr>`;
        } else {
            body.innerHTML = pageRows.map(renderAssignmentRow).join("");
        }

        document.getElementById("usersTableSummary").textContent = `${filtered.length} territory phones - page ${state.page} of ${totalPages}`;
        document.getElementById("usersPrevButton").disabled = state.page <= 1;
        document.getElementById("usersNextButton").disabled = state.page >= totalPages;
        renderUserPhoneContacts();
    }

    function renderUserPhoneContacts() {
        const body = document.getElementById("userPhoneContactsBody");
        const search = document.getElementById("userSearchInput").value.trim().toLowerCase();
        const sourceUsers = state.ownerUsers.length ? state.ownerUsers : state.users;
        const users = sourceUsers
            .filter((user) => user.division_id === selectedDivisionId())
            .filter((user) => {
                const haystack = [
                    user.name,
                    user.email,
                    user.id,
                    user.phone_contacts_text
                ].join(" ").toLowerCase();
                return !search || haystack.includes(search);
            })
            .slice()
            .sort((left, right) => String(left.name || "").localeCompare(String(right.name || "")));

        if (!users.length) {
            body.innerHTML = `<tr><td colspan="4" class="text-center py-4 text-muted">No loaded users match this division and search.</td></tr>`;
            return;
        }

        body.innerHTML = users.map((user) => `
            <tr>
                <td><strong>${escapeHtml(user.name || user.id)}</strong><div class="text-muted small">${escapeHtml(user.email || "")}</div></td>
                <td><code>${escapeHtml(user.id || "")}</code></td>
                <td>${renderPhoneContactSummary(user.phone_contacts)}</td>
                <td>${escapeHtml(user.state || "")}</td>
            </tr>`).join("");
    }

    function renderPhoneContactSummary(contacts) {
        const items = Array.isArray(contacts) ? contacts : [];
        if (!items.length) return `<span class="text-muted small">No phone contacts</span>`;
        return `<div class="small mt-2 d-flex flex-column gap-1">${items.map((contact) => {
            const label = [contact.source, contact.type].filter(Boolean).join(" · ");
            const values = [];
            if (contact.address) values.push(contact.address);
            if (contact.extension) values.push(`Ext ${contact.extension}`);
            if (contact.integration) values.push(contact.integration);
            return `<div><span class="badge text-bg-light border me-1">${escapeHtml(label || "PHONE")}</span>${escapeHtml(values.join(" · ") || "No number or extension")}</div>`;
        }).join("")}</div>`;
    }

    function renderAssignmentRow(assignment) {
        const isEditing = state.editingPhone === assignment.phone;
        const staged = getOpenChangeForPhone(assignment.phone);
        const status = staged ? badge(changeStatusLabel(staged), changeStatusVariant(staged)) : badge(assignment.current_user_id ? "Assigned" : "Unassigned", assignment.current_user_id ? "success" : "secondary");
        const userCell = assignment.current_user_id
            ? `<strong>${escapeHtml(assignment.current_user_name)}</strong><div class="text-muted small">${escapeHtml(assignment.current_user_email)}</div>${renderPhoneContactSummary(assignment.current_user_phone_contacts)}`
            : `<span class="text-muted">Unassigned</span>`;
        const proposedCell = staged
            ? `<strong>${escapeHtml(staged.new_user_name || "Unassigned")}</strong><div class="text-muted small">${escapeHtml(staged.new_user_email || "")}</div>`
            : "";
        const editControls = isEditing ? renderAssignmentEditControls(assignment, staged) : "";
        const actions = isEditing
            ? `<button class="btn btn-success js-stage" title="Stage"><i class="bi bi-check-lg"></i></button><button class="btn btn-outline-secondary js-cancel-edit" title="Cancel"><i class="bi bi-x-lg"></i></button>`
            : `<button class="btn btn-primary js-edit" title="Assign user"><i class="bi bi-person-gear"></i></button><button class="btn btn-outline-dark js-view-audit" title="View audit"><i class="bi bi-clock-history"></i></button>`;

        return `
            <tr data-phone="${escapeHtml(assignment.phone)}">
                <td><strong>${escapeHtml(assignment.phone)}</strong></td>
                <td>${escapeHtml(assignment.extension || "")}</td>
                <td>${userCell}${editControls}</td>
                <td>${escapeHtml(assignment.current_user_id || "")}</td>
                <td>${escapeHtml(assignment.division_name || assignment.division_id)}</td>
                <td>${proposedCell}</td>
                <td>${escapeHtml(formatDate(staged?.effective_at || ""))}</td>
                <td>${status}</td>
                <td>${escapeHtml(formatDate(assignment.last_synced_at))}</td>
                <td>${escapeHtml(assignment.source || "Genesys")}</td>
                <td><div class="row-actions">${actions}</div></td>
            </tr>`;
    }

    function renderAssignmentEditControls(assignment, staged = null) {
        const userOptions = [
            `<option value="">Unassigned</option>`,
            ...state.users
                .slice()
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((user) => `<option value="${escapeHtml(user.id)}" ${user.id === assignment.current_user_id ? "selected" : ""}>${escapeHtml(user.name)} - ${escapeHtml(user.email)}${user.phone_contacts_text ? ` - ${escapeHtml(user.phone_contacts_text)}` : ""}</option>`)
        ].join("");
        const defaultEffectiveAt = toDatetimeLocal(defaultEffectiveAtIso());
        return `
            <div class="row g-2 mt-2">
                <div class="col-12">
                    <label class="visually-hidden" for="assign-${cssId(assignment.phone)}">Assign user</label>
                    <select class="form-select form-select-sm js-target-user" id="assign-${cssId(assignment.phone)}">${userOptions}</select>
                </div>
                <div class="col-12">
                    <label class="form-label small mb-1" for="effective-${cssId(assignment.phone)}">Go live</label>
                    <input class="form-control form-control-sm js-effective-at" id="effective-${cssId(assignment.phone)}" type="datetime-local" value="${escapeHtml(defaultEffectiveAt)}">
                </div>
                <div class="col-12">
                    <div class="form-check small">
                        <input class="form-check-input js-replace-existing-pair" id="replace-${cssId(assignment.phone)}" type="checkbox" ${staged?.replace_existing_pair ? "checked" : ""}>
                        <label class="form-check-label" for="replace-${cssId(assignment.phone)}">Replace a different Direct Routing DID already on the selected user</label>
                    </div>
                </div>
            </div>`;
    }

    async function handleAssignmentsClick(event) {
        const button = event.target.closest("button");
        if (!button) return;
        const row = button.closest("tr");
        const phone = row?.dataset.phone;
        const assignment = buildAssignments().find((item) => item.phone === phone);
        if (!assignment) return;

        if (button.classList.contains("js-edit")) {
            state.editingPhone = phone;
            renderAssignments();
        } else if (button.classList.contains("js-cancel-edit")) {
            state.editingPhone = null;
            renderAssignments();
        } else if (button.classList.contains("js-stage")) {
            stageAssignmentChange(row, assignment);
        } else if (button.classList.contains("js-view-audit")) {
            document.getElementById("auditUserFilter").value = assignment.phone;
            window.location.hash = "audit";
            renderAudit();
        }
    }

    function stageAssignmentChange(row, assignment) {
        const targetUserId = row.querySelector(".js-target-user").value;
        const targetUser = targetUserId ? state.users.find((user) => user.id === targetUserId) : null;
        const effectiveLocal = row.querySelector(".js-effective-at").value;
        const replaceExistingPair = Boolean(row.querySelector(".js-replace-existing-pair")?.checked);
        const effectiveAt = localDateTimeToIso(effectiveLocal);

        if (!state.ownerRecordsCurrent) {
            showToast("Refresh from Genesys successfully before staging an assignment so the current DID owner can be reconciled.", "warning");
            return;
        }
        if (!effectiveAt) {
            showToast("Choose the date and time this assignment should go live.", "danger");
            return;
        }
        if (targetUserId && !targetUser) {
            showToast("The selected user is no longer available. Refresh from Genesys and try again.", "danger");
            return;
        }
        if (!isE164Phone(assignment.phone)) {
            showToast("The territory DID must be an E.164 phone number, for example +19165551234.", "danger");
            return;
        }
        if (targetUserId && !isConfiguredExtension(assignment.extension)) {
            showToast("This territory DID needs a valid extension before it can be assigned. Add the extension in Settings or update the configured inventory.", "danger");
            return;
        }
        if (targetUserId
            && requiresPairedReplacement(targetUser, assignment.phone)
            && !replaceExistingPair) {
            showToast("This user already has a different Direct Routing DID. Select the replacement option to stage this paired update.", "warning");
            return;
        }
        if ((targetUser?.id || "") === (assignment.current_user_id || "")) {
            showToast("Choose a different assigned user before staging.", "warning");
            return;
        }

        const existing = getOpenChangeForPhone(assignment.phone);
        const change = existing || {
            id: crypto.randomUUID(),
            created_at: new Date().toISOString(),
            actor_email: state.currentUser?.email || "unknown"
        };
        Object.assign(change, {
            territory_phone: assignment.phone,
            territory_extension: assignment.extension || "",
            division_id: assignment.division_id,
            division_name: assignment.division_name,
            old_user_id: assignment.current_user_id || "",
            old_user_name: assignment.current_user_name || "",
            old_user_email: assignment.current_user_email || "",
            old_user_version: assignment.current_user_version || "",
            new_user_id: targetUser?.id || "",
            new_user_name: targetUser?.name || "",
            new_user_email: targetUser?.email || "",
            new_user_version: targetUser?.version || "",
            replace_existing_pair: replaceExistingPair,
            effective_at: effectiveAt,
            status: isDue(changeWithEffective(effectiveAt)) ? "STAGED" : "SCHEDULED",
            message: isDue(changeWithEffective(effectiveAt)) ? "Ready to apply." : `Scheduled for ${formatDate(effectiveAt)}.`,
            correlation_id: ""
        });

        if (!existing) state.changes.unshift(change);
        saveChanges();
        appendAudit(change, change.status, change.message);
        state.editingPhone = null;
        renderAssignments();
        renderReview();
        showToast(change.status === "SCHEDULED" ? "Assignment scheduled." : "Assignment staged for review.", "success");
    }

    function renderReview() {
        const body = document.getElementById("reviewTableBody");
        const openChanges = state.changes.filter((change) => ["STAGED", "SCHEDULED", "FAILED"].includes(change.status));
        const dueCount = openChanges.filter((change) => canApply(change)).length;
        document.getElementById("applyAllButton").disabled = dueCount === 0;
        document.getElementById("applyAllButton").innerHTML = `<i class="bi bi-check2-circle"></i> Apply Due (${dueCount})`;
        if (!openChanges.length) {
            body.innerHTML = `<tr><td colspan="9" class="text-center py-5 text-muted">No staged or scheduled assignments.</td></tr>`;
            return;
        }
        body.innerHTML = openChanges.map((change) => `
            <tr data-change-id="${escapeHtml(change.id)}">
                <td>${escapeHtml(formatDate(change.created_at))}</td>
                <td><strong>${escapeHtml(change.territory_phone)}</strong><div class="text-muted small">Ext ${escapeHtml(change.territory_extension || "")}</div></td>
                <td>${escapeHtml(change.old_user_name || "Unassigned")}</td>
                <td><strong>${escapeHtml(change.new_user_name || "Unassigned")}</strong><div class="text-muted small">${escapeHtml(change.new_user_email || "")}</div></td>
                <td>${escapeHtml(change.division_name || change.division_id)}</td>
                <td>${escapeHtml(formatDate(change.effective_at))}</td>
                <td>${badge(changeStatusLabel(change), changeStatusVariant(change))}</td>
                <td>${escapeHtml(change.message || "")}</td>
                <td><div class="row-actions">
                    <button class="btn btn-success js-apply-change" title="Apply due assignment" ${!canApply(change) ? "disabled" : ""}><i class="bi bi-check-lg"></i></button>
                    <button class="btn btn-outline-danger js-cancel-change" title="Cancel"><i class="bi bi-x-lg"></i></button>
                </div></td>
            </tr>`).join("");
    }

    async function handleReviewClick(event) {
        const button = event.target.closest("button");
        const row = event.target.closest("tr");
        if (!button || !row) return;
        const change = state.changes.find((item) => item.id === row.dataset.changeId);
        if (!change) return;

        if (button.classList.contains("js-apply-change")) {
            await applyChangeWithConfirmation(change);
        } else if (button.classList.contains("js-cancel-change")) {
            cancelChange(change);
        }
    }

    async function applyChangeWithConfirmation(change) {
        const assignmentDetail = change.new_user_id
            ? ` This adds ${change.territory_phone} and its paired Direct Routing extension contact (${change.territory_extension}) to ${change.new_user_name || "the selected user"}.${change.replace_existing_pair ? " The explicitly approved existing Direct Routing DID will be replaced if needed." : ""}`
            : ` This removes ${change.territory_phone} and its app-managed Direct Routing extension contact from the current user.`;
        const result = await confirmAction({
            title: "Apply assignment",
            message: `Assign ${change.territory_phone} to ${change.new_user_name || "Unassigned"} now?${assignmentDetail} Other phone contacts remain in the profile.`,
            buttonText: "Apply",
            buttonVariant: "success"
        });
        if (!result.confirmed) return;
        await applyChange(change);
    }

    async function applyAllDue() {
        const due = state.changes.filter((change) => canApply(change));
        if (!due.length) return;
        const result = await confirmAction({
            title: "Apply due assignments",
            message: `Apply ${due.length} due assignment${due.length === 1 ? "" : "s"} to Genesys Cloud?`,
            buttonText: "Apply Due",
            buttonVariant: "success"
        });
        if (!result.confirmed) return;
        for (const change of due) {
            await applyChange(change, false);
        }
        renderReview();
        renderAssignments();
    }

    async function applyDueScheduledChanges() {
        if (state.applyingDue || !state.currentUser) return;
        const due = state.changes.filter((change) => change.status === "SCHEDULED" && isDue(change));
        if (!due.length) {
            renderReview();
            return;
        }
        state.applyingDue = true;
        for (const change of due) {
            await applyChange(change, false);
        }
        state.applyingDue = false;
        renderReview();
        renderAssignments();
    }

    async function applyChange(change, rerender = true) {
        if (!canApply(change)) {
            showToast(`This assignment is scheduled for ${formatDate(change.effective_at)}.`, "warning");
            return;
        }
        change.status = "APPLYING";
        change.message = "Applying...";
        saveChanges();
        if (rerender) renderReview();

        try {
            const result = await state.service.applyTerritoryAssignment(change);
            change.status = "APPLIED";
            change.message = "Applied to Genesys Cloud.";
            change.correlation_id = result.correlationId || "";
            change.applied_at = new Date().toISOString();
            result.updatedUsers.forEach((user) => replaceUser(user));
            syncChangeVersions(change, result.updatedUsers);
            appendAudit(change, "APPLIED", "Assignment applied to Genesys Cloud.");
            showToast(`Applied ${change.territory_phone}.`, "success");
        } catch (error) {
            const partialUsers = Array.isArray(error.updatedUsers) ? error.updatedUsers : [];
            partialUsers.forEach((user) => replaceUser(user));
            syncChangeVersions(change, partialUsers);
            const oldOwnerWasCleared = partialUsers.some((user) => user?.id === change.old_user_id);
            change.status = "FAILED";
            change.message = oldOwnerWasCleared
                ? `${error.message} The previous user was cleared; retry after resolving the error.`
                : error.message;
            change.correlation_id = error.correlationId || "";
            appendAudit(change, "FAILED", change.message);
            showToast(change.message, "danger");
        } finally {
            saveChanges();
            if (rerender) {
                renderReview();
                renderAssignments();
            }
        }
    }

    function cancelChange(change) {
        change.status = "CANCELLED";
        change.message = "Cancelled before applying.";
        saveChanges();
        appendAudit(change, "CANCELLED", "Assignment cancelled.");
        renderReview();
        renderAssignments();
        showToast("Assignment cancelled.", "info");
    }

    function buildAssignments() {
        const divisionId = selectedDivisionId();
        const divisionName = divisionNameFor(divisionId);
        const byPhone = new Map();

        territoryPhoneInventory()
            .filter((item) => item.divisionId === divisionId)
            .forEach((item) => {
                const phone = item.phone;
                if (!phone) return;
                byPhone.set(phoneInventoryKey(phone), {
                    phone,
                    extension: item.extension || "",
                    division_id: divisionId,
                    division_name: item.divisionName || divisionName,
                    current_user_id: "",
                    current_user_name: "",
                    current_user_email: "",
                    current_user_version: "",
                    current_user_phone_contacts: [],
                    current_user_phone_contacts_text: "",
                    last_synced_at: "",
                    source: item.source
                });
            });

        const ownerUsers = state.ownerUsers.length ? state.ownerUsers : state.users;
        ownerUsers.forEach((user) => {
            if (!user.did_phone) return;
            const phone = phoneInventoryKey(user.did_phone);
            if (!phone) return;
            const configured = byPhone.get(phone);
            if (!configured && user.division_id !== divisionId) return;
            byPhone.set(phone, {
                phone,
                // Inventory extension is the authoritative extension paired with
                // a territory DID. Never replace it with an unrelated profile
                // extension merely because the user has several phone contacts.
                extension: configured?.extension || user.did_extension || "",
                division_id: configured?.division_id || user.division_id,
                division_name: configured?.division_name || user.division_name || divisionName,
                current_user_id: user.id,
                current_user_name: user.name,
                current_user_email: user.email,
                current_user_version: user.version,
                current_user_phone_contacts: user.phone_contacts || [],
                current_user_phone_contacts_text: user.phone_contacts_text || "",
                last_synced_at: user.last_synced_at,
                source: configured ? `${configured.source} + Genesys` : "Genesys"
            });
        });

        return [...byPhone.values()].sort((a, b) => a.phone.localeCompare(b.phone));
    }

    function territoryPhoneInventory() {
        const byPhone = new Map();
        const add = (item, source) => {
            const normalized = normalizeTerritoryPhone(item, source);
            if (!normalized) return;
            const key = phoneInventoryKey(normalized.phone);
            if (!byPhone.has(key)) byPhone.set(key, normalized);
        };

        CONFIG.territoryPhoneNumbers.forEach((item) => add(item, "Configured"));
        state.localTerritoryPhones.forEach((item) => add(item, "Browser-local"));
        return [...byPhone.values()];
    }

    function normalizeTerritoryPhone(item, source) {
        const phone = normalizeTerritoryDid(item?.phone || item?.number || "");
        const divisionId = source === "Browser-local"
            ? String(item?.divisionId || item?.division_id || "").trim()
            : normalizeDivisionId(item);
        if (!phone || !divisionId || !isE164Phone(phone)) return null;
        return {
            phone,
            extension: normalizeInventoryExtension(item?.extension),
            divisionId,
            divisionName: source === "Browser-local"
                ? divisionNameFor(divisionId)
                : String(item?.divisionName || item?.division_name || divisionNameFor(divisionId)).trim(),
            createdAt: String(item?.createdAt || item?.created_at || "").trim(),
            source
        };
    }

    function phoneInventoryKey(phone) {
        return normalizeTerritoryDid(phone);
    }

    function getOpenChangeForPhone(phone) {
        const key = phoneInventoryKey(phone);
        return state.changes.find((change) => {
            return phoneInventoryKey(change.territory_phone) === key
                && ["STAGED", "SCHEDULED", "APPLYING", "FAILED"].includes(change.status);
        });
    }

    function replaceUser(user) {
        const normalized = state.service.normalizeUser(user);
        const index = state.users.findIndex((item) => item.id === normalized.id);
        const isAssignable = normalized.division_id === selectedDivisionId()
            && (!normalized.state || normalized.state.toLowerCase() === "active");
        if (index >= 0 && isAssignable) {
            state.users.splice(index, 1, normalized);
        } else if (index >= 0) {
            state.users.splice(index, 1);
        } else if (isAssignable) {
            state.users.push(normalized);
        }
        const ownerIndex = state.ownerUsers.findIndex((item) => item.id === normalized.id);
        if (ownerIndex >= 0) {
            state.ownerUsers.splice(ownerIndex, 1, normalized);
        } else if (CONFIG.allowedDivisions.some((division) => division.id === normalized.division_id)) {
            state.ownerUsers.push(normalized);
        }
    }

    function upsertUpdatedUser(users, user) {
        if (!user?.id) return;
        const index = users.findIndex((item) => item.id === user.id);
        if (index >= 0) users.splice(index, 1, user);
        else users.push(user);
    }

    function syncChangeVersions(change, users) {
        users.forEach((user) => {
            if (user?.version == null) return;
            if (user.id === change.old_user_id) change.old_user_version = String(user.version);
            if (user.id === change.new_user_id) change.new_user_version = String(user.version);
        });
    }

    function renderAudit() {
        const body = document.getElementById("auditTableBody");
            const userFilter = document.getElementById("auditUserFilter").value.trim().toLowerCase();
            const divisionFilter = document.getElementById("auditDivisionFilter").value;
            const statusFilter = document.getElementById("auditStatusFilter").value;
            const rows = state.audit.filter((row) => {
                const textMatches = !userFilter || [
                    row.actor_email,
                    row.operation,
                    row.territory_phone,
                    row.old_user_email,
                    row.old_user_name,
                    row.new_user_email,
                    row.new_user_name,
                    row.call_route_id
                ].join(" ").toLowerCase().includes(userFilter);
            const divisionMatches = !divisionFilter || row.division_id === divisionFilter;
            const statusMatches = !statusFilter || row.status === statusFilter;
            return textMatches && divisionMatches && statusMatches;
        });

        if (!rows.length) {
            body.innerHTML = `<tr><td colspan="10" class="text-center py-5 text-muted">No audit records.</td></tr>`;
            return;
        }
        body.innerHTML = rows.map((row) => `
            <tr>
                <td>${escapeHtml(formatDate(row.timestamp))}</td>
                <td>${escapeHtml(row.actor_email || "")}</td>
                <td><strong>${escapeHtml(row.territory_phone || "")}</strong><div class="text-muted small">Ext ${escapeHtml(row.territory_extension || "")}</div></td>
                <td>${escapeHtml(row.division_name || row.division_id || "")}</td>
                <td>${escapeHtml(row.old_user_name || "Unassigned")}</td>
                <td>${escapeHtml(row.new_user_name || "Unassigned")}</td>
                <td>${escapeHtml(formatDate(row.effective_at || ""))}</td>
                <td>${badge(row.status, auditVariant(row.status))}</td>
                <td>${escapeHtml(row.message || "")}</td>
                <td>${escapeHtml(row.correlation_id || "")}</td>
            </tr>`).join("");
    }

    function buildDirectRoutingPhoneAuditChange({
        user,
        userId,
        phone,
        extension,
        callRouteId,
        userStatus,
        routeStatus,
        userCorrelationId,
        routeCorrelationId
    }) {
        const normalizedUser = user ? state.service.normalizeUser(user) : {};
        return {
            operation: "ADD_DIRECT_ROUTING_PHONE",
            territory_phone: phone,
            territory_extension: extension || normalizedUser.did_extension || "",
            division_id: normalizedUser.division_id || "",
            division_name: normalizedUser.division_name || "",
            old_user_id: "",
            old_user_name: "",
            old_user_email: "",
            new_user_id: normalizedUser.id || userId,
            new_user_name: normalizedUser.name || userId,
            new_user_email: normalizedUser.email || "",
            effective_at: new Date().toISOString(),
            call_route_id: callRouteId,
            user_patch_status: userStatus || "",
            route_update_status: routeStatus || "",
            user_correlation_id: userCorrelationId || "",
            route_correlation_id: routeCorrelationId || "",
            correlation_id: joinCorrelationIds(userCorrelationId, routeCorrelationId)
        };
    }

    function directRoutingStatusText(status) {
        if (status === "UPDATED") return "updated";
        if (status === "UNCHANGED") return "already matched";
        if (status === "UNKNOWN_AFTER_WRITE") return "accepted but not verified";
        if (status === "NOT_ATTEMPTED") return "not attempted";
        return String(status || "failed").toLowerCase().replaceAll("_", " ");
    }

    function directRoutingFailureMessage(error, partialSuccess) {
        if (!partialSuccess) return error.message;
        if (error.routeStatus === "NOT_ATTEMPTED") {
            return `The user contact update was accepted but could not be verified: ${error.message} The Call Route was not attempted; verify the user before retrying.`;
        }
        if (error.routeStatus === "UNKNOWN_AFTER_WRITE") {
            return `User contact ${directRoutingStatusText(error.userStatus)}; the Call Route update was accepted but could not be verified: ${error.message} Verify the Call Route before retrying.`;
        }
        return `User contact ${directRoutingStatusText(error.userStatus)}; Call Route update failed: ${error.message} No rollback was attempted.`;
    }

    function appendAudit(change, status, message) {
        state.audit.unshift({
            id: crypto.randomUUID(),
            timestamp: new Date().toISOString(),
            operation: change.operation || "ASSIGNMENT",
            actor_email: state.currentUser?.email || change.actor_email || "",
            territory_phone: change.territory_phone,
            territory_extension: change.territory_extension,
            division_id: change.division_id,
            division_name: change.division_name,
            old_user_id: change.old_user_id,
            old_user_name: change.old_user_name,
            old_user_email: change.old_user_email,
            new_user_id: change.new_user_id,
            new_user_name: change.new_user_name,
            new_user_email: change.new_user_email,
            effective_at: change.effective_at,
            status,
            message,
            correlation_id: change.correlation_id || "",
            call_route_id: change.call_route_id || "",
            user_patch_status: change.user_patch_status || "",
            route_update_status: change.route_update_status || "",
            user_correlation_id: change.user_correlation_id || "",
            route_correlation_id: change.route_correlation_id || ""
        });
        state.audit = state.audit.slice(0, 500);
        writeJson(STORAGE.audit, state.audit);
        renderAudit();
    }

    async function clearAudit() {
        const result = await confirmAction({
            title: "Clear local audit",
            message: "Clear audit records stored in this browser?",
            buttonText: "Clear",
            buttonVariant: "danger"
        });
        if (!result.confirmed) return;
        state.audit = [];
        writeJson(STORAGE.audit, state.audit);
        renderAudit();
        showToast("Local audit cleared.", "info");
    }

    function exportAuditCsv() {
        const headers = ["Timestamp", "Operation", "Actor", "Territory Phone", "Extension", "Division", "Old User", "New User", "Effective At", "Status", "Call Route ID", "User Contact Status", "Call Route Status", "Message", "Correlation ID", "User Correlation ID", "Call Route Correlation ID"];
        const rows = state.audit.map((row) => [
            row.timestamp,
            row.operation || "ASSIGNMENT",
            row.actor_email,
            row.territory_phone,
            row.territory_extension,
            row.division_name || row.division_id,
            row.old_user_name || "Unassigned",
            row.new_user_name || "Unassigned",
            row.effective_at,
            row.status,
            row.call_route_id,
            row.user_patch_status,
            row.route_update_status,
            row.message,
            row.correlation_id,
            row.user_correlation_id,
            row.route_correlation_id
        ]);
        const csv = [headers, ...rows].map((row) => row.map(csvEscape).join(",")).join("\n");
        downloadBlob(csv, `territory-phone-assignment-audit-${new Date().toISOString().slice(0, 10)}.csv`, "text/csv");
    }

    async function testConnection() {
        const button = document.getElementById("testGenesysButton");
        button.disabled = true;
        button.innerHTML = `<span class="spinner-border spinner-border-sm me-2"></span>Testing`;
        try {
            if (!CONFIG.mockGenesys && !state.service.isAuthenticated()) {
                throw new Error("Sign in before testing the Genesys connection.");
            }
            const user = await state.service.getCurrentUser();
            showToast(`Connection succeeded for ${user.email || user.name}.`, "success");
        } catch (error) {
            showToast(error.message, "danger");
        } finally {
            button.disabled = false;
            button.innerHTML = `<i class="bi bi-plug"></i> Test Connection`;
        }
    }

    function renderSettings() {
        const [apiHost, loginHost] = getHosts(CONFIG);
        const settings = [
            ["Mode", CONFIG.mockGenesys ? "Mock Genesys" : "Live Genesys"],
            ["API Host", apiHost],
            ["Login Host", loginHost],
            ["Region", CONFIG.genesysRegion || "us_east_1"],
            ["OAuth", "Authorization Code with PKCE"],
            ["Redirect URI", CONFIG.redirectUri],
            ["Client ID", CONFIG.genesysClientId || "Not configured"],
            ["Scheduling", "Browser-local while app is open"],
            ["Phone Integration", phoneIntegration()],
            ["Phone Country", phoneCountryCode()],
            ["Default Call Route", configuredCallRouteId() || "Not configured"],
            ["Browser-local territory phones", String(state.localTerritoryPhones.length)]
        ];
        document.getElementById("settingsSummary").innerHTML = settings.map(([label, value]) => `
            <div class="col-12 col-md-6 col-xl-3 settings-kpi">
                <div class="label">${escapeHtml(label)}</div>
                <div class="value">${escapeHtml(value)}</div>
            </div>`).join("");
        document.getElementById("exportLocalTerritoryPhonesButton").disabled = state.localTerritoryPhones.length === 0;
        document.getElementById("directRoutingCountryCode").textContent = phoneCountryCode();
        const callRouteInput = document.getElementById("directRoutingCallRouteId");
        if (!callRouteInput.value.trim()) callRouteInput.value = configuredCallRouteId();
        renderDirectRoutingUserSuggestions();
        const phones = territoryPhoneInventory().sort((left, right) => {
            return `${left.divisionName} ${left.phone}`.localeCompare(`${right.divisionName} ${right.phone}`);
        });
        document.getElementById("settingsDivisionsBody").innerHTML = CONFIG.allowedDivisions.map((division) => `
            <tr>
                <td>${escapeHtml(division.name)}</td>
                <td><code>${escapeHtml(division.id)}</code></td>
                <td>${division.id === CONFIG.defaultDivisionId ? badge("Default", "info") : ""}</td>
                <td>${badge("Deployed config", "secondary")}</td>
                <td></td>
            </tr>`).join("");
        const settingsBody = document.getElementById("settingsDivisionsBody");
        settingsBody.insertAdjacentHTML("beforeend", `
            <tr><td colspan="5" class="table-light fw-semibold">Territory Phone Inventory</td></tr>
            ${phones.length ? phones.map((item) => `
                <tr>
                    <td>${escapeHtml(item.phone)}</td>
                    <td><code>${escapeHtml(item.extension || "—")}</code></td>
                    <td>${escapeHtml(item.divisionName || divisionNameFor(item.divisionId))}</td>
                    <td>${item.source === "Browser-local" ? badge("Browser-local", "warning") : badge("Deployed config", "secondary")}</td>
                    <td class="text-end">${item.source === "Browser-local" ? `<button class="btn btn-outline-danger btn-sm js-remove-local-territory-phone" data-phone="${escapeHtml(item.phone)}" type="button"><i class="bi bi-trash3"></i> Remove</button>` : ""}</td>
                </tr>`).join("") : `
                <tr><td colspan="5" class="text-center py-4 text-muted">No territory phones are configured yet.</td></tr>`}`);
    }

    function renderDirectRoutingUserSuggestions() {
        const suggestions = new Map();
        [...state.ownerUsers, ...state.users].forEach((user) => {
            if (user?.id) suggestions.set(user.id, user);
        });
        document.getElementById("directRoutingUserOptions").innerHTML = [...suggestions.values()]
            .sort((left, right) => String(left.name || "").localeCompare(String(right.name || "")))
            .map((user) => `<option value="${escapeHtml(user.id)}">${escapeHtml(user.name || user.id)} — ${escapeHtml(user.email || "")}${user.phone_contacts_text ? ` — ${escapeHtml(user.phone_contacts_text)}` : ""}</option>`)
            .join("");
    }

    async function addLocalTerritoryPhone(event) {
        event.preventDefault();
        const divisionId = document.getElementById("territoryPhoneDivision").value;
        const phone = String(document.getElementById("territoryPhoneInput").value || "").trim();
        const rawExtension = String(document.getElementById("territoryExtensionInput").value || "").trim();
        const extension = normalizeInventoryExtension(rawExtension);

        if (!isAllowedDivisionId(divisionId)) {
            showToast("Choose one of the configured divisions.", "danger");
            return;
        }
        if (!isE164Phone(phone)) {
            showToast("Enter the territory DID in E.164 format, for example +19165551234.", "danger");
            return;
        }
        if (!isConfiguredExtension(rawExtension)) {
            showToast("Enter an extension of up to 32 characters without line breaks.", "danger");
            return;
        }
        if (territoryPhoneInventory().some((item) => samePhone(item.phone, phone))) {
            showToast("That territory DID is already present in the deployed or browser-local inventory.", "warning");
            return;
        }
        if (getOpenChangeForPhone(phone)) {
            showToast("Resolve the existing staged, scheduled, or failed assignment for this DID before adding it to another division.", "warning");
            return;
        }

        const nextInventory = [
            ...state.localTerritoryPhones,
            {
                phone,
                extension,
                divisionId,
                createdAt: new Date().toISOString()
            }
        ];
        try {
            writeJson(STORAGE.localTerritoryPhones, nextInventory);
        } catch {
            showToast("The browser could not save the territory phone inventory. Check site storage and try again.", "danger");
            return;
        }

        state.localTerritoryPhones = normalizeStoredTerritoryPhones(nextInventory);
        state.page = 1;
        document.getElementById("territoryPhoneInput").value = "";
        document.getElementById("territoryExtensionInput").value = "";
        renderSettings();
        if (state.currentUser) {
            const ownersRefreshed = await loadUsers(true);
            if (!ownersRefreshed) {
                showToast(`Added ${phone} to this browser's territory inventory, but owner data must refresh before it can be assigned.`, "warning");
                return;
            }
        }
        showToast(`Added ${phone} to this browser's territory inventory.`, "success");
    }

    async function addDirectRoutingPhone(event) {
        event.preventDefault();
        const userId = String(document.getElementById("directRoutingUserId").value || "").trim();
        const phoneInput = document.getElementById("directRoutingPhoneInput");
        const phone = normalizeTerritoryDid(phoneInput.value);
        const extensionInput = document.getElementById("directRoutingExtensionInput");
        const extension = normalizeInventoryExtension(extensionInput.value);
        const callRouteId = String(document.getElementById("directRoutingCallRouteId").value || "").trim();
        const countryCode = normalizeCountryCode(phoneCountryCode());
        const replaceExisting = document.getElementById("replaceExistingDirectRoutingPhone").checked;

        if (!state.currentUser) {
            showToast("Sign in to Genesys before adding a Direct Routing phone.", "danger");
            return;
        }
        if (!isGenesysUuid(userId)) {
            showToast("Enter the target Genesys User ID as a UUID.", "danger");
            return;
        }
        if (!isE164Phone(phone)) {
            showToast("Enter the Direct Routing DID in E.164 format, for example +19165551234.", "danger");
            return;
        }
        if (!isConfiguredExtension(extensionInput.value)) {
            showToast("Enter the extension that belongs with this Direct Routing DID.", "danger");
            return;
        }
        if (!isGenesysUuid(callRouteId)) {
            showToast("Enter the Architect Call Route ID as a UUID.", "danger");
            return;
        }
        if (!isCountryCode(countryCode)) {
            showToast("Configure phoneCountryCode in assets/js/config.js as a two-letter country code.", "danger");
            return;
        }

        phoneInput.value = phone;
        extensionInput.value = extension;
        const confirmation = await confirmAction({
            title: "Add Direct Routing phone",
            message: `Add DID ${phone} and extension ${extension} to user ${userId}, then add only the DID to Call Route ${callRouteId}? The app will not check DID pools. The app updates the user first and then the Call Route; a Call Route failure leaves the user profile change in place without automatic rollback.`,
            buttonText: "Add Phone",
            buttonVariant: "primary"
        });
        if (!confirmation.confirmed) return;

        const button = document.getElementById("addDirectRoutingPhoneButton");
        button.disabled = true;
        button.innerHTML = `<span class="spinner-border spinner-border-sm me-2"></span>Adding`;

        try {
            const result = await state.service.addDirectRoutingPhoneAndUpdateCallRoute({
                userId,
                phone,
                extension,
                countryCode,
                callRouteId,
                replaceExisting
            });
            replaceUser(result.user);
            const auditChange = buildDirectRoutingPhoneAuditChange({
                user: result.user,
                userId,
                phone,
                extension,
                callRouteId,
                userStatus: result.userStatus,
                routeStatus: result.routeStatus,
                userCorrelationId: result.userCorrelationId,
                routeCorrelationId: result.routeCorrelationId
            });
            appendAudit(
                auditChange,
                "APPLIED",
                `User contact ${directRoutingStatusText(result.userStatus)}; Call Route ${callRouteId} DNIS ${directRoutingStatusText(result.routeStatus)}.`
            );
            document.getElementById("directRoutingPhoneInput").value = "";
            document.getElementById("directRoutingExtensionInput").value = "";
            document.getElementById("replaceExistingDirectRoutingPhone").checked = false;
            renderAssignments();
            showToast(`Added DID ${phone} and extension ${extension} to the user; added the DID to the Call Route.`, "success");
        } catch (error) {
            const updatedUser = error.updatedUser || null;
            if (updatedUser) replaceUser(updatedUser);
            const partialSuccess = Boolean(error.userUpdateCompleted || updatedUser)
                && ["UPDATED", "UNCHANGED", "UNKNOWN_AFTER_WRITE"].includes(error.userStatus);
            const routeStatus = error.routeStatus || "NOT_ATTEMPTED";
            const errorCorrelationId = error.correlationId || "";
            const auditChange = buildDirectRoutingPhoneAuditChange({
                user: updatedUser,
                userId,
                phone,
                extension,
                callRouteId,
                userStatus: error.userStatus || "FAILED",
                routeStatus,
                userCorrelationId: error.userCorrelationId
                    || (routeStatus === "NOT_ATTEMPTED" ? errorCorrelationId : ""),
                routeCorrelationId: error.routeCorrelationId
                    || (routeStatus !== "NOT_ATTEMPTED" ? errorCorrelationId : "")
            });
            const message = directRoutingFailureMessage(error, partialSuccess);
            appendAudit(auditChange, partialSuccess ? "PARTIAL_SUCCESS" : "FAILED", message);
            renderAssignments();
            showToast(message, partialSuccess ? "warning" : "danger");
        } finally {
            button.disabled = false;
            button.innerHTML = `<i class="bi bi-person-plus"></i> Add Phone`;
        }
    }

    function exportLocalTerritoryPhones() {
        if (!state.localTerritoryPhones.length) {
            showToast("There are no browser-local territory phones to export.", "warning");
            return;
        }
        const exportRows = state.localTerritoryPhones.map((item) => ({
            phone: item.phone,
            extension: item.extension,
            divisionId: item.divisionId,
            divisionName: divisionNameFor(item.divisionId)
        }));
        downloadBlob(
            JSON.stringify(exportRows, null, 2),
            `territory-phone-inventory-${new Date().toISOString().slice(0, 10)}.json`,
            "application/json"
        );
        showToast("Exported browser-local territory phones for deployment.", "success");
    }

    async function handleSettingsInventoryClick(event) {
        const button = event.target.closest(".js-remove-local-territory-phone");
        if (!button) return;
        const phone = phoneInventoryKey(button.dataset.phone);
        const item = state.localTerritoryPhones.find((entry) => samePhone(entry.phone, phone));
        if (!item) return;
        if (getOpenChangeForPhone(phone)) {
            showToast("Resolve the existing staged, scheduled, applying, or failed assignment before removing this browser-local territory phone.", "warning");
            return;
        }

        const result = await confirmAction({
            title: "Remove browser-local territory phone",
            message: `Remove ${phone} from this browser's territory inventory? This does not delete a Genesys Direct Routing number.`,
            buttonText: "Remove",
            buttonVariant: "danger"
        });
        if (!result.confirmed) return;

        const nextInventory = state.localTerritoryPhones.filter((entry) => !samePhone(entry.phone, phone));
        try {
            writeJson(STORAGE.localTerritoryPhones, nextInventory);
        } catch {
            showToast("The browser could not update the territory phone inventory. Check site storage and try again.", "danger");
            return;
        }

        state.localTerritoryPhones = nextInventory;
        state.page = 1;
        renderSettings();
        if (state.currentUser) renderAssignments();
        showToast(`Removed ${phone} from this browser's territory inventory.`, "info");
    }

    class GenesysService {
        constructor(config) {
            this.config = config;
            const [apiHost, loginHost] = getHosts(config);
            this.apiHost = apiHost.replace(/\/$/, "");
            this.loginHost = loginHost.replace(/\/$/, "");
        }

        isAuthenticated() {
            const token = this.getToken();
            return Boolean(token?.access_token && token.expires_at > Date.now() + 30000);
        }

        getToken() {
            return readJson(STORAGE.token, null);
        }

        setToken(tokenResponse) {
            const expiresIn = Number(tokenResponse.expires_in || 3600);
            const token = {
                access_token: tokenResponse.access_token,
                token_type: tokenResponse.token_type || "Bearer",
                expires_at: Date.now() + expiresIn * 1000
            };
            writeJson(STORAGE.token, token);
            return token;
        }

        logout() {
            localStorage.removeItem(STORAGE.token);
            sessionStorage.removeItem(AUTH_STATE_KEY);
            sessionStorage.removeItem(VERIFIER_KEY);
            sessionStorage.removeItem(RETURN_HASH_KEY);
        }

        async login() {
            if (!this.config.genesysClientId) {
                throw new Error("Configure genesysClientId in assets/js/config.js before signing in.");
            }
            const verifier = randomBase64Url(64);
            const challenge = await sha256Base64Url(verifier);
            const authState = randomBase64Url(32);
            sessionStorage.setItem(VERIFIER_KEY, verifier);
            sessionStorage.setItem(AUTH_STATE_KEY, authState);
            sessionStorage.setItem(RETURN_HASH_KEY, window.location.hash || "#dashboard");

            const params = new URLSearchParams({
                response_type: "code",
                client_id: this.config.genesysClientId,
                redirect_uri: this.config.redirectUri,
                state: authState,
                code_challenge: challenge,
                code_challenge_method: "S256"
            });
            if (this.config.oauthScope) params.set("scope", this.config.oauthScope);
            window.location.assign(`${this.loginHost}/oauth/authorize?${params.toString()}`);
        }

        async handleRedirectCallback() {
            const params = new URLSearchParams(window.location.search);
            if (!params.has("code")) return false;
            const expectedState = sessionStorage.getItem(AUTH_STATE_KEY);
            const verifier = sessionStorage.getItem(VERIFIER_KEY);
            if (!expectedState || params.get("state") !== expectedState || !verifier) {
                throw new Error("Genesys login state was invalid. Try signing in again.");
            }
            const body = new URLSearchParams({
                grant_type: "authorization_code",
                code: params.get("code"),
                redirect_uri: this.config.redirectUri,
                client_id: this.config.genesysClientId,
                code_verifier: verifier
            });
            const response = await fetch(`${this.loginHost}/oauth/token`, {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body
            });
            if (!response.ok) {
                throw await this.toApiError(response, "Genesys token exchange failed.");
            }
            this.setToken(await response.json());
            const returnHash = sessionStorage.getItem(RETURN_HASH_KEY) || "#dashboard";
            sessionStorage.removeItem(AUTH_STATE_KEY);
            sessionStorage.removeItem(VERIFIER_KEY);
            sessionStorage.removeItem(RETURN_HASH_KEY);
            window.history.replaceState({}, document.title, `${this.config.redirectUri}${returnHash}`);
            return true;
        }

        async getCurrentUser() {
            const { data } = await this.request("GET", "/api/v2/users/me");
            return {
                id: data.id,
                name: data.name || data.displayName || data.email || data.userName,
                email: data.email || data.userName || data.username || ""
            };
        }

        async searchUsersByDivision(divisionId, states = ["active"], pageSize = 100) {
            const users = [];
            let pageNumber = 1;
            while (true) {
                const body = {
                    pageSize,
                    pageNumber,
                    enforcePermissions: true,
                    query: [
                        { fields: ["divisionId"], value: divisionId, type: "EXACT" }
                    ]
                };
                const { data } = await this.request("POST", "/api/v2/users/search", body);
                const page = data.results || data.entities || [];
                users.push(...page.filter((user) => {
                    const userDivisionId = user.division?.id || user.divisionId || "";
                    const userState = String(user.state || "").toLowerCase();
                    return (!userDivisionId || userDivisionId === divisionId)
                        && (!states.length || !userState || states.includes(userState));
                }));
                const total = Number(data.total || data.totalHits || 0);
                const pageCount = Number(data.pageCount || 0);
                const responsePageNumber = Number(data.pageNumber || pageNumber);
                if (pageCount
                    ? responsePageNumber >= pageCount
                    : page.length < pageSize || (total && users.length >= total)) break;
                pageNumber += 1;
            }
            return users;
        }

        async getUser(userId) {
            const { data } = await this.request("GET", `/api/v2/users/${encodeURIComponent(userId)}`);
            return data;
        }

        async getCallRoute(callRouteId) {
            const { data } = await this.request("GET", `/api/v2/architect/ivrs/${encodeURIComponent(callRouteId)}`);
            return data;
        }

        async updateUser(userId, patch) {
            return this.request("PATCH", `/api/v2/users/${encodeURIComponent(userId)}`, patch);
        }

        async updateCallRoute(callRouteId, patch) {
            return this.request("PUT", `/api/v2/architect/ivrs/${encodeURIComponent(callRouteId)}`, patch);
        }

        async addDirectRoutingPhoneAndUpdateCallRoute({ userId, phone, extension, countryCode, callRouteId, replaceExisting = false }) {
            const normalizedUserId = String(userId || "").trim();
            const normalizedPhone = normalizeTerritoryDid(phone);
            const suppliedExtension = String(extension ?? "");
            const normalizedExtension = normalizeInventoryExtension(extension);
            const normalizedCountryCode = normalizeCountryCode(countryCode);
            const normalizedCallRouteId = String(callRouteId || "").trim();

            if (!isGenesysUuid(normalizedUserId)) {
                throw new Error("The target Genesys User ID must be a UUID.");
            }
            if (!isE164Phone(normalizedPhone)) {
                throw new Error("The Direct Routing DID must be an E.164 phone number, for example +19165551234.");
            }
            if (!isConfiguredExtension(suppliedExtension)) {
                throw new Error("The Direct Routing extension is required and must be no more than 32 characters.");
            }
            if (!isCountryCode(normalizedCountryCode)) {
                throw new Error("The Direct Routing phone country code must be a two-letter ISO country code.");
            }
            if (!isGenesysUuid(normalizedCallRouteId)) {
                throw new Error("The Architect Call Route ID must be a UUID.");
            }

            // Preflight both resources before the first write. This is not a DID-pool
            // lookup; it prevents a missing or inaccessible Call Route from leaving
            // an avoidable user-only update.
            const [initialUser, initialCallRoute] = await Promise.all([
                this.getUser(normalizedUserId),
                this.getCallRoute(normalizedCallRouteId)
            ]);
            this.buildAddDirectRoutingPhonePatch(initialUser, normalizedPhone, normalizedExtension, normalizedCountryCode, Boolean(replaceExisting));
            this.buildCallRouteUpdatePayload(initialCallRoute, normalizedPhone);

            let userResult;
            try {
                userResult = await this.ensureDirectRoutingPhoneOnUser(
                    normalizedUserId,
                    normalizedPhone,
                    normalizedExtension,
                    normalizedCountryCode,
                    Boolean(replaceExisting),
                    initialUser
                );
            } catch (error) {
                // The Call Route mutation has not started yet, whether the user
                // write failed or its post-write verification was inconclusive.
                error.callRouteId = normalizedCallRouteId;
                error.routeStatus = error.routeStatus || "NOT_ATTEMPTED";
                error.routeCorrelationId = error.routeCorrelationId || "";
                throw error;
            }
            try {
                const routeResult = await this.ensureDirectRoutingDidOnCallRoute(
                    normalizedCallRouteId,
                    normalizedPhone,
                    // Re-read after the user mutation so a concurrent Call Route
                    // edit cannot turn an earlier no-op check into a false success.
                    null
                );
                return {
                    user: userResult.user,
                    callRoute: routeResult.callRoute,
                    userStatus: userResult.status,
                    routeStatus: routeResult.status,
                    userCorrelationId: userResult.correlationId,
                    routeCorrelationId: routeResult.correlationId
                };
            } catch (error) {
                error.updatedUser = error.updatedUser || userResult.user;
                error.userUpdateCompleted = error.userUpdateCompleted || ["UPDATED", "UNCHANGED"].includes(userResult.status);
                error.userStatus = error.userStatus || userResult.status;
                error.userCorrelationId = error.userCorrelationId || userResult.correlationId || "";
                error.callRouteId = normalizedCallRouteId;
                error.routeStatus = error.routeStatus || "FAILED";
                error.routeCorrelationId = error.routeCorrelationId || error.correlationId || "";
                throw error;
            }
        }

        async ensureDirectRoutingPhoneOnUser(userId, phone, extension, countryCode, replaceExisting, initialUser = null) {
            let currentUser = initialUser;
            let writeCorrelationId = "";

            for (let attempt = 0; attempt < MAX_MUTATION_ATTEMPTS; attempt += 1) {
                if (!currentUser) currentUser = await this.getUser(userId);
                const plan = this.buildAddDirectRoutingPhonePatch(currentUser, phone, extension, countryCode, replaceExisting);
                if (!plan.required) {
                    return { user: currentUser, status: "UNCHANGED", correlationId: writeCorrelationId };
                }

                let updatedUser = null;
                let userUpdateCompleted = false;
                try {
                    const response = await this.updateUser(userId, plan.patch);
                    updatedUser = response.data || null;
                    writeCorrelationId = response.correlationId || writeCorrelationId;
                    userUpdateCompleted = true;
                    const verifiedUser = await this.verifyDirectRoutingPhoneOnUser(userId, phone, extension, countryCode);
                    return { user: verifiedUser, status: "UPDATED", correlationId: writeCorrelationId };
                } catch (error) {
                    if (userUpdateCompleted) {
                        error.updatedUser = updatedUser;
                        error.userUpdateCompleted = true;
                        error.userStatus = "UNKNOWN_AFTER_WRITE";
                        error.userCorrelationId = writeCorrelationId;
                        error.verificationCorrelationId = error.correlationId || "";
                    } else if (isConflictError(error) && attempt < MAX_MUTATION_ATTEMPTS - 1) {
                        currentUser = null;
                        continue;
                    }
                    error.correlationId = error.correlationId || writeCorrelationId;
                    throw error;
                }
            }

            throw new Error("Genesys could not update the Direct Routing user contact after repeated conflicts.");
        }

        async ensureDirectRoutingDidOnCallRoute(callRouteId, phone, initialCallRoute = null) {
            let currentCallRoute = initialCallRoute;
            let writeCorrelationId = "";

            for (let attempt = 0; attempt < MAX_MUTATION_ATTEMPTS; attempt += 1) {
                if (!currentCallRoute) currentCallRoute = await this.getCallRoute(callRouteId);
                const plan = this.buildCallRouteUpdatePayload(currentCallRoute, phone);
                if (!plan.required) {
                    return { callRoute: currentCallRoute, status: "UNCHANGED", correlationId: writeCorrelationId };
                }

                let updatedCallRoute = null;
                let routeUpdateCompleted = false;
                try {
                    const response = await this.updateCallRoute(callRouteId, plan.patch);
                    updatedCallRoute = response.data || null;
                    writeCorrelationId = response.correlationId || writeCorrelationId;
                    routeUpdateCompleted = true;
                    const verifiedCallRoute = await this.verifyDirectRoutingDidOnCallRoute(callRouteId, phone);
                    return { callRoute: verifiedCallRoute, status: "UPDATED", correlationId: writeCorrelationId };
                } catch (error) {
                    if (routeUpdateCompleted) {
                        error.updatedCallRoute = updatedCallRoute;
                        error.routeUpdateCompleted = true;
                        error.routeStatus = "UNKNOWN_AFTER_WRITE";
                        error.routeCorrelationId = writeCorrelationId;
                        error.verificationCorrelationId = error.correlationId || "";
                    } else if (isConflictError(error) && attempt < MAX_MUTATION_ATTEMPTS - 1) {
                        currentCallRoute = null;
                        continue;
                    }
                    error.correlationId = error.correlationId || writeCorrelationId;
                    throw error;
                }
            }

            throw new Error("Genesys could not update the Call Route after repeated conflicts.");
        }

        async verifyDirectRoutingPhoneOnUser(userId, phone, extension, countryCode) {
            let lastError = null;
            for (let attempt = 0; attempt < MAX_VERIFICATION_ATTEMPTS; attempt += 1) {
                try {
                    const verifiedUser = await this.getUser(userId);
                    if (hasExactlyCanonicalDirectRoutingDid(verifiedUser, phone, extension, countryCode)) return verifiedUser;
                    lastError = new Error("Genesys did not verify the requested Direct Routing DID-and-extension pair on the user.");
                } catch (error) {
                    lastError = error;
                    if (!isRetryableVerificationError(error)) throw error;
                }
                if (attempt < MAX_VERIFICATION_ATTEMPTS - 1) {
                    await delay(VERIFICATION_RETRY_DELAY_MS * (attempt + 1));
                }
            }
            throw lastError || new Error("Genesys did not verify the Direct Routing DID on the user.");
        }

        async verifyDirectRoutingDidOnCallRoute(callRouteId, phone) {
            let lastError = null;
            for (let attempt = 0; attempt < MAX_VERIFICATION_ATTEMPTS; attempt += 1) {
                try {
                    const verifiedCallRoute = await this.getCallRoute(callRouteId);
                    if (callRouteContainsDid(verifiedCallRoute, phone)) return verifiedCallRoute;
                    lastError = new Error("Genesys did not verify the Direct Routing DID on the Call Route.");
                } catch (error) {
                    lastError = error;
                    if (!isRetryableVerificationError(error)) throw error;
                }
                if (attempt < MAX_VERIFICATION_ATTEMPTS - 1) {
                    await delay(VERIFICATION_RETRY_DELAY_MS * (attempt + 1));
                }
            }
            throw lastError || new Error("Genesys did not verify the Direct Routing DID on the Call Route.");
        }

        async applyTerritoryAssignment(change) {
            const updatedUsers = [];
            let correlationId = "";
            const territoryExtension = normalizeInventoryExtension(change.territory_extension);

            try {
                if (!isE164Phone(change.territory_phone)) {
                    throw new Error("The territory DID must be an E.164 phone number, for example +19165551234.");
                }
                if (change.new_user_id && !isConfiguredExtension(change.territory_extension)) {
                    throw new Error("This staged territory change has no valid extension. Re-stage it from inventory so the DID-and-extension pair can be updated safely.");
                }
                // Fetch and validate both versions before releasing a DID from its owner.
                const oldLatest = change.old_user_id ? await this.getUser(change.old_user_id) : null;
                const newLatest = change.new_user_id ? await this.getUser(change.new_user_id) : null;
                if (oldLatest) {
                    const oldBefore = this.normalizeUser(oldLatest);
                    if (change.old_user_version && oldBefore.version && String(change.old_user_version) !== String(oldBefore.version)) {
                        throw new Error("The currently assigned user changed since this assignment was staged. Refresh from Genesys and stage it again.");
                    }
                }
                if (newLatest) {
                    const newBefore = this.normalizeUser(newLatest);
                    if (change.new_user_version && newBefore.version && String(change.new_user_version) !== String(newBefore.version)) {
                        throw new Error("The target user changed since this assignment was staged. Refresh from Genesys and stage it again.");
                    }
                    if (requiresPairedReplacement(newLatest, change.territory_phone)
                        && !Boolean(change.replace_existing_pair)) {
                        throw new Error("The target user now has a different Direct Routing DID. Refresh and stage the assignment again with the replacement option selected.");
                    }
                    // Validate the full target patch before removing the DID
                    // from its current owner (including the reserved extension
                    // contact slot), so a target-profile conflict cannot leave
                    // an avoidable partial reassignment.
                    this.buildAssignPatch(
                        newLatest,
                        change.territory_phone,
                        territoryExtension,
                        Boolean(change.replace_existing_pair)
                    );
                }

                if (oldLatest && change.old_user_id !== change.new_user_id && hasDirectRoutingDid(oldLatest, change.territory_phone)) {
                    const patch = this.buildClearPhonePatch(oldLatest, change.territory_phone);
                    const { data: clearedUser, correlationId: clearCorrelationId } = await this.request("PATCH", `/api/v2/users/${encodeURIComponent(change.old_user_id)}`, patch);
                    correlationId = clearCorrelationId || correlationId;
                    upsertUpdatedUser(updatedUsers, clearedUser);
                    const verifiedOldUser = await this.getUser(change.old_user_id);
                    if (hasDirectRoutingDid(verifiedOldUser, change.territory_phone)
                        || directRoutingExtensionSlotsForUser(verifiedOldUser).length) {
                        throw new Error("Genesys did not remove the Direct Routing DID-and-extension pair from the previous user. Refresh and try again.");
                    }
                    upsertUpdatedUser(updatedUsers, verifiedOldUser);
                }

                if (newLatest) {
                    const patch = this.buildAssignPatch(
                        newLatest,
                        change.territory_phone,
                        territoryExtension,
                        Boolean(change.replace_existing_pair)
                    );
                    const { data: assignedUser, correlationId: assignCorrelationId } = await this.request("PATCH", `/api/v2/users/${encodeURIComponent(change.new_user_id)}`, patch);
                    correlationId = assignCorrelationId || correlationId;
                    upsertUpdatedUser(updatedUsers, assignedUser);
                    const verifiedNewUser = await this.getUser(change.new_user_id);
                    if (!hasTerritoryPhonePair(verifiedNewUser, change.territory_phone, territoryExtension)) {
                        throw new Error("Genesys did not verify the Direct Routing DID-and-extension pair on the assigned user. Refresh and try again.");
                    }
                    upsertUpdatedUser(updatedUsers, verifiedNewUser);
                }

                return { updatedUsers, correlationId };
            } catch (error) {
                error.updatedUsers = updatedUsers;
                error.correlationId = error.correlationId || correlationId;
                throw error;
            }
        }

        async request(method, path, body = null) {
            const token = this.getToken();
            if (!token?.access_token) {
                throw new Error("Sign in to Genesys first.");
            }
            const response = await fetch(`${this.apiHost}${path}`, {
                method,
                headers: {
                    "Authorization": `Bearer ${token.access_token}`,
                    "Content-Type": "application/json",
                    "Accept": "application/json"
                },
                body: body ? JSON.stringify(body) : null
            });
            const correlationId = response.headers.get("inin-correlation-id") || response.headers.get("x-correlation-id") || "";
            if (!response.ok) {
                const error = await this.toApiError(response, "Genesys Cloud request failed.");
                error.correlationId = correlationId;
                throw error;
            }
            const text = await response.text();
            return { data: text ? JSON.parse(text) : {}, correlationId };
        }

        async toApiError(response, fallback) {
            let payload = {};
            try {
                payload = await response.json();
            } catch {
                payload = {};
            }
            const mappings = {
                401: "Genesys authentication failed. Sign in again.",
                403: "Genesys denied this request. Check your permissions and division access.",
                404: "The Genesys user or resource was not found.",
                409: "Genesys reported a conflict. Refresh the user and try again.",
                429: "Genesys rate limit reached. Wait a moment and try again."
            };
            const message = response.status >= 500
                ? "Genesys Cloud is unavailable. Try again later."
                : mappings[response.status] || payload.message || payload.error_description || fallback;
            const error = new Error(message);
            error.status = response.status;
            return error;
        }

        normalizeUser(user) {
            const phoneInfo = this.extractPhoneAndExtension(user);
            const division = user.division || {};
            const email = user.email || user.userName || user.username || "";
            return {
                id: user.id,
                name: user.name || user.displayName || email,
                email,
                division_id: division.id || user.divisionId || "",
                division_name: division.name || "",
                state: user.state || "",
                version: user.version == null ? "" : String(user.version),
                addresses: clone(user.addresses || []),
                primaryContactInfo: clone(user.primaryContactInfo || []),
                did_phone: phoneInfo.didPhone,
                did_extension: phoneInfo.didExtension,
                work_extension: phoneInfo.workExtension,
                primary_extension: phoneInfo.primaryExtension,
                // Retain a compact compatibility value for older views/audit
                // records, while the UI uses the full contact collection below.
                extension: phoneInfo.didExtension || phoneInfo.workExtension || phoneInfo.primaryExtension,
                phone_contacts: phoneInfo.phoneContacts,
                phone_contacts_text: phoneInfo.phoneContacts.map(phoneContactText).join(" "),
                last_synced_at: new Date().toISOString()
            };
        }

        extractPhoneAndExtension(user) {
            const primary = Array.isArray(user.primaryContactInfo) ? user.primaryContactInfo : [];
            const addresses = Array.isArray(user.addresses) ? user.addresses : [];
            const workExtensionContact = findPhoneContactWithExtension(addresses, "work");
            const primaryExtensionContact = findPhoneContactWithExtension(primary, "primary");
            const didContact = findDirectRoutingDidContact(addresses);
            return {
                didPhone: contactAddress(didContact),
                didExtension: directRoutingExtensionForUser(user) || contactExtension(didContact),
                workExtension: contactExtension(workExtensionContact),
                primaryExtension: contactExtension(primaryExtensionContact),
                phoneContacts: collectUserPhoneContacts(user)
            };
        }

        buildAddDirectRoutingPhonePatch(existingUser, phone, extension, countryCode, replaceExisting) {
            if (existingUser?.version == null || existingUser.version === "") {
                throw new Error("Genesys did not return the user's current version. Refresh and try again.");
            }
            if (!isConfiguredExtension(extension)) {
                throw new Error("The Direct Routing extension is required and must be no more than 32 characters.");
            }
            const normalizedExtension = normalizeInventoryExtension(extension);

            // Work with the complete collection so unrelated user contacts are
            // retained. The final PATCH is reduced to writable Contact fields.
            let addresses = clone(Array.isArray(existingUser.addresses) ? existingUser.addresses : []);
            assertDirectRoutingContactShape(addresses);
            const existingDirectRoutingDids = addresses.filter(isDirectRoutingDidContact);
            if (existingDirectRoutingDids.length > 1) {
                throw new Error("The user has multiple Direct Routing DIDs. Resolve that profile manually before adding or replacing a DID.");
            }
            const matchingAddresses = existingDirectRoutingDids.filter((entry) => {
                return samePhone(contactAddress(entry), phone);
            });
            const matchingAddress = matchingAddresses[0] || null;

            if (existingDirectRoutingDids.length === 1
                && matchingAddresses.length === 1
                && isCanonicalDirectRoutingDidContact(matchingAddress, phone, countryCode)
                && hasDirectRoutingExtensionContact(existingUser, normalizedExtension)) {
                return {
                    required: false,
                    patch: { version: existingUser.version, addresses }
                };
            }

            const hasMatchingDirectRoutingDid = existingDirectRoutingDids.length === 1
                && matchingAddresses.length === 1;
            // A phone contact cannot contain both an address and an extension.
            // The matching extension is therefore stored in a separate
            // app-managed Direct Routing contact. A different DID still needs
            // explicit replacement approval.
            if (existingDirectRoutingDids.length
                && !hasMatchingDirectRoutingDid
                && !replaceExisting) {
                const existingNumbers = existingDirectRoutingDids
                    .map((entry) => contactAddress(entry))
                    .filter(Boolean)
                    .join(", ");
                throw new Error("The user already has a different Direct Routing DID ("
                    + (existingNumbers || "unknown")
                    + "). Select the replacement option to use the requested DID and extension.");
            }

            addresses = addresses.filter((entry) => {
                const isRequestedPhone = isPhoneEntry(entry)
                    && samePhone(contactAddress(entry), phone);
                const isDirectRoutingDid = isDirectRoutingDidContact(entry);
                // Genesys treats a phone address as unique. Replace any existing
                // entry for the requested DID, and only remove a different Direct
                // Routing phone after explicit caller approval.
                return !isRequestedPhone && !(replaceExisting && isDirectRoutingDid);
            });
            addresses.push(makeDirectRoutingDidContact(phone, countryCode));
            addresses = upsertDirectRoutingExtensionContact(addresses, normalizedExtension);
            return {
                required: true,
                patch: {
                    version: existingUser.version,
                    addresses
                }
            };
        }

        buildCallRouteUpdatePayload(callRoute, phone) {
            if (!callRoute || typeof callRoute !== "object") {
                throw new Error("Genesys did not return the selected Call Route.");
            }
            if (callRoute.version == null || callRoute.version === "") {
                throw new Error("Genesys did not return the Call Route's current version. Refresh and try again.");
            }
            if (!String(callRoute.name || "").trim()) {
                throw new Error("Genesys did not return the selected Call Route's name. Refresh and try again.");
            }
            if (callRoute.dnis != null && !Array.isArray(callRoute.dnis)) {
                throw new Error("Genesys returned an invalid Call Route DNIS list. Refresh and try again.");
            }

            const patch = {};
            CALL_ROUTE_WRITABLE_FIELDS.forEach((field) => {
                if (callRoute[field] !== undefined && callRoute[field] !== null) {
                    patch[field] = clone(callRoute[field]);
                }
            });
            patch.version = callRoute.version;
            patch.dnis = mergeCallRouteDnis(callRoute.dnis || [], phone);
            return {
                required: !callRouteContainsDid(callRoute, phone),
                patch
            };
        }

        buildAssignPatch(existingUser, phone, extension, replaceExisting = false) {
            if (!isConfiguredExtension(extension)) {
                throw new Error("The territory DID needs a valid extension before it can be assigned.");
            }
            const normalizedExtension = normalizeInventoryExtension(extension);
            let addresses = clone(existingUser.addresses || []);
            assertDirectRoutingContactShape(addresses);
            const existingDids = addresses.filter(isDirectRoutingDidContact);
            if (existingDids.length > 1) {
                throw new Error("The target user has multiple Direct Routing DIDs. Resolve that profile manually before assigning a DID.");
            }
            if (requiresPairedReplacement(existingUser, phone) && !replaceExisting) {
                throw new Error("The target user already has a different Direct Routing DID. Stage the assignment again with the replacement option selected.");
            }
            // Replace only the requested DID, plus any previous Direct Routing
            // DID for which the reviewer explicitly approved replacement.
            // All ordinary and non-app-managed extension contacts remain intact.
            addresses = addresses.filter((entry) => {
                const isRequestedPhone = isPhoneEntry(entry)
                    && samePhone(contactAddress(entry), phone);
                return !isRequestedPhone && !(replaceExisting && isDirectRoutingDidContact(entry));
            });
            addresses.push(makeDirectRoutingDidContact(phone, phoneCountryCode()));
            addresses = upsertDirectRoutingExtensionContact(addresses, normalizedExtension);

            return this.buildContactPatch(existingUser, addresses);
        }

        buildClearPhonePatch(existingUser, phone) {
            const currentAddresses = Array.isArray(existingUser?.addresses) ? existingUser.addresses : [];
            assertDirectRoutingContactShape(currentAddresses);
            const directRoutingDids = currentAddresses
                .filter(isDirectRoutingDidContact);
            if (directRoutingDids.length > 1) {
                throw new Error("The current user has multiple Direct Routing DIDs. Resolve that profile manually before moving or unassigning one.");
            }
            const extensionSlots = currentAddresses.filter(isDirectRoutingExtensionSlot);
            if (extensionSlots.length > 1) {
                throw new Error("The current user has multiple app-managed Direct Routing extension contacts. Resolve that profile manually before moving or unassigning the DID.");
            }
            let addresses = clone(existingUser.addresses || []).filter((entry) => {
                return !isDirectRoutingDidContact(entry) || !samePhone(contactAddress(entry), phone);
            });
            // Only remove the extension contact explicitly tagged as belonging
            // to Direct Routing. A legacy DID may not have this contact yet;
            // in that case remove only the DID rather than guessing ownership
            // from an ordinary user's extension.
            addresses = removeDirectRoutingExtensionContacts(addresses);
            return this.buildContactPatch(existingUser, addresses);
        }

        buildContactPatch(existingUser, addresses) {
            if (existingUser?.version == null || existingUser.version === "") {
                throw new Error("Genesys did not return the user's current version. Refresh and try again.");
            }
            // Only send writable address fields. primaryContactInfo is retained
            // in the UI for visibility but is not PATCHed by this workflow.
            return {
                version: existingUser.version,
                addresses: sanitizeUserAddresses(addresses)
            };
        }
    }

    class MockGenesysService extends GenesysService {
        constructor(config) {
            super(config);
            this.users = readJson(STORAGE.mockUsers, null) || buildMockUsers();
            this.callRoutes = readJson(STORAGE.mockCallRoutes, null) || buildMockCallRoutes(config);
            writeJson(STORAGE.mockUsers, this.users);
            writeJson(STORAGE.mockCallRoutes, this.callRoutes);
        }

        isAuthenticated() {
            return true;
        }

        async handleRedirectCallback() {
            return false;
        }

        async login() {
            return true;
        }

        logout() {
            return true;
        }

        async getCurrentUser() {
            return { id: "00000000-0000-4000-8000-000000000099", name: "Mock Admin", email: "admin@example.com" };
        }

        async searchUsersByDivision(divisionId, states = ["active"]) {
            await delay(160);
            return Object.values(this.users)
                .filter((user) => {
                    const normalized = this.normalizeUser(user);
                    return normalized.division_id === divisionId && (!states.length || states.includes((normalized.state || "").toLowerCase()));
                })
                .map(clone);
        }

        async getUser(userId) {
            await delay(80);
            const user = this.users[userId];
            if (!user) throw new Error("The Genesys user was not found.");
            return clone(user);
        }

        async getCallRoute(callRouteId) {
            await delay(80);
            const callRoute = this.callRoutes[callRouteId];
            if (!callRoute) throw new Error("The Genesys Call Route was not found.");
            return clone(callRoute);
        }

        async updateUser(userId, patch) {
            await delay(80);
            const currentUser = this.users[userId];
            if (!currentUser) throw new Error("The Genesys user was not found.");
            if (String(patch?.version) !== String(currentUser.version)) {
                const error = new Error("Mock Genesys reported a user version conflict.");
                error.status = 409;
                error.correlationId = `mock-${crypto.randomUUID()}`;
                throw error;
            }
            if (!Array.isArray(patch?.addresses)) {
                throw new Error("Mock Genesys requires a complete addresses array for a user update.");
            }
            const updatedUser = {
                ...currentUser,
                addresses: clone(patch.addresses),
                primaryContactInfo: clone(currentUser.primaryContactInfo || []),
                version: Number(currentUser.version || 0) + 1
            };
            this.users[userId] = updatedUser;
            writeJson(STORAGE.mockUsers, this.users);
            return { data: clone(updatedUser), correlationId: `mock-${crypto.randomUUID()}` };
        }

        async updateCallRoute(callRouteId, patch) {
            await delay(80);
            const currentCallRoute = this.callRoutes[callRouteId];
            if (!currentCallRoute) throw new Error("The Genesys Call Route was not found.");
            if (String(patch?.version) !== String(currentCallRoute.version)) {
                const error = new Error("Mock Genesys reported a Call Route version conflict.");
                error.status = 409;
                error.correlationId = `mock-${crypto.randomUUID()}`;
                throw error;
            }
            const updatedCallRoute = { ...currentCallRoute };
            CALL_ROUTE_WRITABLE_FIELDS.forEach((field) => {
                if (Object.prototype.hasOwnProperty.call(patch || {}, field)) {
                    updatedCallRoute[field] = clone(patch[field]);
                }
            });
            updatedCallRoute.id = currentCallRoute.id;
            updatedCallRoute.version = Number(currentCallRoute.version || 0) + 1;
            this.callRoutes[callRouteId] = updatedCallRoute;
            writeJson(STORAGE.mockCallRoutes, this.callRoutes);
            return { data: clone(updatedCallRoute), correlationId: `mock-${crypto.randomUUID()}` };
        }

        async applyTerritoryAssignment(change) {
            const updatedUsers = [];
            const territoryExtension = normalizeInventoryExtension(change.territory_extension);
            try {
                if (!isE164Phone(change.territory_phone)) {
                    throw new Error("The territory DID must be an E.164 phone number, for example +19165551234.");
                }
                if (change.new_user_id && !isConfiguredExtension(change.territory_extension)) {
                    throw new Error("This staged territory change has no valid extension. Re-stage it from inventory so the DID-and-extension pair can be updated safely.");
                }
                const oldLatest = change.old_user_id ? await this.getUser(change.old_user_id) : null;
                const newLatest = change.new_user_id ? await this.getUser(change.new_user_id) : null;
                if (oldLatest) {
                    const oldBefore = this.normalizeUser(oldLatest);
                    if (change.old_user_version && oldBefore.version && String(change.old_user_version) !== String(oldBefore.version)) {
                        throw new Error("The currently assigned user changed since this assignment was staged. Refresh from Genesys and stage it again.");
                    }
                }
                if (newLatest) {
                    const newBefore = this.normalizeUser(newLatest);
                    if (change.new_user_version && newBefore.version && String(change.new_user_version) !== String(newBefore.version)) {
                        throw new Error("The target user changed since this assignment was staged. Refresh from Genesys and stage it again.");
                    }
                    if (requiresPairedReplacement(newLatest, change.territory_phone)
                        && !Boolean(change.replace_existing_pair)) {
                        throw new Error("The target user now has a different Direct Routing DID. Refresh and stage the assignment again with the replacement option selected.");
                    }
                    this.buildAssignPatch(
                        newLatest,
                        change.territory_phone,
                        territoryExtension,
                        Boolean(change.replace_existing_pair)
                    );
                }

                if (oldLatest && change.old_user_id !== change.new_user_id && hasDirectRoutingDid(oldLatest, change.territory_phone)) {
                    const oldUpdated = {
                        ...oldLatest,
                        ...this.buildClearPhonePatch(oldLatest, change.territory_phone),
                        version: Number(oldLatest.version || 0) + 1
                    };
                    this.users[change.old_user_id] = oldUpdated;
                    upsertUpdatedUser(updatedUsers, oldUpdated);
                    const verifiedOldUser = await this.getUser(change.old_user_id);
                    if (hasDirectRoutingDid(verifiedOldUser, change.territory_phone)
                        || directRoutingExtensionSlotsForUser(verifiedOldUser).length) {
                        throw new Error("Mock Genesys did not remove the Direct Routing DID-and-extension pair from the previous user.");
                    }
                    upsertUpdatedUser(updatedUsers, verifiedOldUser);
                }

                if (newLatest) {
                    const newUpdated = {
                        ...newLatest,
                        ...this.buildAssignPatch(
                            newLatest,
                            change.territory_phone,
                            territoryExtension,
                            Boolean(change.replace_existing_pair)
                        ),
                        version: Number(newLatest.version || 0) + 1
                    };
                    this.users[change.new_user_id] = newUpdated;
                    upsertUpdatedUser(updatedUsers, newUpdated);
                    const verifiedNewUser = await this.getUser(change.new_user_id);
                    if (!hasTerritoryPhonePair(verifiedNewUser, change.territory_phone, territoryExtension)) {
                        throw new Error("Mock Genesys did not verify the Direct Routing DID-and-extension pair on the assigned user.");
                    }
                    upsertUpdatedUser(updatedUsers, verifiedNewUser);
                }

                writeJson(STORAGE.mockUsers, this.users);
                await delay(180);
                return { updatedUsers, correlationId: `mock-${crypto.randomUUID()}` };
            } catch (error) {
                writeJson(STORAGE.mockUsers, this.users);
                error.updatedUsers = updatedUsers;
                throw error;
            }
        }
    }

    function selectedDivisionId() {
        return document.getElementById("divisionSelect")?.value || CONFIG.defaultDivisionId || "";
    }

    function normalizeDivisionId(item) {
        return item.divisionId || item.division_id || item.division || CONFIG.defaultDivisionId || "";
    }

    function isAllowedDivisionId(divisionId) {
        return CONFIG.allowedDivisions.some((division) => division.id === divisionId);
    }

    function divisionNameFor(divisionId) {
        return CONFIG.allowedDivisions.find((division) => division.id === divisionId)?.name || divisionId || "";
    }

    function defaultEffectiveAtIso() {
        const date = new Date();
        date.setSeconds(0, 0);
        return date.toISOString();
    }

    function localDateTimeToIso(value) {
        if (!value) return "";
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? "" : date.toISOString();
    }

    function toDatetimeLocal(iso) {
        if (!iso) return "";
        const date = new Date(iso);
        if (Number.isNaN(date.getTime())) return "";
        const offset = date.getTimezoneOffset();
        const local = new Date(date.getTime() - offset * 60000);
        return local.toISOString().slice(0, 16);
    }

    function isDue(change) {
        if (!change?.effective_at) return true;
        return new Date(change.effective_at).getTime() <= Date.now();
    }

    function canApply(change) {
        return ["STAGED", "SCHEDULED", "FAILED"].includes(change.status) && isDue(change);
    }

    function changeStatusLabel(change) {
        if (change.status === "SCHEDULED" && isDue(change)) return "Due";
        return change.status === "STAGED" ? "Ready" : titleCase(change.status || "");
    }

    function changeStatusVariant(change) {
        if (change.status === "FAILED") return "danger";
        if (change.status === "SCHEDULED" && !isDue(change)) return "info";
        if (change.status === "APPLIED") return "success";
        if (change.status === "CANCELLED") return "secondary";
        return "warning";
    }

    function changeWithEffective(effectiveAt) {
        return { effective_at: effectiveAt };
    }

    function getHosts(config) {
        const defaults = REGION_HOSTS[config.genesysRegion || "us_east_1"] || REGION_HOSTS.us_east_1;
        return [
            (config.genesysApiHost || defaults[0]).replace(/\/$/, ""),
            (config.genesysLoginHost || defaults[1]).replace(/\/$/, "")
        ];
    }

    function isPhoneEntry(entry) {
        const mediaType = String(entry?.mediaType || entry?.media_type || "").toLowerCase();
        return mediaType === "phone" || Object.prototype.hasOwnProperty.call(entry || {}, "phone");
    }

    function entryType(entry) {
        return String(entry?.type || "").toLowerCase();
    }

    function contactAddress(entry) {
        return String(entry?.address || entry?.value || entry?.phoneNumber || "").trim();
    }

    function contactExtension(entry) {
        const extension = entry?.extension || entry?.extensionNumber || "";
        return extension ? String(extension).trim() : "";
    }

    function findPhoneContactWithExtension(entries, type, expectedExtension = "") {
        const expected = expectedExtension ? normalizeInventoryExtension(expectedExtension) : "";
        return (Array.isArray(entries) ? entries : []).find((entry) => {
            return isPhoneEntry(entry)
                && entryType(entry) === String(type || "").toLowerCase()
                && Boolean(contactExtension(entry))
                && (!expected || contactExtension(entry) === expected);
        }) || null;
    }

    function hasTerritoryPhonePair(user, phone, extension) {
        const normalizedExtension = normalizeInventoryExtension(extension);
        return hasDirectRoutingExtensionContact(user, normalizedExtension)
            && (Array.isArray(user?.addresses) ? user.addresses : []).some((entry) => {
                return isDirectRoutingDidContact(entry)
                    && samePhone(contactAddress(entry), phone)
                    && !contactExtension(entry);
            });
    }

    function directRoutingContactForPhone(user, phone) {
        return (Array.isArray(user?.addresses) ? user.addresses : []).find((entry) => {
            return isDirectRoutingDidContact(entry) && samePhone(contactAddress(entry), phone);
        }) || null;
    }

    function requiresPairedReplacement(user, phone) {
        const directRoutingPhones = (Array.isArray(user?.addresses) ? user.addresses : [])
            .filter(isDirectRoutingDidContact);
        return directRoutingPhones.length > 1
            || directRoutingPhones.some((entry) => !samePhone(contactAddress(entry), phone));
    }

    function directRoutingExtensionContactType() {
        const type = String(CONFIG.directRoutingExtensionContactType || "WORK4").trim().toUpperCase();
        if (!DIRECT_ROUTING_EXTENSION_CONTACT_TYPES.includes(type)) {
            throw new Error("Configure directRoutingExtensionContactType as WORK3, WORK4, or OTHER before assigning Direct Routing extensions.");
        }
        return type;
    }

    function isDirectRoutingExtensionSlot(entry) {
        return isPhoneEntry(entry)
            && String(entry?.integration || "").toLowerCase() === phoneIntegration()
            && !contactAddress(entry)
            && DIRECT_ROUTING_EXTENSION_CONTACT_TYPES.includes(String(entry?.type || "").toUpperCase());
    }

    function isDirectRoutingExtensionContact(entry) {
        return isDirectRoutingExtensionSlot(entry) && isConfiguredExtension(contactExtension(entry));
    }

    function directRoutingExtensionForUser(user) {
        const contact = directRoutingExtensionSlotsForUser(user)[0] || null;
        return contactExtension(contact);
    }

    function directRoutingExtensionSlotsForUser(user) {
        return (Array.isArray(user?.addresses) ? user.addresses : [])
            .filter(isDirectRoutingExtensionSlot);
    }

    function hasDirectRoutingExtensionContact(user, extension) {
        const normalizedExtension = normalizeInventoryExtension(extension);
        const extensionSlots = directRoutingExtensionSlotsForUser(user);
        return isConfiguredExtension(normalizedExtension)
            && extensionSlots.length === 1
            && contactExtension(extensionSlots[0]) === normalizedExtension;
    }

    function upsertDirectRoutingExtensionContact(entries, extension) {
        const normalizedExtension = normalizeInventoryExtension(extension);
        if (!isConfiguredExtension(normalizedExtension)) {
            throw new Error("The extension is required and must be no more than 32 characters.");
        }

        const contacts = clone(Array.isArray(entries) ? entries : []);
        const extensionSlots = contacts.filter(isDirectRoutingExtensionSlot);
        if (extensionSlots.length > 1) {
            throw new Error("The user has multiple app-managed Direct Routing extension contacts. Resolve those contacts manually before changing the DID.");
        }

        let contact = extensionSlots[0] || null;
        if (!contact) {
            const slotType = directRoutingExtensionContactType();
            const occupiedContact = contacts.find((entry) => {
                return isPhoneEntry(entry)
                    && entryType(entry) === slotType.toLowerCase()
                    && !isDirectRoutingExtensionSlot(entry);
            });
            if (occupiedContact) {
                throw new Error("The reserved " + slotType
                    + " phone-contact slot is already used by an ordinary profile contact. "
                    + "Choose another directRoutingExtensionContactType or free that slot; the app will not overwrite it.");
            }
            contact = {
                mediaType: "PHONE",
                type: slotType,
                extension: normalizedExtension,
                integration: phoneIntegration()
            };
            contacts.push(contact);
            return contacts;
        }

        contact.mediaType = "PHONE";
        contact.extension = normalizedExtension;
        contact.integration = phoneIntegration();
        delete contact.address;
        delete contact.value;
        delete contact.phoneNumber;
        delete contact.extensionNumber;
        delete contact.countryCode;
        delete contact.country_code;
        return contacts;
    }

    function removeDirectRoutingExtensionContacts(entries) {
        return clone(Array.isArray(entries) ? entries : []).filter((entry) => {
            return !isDirectRoutingExtensionSlot(entry);
        });
    }

    function isUnexpectedDirectRoutingAddress(entry) {
        return isPhoneEntry(entry)
            && String(entry?.integration || "").toLowerCase() === phoneIntegration()
            && Boolean(contactAddress(entry))
            && entryType(entry) !== "work2";
    }

    function isUnexpectedDirectRoutingExtensionSlot(entry) {
        return isPhoneEntry(entry)
            && String(entry?.integration || "").toLowerCase() === phoneIntegration()
            && !contactAddress(entry)
            && !DIRECT_ROUTING_EXTENSION_CONTACT_TYPES.includes(String(entry?.type || "").toUpperCase());
    }

    function assertDirectRoutingContactShape(entries) {
        const contacts = Array.isArray(entries) ? entries : [];
        if (contacts.some(isUnexpectedDirectRoutingAddress)
            || contacts.some(isUnexpectedDirectRoutingExtensionSlot)) {
            throw new Error("The user has a Direct Routing contact outside the managed WORK2 DID and reserved extension slots. Resolve that profile manually before changing the DID.");
        }
    }

    function sanitizeUserAddresses(entries) {
        return (Array.isArray(entries) ? entries : [])
            .map((entry) => {
                const sanitized = {};
                USER_ADDRESS_WRITABLE_FIELDS.forEach((field) => {
                    if (entry?.[field] !== undefined
                        && entry[field] !== null
                        && entry[field] !== "") {
                        sanitized[field] = clone(entry[field]);
                    }
                });
                return sanitized;
            })
            .filter((entry) => Object.keys(entry).length);
    }

    function collectUserPhoneContacts(user) {
        const contacts = [];
        const addContacts = (entries, source) => {
            (Array.isArray(entries) ? entries : []).forEach((entry) => {
                if (!isPhoneEntry(entry)) return;
                const extension = contactExtension(entry);
                const display = String(entry?.display || "").trim();
                contacts.push({
                    source,
                    type: String(entry?.type || "PHONE").toUpperCase(),
                    address: contactAddress(entry) || (display && display !== extension ? display : ""),
                    extension,
                    integration: String(entry?.integration || "").trim()
                });
            });
        };
        addContacts(user?.addresses, "Profile");
        addContacts(user?.primaryContactInfo, "Primary");
        return contacts;
    }

    function phoneContactText(contact) {
        return [
            contact?.source,
            contact?.type,
            contact?.address,
            contact?.extension ? `Ext ${contact.extension}` : "",
            contact?.integration
        ].filter(Boolean).join(" ");
    }

    function isDirectRoutingDidContact(entry) {
        return isPhoneEntry(entry)
            && String(entry?.integration || "").toLowerCase() === phoneIntegration()
            && entryType(entry) === "work2"
            && Boolean(contactAddress(entry));
    }

    function findDirectRoutingDidContact(entries) {
        return (Array.isArray(entries) ? entries : []).find(isDirectRoutingDidContact) || null;
    }

    function hasDirectRoutingDid(user, phone) {
        return (Array.isArray(user?.addresses) ? user.addresses : []).some((entry) => {
            return isDirectRoutingDidContact(entry) && samePhone(contactAddress(entry), phone);
        });
    }

    function hasExactlyCanonicalDirectRoutingDid(user, phone, extension, countryCode) {
        const directRoutingAddresses = (Array.isArray(user?.addresses) ? user.addresses : [])
            .filter(isDirectRoutingDidContact);
        return directRoutingAddresses.length === 1
            && isCanonicalDirectRoutingDidContact(directRoutingAddresses[0], phone, countryCode)
            && hasDirectRoutingExtensionContact(user, extension);
    }

    function isDirectRoutingPhoneContact(entry) {
        return isDirectRoutingDidContact(entry);
    }

    function isCanonicalDirectRoutingDidContact(entry, phone, countryCode) {
        return isDirectRoutingDidContact(entry)
            && entryType(entry) === "work2"
            && samePhone(contactAddress(entry), phone)
            && !contactExtension(entry)
            && normalizeCountryCode(entry?.countryCode ?? entry?.country_code) === normalizeCountryCode(countryCode);
    }

    function makeDirectRoutingDidContact(phone, countryCode) {
        const entry = { mediaType: "PHONE", type: "WORK2", integration: phoneIntegration() };
        applyDirectRoutingDidFields(entry, phone);
        entry.countryCode = normalizeCountryCode(countryCode);
        return entry;
    }

    function callRouteContainsDid(callRoute, phone) {
        return (Array.isArray(callRoute?.dnis) ? callRoute.dnis : []).some((entry) => samePhone(entry, phone));
    }

    function mergeCallRouteDnis(existingDnis, phone) {
        const dnis = [];
        const seen = new Set();
        [...(Array.isArray(existingDnis) ? existingDnis : []), phone].forEach((value) => {
            const did = String(value ?? "").trim();
            if (!did) return;
            const key = isE164Phone(normalizeTerritoryDid(did))
                ? normalizeTerritoryDid(did)
                : did.toLowerCase();
            if (seen.has(key)) return;
            seen.add(key);
            dnis.push(did);
        });
        return dnis;
    }

    function samePhone(left, right) {
        return phoneInventoryKey(left) === phoneInventoryKey(right);
    }

    function isE164Phone(phone) {
        return /^\+[1-9]\d{1,14}$/.test(String(phone || "").trim());
    }

    function isGenesysUuid(value) {
        return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || "").trim());
    }

    function normalizeCountryCode(value) {
        return String(value || "").trim().toUpperCase();
    }

    function isCountryCode(value) {
        return /^[A-Z]{2}$/.test(normalizeCountryCode(value));
    }

    function configuredCallRouteId() {
        const configured = String(CONFIG.callRouteId || "").trim();
        if (configured) return configured;
        return CONFIG.mockGenesys ? String(CONFIG.mockCallRouteId || DEFAULT_MOCK_CALL_ROUTE_ID).trim() : "";
    }

    function isConflictError(error) {
        return Number(error?.status) === 409;
    }

    function isRetryableVerificationError(error) {
        const status = Number(error?.status || 0);
        return !status || status === 408 || status === 409 || status === 429 || status >= 500;
    }

    function joinCorrelationIds(...correlationIds) {
        return [...new Set(correlationIds.map((value) => String(value || "").trim()).filter(Boolean))].join(" | ");
    }

    function normalizeTerritoryDid(value) {
        const phone = String(value ?? "").trim();
        if (isE164Phone(phone)) return phone;
        if (/^\+[\d\s().-]+$/.test(phone)) {
            const formattedPhone = `+${phone.replace(/\D/g, "")}`;
            if (isE164Phone(formattedPhone)) return formattedPhone;
        }
        return phone;
    }

    function normalizeInventoryExtension(value) {
        return String(value ?? "").trim().slice(0, 32);
    }

    function isValidInventoryExtension(value) {
        const extension = String(value ?? "").trim();
        return extension.length <= 32 && !/[\r\n]/.test(extension);
    }

    function isConfiguredExtension(value) {
        const extension = String(value ?? "").trim();
        return Boolean(extension) && isValidInventoryExtension(extension);
    }

    function applyDirectRoutingDidFields(entry, phone) {
        const normalizedPhone = String(phone || "").trim();
        entry.address = normalizedPhone;
        entry.display = formatPhoneDisplay(normalizedPhone);
        entry.mediaType = "PHONE";
        entry.type = "WORK2";
        entry.countryCode = phoneCountryCode();
        entry.integration = phoneIntegration();
        // Genesys Contact defines extension as mutually exclusive with address.
        // The paired extension is stored in the app-managed extension contact.
        delete entry.extension;
        delete entry.extensionNumber;
        delete entry.media_type;
        delete entry.country_code;
    }

    function formatPhoneDisplay(phone) {
        const digits = String(phone || "").replace(/\D/g, "");
        if (digits.length === 11 && digits.startsWith("1")) {
            return `+1 ${digits.slice(1, 4)}-${digits.slice(4, 7)}-${digits.slice(7)}`;
        }
        return String(phone || "").trim();
    }

    function phoneCountryCode() {
        return normalizeCountryCode(CONFIG.phoneCountryCode || "US");
    }

    function phoneIntegration() {
        return "directrouting";
    }

    function saveChanges() {
        writeJson(STORAGE.changes, state.changes);
    }

    function auditVariant(status) {
        return {
            STAGED: "warning",
            SCHEDULED: "info",
            APPLYING: "info",
            APPLIED: "success",
            PARTIAL_SUCCESS: "warning",
            FAILED: "danger",
            CANCELLED: "secondary"
        }[status] || "info";
    }

    function badge(label, variant) {
        return `<span class="badge text-bg-${variant} status-badge">${escapeHtml(label)}</span>`;
    }

    function showToast(message, variant = "success") {
        const container = document.getElementById("toastContainer");
        const toastEl = document.createElement("div");
        toastEl.className = `toast align-items-center text-bg-${variant} border-0`;
        toastEl.role = "alert";
        toastEl.ariaLive = "assertive";
        toastEl.ariaAtomic = "true";
        toastEl.innerHTML = `
            <div class="d-flex">
                <div class="toast-body">${escapeHtml(message)}</div>
                <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button>
            </div>`;
        container.appendChild(toastEl);
        const toast = new bootstrap.Toast(toastEl, { delay: 4200 });
        toast.show();
        toastEl.addEventListener("hidden.bs.toast", () => toastEl.remove());
    }

    function confirmAction({ title, message, buttonText = "Continue", buttonVariant = "primary" }) {
        return new Promise((resolve) => {
            const modalEl = document.getElementById("confirmModal");
            const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
            const button = document.getElementById("confirmActionButton");
            document.getElementById("confirmTitle").textContent = title;
            document.getElementById("confirmMessage").textContent = message;
            button.textContent = buttonText;
            button.className = `btn btn-${buttonVariant}`;

            const cleanup = () => {
                button.removeEventListener("click", onConfirm);
                modalEl.removeEventListener("hidden.bs.modal", onHidden);
            };
            const onConfirm = () => {
                cleanup();
                modal.hide();
                resolve({ confirmed: true });
            };
            const onHidden = () => {
                cleanup();
                resolve({ confirmed: false });
            };

            button.addEventListener("click", onConfirm);
            modalEl.addEventListener("hidden.bs.modal", onHidden, { once: true });
            modal.show();
        });
    }

    function escapeHtml(value) {
        return String(value ?? "")
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#039;");
    }

    function formatDate(value) {
        if (!value) return "";
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
    }

    function readJson(key, fallback) {
        try {
            const raw = localStorage.getItem(key);
            return raw ? JSON.parse(raw) : fallback;
        } catch {
            return fallback;
        }
    }

    function writeJson(key, value) {
        localStorage.setItem(key, JSON.stringify(value));
    }

    function clone(value) {
        return JSON.parse(JSON.stringify(value));
    }

    function debounce(fn, wait = 250) {
        let timeout;
        return (...args) => {
            clearTimeout(timeout);
            timeout = setTimeout(() => fn(...args), wait);
        };
    }

    function csvEscape(value) {
        const text = String(value ?? "");
        return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
    }

    function downloadBlob(content, filename, type) {
        const blob = new Blob([content], { type });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
    }

    async function sha256Base64Url(value) {
        const bytes = new TextEncoder().encode(value);
        const hash = await crypto.subtle.digest("SHA-256", bytes);
        return base64UrlFromBytes(new Uint8Array(hash));
    }

    function randomBase64Url(length) {
        const bytes = new Uint8Array(length);
        crypto.getRandomValues(bytes);
        return base64UrlFromBytes(bytes);
    }

    function base64UrlFromBytes(bytes) {
        let binary = "";
        bytes.forEach((byte) => {
            binary += String.fromCharCode(byte);
        });
        return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    }

    function delay(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    async function mapWithConcurrency(items, limit, mapper) {
        const values = Array.isArray(items) ? items : [];
        const results = new Array(values.length);
        let nextIndex = 0;
        const workerCount = Math.min(Math.max(Number(limit) || 1, 1), values.length);
        const workers = Array.from({ length: workerCount }, async () => {
            while (nextIndex < values.length) {
                const index = nextIndex;
                nextIndex += 1;
                results[index] = await mapper(values[index], index);
            }
        });
        await Promise.all(workers);
        return results;
    }

    function titleCase(value) {
        return String(value || "").toLowerCase().replace(/(^|_|\s)\w/g, (match) => match.toUpperCase().replace("_", " "));
    }

    function cssId(value) {
        return String(value || "").replace(/[^a-z0-9_-]/gi, "-");
    }

    function normalizeStoredChanges(changes) {
        return (Array.isArray(changes) ? changes : [])
            .filter((change) => change.territory_phone)
            .map((change) => ({ ...change }));
    }

    function normalizeStoredAudit(rows) {
        return (Array.isArray(rows) ? rows : [])
            .filter((row) => row.territory_phone)
            .map((row) => ({ ...row }));
    }

    function normalizeStoredTerritoryPhones(rows) {
        const configuredPhones = new Set(CONFIG.territoryPhoneNumbers.map((item) => {
            return phoneInventoryKey(item?.phone || item?.number || "");
        }).filter(Boolean));
        const byPhone = new Map();
        (Array.isArray(rows) ? rows : []).forEach((item) => {
            const normalized = normalizeTerritoryPhone(item, "Browser-local");
            if (!normalized
                || !isE164Phone(normalized.phone)
                || !isAllowedDivisionId(normalized.divisionId)
                || !isValidInventoryExtension(item?.extension)) return;
            const key = phoneInventoryKey(normalized.phone);
            if (!configuredPhones.has(key) && !byPhone.has(key)) {
                byPhone.set(key, {
                    phone: normalized.phone,
                    extension: normalized.extension,
                    divisionId: normalized.divisionId,
                    createdAt: normalized.createdAt
                });
            }
        });
        return [...byPhone.values()];
    }

    function buildMockUsers() {
        const users = [
            mockUser("00000000-0000-4000-8000-000000000101", "Avery Johnson", "avery.johnson@example.com", "sales-west", "Sales West", "+14155550101", "4101", 3),
            mockUser("00000000-0000-4000-8000-000000000102", "Morgan Lee", "morgan.lee@example.com", "sales-west", "Sales West", "+14155550102", "4102", 2),
            mockUser("00000000-0000-4000-8000-000000000103", "Priya Shah", "priya.shah@example.com", "sales-west", "Sales West", "+14155550103", "4103", 7),
            mockUser("00000000-0000-4000-8000-000000000201", "Jordan Smith", "jordan.smith@example.com", "sales-east", "Sales East", "+12125550101", "5101", 5),
            mockUser("00000000-0000-4000-8000-000000000202", "Taylor Brown", "taylor.brown@example.com", "sales-east", "Sales East", "+12125550102", "5102", 4),
            mockUser("00000000-0000-4000-8000-000000000301", "Casey Davis", "casey.davis@example.com", "enterprise", "Enterprise Accounts", "+13125550101", "6101", 6)
        ];
        return Object.fromEntries(users.map((user) => [user.id, user]));
    }

    function buildMockCallRoutes(config) {
        const id = isGenesysUuid(config?.mockCallRouteId)
            ? String(config.mockCallRouteId).trim()
            : DEFAULT_MOCK_CALL_ROUTE_ID;
        const configuredDids = Array.isArray(config?.territoryPhoneNumbers)
            ? config.territoryPhoneNumbers.map((item) => normalizeTerritoryDid(item?.phone || item?.number || ""))
            : [];
        const dnis = configuredDids.reduce((result, did) => mergeCallRouteDnis(result, did), []);
        const divisionId = String(config?.defaultDivisionId || "").trim();
        const divisionName = config?.allowedDivisions?.find((division) => division.id === divisionId)?.name || divisionId;
        return {
            [id]: {
                id,
                name: "Mock Direct Routing Call Route",
                division: divisionId ? { id: divisionId, name: divisionName } : undefined,
                description: "Mock Call Route used by the Direct Routing phone workflow.",
                version: 1,
                dnis
            }
        };
    }

    function mockUser(id, name, email, divisionId, divisionName, didPhone, extension, version) {
        const user = {
            id,
            name,
            email,
            division: { id: divisionId, name: divisionName },
            state: "active",
            version,
            addresses: [
                { mediaType: "EMAIL", type: "WORK", address: email },
                {
                    address: didPhone,
                    display: formatPhoneDisplay(didPhone),
                    mediaType: "PHONE",
                    type: "WORK2",
                    countryCode: "US",
                    integration: "directrouting"
                },
                {
                    mediaType: "PHONE",
                    type: directRoutingExtensionContactType(),
                    extension,
                    integration: "directrouting"
                }
            ],
            primaryContactInfo: [
                { mediaType: "EMAIL", type: "WORK", address: email }
            ]
        };
        // Exercise the dashboard's complete contact display without making
        // ordinary phones into territory-assignment rows.
        if (id.endsWith("102")) {
            user.addresses.push(
                {
                    address: "+14155550902",
                    display: formatPhoneDisplay("+14155550902"),
                    mediaType: "PHONE",
                    type: "MOBILE",
                    countryCode: "US"
                },
                { display: "4102-ALT", mediaType: "PHONE", type: "WORK3", extension: "4102-ALT" }
            );
            user.primaryContactInfo.push({
                address: "+14155550903",
                display: formatPhoneDisplay("+14155550903"),
                mediaType: "PHONE",
                type: "MOBILE",
                countryCode: "US"
            });
            user.primaryContactInfo.push({
                display: "4102-PRIMARY",
                mediaType: "PHONE",
                type: "PRIMARY",
                extension: "4102-PRIMARY"
            });
        }
        return user;
    }
})();
