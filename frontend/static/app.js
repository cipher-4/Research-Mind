// Global variables
let wsConnection = null;
let timerInterval = null;
let activeReportContent = ""; // Stores raw markdown report
let globalSourcesList = [];   // Stores unique sources found during search

// Authentication State
let authToken = localStorage.getItem("rm_token") || null;
let currentUser = JSON.parse(localStorage.getItem("rm_user") || "null");

// DOM Elements
const sidebar = document.getElementById("sidebar");
const appContainer = document.getElementById("app-container");
const mainContent = document.getElementById("main-content");
const historyList = document.getElementById("history-list");

const btnSidebarCollapse = document.getElementById("btn-sidebar-collapse");
const btnSidebarExpand = document.getElementById("btn-sidebar-expand");

const viewSearch = document.getElementById("view-search");
const viewRunning = document.getElementById("view-running");
const viewResult = document.getElementById("view-result");
const viewDownloads = document.getElementById("view-downloads");

const btnSidebarNavSearch = document.getElementById("btn-sidebar-nav-search");
const btnSidebarNavDownloads = document.getElementById("btn-sidebar-nav-downloads");
const btnBackFromDownloads = document.getElementById("btn-back-from-downloads");
const downloadsSearchInput = document.getElementById("downloads-search-input");
const downloadsTbody = document.getElementById("downloads-tbody");
const btnDownloadMd = document.getElementById("btn-download-md");

const searchForm = document.getElementById("search-form");
const searchInput = document.getElementById("search-input");
const btnSubmit = document.getElementById("btn-submit");

const runningQueryDisplay = document.getElementById("running-query-display");
const runningTimer = document.getElementById("running-timer");
const consoleLogs = document.getElementById("console-logs");

const researchersBranch = document.getElementById("researchers-branch");
const activeSourcesBar = document.getElementById("active-sources-bar");
const activeSourcesStack = document.getElementById("active-sources-stack");

const reportSourcesSection = document.getElementById("report-sources-section");
const reportSourcesAvatars = document.getElementById("report-sources-avatars");
const reportSourcesGrid = document.getElementById("report-sources-grid");
const reportSourcesTrigger = document.getElementById("report-sources-trigger");
const sourcesCountText = document.getElementById("sources-count");

const reportOutputRendered = document.getElementById("report-output-rendered");
const btnNewSearch = document.getElementById("btn-new-search");
const btnCopyMarkdown = document.getElementById("btn-copy-markdown");
const btnPrint = document.getElementById("btn-print");

const toast = document.getElementById("toast");
const toastIcon = document.getElementById("toast-icon");
const toastMessage = document.getElementById("toast-message");

// Auth & Admin Elements
const authNavContainer = document.getElementById("auth-nav-container");
const modalAuth = document.getElementById("modal-auth");
const modalAdmin = document.getElementById("modal-admin");
const btnCloseAuthModal = document.getElementById("btn-close-auth-modal");
const btnCloseAdminModal = document.getElementById("btn-close-admin-modal");

const tabLoginBtn = document.getElementById("tab-login-btn");
const tabRegisterBtn = document.getElementById("tab-register-btn");
const formLogin = document.getElementById("form-login");
const formRegister = document.getElementById("form-register");

// Graph node references (Planner, Arbitrator, Synthesizer)
const nodes = {
    planner: document.getElementById("node-planner"),
    arbitrator: document.getElementById("node-arbitrator"),
    synthesizer: document.getElementById("node-synthesizer")
};

// ==========================================================================
//  INITIALIZATION & SIDEBAR CONTROL
// ==========================================================================
document.addEventListener("DOMContentLoaded", () => {
    setupEventListeners();
    setupAuthModalEvents();
    setupAdminModalEvents();
    renderAuthNav();

    const path = window.location.pathname;
    const urlParams = new URLSearchParams(window.location.search);

    if (path === "/login") {
        if (currentUser && authToken) {
            window.location.replace("/app");
            return;
        }
        // Unauthenticated visitor on /login: automatically open modal
        if (urlParams.get("mode") === "signup") {
            openAuthModal("register");
        } else {
            openAuthModal("login");
        }
    } else if (path === "/downloads") {
        if (!currentUser || !authToken) {
            window.location.replace("/login");
            return;
        }
        switchView("downloads");
        loadHistory();
        refreshUserProfile();
        return;
    } else if (path === "/app") {
        if (!currentUser || !authToken) {
            window.location.replace("/login");
            return;
        }
    }

    switchView("search");
    loadHistory();
    refreshUserProfile();
});

async function refreshUserProfile() {
    if (!authToken) return;
    try {
        const res = await fetch("/api/auth/me", {
            headers: { "Authorization": `Bearer ${authToken}` }
        });
        if (res.ok) {
            const data = await res.json();
            currentUser = data;
            localStorage.setItem("rm_user", JSON.stringify(currentUser));
            renderAuthNav();
        }
    } catch (e) {
        console.warn("Profile refresh error:", e);
    }
}

