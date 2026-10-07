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
        // v2 fixtures model the extension and Direct Routing DID as separate contacts.
        mockUsers: "territory.mockUsers.v2",
        selectedDivision: "territory.selectedDivision"
    };
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
            renderSignedOut();
            showToast("Signed out.", "info");
        });

        document.getElementById("refreshUsersButton").addEventListener("click", () => loadUsers(true));
        document.getElementById("divisionSelect").addEventListener("change", () => {
            localStorage.setItem(STORAGE.selectedDivision, document.getElementById("divisionSelect").value);
            state.page = 1;
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
    }

    function populateDivisionControls() {
        const selected = localStorage.getItem(STORAGE.selectedDivision) || CONFIG.defaultDivisionId || CONFIG.allowedDivisions[0]?.id || "";
        const options = CONFIG.allowedDivisions.map((division) => `<option value="${escapeHtml(division.id)}">${escapeHtml(division.name)}</option>`).join("");
        document.getElementById("divisionSelect").innerHTML = options;
        document.getElementById("auditDivisionFilter").innerHTML = `<option value="">All</option>${options}`;
        if (CONFIG.allowedDivisions.some((division) => division.id === selected)) {
            document.getElementById("divisionSelect").value = selected;
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
            renderSignedOut();
            return;
        }
        const divisionId = selectedDivisionId();
        if (!divisionId) {
            document.getElementById("usersTableBody").innerHTML = `<tr><td colspan="11" class="text-center py-5 text-muted">Configure at least one division in assets/js/config.js.</td></tr>`;
            return;
        }

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
            const ownersById = new Map();
            userGroups.flat().forEach((user) => {
                const normalized = state.service.normalizeUser(user);
                if (normalized.id) ownersById.set(normalized.id, normalized);
            });
            state.ownerUsers = [...ownersById.values()];
            state.users = state.ownerUsers.filter((user) => {
                return user.division_id === divisionId && (!user.state || user.state.toLowerCase() === "active");
            });
            state.page = force ? 1 : state.page;
            renderAssignments();
            showToast(`Loaded ${state.users.length} assignable users, checked ${state.ownerUsers.length} owner records, and found ${buildAssignments().length} territory phones.`, "success");
        } catch (error) {
            document.getElementById("usersTableBody").innerHTML = `<tr><td colspan="11" class="text-center py-5 text-danger">${escapeHtml(error.message)}</td></tr>`;
            showToast(error.message, "danger");
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
    }

    function renderAssignmentRow(assignment) {
        const isEditing = state.editingPhone === assignment.phone;
        const staged = getOpenChangeForPhone(assignment.phone);
        const status = staged ? badge(changeStatusLabel(staged), changeStatusVariant(staged)) : badge(assignment.current_user_id ? "Assigned" : "Unassigned", assignment.current_user_id ? "success" : "secondary");
        const userCell = assignment.current_user_id
            ? `<strong>${escapeHtml(assignment.current_user_name)}</strong><div class="text-muted small">${escapeHtml(assignment.current_user_email)}</div>`
            : `<span class="text-muted">Unassigned</span>`;
        const proposedCell = staged
            ? `<strong>${escapeHtml(staged.new_user_name || "Unassigned")}</strong><div class="text-muted small">${escapeHtml(staged.new_user_email || "")}</div>`
            : "";
        const editControls = isEditing ? renderAssignmentEditControls(assignment) : "";
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

    function renderAssignmentEditControls(assignment) {
        const userOptions = [
            `<option value="">Unassigned</option>`,
            ...state.users
                .slice()
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((user) => `<option value="${escapeHtml(user.id)}" ${user.id === assignment.current_user_id ? "selected" : ""}>${escapeHtml(user.name)} - ${escapeHtml(user.email)}</option>`)
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
        const effectiveAt = localDateTimeToIso(effectiveLocal);

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
        if (targetUserId && (!targetUser.extension || !targetUser.has_primary_extension)) {
            showToast("The selected user needs matching PHONE/WORK and PHONE/PRIMARY extension contacts before a Direct Routing DID can be assigned.", "danger");
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
            territory_extension: targetUser?.extension || assignment.extension || "",
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
        const result = await confirmAction({
            title: "Apply assignment",
            message: `Assign ${change.territory_phone} to ${change.new_user_name || "Unassigned"} now?`,
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

        CONFIG.territoryPhoneNumbers
            .filter((item) => normalizeDivisionId(item) === divisionId)
            .forEach((item) => {
                const phone = item.phone || item.number || "";
                if (!phone) return;
                byPhone.set(phone, {
                    phone,
                    extension: item.extension || "",
                    division_id: divisionId,
                    division_name: item.divisionName || item.division_name || divisionName,
                    current_user_id: "",
                    current_user_name: "",
                    current_user_email: "",
                    current_user_version: "",
                    last_synced_at: "",
                    source: "Configured"
                });
            });

        const ownerUsers = state.ownerUsers.length ? state.ownerUsers : state.users;
        ownerUsers.forEach((user) => {
            if (!user.did_phone) return;
            const configured = byPhone.get(user.did_phone);
            if (!configured && user.division_id !== divisionId) return;
            byPhone.set(user.did_phone, {
                phone: user.did_phone,
                extension: user.extension || configured?.extension || "",
                division_id: configured?.division_id || user.division_id,
                division_name: configured?.division_name || user.division_name || divisionName,
                current_user_id: user.id,
                current_user_name: user.name,
                current_user_email: user.email,
                current_user_version: user.version,
                last_synced_at: user.last_synced_at,
                source: configured ? "Configured + Genesys" : "Genesys"
            });
        });

        return [...byPhone.values()].sort((a, b) => a.phone.localeCompare(b.phone));
    }

    function getOpenChangeForPhone(phone) {
        return state.changes.find((change) => change.territory_phone === phone && ["STAGED", "SCHEDULED", "FAILED"].includes(change.status));
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
                row.territory_phone,
                row.old_user_email,
                row.old_user_name,
                row.new_user_email,
                row.new_user_name
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

    function appendAudit(change, status, message) {
        state.audit.unshift({
            id: crypto.randomUUID(),
            timestamp: new Date().toISOString(),
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
            correlation_id: change.correlation_id || ""
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
        const headers = ["Timestamp", "Actor", "Territory Phone", "Extension", "Division", "Old User", "New User", "Effective At", "Status", "Message", "Correlation ID"];
        const rows = state.audit.map((row) => [
            row.timestamp,
            row.actor_email,
            row.territory_phone,
            row.territory_extension,
            row.division_name || row.division_id,
            row.old_user_name || "Unassigned",
            row.new_user_name || "Unassigned",
            row.effective_at,
            row.status,
            row.message,
            row.correlation_id
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
            ["Phone Country", phoneCountryCode()]
        ];
        document.getElementById("settingsSummary").innerHTML = settings.map(([label, value]) => `
            <div class="col-12 col-md-6 col-xl-3 settings-kpi">
                <div class="label">${escapeHtml(label)}</div>
                <div class="value">${escapeHtml(value)}</div>
            </div>`).join("");
        const phones = CONFIG.territoryPhoneNumbers.filter((item) => !selectedDivisionId() || normalizeDivisionId(item) === selectedDivisionId());
        document.getElementById("settingsDivisionsBody").innerHTML = CONFIG.allowedDivisions.map((division) => `
            <tr>
                <td>${escapeHtml(division.name)}</td>
                <td><code>${escapeHtml(division.id)}</code></td>
                <td>${division.id === CONFIG.defaultDivisionId ? badge("Default", "info") : ""}</td>
            </tr>`).join("");
        const settingsBody = document.getElementById("settingsDivisionsBody");
        if (phones.length) {
            settingsBody.insertAdjacentHTML("beforeend", `
                <tr><td colspan="3" class="table-light fw-semibold">Configured Territory Phones</td></tr>
                ${phones.map((item) => `
                    <tr>
                        <td>${escapeHtml(item.phone || item.number || "")}</td>
                        <td><code>${escapeHtml(item.extension || "")}</code></td>
                        <td>${escapeHtml(item.divisionName || divisionNameFor(normalizeDivisionId(item)))}</td>
                    </tr>`).join("")}`);
        }
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

        async applyTerritoryAssignment(change) {
            const updatedUsers = [];
            let correlationId = "";

            try {
                if (!isE164Phone(change.territory_phone)) {
                    throw new Error("The territory DID must be an E.164 phone number, for example +19165551234.");
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
                    const targetContacts = this.extractPhoneAndExtension(newLatest);
                    if (!targetContacts.extension || !targetContacts.hasPrimaryExtension) {
                        throw new Error("The target user needs matching PHONE/WORK and PHONE/PRIMARY extension contacts before a Direct Routing DID can be assigned.");
                    }
                }

                if (oldLatest && change.old_user_id !== change.new_user_id && hasDirectRoutingDid(oldLatest, change.territory_phone)) {
                    const patch = this.buildClearPhonePatch(oldLatest, change.territory_phone);
                    const { data: clearedUser, correlationId: clearCorrelationId } = await this.request("PATCH", `/api/v2/users/${encodeURIComponent(change.old_user_id)}`, patch);
                    correlationId = clearCorrelationId || correlationId;
                    upsertUpdatedUser(updatedUsers, clearedUser);
                    const verifiedOldUser = await this.getUser(change.old_user_id);
                    if (hasDirectRoutingDid(verifiedOldUser, change.territory_phone)) {
                        throw new Error("Genesys did not remove the Direct Routing DID from the previous user. Refresh and try again.");
                    }
                    upsertUpdatedUser(updatedUsers, verifiedOldUser);
                }

                if (newLatest) {
                    const patch = this.buildAssignPatch(newLatest, change.territory_phone);
                    const { data: assignedUser, correlationId: assignCorrelationId } = await this.request("PATCH", `/api/v2/users/${encodeURIComponent(change.new_user_id)}`, patch);
                    correlationId = assignCorrelationId || correlationId;
                    upsertUpdatedUser(updatedUsers, assignedUser);
                    const verifiedNewUser = await this.getUser(change.new_user_id);
                    if (!hasDirectRoutingDid(verifiedNewUser, change.territory_phone)) {
                        throw new Error("Genesys did not verify the Direct Routing DID on the assigned user. Refresh and try again.");
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
                extension: phoneInfo.extension,
                has_primary_extension: phoneInfo.hasPrimaryExtension,
                last_synced_at: new Date().toISOString()
            };
        }

        extractPhoneAndExtension(user) {
            const primary = Array.isArray(user.primaryContactInfo) ? user.primaryContactInfo : [];
            const addresses = Array.isArray(user.addresses) ? user.addresses : [];
            const extensionContact = findExtensionContact(addresses, ["work"]);
            const extension = contactExtension(extensionContact);
            const primaryExtensionContact = extension
                ? findExtensionContact(primary, ["primary"], extension)
                : null;
            const didContact = findDirectRoutingDidContact(addresses);
            return {
                didPhone: contactAddress(didContact),
                extension,
                hasPrimaryExtension: Boolean(primaryExtensionContact)
            };
        }

        buildAssignPatch(existingUser, phone) {
            const extensionInfo = this.extractPhoneAndExtension(existingUser);
            if (!extensionInfo.extension || !extensionInfo.hasPrimaryExtension) {
                throw new Error("The target user needs matching PHONE/WORK and PHONE/PRIMARY extension contacts before a Direct Routing DID can be assigned.");
            }

            let addresses = clone(existingUser.addresses || []);
            const existingDids = addresses.filter(isDirectRoutingDidContact);
            let didContact = existingDids.find((entry) => samePhone(contactAddress(entry), phone)) || existingDids[0];
            if (didContact) {
                // Keep one Direct Routing WORK2 entry and replace its DID instead of adding another.
                addresses = addresses.filter((entry) => entry === didContact || !isDirectRoutingDidContact(entry));
            } else {
                didContact = { mediaType: "PHONE", type: "WORK2", integration: phoneIntegration() };
                addresses.push(didContact);
            }
            applyDirectRoutingDidFields(didContact, phone);

            return this.buildContactPatch(existingUser, addresses);
        }

        buildClearPhonePatch(existingUser, phone) {
            const addresses = clone(existingUser.addresses || []).filter((entry) => {
                return !isDirectRoutingDidContact(entry) || !samePhone(contactAddress(entry), phone);
            });
            return this.buildContactPatch(existingUser, addresses);
        }

        buildContactPatch(existingUser, addresses) {
            if (existingUser?.version == null || existingUser.version === "") {
                throw new Error("Genesys did not return the user's current version. Refresh and try again.");
            }
            // Browser REST uses camelCase; the Python SDK equivalent is UpdateUser.primary_contact_info.
            return {
                version: existingUser.version,
                addresses,
                primaryContactInfo: clone(existingUser.primaryContactInfo || [])
            };
        }
    }

    class MockGenesysService extends GenesysService {
        constructor(config) {
            super(config);
            this.users = readJson(STORAGE.mockUsers, null) || buildMockUsers();
            writeJson(STORAGE.mockUsers, this.users);
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
            return { id: "mock-admin", name: "Mock Admin", email: "admin@example.com" };
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

        async applyTerritoryAssignment(change) {
            const updatedUsers = [];
            try {
                if (!isE164Phone(change.territory_phone)) {
                    throw new Error("The territory DID must be an E.164 phone number, for example +19165551234.");
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
                    const targetContacts = this.extractPhoneAndExtension(newLatest);
                    if (!targetContacts.extension || !targetContacts.hasPrimaryExtension) {
                        throw new Error("The target user needs matching PHONE/WORK and PHONE/PRIMARY extension contacts before a Direct Routing DID can be assigned.");
                    }
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
                    if (hasDirectRoutingDid(verifiedOldUser, change.territory_phone)) {
                        throw new Error("Mock Genesys did not remove the Direct Routing DID from the previous user.");
                    }
                    upsertUpdatedUser(updatedUsers, verifiedOldUser);
                }

                if (newLatest) {
                    const newUpdated = {
                        ...newLatest,
                        ...this.buildAssignPatch(newLatest, change.territory_phone),
                        version: Number(newLatest.version || 0) + 1
                    };
                    this.users[change.new_user_id] = newUpdated;
                    upsertUpdatedUser(updatedUsers, newUpdated);
                    const verifiedNewUser = await this.getUser(change.new_user_id);
                    if (!hasDirectRoutingDid(verifiedNewUser, change.territory_phone)) {
                        throw new Error("Mock Genesys did not verify the Direct Routing DID on the assigned user.");
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

    function findExtensionContact(entries, acceptedTypes, expectedExtension = "") {
        return entries.find((entry) => {
            return isPhoneEntry(entry)
                && contactExtension(entry)
                && !isE164Phone(contactAddress(entry))
                && (!acceptedTypes.length || acceptedTypes.includes(entryType(entry)))
                && (!expectedExtension || contactExtension(entry) === expectedExtension);
        }) || null;
    }

    function isDirectRoutingDidContact(entry) {
        return isPhoneEntry(entry)
            && entryType(entry) === "work2"
            && String(entry?.integration || "").toLowerCase() === "directrouting";
    }

    function findDirectRoutingDidContact(entries) {
        return entries.find(isDirectRoutingDidContact) || null;
    }

    function hasDirectRoutingDid(user, phone) {
        return (Array.isArray(user?.addresses) ? user.addresses : []).some((entry) => {
            return isDirectRoutingDidContact(entry) && samePhone(contactAddress(entry), phone);
        });
    }

    function samePhone(left, right) {
        return String(left || "").trim() === String(right || "").trim();
    }

    function isE164Phone(phone) {
        return /^\+[1-9]\d{1,14}$/.test(String(phone || "").trim());
    }

    function applyDirectRoutingDidFields(entry, phone) {
        const normalizedPhone = String(phone || "").trim();
        entry.address = normalizedPhone;
        entry.display = formatPhoneDisplay(normalizedPhone);
        entry.mediaType = "PHONE";
        entry.type = "WORK2";
        entry.countryCode = phoneCountryCode();
        entry.integration = phoneIntegration();
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
        return CONFIG.phoneCountryCode || "US";
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

    function buildMockUsers() {
        const users = [
            mockUser("user-1001", "Avery Johnson", "avery.johnson@example.com", "sales-west", "Sales West", "+14155550101", "4101", 3),
            mockUser("user-1002", "Morgan Lee", "morgan.lee@example.com", "sales-west", "Sales West", "+14155550102", "4102", 2),
            mockUser("user-1003", "Priya Shah", "priya.shah@example.com", "sales-west", "Sales West", "+14155550103", "4103", 7),
            mockUser("user-2001", "Jordan Smith", "jordan.smith@example.com", "sales-east", "Sales East", "+12125550101", "5101", 5),
            mockUser("user-2002", "Taylor Brown", "taylor.brown@example.com", "sales-east", "Sales East", "+12125550102", "5102", 4),
            mockUser("user-3001", "Casey Davis", "casey.davis@example.com", "enterprise", "Enterprise Accounts", "+13125550101", "6101", 6)
        ];
        return Object.fromEntries(users.map((user) => [user.id, user]));
    }

    function mockUser(id, name, email, divisionId, divisionName, didPhone, extension, version) {
        return {
            id,
            name,
            email,
            division: { id: divisionId, name: divisionName },
            state: "active",
            version,
            addresses: [
                { mediaType: "EMAIL", type: "WORK", address: email },
                { display: extension, mediaType: "PHONE", type: "WORK", extension },
                {
                    address: didPhone,
                    display: formatPhoneDisplay(didPhone),
                    mediaType: "PHONE",
                    type: "WORK2",
                    countryCode: "US",
                    integration: "directrouting"
                }
            ],
            primaryContactInfo: [
                { mediaType: "EMAIL", type: "WORK", address: email },
                { display: extension, mediaType: "PHONE", type: "PRIMARY", extension }
            ]
        };
    }
})();