function setupEventListeners() {
    // Sidebar Collapsing
    btnSidebarCollapse.addEventListener("click", () => {
        sidebar.classList.add("collapsed");
        btnSidebarExpand.classList.remove("hidden");
    });

    btnSidebarExpand.addEventListener("click", () => {
        sidebar.classList.remove("collapsed");
        btnSidebarExpand.classList.add("hidden");
    });

    // Form submission — validate first, then start research if valid
    searchForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const query = searchInput.value.trim();
        if (query) {
            await validateAndStart(query);
        }
    });

    // Clicking sample suggestions populates search and validates
    document.querySelectorAll(".suggestion-chip").forEach(chip => {
        chip.addEventListener("click", async () => {
            const query = chip.getAttribute("data-query");
            searchInput.value = query;
            await validateAndStart(query);
        });
    });

    // Back / New Research button
    btnNewSearch.addEventListener("click", () => {
        switchView("search");
        searchInput.value = "";
    });

    // Copy Raw Markdown
    btnCopyMarkdown.addEventListener("click", () => {
        if (!activeReportContent) return;
        navigator.clipboard.writeText(activeReportContent)
            .then(() => showToast("success", "Markdown copied to clipboard!"))
            .catch(err => showToast("error", "Failed to copy: " + err));
    });

    // Print / PDF Export
    btnPrint.addEventListener("click", () => {
        window.print();
    });

    // Download Markdown File to PC
    if (btnDownloadMd) {
        btnDownloadMd.addEventListener("click", () => {
            downloadCurrentReportMd();
        });
    }

    // Sidebar View Navigation
    if (btnSidebarNavSearch) {
        btnSidebarNavSearch.addEventListener("click", () => {
            switchView("search");
        });
    }

    if (btnSidebarNavDownloads) {
        btnSidebarNavDownloads.addEventListener("click", () => {
            switchView("downloads");
        });
    }

    if (btnBackFromDownloads) {
        btnBackFromDownloads.addEventListener("click", () => {
            switchView("search");
        });
    }

    if (downloadsSearchInput) {
        downloadsSearchInput.addEventListener("input", (e) => {
            filterDownloadsList(e.target.value);
        });
    }

    // Toggle sources grid collapse
    reportSourcesTrigger.addEventListener("click", () => {
        reportSourcesTrigger.classList.toggle("open");
        reportSourcesGrid.classList.toggle("hidden");
    });
}

// ==========================================================================
//  TOP NAV & AUTHENTICATION CONTROLS
// ==========================================================================
function renderAuthNav() {
    if (!authNavContainer) return;

    if (currentUser && authToken) {
        const isAdmin = currentUser.role === "admin";
        const name = currentUser.full_name || currentUser.email || "Researcher";
        const initial = (name.charAt(0) || "U").toUpperCase();

        authNavContainer.innerHTML = `
            <div class="user-menu-wrapper" id="user-menu-wrapper">
                <button class="user-profile-trigger" id="btn-user-profile" aria-expanded="false" title="Account Menu">
                    <div class="user-avatar-initial">${initial}</div>
                    <div class="user-trigger-info">
                        <span class="user-trigger-name">${name}</span>
                        <span class="role-tag ${currentUser.role}">${currentUser.role}</span>
                    </div>
                    <i class="fa-solid fa-chevron-down trigger-chevron"></i>
                </button>
                
                <div class="user-dropdown-menu hidden" id="user-dropdown-menu">
                    <div class="dropdown-header">
                        <div class="dropdown-user-avatar">${initial}</div>
                        <div class="dropdown-user-details">
                            <span class="dropdown-user-name">${name}</span>
                            <span class="dropdown-user-email">${currentUser.email}</span>
                        </div>
                    </div>
                    <div class="dropdown-divider"></div>
                    <button class="dropdown-item" id="dropdown-btn-downloads">
                        <i class="fa-solid fa-box-archive"></i>
                        <span>My Downloads &amp; Dossiers</span>
                    </button>
                    <div class="dropdown-divider"></div>
                    ${isAdmin ? `
                    <button class="dropdown-item" id="dropdown-btn-admin">
                        <i class="fa-solid fa-shield-halved"></i>
                        <span>Admin Console</span>
                    </button>
                    <div class="dropdown-divider"></div>
                    ` : ""}
                    <button class="dropdown-item danger" id="dropdown-btn-logout">
                        <i class="fa-solid fa-arrow-right-from-bracket"></i>
                        <span>Sign Out</span>
                    </button>
                </div>
            </div>
        `;

        const btnTrigger = document.getElementById("btn-user-profile");
        const dropdownMenu = document.getElementById("user-dropdown-menu");
        const btnDownloads = document.getElementById("dropdown-btn-downloads");
        const btnAdmin = document.getElementById("dropdown-btn-admin");
        const btnLogout = document.getElementById("dropdown-btn-logout");

        if (btnTrigger && dropdownMenu) {
            btnTrigger.addEventListener("click", (e) => {
                e.stopPropagation();
                const isHidden = dropdownMenu.classList.contains("hidden");
                dropdownMenu.classList.toggle("hidden");
                btnTrigger.classList.toggle("active", isHidden);
                btnTrigger.setAttribute("aria-expanded", isHidden ? "true" : "false");
            });

            // Dismiss menu on click outside
            document.addEventListener("click", (e) => {
                if (!dropdownMenu.contains(e.target) && !btnTrigger.contains(e.target)) {
                    dropdownMenu.classList.add("hidden");
                    btnTrigger.classList.remove("active");
                    btnTrigger.setAttribute("aria-expanded", "false");
                }
            });
        }

        if (btnDownloads) {
            btnDownloads.addEventListener("click", () => {
                dropdownMenu.classList.add("hidden");
                btnTrigger.classList.remove("active");
                switchView("downloads");
            });
        }

        if (btnAdmin) {
            btnAdmin.addEventListener("click", () => {
                dropdownMenu.classList.add("hidden");
                btnTrigger.classList.remove("active");
                openAdminModal();
            });
        }

        if (btnLogout) {
            btnLogout.addEventListener("click", () => {
                dropdownMenu.classList.add("hidden");
                btnTrigger.classList.remove("active");
                handleLogout();
            });
        }
    } else {
        authNavContainer.innerHTML = `
            <button class="btn-nav-auth" id="btn-nav-login">Sign In</button>
            <button class="btn-nav-auth primary" id="btn-nav-register">Create Account</button>
        `;

        document.getElementById("btn-nav-login").addEventListener("click", () => openAuthModal("login"));
        document.getElementById("btn-nav-register").addEventListener("click", () => openAuthModal("register"));
    }
}

function handleLogout() {
    localStorage.removeItem("rm_token");
    localStorage.removeItem("rm_user");
    authToken = null;
    currentUser = null;

    // Smooth page exit transition back to the public home page
    document.body.classList.add("page-exit");
    setTimeout(() => {
        window.location.href = "/";
    }, 260);
}

function showAuthError(msg) {
    const errorBanner = document.getElementById("auth-error-banner");
    const errorText = document.getElementById("auth-error-text");
    if (errorBanner && errorText) {
        errorText.textContent = msg;
        errorBanner.classList.remove("hidden");
        // retrigger shake animation
        errorBanner.style.animation = "none";
        errorBanner.offsetHeight;
        errorBanner.style.animation = "";
    }
}

function clearAuthError() {
    const errorBanner = document.getElementById("auth-error-banner");
    if (errorBanner) {
        errorBanner.classList.add("hidden");
    }
}

function openAuthModal(defaultTab = "login") {
    clearAuthError();
    modalAuth.classList.remove("hidden", "closing");
    if (defaultTab === "login") {
        tabLoginBtn.classList.add("active");
        tabRegisterBtn.classList.remove("active");
        formLogin.classList.remove("hidden");
        formRegister.classList.add("hidden");
    } else {
        tabLoginBtn.classList.remove("active");
        tabRegisterBtn.classList.add("active");
        formLogin.classList.add("hidden");
        formRegister.classList.remove("hidden");
    }
}

function closeAuthModalSmoothly(callback) {
    if (!modalAuth || modalAuth.classList.contains("hidden")) {
        if (callback) callback();
        return;
    }
    modalAuth.classList.add("closing");
    setTimeout(() => {
        modalAuth.classList.remove("closing");
        modalAuth.classList.add("hidden");
        clearAuthError();
        if (callback) callback();
    }, 220);
}

function closeAuthModal() {
    closeAuthModalSmoothly();
}

function setupAuthModalEvents() {
    btnCloseAuthModal.addEventListener("click", closeAuthModal);
    modalAuth.addEventListener("click", (e) => {
        if (e.target === modalAuth) closeAuthModal();
    });

    // Clear error banner on tab switch
    tabLoginBtn.addEventListener("click", () => {
        clearAuthError();
        tabLoginBtn.classList.add("active");
        tabRegisterBtn.classList.remove("active");
        formLogin.classList.remove("hidden");
        formRegister.classList.add("hidden");
    });

    tabRegisterBtn.addEventListener("click", () => {
        clearAuthError();
        tabRegisterBtn.classList.add("active");
        tabLoginBtn.classList.remove("active");
        formRegister.classList.remove("hidden");
        formLogin.classList.add("hidden");
    });

    // Clear error banner while typing
    ["login-email", "login-password", "register-name", "register-email", "register-password"].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener("input", clearAuthError);
    });

    // Login Form Submit
    formLogin.addEventListener("submit", async (e) => {
        e.preventDefault();
        clearAuthError();
        const email = document.getElementById("login-email").value.trim();
        const password = document.getElementById("login-password").value;
        const btn = document.getElementById("btn-submit-login");

        btn.disabled = true;
        btn.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Signing In...`;

        try {
            const res = await fetch("/api/auth/login", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email, password })
            });

            const data = await res.json();
            if (!res.ok) throw new Error(data.detail || "Login failed");

            // Smooth visual feedback on button
            btn.innerHTML = `<i class="fa-solid fa-check"></i> Welcome back!`;
            btn.style.background = "var(--success)";

            authToken = data.token;
            currentUser = data.user;
            localStorage.setItem("rm_token", authToken);
            localStorage.setItem("rm_user", JSON.stringify(currentUser));

            renderAuthNav();
            loadHistory();
            switchView("search");

            // Smoothly update browser URL without jarring full page reload
            if (window.location.pathname === "/login") {
                window.history.replaceState({}, "", "/app");
            }

            // Smooth animated modal dismiss
            setTimeout(() => {
                closeAuthModalSmoothly(() => {
                    btn.disabled = false;
                    btn.style.background = "";
                    btn.innerHTML = `Sign In &nbsp;<i class="fa-solid fa-arrow-right"></i>`;
                    showToast("success", `Welcome back, ${currentUser.full_name}!`);
                });
            }, 300);
        } catch (err) {
            btn.disabled = false;
            btn.style.background = "";
            btn.innerHTML = `Sign In &nbsp;<i class="fa-solid fa-arrow-right"></i>`;
            showAuthError(err.message);
            showToast("error", err.message);
        }
    });

    // Register Form Submit
    formRegister.addEventListener("submit", async (e) => {
        e.preventDefault();
        clearAuthError();
        const fullName = document.getElementById("register-name").value.trim();
        const email = document.getElementById("register-email").value.trim();
        const password = document.getElementById("register-password").value;
        const btn = document.getElementById("btn-submit-register");

        btn.disabled = true;
        btn.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Creating Account...`;

        try {
            const res = await fetch("/api/auth/register", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ full_name: fullName, email, password })
            });

            const data = await res.json();
            if (!res.ok) throw new Error(data.detail || "Registration failed");

            btn.innerHTML = `<i class="fa-solid fa-check"></i> Account Created!`;
            btn.style.background = "var(--success)";

            authToken = data.token;
            currentUser = data.user;
            localStorage.setItem("rm_token", authToken);
            localStorage.setItem("rm_user", JSON.stringify(currentUser));

            renderAuthNav();
            loadHistory();
            switchView("search");

            // Smoothly update browser URL without jarring full page reload
            if (window.location.pathname === "/login") {
                window.history.replaceState({}, "", "/app");
            }

            setTimeout(() => {
                closeAuthModalSmoothly(() => {
                    btn.disabled = false;
                    btn.style.background = "";
                    btn.innerHTML = `Create Account &nbsp;<i class="fa-solid fa-user-plus"></i>`;
                    showToast("success", `Account created! Welcome, ${currentUser.full_name}.`);
                });
            }, 300);
        } catch (err) {
            btn.disabled = false;
            btn.style.background = "";
            btn.innerHTML = `Create Account &nbsp;<i class="fa-solid fa-user-plus"></i>`;
            showAuthError(err.message);
            showToast("error", err.message);
        }
    });
}

function openAdminModal() {
    modalAdmin.classList.remove("hidden");
    loadAdminStats();
    loadAdminUsers();
}

function closeAdminModal() {
    modalAdmin.classList.add("hidden");
}

function setupAdminModalEvents() {
    btnCloseAdminModal.addEventListener("click", closeAdminModal);
    modalAdmin.addEventListener("click", (e) => {
        if (e.target === modalAdmin) closeAdminModal();
    });

    const btnTabUsers = document.getElementById("btn-admin-tab-users");
    const btnTabSessions = document.getElementById("btn-admin-tab-sessions");
    const viewUsers = document.getElementById("admin-users-view");
    const viewSessions = document.getElementById("admin-sessions-view");

    btnTabUsers.addEventListener("click", () => {
        btnTabUsers.classList.add("active");
        btnTabSessions.classList.remove("active");
        viewUsers.classList.remove("hidden");
        viewSessions.classList.add("hidden");
        loadAdminUsers();
    });

    btnTabSessions.addEventListener("click", () => {
        btnTabSessions.classList.add("active");
        btnTabUsers.classList.remove("active");
        viewSessions.classList.remove("hidden");
        viewUsers.classList.add("hidden");
        loadAdminSessions();
    });
}

async function loadAdminStats() {
    if (!authToken) return;
    try {
        const res = await fetch("/api/admin/stats", {
            headers: { "Authorization": `Bearer ${authToken}` }
        });
        if (!res.ok) return;
        const stats = await res.json();

        document.getElementById("admin-stat-users").textContent = stats.total_users;
        document.getElementById("admin-stat-sessions").textContent = stats.total_sessions;
        document.getElementById("admin-stat-completed").textContent = stats.completed_sessions;
        document.getElementById("admin-stat-findings").textContent = stats.total_findings;
    } catch (err) {
        console.error("Error loading admin stats:", err);
    }
}

async function loadAdminUsers() {
    if (!authToken) return;
    const tbody = document.getElementById("admin-users-tbody");
    tbody.innerHTML = `<tr><td colspan="6" class="table-loading"><i class="fa-solid fa-circle-notch fa-spin"></i> Fetching users...</td></tr>`;

    try {
        const res = await fetch("/api/admin/users", {
            headers: { "Authorization": `Bearer ${authToken}` }
        });
        if (!res.ok) throw new Error("Unauthorized");
        const users = await res.json();

        if (users.length === 0) {
            tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:1rem;">No users found.</td></tr>`;
            return;
        }

        tbody.innerHTML = "";
        users.forEach(u => {
            const tr = document.createElement("tr");
            const dateStr = u.created_at ? new Date(u.created_at).toLocaleDateString() : "—";
            tr.innerHTML = `
                <td><strong>${u.full_name}</strong></td>
                <td>${u.email}</td>
                <td><span class="role-tag ${u.role}">${u.role}</span></td>
                <td>${u.is_active ? '<span style="color:var(--accent);">Active</span>' : '<span style="color:var(--danger);">Inactive</span>'}</td>
                <td>${u.session_count}</td>
                <td>${dateStr}</td>
            `;
            tbody.appendChild(tr);
        });
    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--danger);padding:1rem;">Failed to load user directory.</td></tr>`;
    }
}

async function loadAdminSessions() {
    if (!authToken) return;
    const tbody = document.getElementById("admin-sessions-tbody");
    tbody.innerHTML = `<tr><td colspan="4" class="table-loading"><i class="fa-solid fa-circle-notch fa-spin"></i> Fetching platform sessions...</td></tr>`;

    try {
        const res = await fetch("/api/admin/sessions", {
            headers: { "Authorization": `Bearer ${authToken}` }
        });
        if (!res.ok) throw new Error("Unauthorized");
        const sessions = await res.json();

        if (sessions.length === 0) {
            tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;padding:1rem;">No sessions recorded yet.</td></tr>`;
            return;
        }

        tbody.innerHTML = "";
        sessions.forEach(s => {
            const tr = document.createElement("tr");
            const dateStr = s.created_at ? new Date(s.created_at).toLocaleString() : "—";
            tr.innerHTML = `
                <td>${s.user_email}</td>
                <td><strong>${s.topic}</strong></td>
                <td><span class="role-tag ${s.status === 'completed' ? 'user' : 'admin'}">${s.status}</span></td>
                <td>${dateStr}</td>
            `;
            tbody.appendChild(tr);
        });
    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;color:var(--danger);padding:1rem;">Failed to load platform sessions.</td></tr>`;
    }
}

// ==========================================================================
//  POSTGRESQL & FILE RESEARCH HISTORY
// ==========================================================================
async function loadHistory() {
    historyList.innerHTML = `<div class="history-loading"><i class="fa-solid fa-circle-notch fa-spin"></i> Loading history...</div>`;

    // 1. If user is logged in, load their PostgreSQL research dossiers
    if (authToken && currentUser) {
        try {
            const response = await fetch("/api/user/sessions", {
                headers: { "Authorization": `Bearer ${authToken}` }
            });
            if (response.ok) {
                const sessions = await response.json();
                if (sessions.length > 0) {
                    historyList.innerHTML = "";
                    sessions.forEach(s => {
                        const date = s.created_at ? new Date(s.created_at).toLocaleDateString(undefined, {
                            month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
                        }) : "";
                        const item = document.createElement("div");
                        item.className = "history-item";
                        item.innerHTML = `
                            <div class="history-title" title="${s.topic}">${s.topic}</div>
                            <div class="history-meta">
                                <span>${date}</span>
                                <span class="role-tag ${s.status === 'completed' ? 'user' : 'admin'}" style="font-size:0.65rem;">${s.status}</span>
                            </div>
                        `;
                        item.addEventListener("click", () => loadPostgresSession(s.id));
                        historyList.appendChild(item);
                    });
                    return;
                }
            }
        } catch (err) {
            console.warn("Could not load Postgres sessions, trying local files fallback:", err);
        }
    }

    // 2. Fallback to /reports folder files
    try {
        const response = await fetch("/api/history");
        if (!response.ok) throw new Error("Failed to fetch history list");
        
        const files = await response.json();
        
        if (files.length === 0) {
            historyList.innerHTML = `<div class="history-empty">No dossiers found. Start research to generate one!</div>`;
            return;
        }

        historyList.innerHTML = "";
        files.forEach(file => {
            const date = new Date(file.createdTime * 1000).toLocaleDateString(undefined, {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });
            const sizeKB = (file.sizeBytes / 1024).toFixed(1);
            
            const item = document.createElement("div");
            item.className = "history-item";
            item.innerHTML = `
                <div class="history-title" title="${file.title}">${file.title}</div>
                <div class="history-meta">
                    <span>${date}</span>
                    <span>${sizeKB} KB</span>
                </div>
            `;
            item.addEventListener("click", () => loadSavedReport(file.filename));
            historyList.appendChild(item);
        });

    } catch (error) {
        console.error("Error loading history:", error);
        historyList.innerHTML = `<div class="history-empty" style="color:var(--danger)">Error loading history.</div>`;
    }
}

// Load a specific research session directly from PostgreSQL
async function loadPostgresSession(sessionId) {
    try {
        const headers = authToken ? { "Authorization": `Bearer ${authToken}` } : {};
        const response = await fetch(`/api/user/sessions/${sessionId}`, { headers });
        if (!response.ok) throw new Error("Failed to load session from database");
        
        const data = await response.json();
        activeReportContent = data.report || "No synthesized report was generated for this session.";
        
        // Also collect all verified sources from findings
        globalSourcesList = [];
        if (data.findings) {
            data.findings.forEach(f => {
                if (f.sources) {
                    f.sources.forEach(url => {
                        if (!globalSourcesList.includes(url)) globalSourcesList.push(url);
                    });
                }
            });
        }
        
        renderReport(activeReportContent);
        switchView("result");
        showToast("success", "Dossier loaded from PostgreSQL!");
    } catch (error) {
        showToast("error", "Error loading session: " + error.message);
    }
}

// Fetch report content from API and display it
async function loadSavedReport(filename) {
    try {
        const response = await fetch(`/api/history/load?filename=${encodeURIComponent(filename)}`);
        if (!response.ok) throw new Error("Failed to load report file");
        
        const data = await response.json();
        activeReportContent = data.content;
        
        renderReport(activeReportContent);
        switchView("result");
        showToast("success", "Dossier loaded!");
    } catch (error) {
        showToast("error", "Error loading report: " + error.message);
    }
}

// ==========================================================================
//  INPUT VALIDATION GATE (calls /api/validate before pipeline)
// ==========================================================================
async function validateAndStart(query) {
    // STRICT AUTH GATE: Must be logged in
    if (!currentUser || !authToken) {
        showToast("error", "Please sign in or create an account to start research.");
        openAuthModal("login");
        return;
    }

    // Disable the submit button and show a brief loading state
    btnSubmit.disabled = true;
    const originalBtnHTML = btnSubmit.innerHTML;
    btnSubmit.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i>&nbsp; Validating...`;

    try {
        const response = await fetch("/api/validate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ query: query })
        });

        const result = await response.json();

        if (result.is_valid) {
            // Input is valid — proceed to the full pipeline
            startResearch(query);
        } else {
            // Input is invalid — show warning toast, stay on search screen
            showToast("error", result.reason || "Please enter a valid research topic.");
        }
    } catch (error) {
        // If the validation endpoint itself fails, let the query through
        // so we don't block users due to an infra issue
        console.warn("Validation endpoint failed, proceeding anyway:", error);
        startResearch(query);
    } finally {
        // Restore the submit button
        btnSubmit.disabled = false;
        btnSubmit.innerHTML = originalBtnHTML;
    }
}


// ==========================================================================
//  WEBSOCKET CONNECTION & RESEARCH FLOW
// ==========================================================================
function startResearch(query) {
    // Reset timeline and UI
    resetTimeline();
    consoleLogs.innerHTML = "";
    runningQueryDisplay.textContent = `Topic: "${query}"`;
    globalSourcesList = [];
    activeSourcesStack.innerHTML = "";
    activeSourcesBar.classList.add("hidden");
    
    // Reset researcher container to placeholder
    researchersBranch.innerHTML = `<div class="researcher-placeholder">Planner is decomposing query...</div>`;
    
    // Switch to active running panel
    switchView("running");
    appendLog("system", `Connecting to ResearchMind core pipeline...`);
    
    // Start timer clock
    startTimer();

    // Establish WebSocket connection
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.host;
    const wsUrl = `${protocol}//${host}/ws/research`;
    
    wsConnection = new WebSocket(wsUrl);

    wsConnection.onopen = () => {
        appendLog("system", `Connection opened. Triggering research agents...`);
        wsConnection.send(JSON.stringify({ 
            query: query,
            token: authToken 
        }));
    };

    wsConnection.onmessage = (event) => {
        const data = JSON.parse(event.data);
        handleProgressMessage(data);
    };

    wsConnection.onerror = (error) => {
        console.error("WebSocket Error:", error);
        appendLog("error", `API Connection Error. Verify server log.`);
        showToast("error", "WebSocket connection failure.");
        stopTimer();
    };

    wsConnection.onclose = () => {
        appendLog("system", `Connection closed.`);
        stopTimer();
    };
}

// Process incoming progress messages and update timeline & logs
function handleProgressMessage(data) {
    const event = data.event;
    const message = data.message;
    const details = data.data || {};

    switch (event) {
        // Node 1: Planner
        case "planner_start":
            setTimelineState("planner", "active");
            appendLog("planner", `[Planner] ${message}`);
            break;
            
        case "planner_end":
            setTimelineState("planner", "completed");
            appendLog("planner", `[Planner] ${message}`);
            
            // Build the parallel researcher cards
            if (details.subqueries && details.subqueries.length > 0) {
                researchersBranch.innerHTML = "";
                details.subqueries.forEach((sq, i) => {
                    const card = document.createElement("div");
                    card.className = "subquery-card idle";
                    card.id = `subquery-card-${i}`;
                    card.innerHTML = `
                        <div class="sq-card-header">
                            <span class="sq-badge">Subquery 0${i + 1}</span>
                            <span class="sq-status-icon" id="sq-status-${i}"><i class="fa-solid fa-circle-dot"></i></span>
                        </div>
                        <div class="sq-card-text" title="${sq}">${sq}</div>
                        <div class="sq-card-sources" id="sq-sources-${i}"></div>
                    `;
                    researchersBranch.appendChild(card);
                    appendLog("planner", `  └─ Subquery ${i + 1}: "${sq}"`);
                });
            }
            break;

        // Pacing delay
        case "pacing_start":
            appendLog("pacing", `[Pacing] ${message}`);
            break;

        // Node 2: Researchers
        case "researcher_start":
            // Highlight the running subquery card
            updateSubqueryCardState(details.index, "active");
            appendLog("researcher", `\n=== SUBQUERY ${details.index + 1} (Attempt ${details.retry + 1}) ===`);
            appendLog("researcher", `[Researchers] ${message}`);
            break;

        case "researcher_progress":
            appendLog("researcher", `  └─ ${message}`);
            // Check if there are sources sent in real-time
            if (details.sources && details.sources.length > 0) {
                // Find current active subquery card index based on active card in UI
                const activeIdx = getActiveSubqueryIndex();
                if (activeIdx !== -1) {
                    addSourcesToSubquery(activeIdx, details.sources);
                }
                updateGlobalSources(details.sources);
            }
            break;

        case "researcher_end":
            // Mark subquery as completed
            const completedIdx = getActiveSubqueryIndex();
            if (completedIdx !== -1) {
                updateSubqueryCardState(completedIdx, "completed");
                if (details.sources) {
                    addSourcesToSubquery(completedIdx, details.sources);
                    updateGlobalSources(details.sources);
                }
            }
            appendLog("researcher", `[Researchers] ${message}`);
            break;

        // Node 3: Arbitrator
        case "arbitrator_start":
            setTimelineState("arbitrator", "active");
            appendLog("arbitrator", `[Arbitrator] ${message}`);
            break;

        case "arbitrator_end":
            const accepted = details.accepted;
            if (accepted) {
                setTimelineState("arbitrator", "completed");
                appendLog("arbitrator", `[Arbitrator] Verdict: ACCEPTED — ${message}`);
            } else {
                setTimelineState("arbitrator", "idle");
                // Find active card and mark as rejected
                const activeIdx = getActiveSubqueryIndex();
                if (activeIdx !== -1) {
                    updateSubqueryCardState(activeIdx, "rejected");
                }
                appendLog("arbitrator", `[Arbitrator] Verdict: REJECTED — ${message}`);
            }
            break;

        // Node 4: Synthesizer
        case "synthesizer_start":
            setTimelineState("synthesizer", "active");
            appendLog("synthesizer", `[Synthesizer] ${message}`);
            break;

        case "synthesizer_end":
            setTimelineState("synthesizer", "completed");
            appendLog("synthesizer", `[Synthesizer] ${message}`);
            break;

        // Error Handlers
        case "error":
            appendLog("error", `CRITICAL ERROR: ${message}`);
            stopTimer();
            showToast("error", `Pipeline failed: ${message}`);
            break;

        // Completion
        case "complete":
            stopTimer();
            activeReportContent = data.report;
            
            renderReport(activeReportContent);
            
            // Switch views and refresh history list
            setTimeout(() => {
                switchView("result");
                showToast("success", "Synthesis complete!");
                loadHistory();
            }, 1000);
            break;
            
        default:
            appendLog("system", message);
    }
}

// ==========================================================================
//  SOURCES ENGINE (Real-time and Accordion Grid)
// ==========================================================================
function updateGlobalSources(urls) {
    if (!urls || urls.length === 0) return;
    
    activeSourcesBar.classList.remove("hidden");
    
    urls.forEach(url => {
        if (!url || typeof url !== "string") return;
        try {
            const domain = new URL(url).hostname;
            if (globalSourcesList.includes(url)) return;
            
            globalSourcesList.push(url);
            
            // Add overlapping favicon to active sources stack bar
            const badge = document.createElement("div");
            badge.className = "source-badge-circle";
            badge.title = domain;
            badge.setAttribute("onclick", `window.open('${url}', '_blank')`);
            badge.innerHTML = `<img src="https://www.google.com/s2/favicons?domain=${domain}&sz=32" alt="${domain}" onerror="this.src='https://cdn-icons-png.flaticon.com/512/1249/1249379.png';">`;
            activeSourcesStack.appendChild(badge);
        } catch(e) {}
    });
}

function addSourcesToSubquery(cardIndex, urls) {
    const sourcesContainer = document.getElementById(`sq-sources-${cardIndex}`);
    if (!sourcesContainer || !urls || urls.length === 0) return;
    
    sourcesContainer.innerHTML = "";
    
    const container = document.createElement("div");
    container.className = "stacked-avatars";
    
    const uniqueDomains = [];
    urls.forEach(url => {
        try {
            const domain = new URL(url).hostname;
            if (uniqueDomains.includes(domain)) return;
            uniqueDomains.push(domain);
            
            const img = document.createElement("img");
            img.src = `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
            img.alt = domain;
            img.title = domain;
            img.onerror = function() { this.src = 'https://cdn-icons-png.flaticon.com/512/1249/1249379.png'; };
            container.appendChild(img);
        } catch(e) {}
    });
    
    sourcesContainer.appendChild(container);
}

function getActiveSubqueryIndex() {
    const cards = researchersBranch.querySelectorAll(".subquery-card");
    for (let i = 0; i < cards.length; i++) {
        if (cards[i].classList.contains("active")) {
            return i;
        }
    }
    // Fallback: get first idle card
    for (let i = 0; i < cards.length; i++) {
        if (cards[i].classList.contains("idle")) {
            return i;
        }
    }
    return -1;
}

function updateSubqueryCardState(index, state) {
    const card = document.getElementById(`subquery-card-${index}`);
    if (!card) return;
    
    card.className = `subquery-card ${state}`;
    const statusIcon = document.getElementById(`sq-status-${index}`);
    if (statusIcon) {
        if (state === "active") {
            statusIcon.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i>`;
        } else if (state === "completed") {
            statusIcon.innerHTML = `<i class="fa-solid fa-circle-check"></i>`;
        } else if (state === "rejected") {
            statusIcon.innerHTML = `<i class="fa-solid fa-circle-xmark"></i>`;
        } else {
            statusIcon.innerHTML = `<i class="fa-solid fa-circle-dot"></i>`;
        }
    }
}

// ==========================================================================
//  REPORT RENDER & CITATION MARK PARSER
// ==========================================================================
function renderReport(markdown) {
    // 1. Render main markdown body using Marked
    let renderedHtml = marked.parse(markdown);
    
    // 2. Turn standard citations [1] or [1, 2] into beautiful interactive citation badges
    renderedHtml = renderedHtml.replace(/\[(\d+)\]/g, '<span class="citation-badge" title="Jump to Source $1" onclick="scrollToSource($1)">$1</span>');
    renderedHtml = renderedHtml.replace(/\[(\d+),\s*(\d+)\]/g, '<span class="citation-badge" title="Source $1" onclick="scrollToSource($1)">$1</span><span class="citation-badge" title="Source $2" onclick="scrollToSource($2)">$2</span>');
    
    reportOutputRendered.innerHTML = renderedHtml;
    
    // 3. Extract bibliography links and generate ChatGPT style sources header
    extractAndBuildReportSources(markdown);
}

function scrollToSource(number) {
    const reportPanel = viewResult;
    const bodyText = reportOutputRendered;
    // Find matching link index or lists of links at the end
    const sourcesHeader = bodyText.querySelector("h2:last-of-type, h2:nth-last-of-type(2)");
    if (sourcesHeader) {
        sourcesHeader.scrollIntoView({ behavior: 'smooth' });
    }
}

function extractAndBuildReportSources(markdown) {
    // Extract unique URL links from the markdown bibliography
    const urlRegex = /(https?:\/\/[^\s\)]+)/g;
    const matches = markdown.match(urlRegex) || [];
    const uniqueUrls = [...new Set(matches)];
    
    if (uniqueUrls.length === 0) {
        reportSourcesSection.classList.add("hidden");
        return;
    }
    
    reportSourcesSection.classList.remove("hidden");
    sourcesCountText.textContent = uniqueUrls.length;
    reportSourcesAvatars.innerHTML = "";
    reportSourcesGrid.innerHTML = "";
    
    const uniqueDomains = [];
    
    uniqueUrls.forEach(url => {
        try {
            const domain = new URL(url).hostname;
            
            // Build overlapping avatars
            if (!uniqueDomains.includes(domain)) {
                uniqueDomains.push(domain);
                const avatar = document.createElement("img");
                avatar.src = `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
                avatar.alt = domain;
                avatar.title = domain;
                avatar.onerror = function() { this.src = 'https://cdn-icons-png.flaticon.com/512/1249/1249379.png'; };
                reportSourcesAvatars.appendChild(avatar);
            }
            
            // Build dropdown card
            const card = document.createElement("a");
            card.href = url;
            card.target = "_blank";
            card.className = "source-card";
            card.innerHTML = `
                <img src="https://www.google.com/s2/favicons?domain=${domain}&sz=32" alt="${domain}" onerror="this.src='https://cdn-icons-png.flaticon.com/512/1249/1249379.png';">
                <div class="source-card-info">
                    <span class="source-card-domain">${domain}</span>
                    <span class="source-card-url" title="${url}">${url}</span>
                </div>
            `;
            reportSourcesGrid.appendChild(card);
        } catch(e) {}
    });
}

// ==========================================================================
//  UI UTILITY FUNCTIONS & DOWNLOADS LIBRARY
// ==========================================================================
let userDossiersCache = [];

function switchView(viewName) {
    viewSearch.classList.add("hidden");
    viewRunning.classList.add("hidden");
    viewResult.classList.add("hidden");
    if (viewDownloads) viewDownloads.classList.add("hidden");

    if (btnSidebarNavSearch) btnSidebarNavSearch.classList.remove("active");
    if (btnSidebarNavDownloads) btnSidebarNavDownloads.classList.remove("active");

    if (viewName === "search") {
        viewSearch.classList.remove("hidden");
        if (btnSidebarNavSearch) btnSidebarNavSearch.classList.add("active");
        if (window.location.pathname === "/downloads") {
            window.history.pushState({}, "", "/app");
        }
    } else if (viewName === "running") {
        viewRunning.classList.remove("hidden");
    } else if (viewName === "result") {
        viewResult.classList.remove("hidden");
    } else if (viewName === "downloads") {
        if (viewDownloads) viewDownloads.classList.remove("hidden");
        if (btnSidebarNavDownloads) btnSidebarNavDownloads.classList.add("active");
        if (window.location.pathname !== "/downloads") {
            window.history.pushState({}, "", "/downloads");
        }
        loadDownloadsPage();
    }
}

function downloadMarkdownBlob(filename, text) {
    if (!text) {
        showToast("error", "No report content available to download.");
        return;
    }
    const cleanName = filename.replace(/[^a-zA-Z0-9_\-]/g, "_").substring(0, 50);
    const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ResearchDossier_${cleanName}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast("success", `Downloaded: ResearchDossier_${cleanName}.md`);
}

function downloadCurrentReportMd() {
    if (!activeReportContent) {
        showToast("error", "No active report loaded to download.");
        return;
    }
    const titleMatch = activeReportContent.match(/^#\s+(.*)/m);
    const title = titleMatch ? titleMatch[1] : "academic_synthesis";
    downloadMarkdownBlob(title, activeReportContent);
}

async function downloadSessionById(sessionId, topic) {
    showToast("info", "Preparing file download...");
    try {
        const res = await fetch(`/api/user/sessions/${sessionId}`, {
            headers: authToken ? { "Authorization": `Bearer ${authToken}` } : {}
        });
        if (!res.ok) throw new Error("Failed to load dossier for download");
        const data = await res.json();
        if (!data.report) throw new Error("This dossier has not finished synthesizing yet.");
        downloadMarkdownBlob(topic || data.topic, data.report);
    } catch (err) {
        showToast("error", err.message);
    }
}

async function loadDownloadsPage() {
    if (!downloadsTbody) return;
    downloadsTbody.innerHTML = `<tr><td colspan="4" class="table-loading"><i class="fa-solid fa-circle-notch fa-spin"></i> Fetching your research dossiers...</td></tr>`;

    if (!authToken || !currentUser) {
        downloadsTbody.innerHTML = `<tr><td colspan="4" class="table-loading">Please sign in to view your downloads.</td></tr>`;
        return;
    }

    try {
        const response = await fetch("/api/user/sessions", {
            headers: { "Authorization": `Bearer ${authToken}` }
        });
        if (!response.ok) throw new Error("Failed to fetch dossiers");
        const sessions = await response.json();
        userDossiersCache = sessions;

        renderDownloadsTable(sessions);
    } catch (err) {
        downloadsTbody.innerHTML = `<tr><td colspan="4" style="text-align:center;color:var(--danger);padding:2rem;">Failed to load research library.</td></tr>`;
    }
}

function renderDownloadsTable(sessions) {
    if (!downloadsTbody) return;

    // Update stats cards
    const dlCount = document.getElementById("dl-stat-count");
    const dlCompleted = document.getElementById("dl-stat-completed");
    const dlReady = document.getElementById("dl-stat-ready");

    const total = sessions.length;
    const completed = sessions.filter(s => s.status === "completed" || s.has_report).length;

    if (dlCount) dlCount.textContent = total;
    if (dlCompleted) dlCompleted.textContent = completed;
    if (dlReady) dlReady.textContent = completed;

    if (sessions.length === 0) {
        downloadsTbody.innerHTML = `
            <tr>
                <td colspan="4" style="text-align:center;padding:3rem 1rem;color:var(--text-muted);">
                    <i class="fa-solid fa-folder-open" style="font-size:2.5rem;margin-bottom:0.8rem;opacity:0.4;display:block;"></i>
                    No research dossiers generated yet. Start a new research query to build your library!
                </td>
            </tr>
        `;
        return;
    }

    downloadsTbody.innerHTML = "";
    sessions.forEach(s => {
        const tr = document.createElement("tr");
        const dateStr = s.created_at ? new Date(s.created_at).toLocaleDateString(undefined, {
            month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit'
        }) : "—";

        const isReady = s.status === "completed" || s.has_report;

        tr.innerHTML = `
            <td>
                <div class="dossier-topic-title">
                    <i class="fa-solid fa-file-lines" style="color:var(--primary);"></i>
                    <span title="${s.topic}">${s.topic}</span>
                </div>
            </td>
            <td style="color:var(--text-muted);font-size:0.82rem;">${dateStr}</td>
            <td>
                <span class="role-tag ${isReady ? 'user' : 'admin'}">${s.status}</span>
            </td>
            <td>
                <div class="dl-action-btns">
                    <button class="btn-dl-action" data-action="view" data-id="${s.id}" title="Read full dossier on screen">
                        <i class="fa-solid fa-eye"></i> View
                    </button>
                    ${isReady ? `
                    <button class="btn-dl-action primary" data-action="download-md" data-id="${s.id}" data-topic="${encodeURIComponent(s.topic)}" title="Download .md file directly to PC">
                        <i class="fa-solid fa-download"></i> .MD
                    </button>
                    <button class="btn-dl-action" data-action="print-pdf" data-id="${s.id}" title="Export as PDF">
                        <i class="fa-solid fa-file-pdf"></i> PDF
                    </button>
                    ` : `
                    <span style="font-size:0.75rem;color:var(--text-muted);">In progress...</span>
                    `}
                </div>
            </td>
        `;

        // Wire click handlers
        const btnView = tr.querySelector('[data-action="view"]');
        if (btnView) {
            btnView.addEventListener("click", () => loadPostgresSession(s.id));
        }

        const btnMd = tr.querySelector('[data-action="download-md"]');
        if (btnMd) {
            btnMd.addEventListener("click", () => downloadSessionById(s.id, s.topic));
        }

        const btnPdf = tr.querySelector('[data-action="print-pdf"]');
        if (btnPdf) {
            btnPdf.addEventListener("click", async () => {
                await loadPostgresSession(s.id);
                setTimeout(() => window.print(), 400);
            });
        }

        downloadsTbody.appendChild(tr);
    });
}

function filterDownloadsList(keyword) {
    if (!userDossiersCache) return;
    const q = (keyword || "").trim().toLowerCase();
    if (!q) {
        renderDownloadsTable(userDossiersCache);
        return;
    }
    const filtered = userDossiersCache.filter(s => (s.topic || "").toLowerCase().includes(q));
    renderDownloadsTable(filtered);
}

function setTimelineState(nodeName, state) {
    const nodeEl = nodes[nodeName];
    if (!nodeEl) return;

    nodeEl.classList.remove("active", "completed", "idle");
    nodeEl.classList.add(state);

    const statusEl = nodeEl.querySelector(".node-status");
    if (statusEl) {
        statusEl.textContent = state;
    }
}

function resetTimeline() {
    Object.keys(nodes).forEach(node => {
        setTimelineState(node, "idle");
    });
}

function appendLog(category, message) {
    const line = document.createElement("div");
    line.className = `console-line ${category}-msg`;
    line.textContent = message;
    consoleLogs.appendChild(line);
    
    // Auto-scroll console
    consoleLogs.scrollTop = consoleLogs.scrollHeight;
}

// Clock Timer counter
function startTimer() {
    let seconds = 0;
    runningTimer.textContent = "00:00";
    
    if (timerInterval) clearInterval(timerInterval);
    
    timerInterval = setInterval(() => {
        seconds++;
        const mins = String(Math.floor(seconds / 60)).padStart(2, "0");
        const secs = String(seconds % 60).padStart(2, "0");
        runningTimer.textContent = `${mins}:${secs}`;
    }, 1000);
}

function stopTimer() {
    if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
    }
}

// Toast alerts system
function showToast(type, message) {
    toast.className = `toast-notification ${type}`;
    toastMessage.textContent = message;

    if (type === "success") {
        toastIcon.className = "fa-solid fa-circle-check";
    } else if (type === "error") {
        toastIcon.className = "fa-solid fa-circle-exclamation";
    } else {
        toastIcon.className = "fa-solid fa-circle-info";
    }

    toast.classList.remove("hidden");

    setTimeout(() => {
        toast.classList.add("hidden");
    }, 4000);
}
