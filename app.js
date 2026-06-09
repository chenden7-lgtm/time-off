// ==========================================================================
// App State and Mock Data Initialization
// ==========================================================================

const DEFAULT_USERS = [
    { username: 'admin', password: 'admin123', name: '主管/管理員', role: 'admin', position: 'other', compDays: 0, leaveLimit: 2 },
    { username: '001', password: '123', name: '李子麒', role: 'employee', position: 'master', compDays: 1.5, leaveLimit: 2 },
    { username: '002', password: '123', name: '簡宏哲', role: 'employee', position: 'master', compDays: 7.0, leaveLimit: 2 },
    { username: '003', password: '123', name: '許凱翔', role: 'employee', position: 'master', compDays: 0, leaveLimit: 2 },
    { username: '004', password: '123', name: '陳麒竣', role: 'employee', position: 'master', compDays: 0, leaveLimit: 2 },
    { username: '005', password: '123', name: '蕭兆宏', role: 'employee', position: 'semi', compDays: 7.0, leaveLimit: 2 },
    { username: '006', password: '123', name: '許嵊勛', role: 'employee', position: 'semi', compDays: 10.0, leaveLimit: 2 },
    { username: '007', password: '123', name: '楊遠宸', role: 'employee', position: 'semi', compDays: 5.0, leaveLimit: 2 },
    { username: '008', password: '123', name: '劉奕杉', role: 'employee', position: 'other', compDays: 2.0, leaveLimit: 2 },
    { username: '009', password: '123', name: '陳曉瑩', role: 'employee', position: 'other', compDays: 0, leaveLimit: 2 }
];

const DEFAULT_SHIFTS = [
    // June 2026 Mock Shifts (only record leave days since weekdays are work by default)
    { id: 's1', username: '001', date: '2026-06-04', type: 'leave' },
    { id: 's2', username: '002', date: '2026-06-05', type: 'leave' }
];

const DEFAULT_LEAVES = [
    { id: 'l1', username: '001', date: '2026-06-04', reason: '辦理私人事務', status: 'approved' },
    { id: 'l2', username: '002', date: '2026-06-05', reason: '家人聚餐', status: 'approved' },
    { id: 'l3', username: '003', date: '2026-06-08', reason: '醫院回診', status: 'pending' }
];

const DEFAULT_TASKS = [
    { id: 't1', area: '室內地版整潔', username: '001', date: '2026-06-01', estHours: 1.5, actHours: 1.5, status: 'completed' },
    { id: 't2', area: '吸煙區整潔', username: '002', date: '2026-06-02', estHours: 2.0, actHours: 2.3, status: 'completed' },
    { id: 't3', area: '藥水補充', username: '003', date: '2026-06-03', estHours: 2.0, actHours: null, status: 'pending' },
    { id: 't4', area: '工具歸位整理', username: '001', date: '2026-06-03', estHours: 1.0, actHours: null, status: 'pending' }
];

// Active State
let currentUser = null;
let currentYear = 2026;
let currentMonth = 5; // 0-indexed, so 5 = June
let dbData = {
    users: [],
    shifts: [],
    leaves: [],
    tasks: []
};

// ==========================================================================
// Initialization & Storage Helper Functions
// ==========================================================================

function loadData() {
    const stored = localStorage.getItem('shift_system_data');
    if (stored) {
        try {
            dbData = JSON.parse(stored);
            
            // 安全修復機制：自動將管理員密碼還原為 admin123，保護其餘所有員工資料不遺失
            let adminUser = dbData.users.find(u => u.username === 'admin');
            if (adminUser) {
                adminUser.password = 'admin123';
            } else {
                dbData.users.push({ username: 'admin', password: 'admin123', name: '主管/管理員', role: 'admin', position: 'other', compDays: 0, leaveLimit: 2 });
            }
            
            dbData.users.forEach(u => {
                if (!u.position) {
                    if (u.username === 'admin') u.position = 'other';
                    else if (['001', '002', '003', '004'].includes(u.username)) u.position = 'master';
                    else if (['005', '006', '007'].includes(u.username)) u.position = 'semi';
                    else u.position = 'other';
                }
                if (u.leaveLimit === undefined) {
                    u.leaveLimit = 2;
                }
            });
            
            saveData();
        } catch (e) {
            console.error("Error parsing localstorage data", e);
            seedDefaultData();
        }
    } else {
        seedDefaultData();
    }
    // Ensure lineSettings and shopEvents exist
    dbData.lineSettings = dbData.lineSettings || { enabled: true, webhookUrl: 'https://hook.eu1.make.com/33ojcknpd9pdnsk2bcynw3agi4ae16l3' };
    if (!dbData.lineSettings.webhookUrl) {
        dbData.lineSettings.webhookUrl = 'https://hook.eu1.make.com/33ojcknpd9pdnsk2bcynw3agi4ae16l3';
        dbData.lineSettings.enabled = true;
    }
    dbData.shopEvents = dbData.shopEvents || [];
    dbData.syncSettings = dbData.syncSettings || { enabled: false, syncKey: '' };
}

function saveData(shouldSync = true) {
    dbData.lastUpdated = Date.now();
    localStorage.setItem('shift_system_data', JSON.stringify(dbData));
    if (shouldSync) {
        syncDatabaseToWebhook();
        syncDatabaseToCloud();
    }
}

function getWeekdaysCount(year, month) {
    const totalDays = new Date(year, month + 1, 0).getDate();
    let count = 0;
    for (let d = 1; d <= totalDays; d++) {
        const date = new Date(year, month, d);
        const dayOfWeek = date.getDay();
        if (dayOfWeek !== 0) { // Not Sunday
            const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            const isClosed = dbData.shopEvents.some(e => e.date === dateStr && e.type === 'closed');
            if (!isClosed) {
                count++;
            }
        }
    }
    return count;
}

function isOffDay(username, dateStr, excludeRecordId = null) {
    const d = new Date(dateStr);
    if (d.getDay() === 0) return true; // Sunday is off day
    
    const isClosed = dbData.shopEvents && dbData.shopEvents.some(e => e.date === dateStr && e.type === 'closed');
    if (isClosed) return true; // Shop closed day is off day
    
    const hasApprovedLeave = dbData.shifts.some(s => 
        s.username === username && 
        s.date === dateStr && 
        s.type === 'leave' && 
        (!excludeRecordId || s.id !== excludeRecordId)
    );
    if (hasApprovedLeave) return true;
    
    const hasPendingLeave = dbData.leaves.some(l => 
        l.username === username && 
        l.date === dateStr && 
        (!excludeRecordId || l.id !== excludeRecordId)
    );
    if (hasPendingLeave) return true;
    
    return false;
}

function getConsecutiveLeaveDays(username, dateStr, excludeRecordId = null) {
    let count = 1;
    
    let prevDate = new Date(dateStr);
    while (true) {
        prevDate.setDate(prevDate.getDate() - 1);
        const prevStr = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}-${String(prevDate.getDate()).padStart(2, '0')}`;
        if (isOffDay(username, prevStr, excludeRecordId)) {
            count++;
        } else {
            break;
        }
    }
    
    let nextDate = new Date(dateStr);
    while (true) {
        nextDate.setDate(nextDate.getDate() + 1);
        const nextStr = `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, '0')}-${String(nextDate.getDate()).padStart(2, '0')}`;
        if (isOffDay(username, nextStr, excludeRecordId)) {
            count++;
        } else {
            break;
        }
    }
    
    return count;
}

function isDateSchedulingOpen(dateStr) {
    const targetDate = new Date(dateStr);
    targetDate.setHours(0, 0, 0, 0);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return targetDate >= today; // Must be today or in the future
}

function checkDailyLeaveLimit(dateStr, usernameToExclude = null) {
    const dateObj = new Date(dateStr);
    const dayOfWeek = dateObj.getDay();
    if (dayOfWeek === 0) return { allowed: false, message: '週日為公休日，無需排休。' };
    
    // Check if there is a custom closed shop event for this day
    const isClosed = dbData.shopEvents.some(e => e.date === dateStr && e.type === 'closed');
    if (isClosed) return { allowed: false, message: '當日店休公休，無需排休。' };
    
    // 檢查技師與半技師衝突規則
    const candidateUser = dbData.users.find(u => u.username === usernameToExclude);
    const candidatePosition = candidateUser ? candidateUser.position : 'other';
    
    if (candidatePosition === 'master' || candidatePosition === 'semi') {
        const opposingPosition = candidatePosition === 'master' ? 'semi' : 'master';
        const opposingPositionLabel = opposingPosition === 'master' ? '技師' : '半技師';
        
        const hasOpposing = dbData.shifts.some(s => {
            if (s.date !== dateStr || s.type !== 'leave') return false;
            if (usernameToExclude && s.username === usernameToExclude) return false;
            const u = dbData.users.find(usr => usr.username === s.username);
            return u && u.position === opposingPosition;
        });
        
        if (hasOpposing) {
            return {
                allowed: false,
                message: `排休失敗：技師與半技師不能在同一天休假！當天已有一名${opposingPositionLabel}排休。`
            };
        }
    }
    
    const limit = (dayOfWeek === 6) ? 1 : 2;
    const dayName = (dayOfWeek === 6) ? '週六' : '平日';
    
    // Count approved leaves in dbData.shifts
    let existingLeaves = dbData.shifts.filter(s => s.date === dateStr && s.type === 'leave');
    if (usernameToExclude) {
        existingLeaves = existingLeaves.filter(s => s.username !== usernameToExclude);
    }
    
    if (existingLeaves.length >= limit) {
        return {
            allowed: false,
            message: `排休失敗：${dateStr} (${dayName}) 最多只能排休 ${limit} 人！`
        };
    }
    return { allowed: true };
}

function getWeekRange(dateStr) {
    const d = new Date(dateStr);
    const day = d.getDay(); // 0 is Sunday, 1 is Monday, ..., 6 is Saturday
    // We want Monday to be day 1. If day is 0 (Sunday), we treat it as day 7.
    const dayOffset = day === 0 ? 6 : day - 1;
    
    const monday = new Date(d);
    monday.setDate(d.getDate() - dayOffset);
    
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    
    const formatDate = (date) => {
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    };
    
    return {
        mondayStr: formatDate(monday),
        sundayStr: formatDate(sunday),
        label: `${formatDate(monday)} ~ ${formatDate(sunday)}`
    };
}

function seedDefaultData() {
    dbData.users = [...DEFAULT_USERS];
    dbData.shifts = [...DEFAULT_SHIFTS];
    dbData.leaves = [...DEFAULT_LEAVES];
    dbData.tasks = [...DEFAULT_TASKS];
    dbData.lineSettings = { enabled: true, webhookUrl: 'https://hook.eu1.make.com/33ojcknpd9pdnsk2bcynw3agi4ae16l3' };
    dbData.shopEvents = [];
    saveData();
}

// ==========================================================================
// DOM Elements Reference
// ==========================================================================

// Views
const loginView = document.getElementById('loginView');
const appWrapper = document.getElementById('appWrapper');

// Login Form
const loginForm = document.getElementById('loginForm');
const loginUsernameInput = document.getElementById('loginUsername');
const loginPasswordInput = document.getElementById('loginPassword');

// Header Info
const currentUserAvatar = document.getElementById('currentUserAvatar');
const currentUserName = document.getElementById('currentUserName');
const currentUserRole = document.getElementById('currentUserRole');
const btnLogout = document.getElementById('btnLogout');
const pageTitleText = document.getElementById('pageTitleText');

// Pages Content
const pages = {
    dashboardPage: document.getElementById('dashboardPage'),
    calendarPage: document.getElementById('calendarPage'),
    cleaningPage: document.getElementById('cleaningPage'),
    memberPage: document.getElementById('memberPage')
};

// Nav Items
const navItems = document.querySelectorAll('.nav-item');

// Dashboard Elements
const statTotalShifts = document.getElementById('statTotalShifts');
const statPendingLeaves = document.getElementById('statPendingLeaves');
const statCompletedTasks = document.getElementById('statCompletedTasks');

const currentDateDisplay = document.getElementById('currentDateDisplay');
const todayShiftsList = document.getElementById('todayShiftsList');

// Dashboard actions
const actionRequestLeave = document.getElementById('actionRequestLeave');
const actionAddTask = document.getElementById('actionAddTask');
const actionAddMember = document.getElementById('actionAddMember');
const actionGoToCalendar = document.getElementById('actionGoToCalendar');

// Calendar Page Elements
const btnPrevMonth = document.getElementById('btnPrevMonth');
const btnNextMonth = document.getElementById('btnNextMonth');
const currentMonthYear = document.getElementById('currentMonthYear');
const calendarDaysGrid = document.getElementById('calendarDaysGrid');

// Cleaning Page Elements
const btnAddNewTask = document.getElementById('btnAddNewTask');
const tasksList = document.getElementById('tasksList');


// Member Management Elements
const btnAddNewMember = document.getElementById('btnAddNewMember');
const memberGrid = document.getElementById('memberGrid');

// Admin Approvals elements
const btnPendingLeaves = document.getElementById('btnPendingLeaves');
const pendingLeavesCount = document.getElementById('pendingLeavesCount');

// LINE Elements
const btnLineSettings = document.getElementById('btnLineSettings');
const lineSettingsModal = document.getElementById('lineSettingsModal');
const lineNotifyEnabled = document.getElementById('lineNotifyEnabled');
const lineWebhookUrl = document.getElementById('lineWebhookUrl');
const btnTestLineMessage = document.getElementById('btnTestLineMessage');
const btnSendDailyReport = document.getElementById('btnSendDailyReport');
const btnSaveLineSettings = document.getElementById('btnSaveLineSettings');
const lineSimContainer = document.getElementById('lineSimContainer');
const btnCopyGASCode = document.getElementById('btnCopyGASCode');

// Backup & Restore Elements
const btnBackupRestore = document.getElementById('btnBackupRestore');
const backupModal = document.getElementById('backupModal');
const btnExportData = document.getElementById('btnExportData');
const importFile = document.getElementById('importFile');
const btnConfirmImport = document.getElementById('btnConfirmImport');
const btnMobileLogout = document.getElementById('btnMobileLogout');
const mobileProfileSection = document.getElementById('mobileProfileSection');
const actionPendingLeaves = document.getElementById('actionPendingLeaves');
const actionBackupRestore = document.getElementById('actionBackupRestore');
const actionLineSettings = document.getElementById('actionLineSettings');

// Cloud Sync Elements
const textSyncStatus = document.getElementById('textSyncStatus');
const syncKeyContainer = document.getElementById('syncKeyContainer');
const syncKeyField = document.getElementById('syncKeyField');
const syncUrlField = document.getElementById('syncUrlField');
const inputSyncKey = document.getElementById('inputSyncKey');
const btnEnableSync = document.getElementById('btnEnableSync');
const btnGenerateSyncKey = document.getElementById('btnGenerateSyncKey');
const btnDisableSync = document.getElementById('btnDisableSync');
const btnCopySyncKey = document.getElementById('btnCopySyncKey');
const btnCopySyncUrl = document.getElementById('btnCopySyncUrl');
const btnMobileBackupRestore = document.getElementById('btnMobileBackupRestore');
const btnMobileLineSettings = document.getElementById('btnMobileLineSettings');
const syncInputGroup = document.getElementById('syncInputGroup');

// Shop Events Elements
const actionManageEvents = document.getElementById('actionManageEvents');
const eventModal = document.getElementById('eventModal');
const eventForm = document.getElementById('eventForm');
const eventIdField = document.getElementById('eventIdField');
const eventType = document.getElementById('eventType');
const eventDate = document.getElementById('eventDate');
const gatheringFields = document.getElementById('gatheringFields');
const eventTime = document.getElementById('eventTime');
const eventLocation = document.getElementById('eventLocation');
const eventTitle = document.getElementById('eventTitle');
const btnDeleteEvent = document.getElementById('btnDeleteEvent');
const btnSaveEvent = document.getElementById('btnSaveEvent');

// Modals
const modalOverlays = document.querySelectorAll('.modal-overlay');
const shiftModal = document.getElementById('shiftModal');
const leaveRequestModal = document.getElementById('leaveRequestModal');
const taskModal = document.getElementById('taskModal');
const completeTaskModal = document.getElementById('completeTaskModal');
const leaveApprovalModal = document.getElementById('leaveApprovalModal');
const memberModal = document.getElementById('memberModal');
const changePasswordModal = document.getElementById('changePasswordModal');
const changePasswordForm = document.getElementById('changePasswordForm');
const oldPasswordInput = document.getElementById('oldPassword');
const newPasswordInput = document.getElementById('newPassword');
const confirmNewPasswordInput = document.getElementById('confirmNewPassword');
const btnSaveNewPassword = document.getElementById('btnSaveNewPassword');

// Modal Form Elements
const shiftForm = document.getElementById('shiftForm');
const shiftDate = document.getElementById('shiftDate');
const shiftDateLabel = document.getElementById('shiftDateLabel');
const shiftEmployee = document.getElementById('shiftEmployee');
const shiftType = document.getElementById('shiftType');
const shiftCompDurationGroup = document.getElementById('shiftCompDurationGroup');
const shiftCompDuration = document.getElementById('shiftCompDuration');
const btnDeleteShift = document.getElementById('btnDeleteShift');
const btnSaveShift = document.getElementById('btnSaveShift');

const leaveRequestForm = document.getElementById('leaveRequestForm');
const leaveRequestEmployee = document.getElementById('leaveRequestEmployee');
const leaveRequestDate = document.getElementById('leaveRequestDate');
const leaveRequestType = document.getElementById('leaveRequestType');
const leaveCompDurationGroup = document.getElementById('leaveCompDurationGroup');
const leaveCompDuration = document.getElementById('leaveCompDuration');
const leaveReason = document.getElementById('leaveReason');
const btnSubmitLeaveRequest = document.getElementById('btnSubmitLeaveRequest');
const btnDeleteLeaveRequest = document.getElementById('btnDeleteLeaveRequest');
const leaveRequestId = document.getElementById('leaveRequestId');
const leaveRequestModalTitle = document.getElementById('leaveRequestModalTitle');

const taskForm = document.getElementById('taskForm');
const taskIdField = document.getElementById('taskIdField');
const taskArea = document.getElementById('taskArea');
const taskEmployee = document.getElementById('taskEmployee');
const taskDate = document.getElementById('taskDate');

const btnDeleteTask = document.getElementById('btnDeleteTask');
const btnSaveTask = document.getElementById('btnSaveTask');

const customTaskAreaContainer = document.getElementById('customTaskAreaContainer');
const taskAreaCustom = document.getElementById('taskAreaCustom');

const btnAutoAssignTasks = document.getElementById('btnAutoAssignTasks');
const autoAssignModal = document.getElementById('autoAssignModal');
const btnExecuteAutoAssign = document.getElementById('btnExecuteAutoAssign');
const autoAssignDate = document.getElementById('autoAssignDate');
const autoAssignMode = document.getElementById('autoAssignMode');
const btnClearAllTasks = document.getElementById('btnClearAllTasks');



const pendingLeaveApprovalList = document.getElementById('pendingLeaveApprovalList');

const memberForm = document.getElementById('memberForm');
const memberIdField = document.getElementById('memberIdField');
const memberName = document.getElementById('memberName');
const memberUsername = document.getElementById('memberUsername');
const memberPassword = document.getElementById('memberPassword');
const memberRole = document.getElementById('memberRole');
const memberPosition = document.getElementById('memberPosition');
const memberCompDays = document.getElementById('memberCompDays');
const memberLeaveLimit = document.getElementById('memberLeaveLimit');
const btnSaveMember = document.getElementById('btnSaveMember');

// ==========================================================================
// Authentication & Routing Modules & Limit Helpers
// ==========================================================================

function getLeaveCountForMonth(username, year, month) {
    const monthPrefix = `${year}-${String(month + 1).padStart(2, '0')}`;
    
    // Count approved shifts of type 'leave' and leaveType is regular
    const approvedCount = dbData.shifts.filter(s => s.username === username && s.date.startsWith(monthPrefix) && s.type === 'leave' && s.leaveType !== 'comp').length;
    
    // Count pending leave requests where leaveType is regular
    const pendingCount = dbData.leaves.filter(l => l.username === username && l.date.startsWith(monthPrefix) && l.status === 'pending' && l.leaveType !== 'comp').length;
    
    return approvedCount + pendingCount;
}

function updateLimitBadge(username, elementId) {
    const badge = document.getElementById(elementId);
    if (!badge) return;
    const userObj = dbData.users.find(u => u.username === username);
    const limit = (userObj && userObj.leaveLimit !== undefined) ? userObj.leaveLimit : 2;
    const count = getLeaveCountForMonth(username, currentYear, currentMonth);
    badge.textContent = `本月已使用一般排休: ${count} / ${limit} 天`;
    if (count >= limit) {
        badge.className = 'limit-badge warning';
    } else {
        badge.className = 'limit-badge normal';
    }
}

function checkSession() {
    const sessionUser = sessionStorage.getItem('scheduler_current_user');
    if (sessionUser) {
        try {
            const parsedUser = JSON.parse(sessionUser);
            // Verify if user still exists in the database
            const userInDb = dbData.users.find(u => u.username.toLowerCase() === parsedUser.username.toLowerCase());
            if (userInDb) {
                // Update active user data in case password or metadata changed
                currentUser = userInDb;
                sessionStorage.setItem('scheduler_current_user', JSON.stringify(currentUser));
                showMainApp();
            } else {
                sessionStorage.removeItem('scheduler_current_user');
                currentUser = null;
                showLogin();
            }
        } catch (e) {
            showLogin();
        }
    } else {
        showLogin();
    }
}

function showLogin() {
    loginView.style.display = 'flex';
    appWrapper.style.display = 'none';
}

function showMainApp() {
    loginView.style.display = 'none';
    appWrapper.style.display = 'grid';
    
    // Set UI User Info
    currentUserAvatar.textContent = currentUser.name.charAt(0);
    currentUserName.textContent = currentUser.name;
    currentUserRole.textContent = currentUser.role === 'admin' ? '管理員 (Admin)' : '一般員工 (Employee)';
    
    // Set Mobile User Info
    const mobileUserAvatar = document.getElementById('mobileUserAvatar');
    const mobileUserName = document.getElementById('mobileUserName');
    if (mobileUserAvatar) mobileUserAvatar.textContent = currentUser.name.charAt(0);
    if (mobileUserName) {
        if (currentUser.role === 'employee') {
            const liveUser = dbData.users.find(u => u.username === currentUser.username);
            const compDays = liveUser && liveUser.compDays !== undefined ? liveUser.compDays : 0;
            mobileUserName.textContent = `${currentUser.name} (${compDays}天補休)`;
        } else {
            mobileUserName.textContent = currentUser.name;
        }
    }
    
    // Update personal compensatory leave days
    const liveUser = dbData.users.find(u => u.username === currentUser.username);
    const compDays = liveUser && liveUser.compDays !== undefined ? liveUser.compDays : 0;
    const compDaysEl = document.getElementById('currentUserCompDays');
    if (compDaysEl) {
        if (currentUser.role === 'admin') {
            compDaysEl.style.display = 'none';
        } else {
            compDaysEl.style.display = 'block';
            compDaysEl.textContent = `可補休天數: ${compDays} 天`;
        }
    }
    
    // Hide/Show Admin-only controls
    const adminElements = document.querySelectorAll('.admin-only');
    adminElements.forEach(el => {
        if (currentUser.role === 'admin') {
            el.style.display = '';
        } else {
            el.style.display = 'none';
        }
    });
    
    // Default show page based on role and screen size
    const isMobile = window.innerWidth <= 768;
    const mobileNavBar = document.querySelector('.mobile-nav-bar');
    
    if (currentUser.role === 'admin') {
        switchPage('dashboardPage');
        if (mobileNavBar) {
            mobileNavBar.style.setProperty('display', 'flex', 'important');
        }
    } else {
        if (isMobile) {
            switchPage('calendarPage');
            if (mobileNavBar) {
                mobileNavBar.style.setProperty('display', 'none', 'important');
            }
        } else {
            switchPage('dashboardPage');
        }
    }
    initAppComponents();
}

function switchPage(pageId) {
    fetchAndSyncDatabase();
    
    // Deactivate all nav items & pages
    navItems.forEach(item => {
        item.classList.remove('active');
        if (item.getAttribute('data-target') === pageId) {
            item.classList.add('active');
        }
    });
    
    for (const [key, value] of Object.entries(pages)) {
        value.classList.remove('active');
    }
    
    // Activate target page
    pages[pageId].classList.add('active');
    
    // Set Page title
    const titles = {
        dashboardPage: '總覽儀表板',
        calendarPage: '排班與請假行事曆',
        cleaningPage: '打掃工作指派與工時計算',
        memberPage: '員工管理'
    };
    pageTitleText.textContent = titles[pageId];
    
    // Specific page reload components
    if (pageId === 'dashboardPage') {
        renderDashboard();
    } else if (pageId === 'calendarPage') {
        renderCalendar(currentYear, currentMonth);
    } else if (pageId === 'cleaningPage') {
        renderCleaningPage();
    } else if (pageId === 'memberPage') {
        renderMembers();
    }
}

// ==========================================================================
// Modal Control Helpers
// ==========================================================================

function openModal(modal) {
    modal.classList.add('active');
}

function closeModal(modal) {
    modal.classList.remove('active');
}

// Setup universal close buttons
document.querySelectorAll('[data-close]').forEach(button => {
    button.addEventListener('click', () => {
        const modalId = button.getAttribute('data-close');
        closeModal(document.getElementById(modalId));
    });
});

// Close modal when clicking backdrop
modalOverlays.forEach(overlay => {
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
            closeModal(overlay);
        }
    });
});

// ==========================================================================
// Dropdowns Populate Helpers
// ==========================================================================

function populateEmployeeDropdowns() {
    // Clear previous options
    shiftEmployee.innerHTML = '';
    leaveRequestEmployee.innerHTML = '';
    taskEmployee.innerHTML = '';
    
    dbData.users.forEach(user => {
        // Shift dropdown
        const optShift = document.createElement('option');
        optShift.value = user.username;
        optShift.textContent = user.name;
        shiftEmployee.appendChild(optShift);
        
        // Leave dropdown
        const optLeave = document.createElement('option');
        optLeave.value = user.username;
        optLeave.textContent = user.name;
        leaveRequestEmployee.appendChild(optLeave);
        
        // Task dropdown
        const optTask = document.createElement('option');
        optTask.value = user.username;
        optTask.textContent = user.name;
        taskEmployee.appendChild(optTask);
    });

    // Update badges when employee selection changes
    shiftEmployee.addEventListener('change', () => {
        updateLimitBadge(shiftEmployee.value, 'shiftLimitNotice');
    });
    
    leaveRequestEmployee.addEventListener('change', () => {
        updateLimitBadge(leaveRequestEmployee.value, 'leaveLimitNotice');
    });
}

// ==========================================================================
// Main Application Rendering Logics
// ==========================================================================

function initAppComponents() {
    populateEmployeeDropdowns();
    renderNotificationCount();
    renderDashboard();
}

function renderNotificationCount() {
    const pendingCount = dbData.leaves.filter(l => l.status === 'pending').length;
    if (pendingCount > 0) {
        pendingLeavesCount.textContent = pendingCount;
        pendingLeavesCount.style.display = 'flex';
    } else {
        pendingLeavesCount.style.display = 'none';
    }
}

// --- DASHBOARD PAGE ---
function renderDashboard() {
    // Update personal compensatory leave days
    if (currentUser) {
        const liveUser = dbData.users.find(u => u.username === currentUser.username);
        const compDays = liveUser && liveUser.compDays !== undefined ? liveUser.compDays : 0;
        const compDaysEl = document.getElementById('currentUserCompDays');
        if (compDaysEl) {
            if (currentUser.role === 'admin') {
                compDaysEl.style.display = 'none';
            } else {
                compDaysEl.style.display = 'block';
                compDaysEl.textContent = `可補休天數: ${compDays} 天`;
            }
        }
    }
    
    // Current local Date string
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    
    // Check if daily report should be auto-sent (admin only, past 10:30 AM, not yet sent today)
    if (currentUser && currentUser.role === 'admin' && dbData.lineSettings && dbData.lineSettings.enabled) {
        const currentHour = today.getHours();
        const currentMinute = today.getMinutes();
        if (currentHour > 10 || (currentHour === 10 && currentMinute >= 30)) {
            if (dbData.lineSettings.lastReportDate !== todayStr) {
                dbData.lineSettings.lastReportDate = todayStr;
                saveData();
                
                // Trigger daily report notification
                const msg = getDailyReportMessage(todayStr);
                sendLineNotification(msg);
            }
        }
    }
    
    // Format Display
    currentDateDisplay.textContent = today.toLocaleDateString('zh-TW', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        weekday: 'long'
    });
    
    // Stats calculation (current month June 2026 for demonstration, but match current page selected month)
    const monthPrefix = `2026-${String(currentMonth + 1).padStart(2, '0')}`;
    
    // Count weekdays (non-Sundays and non-closed days) in the current month
    const weekdaysCount = getWeekdaysCount(currentYear, currentMonth);
    
    // Total shifts (work days) this month across all employees
    let totalWorkDaysAll = 0;
    dbData.users.forEach(u => {
        const leaveCount = dbData.shifts.filter(s => s.username === u.username && s.date.startsWith(monthPrefix) && s.type === 'leave').length;
        totalWorkDaysAll += Math.max(0, weekdaysCount - leaveCount);
    });
    statTotalShifts.textContent = `${totalWorkDaysAll} 人天`;
    
    // Pending leaves
    const pendingLeaves = dbData.leaves.filter(l => l.status === 'pending').length;
    statPendingLeaves.textContent = `${pendingLeaves} 筆`;
    
    // Completed tasks
    const completedTasks = dbData.tasks.filter(t => t.date.startsWith(monthPrefix) && t.status === 'completed').length;
    statCompletedTasks.textContent = `${completedTasks} 區`;
    

    
    // Render Today's shift list
    todayShiftsList.innerHTML = '';
    
    // Find shifts on today's date (We'll use mockup '2026-06-03' as today)
    const mockToday = '2026-06-03'; // Wednesday
    const todayDateObj = new Date(mockToday);
    const isSunday = todayDateObj.getDay() === 0;
    
    if (isSunday) {
        todayShiftsList.innerHTML = `
            <div class="shift-row-item" style="--shift-color: var(--shift-closed)">
                <div class="shift-row-info">
                    <div>
                        <div class="shift-row-title">今日週日公休</div>
                        <div class="shift-row-sub">全店公休不營業</div>
                    </div>
                </div>
            </div>
        `;
    } else {
        dbData.users.forEach(user => {
            const hasLeave = dbData.shifts.find(s => s.date === mockToday && s.username === user.username && s.type === 'leave');
            const hasPending = dbData.leaves.find(l => l.date === mockToday && l.username === user.username && l.status === 'pending');
            
            let statusText = '平日上班 (09:00 - 18:00)';
            let color = 'var(--shift-work)';
            
            if (hasLeave) {
                statusText = '排休 (已核准)';
                color = 'var(--shift-leave)';
            } else if (hasPending) {
                statusText = '排休 (審核中)';
                color = 'var(--shift-pending)';
            }
            
            const div = document.createElement('div');
            div.className = 'shift-row-item';
            div.style.setProperty('--shift-color', color);
            div.innerHTML = `
                <div class="shift-row-info">
                    <div class="avatar" style="width: 32px; height: 32px; font-size: 0.85rem;">${user.name.charAt(0)}</div>
                    <div>
                        <div class="shift-row-title">${user.name}</div>
                        <div class="shift-row-sub">${statusText}</div>
                    </div>
                </div>
            `;
            todayShiftsList.appendChild(div);
        });
    }
}

// --- CALENDAR PAGE ---
function renderCalendar(year, month) {
    currentMonthYear.textContent = `${year} 年 ${month + 1} 月`;
    calendarDaysGrid.innerHTML = '';
    
    // Total days in month
    const totalDays = new Date(year, month + 1, 0).getDate();
    // First day weekday index (0 for Sunday, etc.)
    const firstDayIndex = new Date(year, month, 1).getDay();
    
    // Days from previous month to pad the beginning
    const prevMonthDays = new Date(year, month, 0).getDate();
    for (let i = firstDayIndex - 1; i >= 0; i--) {
        const cell = document.createElement('div');
        cell.className = 'calendar-day-cell other-month';
        const dayNum = prevMonthDays - i;
        cell.innerHTML = `<span class="day-number">${dayNum}</span>`;
        calendarDaysGrid.appendChild(cell);
    }
    
    // Days in current month
    for (let d = 1; d <= totalDays; d++) {
        const cell = document.createElement('div');
        cell.className = 'calendar-day-cell';
        
        const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const dateObj = new Date(year, month, d);
        const isSunday = dateObj.getDay() === 0;
        
        if (isSunday) {
            cell.classList.add('sunday-closed');
        }
        
        // Highlight Today (Using mockup date 2026-06-03 as 'today')
        if (year === 2026 && month === 5 && d === 3) {
            cell.classList.add('today');
        }
        
        // Add Day Number
        const span = document.createElement('span');
        span.className = 'day-number';
        span.textContent = d;
        cell.appendChild(span);
        
        // Badges container
        const badgesContainer = document.createElement('div');
        badgesContainer.className = 'shift-badge-container';
        cell.appendChild(badgesContainer);
        
        const shopEventsToday = dbData.shopEvents.filter(e => e.date === dateStr);
        const hasClosedEvent = shopEventsToday.some(e => e.type === 'closed');
        
        if (hasClosedEvent) {
            cell.classList.add('shop-closed');
        }
        
        // Render Closed Day Banners
        if (isSunday) {
            // Sunday Closed banner
            const badge = document.createElement('div');
            badge.className = 'cell-shift-badge closed';
            badge.style.justifyContent = 'center';
            badge.innerHTML = `<span class="shift-name">週日公休</span>`;
            badgesContainer.appendChild(badge);
        }
        
        // Render Custom Closed Events
        shopEventsToday.filter(e => e.type === 'closed').forEach(ev => {
            const badge = document.createElement('div');
            badge.className = 'cell-shift-badge closed';
            badge.style.justifyContent = 'center';
            badge.innerHTML = `<span class="shift-name">🔴 公休: ${ev.title}</span>`;
            if (currentUser.role === 'admin') {
                badge.addEventListener('click', (e) => {
                    e.stopPropagation();
                    openEditEventModal(ev.id);
                });
            }
            badgesContainer.appendChild(badge);
        });

        // Render Custom Gathering Events
        shopEventsToday.filter(e => e.type === 'gathering').forEach(ev => {
            const badge = document.createElement('div');
            badge.className = 'cell-shift-badge gathering';
            badge.style.justifyContent = 'center';
            badge.innerHTML = `<span class="shift-name">🍴 ${ev.time} ${ev.title}</span>`;
            if (currentUser.role === 'admin') {
                badge.addEventListener('click', (e) => {
                    e.stopPropagation();
                    openEditEventModal(ev.id);
                });
            }
            badgesContainer.appendChild(badge);
        });

        // Render Custom Other Events
        shopEventsToday.filter(e => e.type === 'other').forEach(ev => {
            const badge = document.createElement('div');
            badge.className = 'cell-shift-badge other-event';
            badge.style.justifyContent = 'center';
            const timeDisplay = ev.time ? `${ev.time} ` : '';
            badge.innerHTML = `<span class="shift-name">📌 ${timeDisplay}${ev.title}</span>`;
            if (currentUser.role === 'admin') {
                badge.addEventListener('click', (e) => {
                    e.stopPropagation();
                    openEditEventModal(ev.id);
                });
            }
            badgesContainer.appendChild(badge);
        });

        // Weekday employee shifts (only if shop is open)
        if (!isSunday && !hasClosedEvent) {
            dbData.users.forEach(user => {
                const leaveShift = dbData.shifts.find(s => s.date === dateStr && s.username === user.username && s.type === 'leave');
                const pendingLeave = dbData.leaves.find(l => l.date === dateStr && l.username === user.username && l.status === 'pending');
                
                const badge = document.createElement('div');
                
                if (leaveShift) {
                    const isComp = leaveShift.leaveType === 'comp';
                    const durText = (isComp && leaveShift.duration === 0.5) ? '(半)' : '';
                    badge.className = isComp ? 'cell-shift-badge comp-leave' : 'cell-shift-badge leave';
                    badge.innerHTML = `
                        <span class="employee-initial">${user.name}</span>
                        <span class="shift-name">${isComp ? '補休' + durText : '排休'}</span>
                    `;
                    if (currentUser.role === 'admin') {
                        badge.addEventListener('click', (e) => {
                            e.stopPropagation();
                            openShiftAllocationModal(dateStr, user.username, 'leave', leaveShift.id);
                        });
                    } else if (user.username === currentUser.username) {
                        badge.addEventListener('click', (e) => {
                            e.stopPropagation();
                            openEditLeaveRequestModal(leaveShift.id, true);
                        });
                        badge.style.cursor = 'pointer';
                    }
                    badgesContainer.appendChild(badge);
                } else if (pendingLeave) {
                    const isComp = pendingLeave.leaveType === 'comp';
                    const durText = (isComp && pendingLeave.duration === 0.5) ? '(半)' : '';
                    badge.className = 'cell-shift-badge pending';
                    badge.innerHTML = `
                        <span class="employee-initial">${user.name}</span>
                        <span class="shift-name">${isComp ? '補休' + durText + '待核' : '待核'}</span>
                    `;
                    if (user.username === currentUser.username) {
                        badge.addEventListener('click', (e) => {
                            e.stopPropagation();
                            openEditLeaveRequestModal(pendingLeave.id, false);
                        });
                        badge.style.cursor = 'pointer';
                    }
                    badgesContainer.appendChild(badge);
                }
            });
        }
        
        // Click on cell to assign/request shift (All users - disable for Sunday and Closed days)
        if (!isSunday && !hasClosedEvent) {
            const addBtn = document.createElement('button');
            addBtn.className = 'add-shift-btn-cell';
            addBtn.innerHTML = '+';
            addBtn.addEventListener('click', () => {
                if (currentUser.role === 'admin') {
                    openShiftAllocationModal(dateStr);
                } else {
                    openLeaveRequestModal(dateStr);
                }
            });
            cell.appendChild(addBtn);
        }
        
        calendarDaysGrid.appendChild(cell);
    }
    
    // Pad remaining space at the end to make it standard calendar grid look (total cells = 35 or 42)
    const totalCells = firstDayIndex + totalDays;
    const remainingCells = (totalCells <= 35) ? 35 - totalCells : 42 - totalCells;
    for (let i = 1; i <= remainingCells; i++) {
        const cell = document.createElement('div');
        cell.className = 'calendar-day-cell other-month';
        cell.innerHTML = `<span class="day-number">${i}</span>`;
        calendarDaysGrid.appendChild(cell);
    }
}

function openShiftAllocationModal(dateStr, username = '', type = 'leave', shiftId = '') {
    shiftDate.value = dateStr;
    shiftDateLabel.textContent = dateStr;
    
    // If we're updating a shift, set values
    if (username) {
        shiftEmployee.value = username;
        shiftType.value = type;
        const shiftObj = dbData.shifts.find(s => s.id === shiftId);
        const lType = (shiftObj && shiftObj.leaveType) ? shiftObj.leaveType : 'regular';
        shiftLeaveType.value = lType;
        if (lType === 'comp') {
            shiftCompDurationGroup.style.display = 'block';
            shiftCompDuration.value = shiftObj && shiftObj.duration !== undefined ? String(shiftObj.duration) : '1.0';
        } else {
            shiftCompDurationGroup.style.display = 'none';
        }
        btnDeleteShift.style.display = type === 'leave' ? 'block' : 'none'; // Only delete if it's a leave shift
        btnDeleteShift.setAttribute('data-id', shiftId);
    } else {
        // Defaults
        shiftEmployee.selectedIndex = 0;
        shiftType.value = 'leave';
        shiftLeaveType.value = 'regular';
        shiftCompDurationGroup.style.display = 'none';
        btnDeleteShift.style.display = 'none';
        btnDeleteShift.removeAttribute('data-id');
    }
    
    updateLimitBadge(shiftEmployee.value, 'shiftLimitNotice');
    openModal(shiftModal);
}

// --- CLEANING & HOURS PAGE ---
function renderCleaningPage() {
    renderCleaningTasks();
}

function renderCleaningTasks() {
    tasksList.innerHTML = '';
    
    if (dbData.tasks.length === 0) {
        tasksList.innerHTML = `
            <div style="text-align: center; padding: 3rem; color: var(--text-muted);">
                目前無指派的打掃任務
            </div>
        `;
        return;
    }
    
    // 1. Group tasks by week
    const weeksMap = {}; // weekLabel -> { label, mondayStr, tasks: [] }
    
    dbData.tasks.forEach(task => {
        const weekInfo = getWeekRange(task.date);
        const label = weekInfo.label;
        if (!weeksMap[label]) {
            weeksMap[label] = {
                label: label,
                mondayStr: weekInfo.mondayStr,
                tasks: []
            };
        }
        weeksMap[label].tasks.push(task);
    });
    
    // Sort weeks descending by Monday date
    const sortedWeeks = Object.values(weeksMap).sort((a, b) => {
        return new Date(b.mondayStr) - new Date(a.mondayStr);
    });
    
    sortedWeeks.forEach(week => {
        const weekSection = document.createElement('div');
        weekSection.className = 'cleaning-week-section';
        
        const weekHeader = document.createElement('div');
        weekHeader.className = 'cleaning-week-header';
        weekHeader.innerHTML = `
            <svg viewBox="0 0 24 24" style="width:1.2rem;height:1.2rem;fill:var(--color-primary);margin-right:0.5rem;"><path d="M19 4h-1V2h-2v2H8V2H6v2H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V10h14v10z"/></svg>
            週區間：${week.label}
        `;
        weekSection.appendChild(weekHeader);
        
        // 2. Group tasks of this week by date (descending within week)
        const daysMap = {}; // dateStr -> tasks[]
        week.tasks.forEach(task => {
            if (!daysMap[task.date]) {
                daysMap[task.date] = [];
            }
            daysMap[task.date].push(task);
        });
        
        const sortedDates = Object.keys(daysMap).sort((a, b) => {
            return new Date(a) - new Date(b);
        });
        
        const daysContainer = document.createElement('div');
        daysContainer.className = 'cleaning-days-container';
        
        sortedDates.forEach(dateStr => {
            const dayGroup = document.createElement('div');
            dayGroup.className = 'cleaning-day-group';
            
            // Format date to show weekday
            const dateObj = new Date(dateStr);
            const weekdays = ['週日', '週一', '週二', '週三', '週四', '週五', '週六'];
            const weekdayName = weekdays[dateObj.getDay()];
            
            const dayHeader = document.createElement('div');
            dayHeader.className = 'cleaning-day-header';
            dayHeader.innerHTML = `📅 ${dateStr} (${weekdayName})`;
            dayGroup.appendChild(dayHeader);
            
            // 3. Group tasks of this day by area
            const areasMap = {}; // areaName -> tasks[]
            daysMap[dateStr].forEach(task => {
                if (!areasMap[task.area]) {
                    areasMap[task.area] = [];
                }
                areasMap[task.area].push(task);
            });
            
            const tasksContainer = document.createElement('div');
            tasksContainer.className = 'cleaning-day-tasks';
            
            Object.keys(areasMap).forEach(area => {
                const areaTasks = areasMap[area];
                
                // Render a single task card for this area
                const card = document.createElement('div');
                card.className = 'task-card';
                
                // Group status: if all tasks are completed, the card is completed. Otherwise, pending.
                const isAllCompleted = areaTasks.every(t => t.status === 'completed');
                const statusBadge = isAllCompleted 
                    ? '<span class="status-pill completed">已完成</span>' 
                    : '<span class="status-pill pending">未完成</span>';
                
                let areaDisplayName = area;
                if (area === '處理好指定空間') {
                    areaDisplayName = '處理好指定空間 (後勤/行政/汽美)';
                }
                
                let cardBodyHtml = `
                    <div class="task-card-info" style="width: 100%;">
                        <div class="task-title-area" style="margin-bottom: 0.8rem;">
                            <span class="task-name" style="font-size: 1.1rem; font-weight: 600; color: var(--text-primary);">${areaDisplayName}</span>
                            ${statusBadge}
                        </div>
                        <div class="task-assignees-list" style="display: flex; flex-direction: column; gap: 0.6rem;">
                `;
                
                areaTasks.forEach(task => {
                    const user = dbData.users.find(u => u.username === task.username);
                    const displayName = user ? user.name : task.username;
                    const isSelf = currentUser.username === task.username;
                    
                    const assigneeStatusBadge = task.status === 'completed'
                        ? '<span class="status-pill completed" style="font-size: 0.7rem; padding: 2px 6px;">已完成</span>'
                        : '<span class="status-pill pending" style="font-size: 0.7rem; padding: 2px 6px;">未完成</span>';
                    
                    // Show actions:
                    let actionBtn = '';
                    if (task.status === 'pending') {
                        if (isSelf || currentUser.role === 'admin') {
                            actionBtn = `<button class="btn btn-success btn-xs" onclick="completeTaskDirectly('${task.id}')">完成</button>`;
                        }
                    }
                    
                    let adminControls = '';
                    if (currentUser.role === 'admin') {
                        adminControls = `
                            <button class="btn btn-secondary btn-xs" onclick="openEditTaskModal('${task.id}')" style="display: flex; align-items: center; justify-content: center;">
                                <svg viewBox="0 0 24 24" style="width:14px;height:14px;fill:var(--text-secondary);"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>
                            </button>
                        `;
                    }
                    
                    cardBodyHtml += `
                        <div class="task-assignee-row" style="display: flex; align-items: center; justify-content: space-between; padding: 0.4rem 0.6rem; background: rgba(15, 23, 42, 0.02); border-radius: 6px; border: 1px solid var(--border-color);">
                            <div style="display: flex; align-items: center; gap: 0.8rem;">
                                <span style="font-weight: 500; color: var(--text-primary); min-width: 60px;">${displayName}</span>
                                ${assigneeStatusBadge}
                            </div>
                            <div style="display: flex; align-items: center; gap: 0.4rem;">
                                ${actionBtn}
                                ${adminControls}
                            </div>
                        </div>
                    `;
                });
                
                cardBodyHtml += `
                        </div>
                    </div>
                `;
                
                card.innerHTML = cardBodyHtml;
                tasksContainer.appendChild(card);
            });
            
            dayGroup.appendChild(tasksContainer);
            daysContainer.appendChild(dayGroup);
        });
        
        weekSection.appendChild(daysContainer);
        tasksList.appendChild(weekSection);
    });
}

function completeTaskDirectly(taskId) {
    const taskIndex = dbData.tasks.findIndex(t => t.id === taskId);
    if (taskIndex !== -1) {
        const task = dbData.tasks[taskIndex];
        task.status = 'completed';
        task.actHours = null;
        
        saveData();
        renderCleaningPage();
        renderDashboard();

        // Send LINE notification
        const userObj = dbData.users.find(u => u.username === task.username);
        const employeeName = userObj ? userObj.name : task.username;
        const msg = `✅ 【打掃任務完成回報】\n負責人：${employeeName}\n工作項目：${task.area}\n*工作已完成並登錄系統。*`;
        sendLineNotification(msg);
    }
}

function openEditTaskModal(taskId) {
    const task = dbData.tasks.find(t => t.id === taskId);
    if (!task) return;
    
    taskModalTitle.textContent = '編輯打掃任務';
    taskIdField.value = task.id;
    
    // Handle task area and custom field
    const standardAreas = ['室內地板環境整理', '藥水補充', '室外吸煙區整理', '工具歸位整理', '處理好指定空間'];
    if (standardAreas.includes(task.area)) {
        taskArea.value = task.area;
        customTaskAreaContainer.style.display = 'none';
        taskAreaCustom.value = '';
    } else {
        taskArea.value = 'other';
        customTaskAreaContainer.style.display = 'block';
        taskAreaCustom.value = task.area;
    }
    
    taskDate.value = task.date;
    updateTaskEmployeeDropdownForDate(task.date);
    taskEmployee.value = task.username;
    
    btnDeleteTask.style.display = 'block';
    
    openModal(taskModal);
}



// --- MEMBERS MANAGEMENT PAGE ---
function renderMembers() {
    memberGrid.innerHTML = '';
    
    dbData.users.forEach(user => {
        // Calculate basic statistics
        const monthPrefix = `2026-${String(currentMonth + 1).padStart(2, '0')}`;
        
        // Count weekdays
        const weekdaysCount = getWeekdaysCount(currentYear, currentMonth);
        
        const userLeaves = dbData.shifts.filter(s => s.username === user.username && s.date.startsWith(monthPrefix) && s.type === 'leave').length;
        const userShifts = Math.max(0, weekdaysCount - userLeaves); // Working days
        
        const cleaningHours = dbData.tasks
            .filter(t => t.username === user.username && t.status === 'completed' && t.date.startsWith(monthPrefix))
            .reduce((sum, t) => sum + (t.actHours || 0), 0);
            
        const card = document.createElement('div');
        card.className = 'glass-card member-card';
        
        let editControls = '';
        if (currentUser.role === 'admin') {
            editControls = `
                <div class="member-card-actions">
                    <button class="btn btn-secondary btn-sm" onclick="openEditMemberModal('${user.username}')">編輯</button>
                    ${user.username !== 'admin' ? `<button class="btn btn-danger btn-sm" onclick="deleteMember('${user.username}')">刪除</button>` : ''}
                </div>
            `;
        }
        
        card.innerHTML = `
            <div class="member-card-header">
                <div class="avatar">${user.name.charAt(0)}</div>
                <div class="member-card-details">
                    <h4>${user.name}</h4>
                    <span>帳號: <strong>${user.username}</strong></span>
                    <span style="font-size: 0.8rem; color: var(--text-secondary); display: block; margin-top: 2px;">初始密碼: <strong>${user.password}</strong></span>
                    <span style="font-size: 0.75rem; color: var(--text-muted); display: block; margin-top: 2px;">角色/職位: ${user.role === 'admin' ? '管理員' : (user.position === 'master' ? '技師' : (user.position === 'semi' ? '半技師' : (user.position === 'apprentice' ? '學徒' : (user.position === 'beauty' ? '汽美部門' : '行政/後勤/其他'))))}</span>
                </div>
            </div>
            <div class="member-stats-mini">
                <div class="mini-stat-item">
                    <span class="mini-stat-label">當月工作天數</span>
                    <span class="mini-stat-val">${userShifts} 天</span>
                </div>
                <div class="mini-stat-item">
                    <span class="mini-stat-label">當月打掃時數</span>
                    <span class="mini-stat-val">${cleaningHours.toFixed(1)} 小時</span>
                </div>
                <div class="mini-stat-item" style="border-top: 1px dashed var(--border-color); padding-top: 4px; margin-top: 4px;">
                    <span class="mini-stat-label">可補休天數</span>
                    <span class="mini-stat-val" style="color: var(--color-info); font-weight: 600;">${user.compDays !== undefined ? user.compDays : 0} 天</span>
                </div>
                <div class="mini-stat-item" style="border-top: 1px dashed var(--border-color); padding-top: 4px; margin-top: 4px;">
                    <span class="mini-stat-label">每月排休上限</span>
                    <span class="mini-stat-val" style="color: var(--color-primary); font-weight: 600;">${user.leaveLimit !== undefined ? user.leaveLimit : 2} 天</span>
                </div>
            </div>
            ${editControls}
        `;
        
        memberGrid.appendChild(card);
    });
}

function openEditMemberModal(username) {
    const user = dbData.users.find(u => u.username === username);
    if (!user) return;
    
    memberModalTitle.textContent = '編輯員工資料';
    memberIdField.value = user.username; // Use username as ID
    memberName.value = user.name;
    memberUsername.value = user.username;
    memberUsername.disabled = true; // Cannot edit username
    memberPassword.value = user.password;
    memberRole.value = user.role;
    memberPosition.value = user.position || 'other';
    memberCompDays.value = user.compDays !== undefined ? user.compDays : 0;
    memberLeaveLimit.value = user.leaveLimit !== undefined ? user.leaveLimit : 2;
    
    openModal(memberModal);
}

function deleteMember(username) {
    if (username === 'admin') {
        alert('無法刪除主管理員帳密。');
        return;
    }
    if (confirm(`確定要刪除員工「${username}」的帳號嗎？此動作將清除該員工的關聯排班與任務資料。`)) {
        // Delete related tasks and shifts
        dbData.users = dbData.users.filter(u => u.username !== username);
        dbData.shifts = dbData.shifts.filter(s => s.username !== username);
        dbData.tasks = dbData.tasks.filter(t => t.username !== username);
        dbData.leaves = dbData.leaves.filter(l => l.username !== username);
        
        saveData();
        renderMembers();
        populateEmployeeDropdowns();
        alert('員工帳號刪除成功。');
    }
}

// --- SHOP EVENTS MANAGEMENT ---
function toggleGatheringFields() {
    if (eventType.value === 'gathering' || eventType.value === 'other') {
        gatheringFields.style.display = 'block';
    } else {
        gatheringFields.style.display = 'none';
    }
}

// Watch eventType changes
eventType.addEventListener('change', toggleGatheringFields);

function openAddEventModal(dateStr = '') {
    eventModalTitle.textContent = '新增事件';
    eventForm.reset();
    eventIdField.value = '';
    
    if (dateStr) {
        eventDate.value = dateStr;
    } else {
        const today = new Date();
        eventDate.value = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    }
    
    toggleGatheringFields();
    btnDeleteEvent.style.display = 'none';
    openModal(eventModal);
}

function openEditEventModal(eventId) {
    const ev = dbData.shopEvents.find(e => e.id === eventId);
    if (!ev) return;
    
    eventModalTitle.textContent = '編輯事件';
    eventIdField.value = ev.id;
    eventType.value = ev.type;
    eventDate.value = ev.date;
    eventTitle.value = ev.title;
    
    if (ev.type === 'gathering' || ev.type === 'other') {
        eventTime.value = ev.time || '';
        eventLocation.value = ev.location || '';
    } else {
        eventTime.value = '';
        eventLocation.value = '';
    }
    
    toggleGatheringFields();
    btnDeleteEvent.style.display = 'block';
    openModal(eventModal);
}

// Event Save click
btnSaveEvent.addEventListener('click', () => {
    const id = eventIdField.value;
    const type = eventType.value;
    const date = eventDate.value;
    const title = eventTitle.value.trim();
    const time = eventTime.value;
    const location = eventLocation.value.trim();
    
    if (!date || !title) {
        alert('請填寫完整日期與事件名稱。');
        return;
    }
    
    if (type === 'gathering' && !time) {
        alert('聚餐事件請填寫時間！');
        return;
    }
    
    let isNew = !id;
    const hasTimeOrLoc = (type === 'gathering' || type === 'other');
    if (id) {
        // Edit existing
        const evIndex = dbData.shopEvents.findIndex(e => e.id === id);
        if (evIndex !== -1) {
            dbData.shopEvents[evIndex].type = type;
            dbData.shopEvents[evIndex].date = date;
            dbData.shopEvents[evIndex].title = title;
            dbData.shopEvents[evIndex].time = hasTimeOrLoc ? (time || null) : null;
            dbData.shopEvents[evIndex].location = hasTimeOrLoc ? (location || null) : null;
        }
    } else {
        // Add new
        dbData.shopEvents.push({
            id: 'e_' + Math.random().toString(36).substr(2, 9),
            type: type,
            date: date,
            title: title,
            time: hasTimeOrLoc ? (time || null) : null,
            location: hasTimeOrLoc ? (location || null) : null
        });
    }
    
    saveData();
    closeModal(eventModal);
    renderCalendar(currentYear, currentMonth);
    renderDashboard();
    
    // Send LINE Notification if enabled
    if (isNew) {
        let msg = '';
        if (type === 'closed') {
            msg = `📢 【店內公休公告】\n日期：${date}\n事由：${title}\n*當天不營業，全體公休。*`;
        } else if (type === 'gathering') {
            msg = `📢 【員工聚餐通知】\n活動項目：${title}\n日期：${date}\n時間：${time}\n地點：${location || '未定'}\n*請全體同仁準時參加！*`;
        } else {
            msg = `📢 【公告事項】\n項目：${title}\n日期：${date}\n${time ? '時間：' + time + '\n' : ''}${location ? '說明/地點：' + location + '\n' : ''}*請各位同仁留意！*`;
        }
        sendLineNotification(msg);
    }
});

// Event Delete click
btnDeleteEvent.addEventListener('click', () => {
    const id = eventIdField.value;
    if (id) {
        dbData.shopEvents = dbData.shopEvents.filter(e => e.id !== id);
        saveData();
        closeModal(eventModal);
        renderCalendar(currentYear, currentMonth);
        renderDashboard();
        alert('事件已成功刪除。');
    }
});

// Action item click
actionManageEvents.addEventListener('click', () => {
    openAddEventModal();
});

// --- ADMIN LEAVE REQUESTS APPROVALS ---
function renderLeaveApprovalList() {
    pendingLeaveApprovalList.innerHTML = '';
    const pendings = dbData.leaves.filter(l => l.status === 'pending');
    
    if (pendings.length === 0) {
        pendingLeaveApprovalList.innerHTML = `
            <div style="text-align: center; padding: 2rem; color: var(--text-muted);">
                目前沒有待審核的休假申請
            </div>
        `;
        return;
    }
    
    pendings.forEach(leave => {
        const user = dbData.users.find(u => u.username === leave.username);
        const name = user ? user.name : leave.username;
        
        const div = document.createElement('div');
        div.className = 'approval-item';
        div.innerHTML = `
            <div class="approval-info">
                <div class="approval-user">${name} <span style="font-weight: normal; font-size: 0.8rem; color: var(--text-secondary);">申請排休</span></div>
                <div class="approval-date">日期: <strong>${leave.date}</strong></div>
                <div style="font-size: 0.8rem; margin-top: 4px;">說明: ${leave.reason || '無'}</div>
            </div>
            <div class="approval-actions">
                <button class="btn btn-success btn-sm" onclick="approveLeave('${leave.id}', true)">核准</button>
                <button class="btn btn-danger btn-sm" onclick="approveLeave('${leave.id}', false)">駁回</button>
            </div>
        `;
        pendingLeaveApprovalList.appendChild(div);
    });
}

function approveLeave(leaveId, approve) {
    const leaveIndex = dbData.leaves.findIndex(l => l.id === leaveId);
    if (leaveIndex === -1) return;
    
    const leave = dbData.leaves[leaveIndex];
    if (approve) {
        // Daily Limit Check
        const limitCheck = checkDailyLeaveLimit(leave.date, leave.username);
        if (!limitCheck.allowed) {
            alert(limitCheck.message);
            return;
        }

        const userObj = dbData.users.find(u => u.username === leave.username);
        const duration = leave.duration !== undefined ? leave.duration : 1.0;
        if (leave.leaveType === 'comp') {
            if (!userObj || userObj.compDays < duration) {
                alert(`核准失敗：該員工「${userObj ? userObj.name : leave.username}」的可補休天數不足 ${duration} 天！`);
                return;
            }
            userObj.compDays -= duration;
        }

        const dateObj = new Date(leave.date);
        const targetYear = dateObj.getFullYear();
        const targetMonth = dateObj.getMonth();
        
        // Count ONLY approved leaves (excluding this pending one)
        const approvedCount = dbData.shifts.filter(s => s.username === leave.username && s.date.startsWith(`${targetYear}-${String(targetMonth + 1).padStart(2, '0')}`) && s.type === 'leave' && s.leaveType !== 'comp').length;
        const userLimit = (userObj && userObj.leaveLimit !== undefined) ? userObj.leaveLimit : 2;
        
        if (leave.leaveType === 'regular' && approvedCount >= userLimit) {
            alert(`無法核准：該員工「${dbData.users.find(u => u.username === leave.username).name}」在本月已核准排休 ${userLimit} 天，已達上限！`);
            return;
        }

        leave.status = 'approved';
        
        // Auto create/overwrite shift cell for this employee as 'leave'
        // Delete any existing shift on this date for this user
        dbData.shifts = dbData.shifts.filter(s => !(s.date === leave.date && s.username === leave.username));
        dbData.shifts.push({
            id: 's_auto_' + Math.random().toString(36).substr(2, 9),
            username: leave.username,
            date: leave.date,
            type: 'leave',
            leaveType: leave.leaveType || 'regular',
            duration: duration
        });
    } else {
        leave.status = 'rejected';
    }
    
    saveData();
    renderLeaveApprovalList();
    renderNotificationCount();
    renderDashboard();
    renderCalendar(currentYear, currentMonth);
}

// ==========================================================================
function getDailyReportMessage(dateStr) {
    // Look up leaves on this date
    const leavesToday = dbData.shifts.filter(s => s.date === dateStr && s.type === 'leave');
    const leaveNames = leavesToday.map(s => {
        const userObj = dbData.users.find(u => u.username === s.username);
        return userObj ? userObj.name : s.username;
    });

    // Look up tasks on this date
    const tasksToday = dbData.tasks.filter(t => t.date === dateStr);

    let msg = `📅 【今日排班與打掃日報 - ${dateStr}】\n\n`;

    msg += `🏖️ 今日排休人員：\n`;
    if (leaveNames.length > 0) {
        leaveNames.forEach(name => {
            msg += `- ${name}\n`;
        });
        msg += `*(其餘人員皆正常上班)*\n\n`;
    } else {
        msg += `(今日無人排休，全體正常上班)\n\n`;
    }

    msg += `🧹 今日打掃安排：\n`;
    if (tasksToday.length > 0) {
        tasksToday.forEach((t, index) => {
            const userObj = dbData.users.find(u => u.username === t.username);
            const name = userObj ? userObj.name : t.username;
            msg += `${index + 1}. ${name} - ${t.area}${t.status === 'completed' ? ' [已完成]' : ''}\n`;
        });
        msg += `\n*請相關負責人於今日完成後登入系統點擊「完成」。*`;
    } else {
        msg += `(今日無指派打掃工作)\n`;
    }

    return msg;
}

async function sendLineNotification(messageText) {
    // 1. Show the simulator toast (always show it so the user can see the effect)
    triggerLineSimulatorToast(messageText);

    // 2. If LINE notifications are enabled and webhookUrl is set, send the actual request
    if (dbData.lineSettings && dbData.lineSettings.enabled && dbData.lineSettings.webhookUrl) {
        try {
            await fetch(dbData.lineSettings.webhookUrl, {
                method: 'POST',
                mode: 'no-cors',
                body: messageText
            });
            console.log("LINE Webhook notification sent successfully");
        } catch (error) {
            console.warn("LINE Webhook call failed (expected if CORS is not configured or offline):", error);
        }
    }
}

async function syncDatabaseToWebhook() {
    if (dbData.lineSettings && dbData.lineSettings.enabled && dbData.lineSettings.webhookUrl) {
        // Only sync database if using Google Apps Script (GAS) to prevent Make.com from receiving sync payloads
        if (!dbData.lineSettings.webhookUrl.includes('script.google.com')) {
            return;
        }
        try {
            await fetch(dbData.lineSettings.webhookUrl, {
                method: 'POST',
                mode: 'no-cors',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    action: 'sync',
                    dbData: dbData
                })
            });
            console.log("Database backup synced to Webhook successfully");
        } catch (error) {
            console.warn("Database sync failed:", error);
        }
    }
}

async function fetchAndSyncDatabase() {
    let synced = false;
    
    // 1. Cloud KV Store Sync (Priority)
    if (dbData.syncSettings && dbData.syncSettings.enabled && dbData.syncSettings.syncKey) {
        try {
            console.log("Fetching database update from Cloud KV Store...");
            const response = await fetch(`https://kvdb.io/4jVV8b8bbLkHjBX9jQNbAP/${dbData.syncSettings.syncKey}`, {
                method: 'GET',
                mode: 'cors'
            });
            if (response.ok) {
                const remoteData = await response.json();
                if (remoteData && remoteData.users && remoteData.shifts && remoteData.leaves && remoteData.tasks) {
                    const localUpdated = dbData.lastUpdated || 0;
                    const remoteUpdated = remoteData.lastUpdated || 0;
                    
                    if (remoteUpdated > localUpdated) {
                        console.log("Remote Cloud database is newer. Overwriting local data...", { localUpdated, remoteUpdated });
                        dbData = remoteData;
                        
                        // Safety Recovery: Ensure admin user password is not compromised
                        let adminUser = dbData.users.find(u => u.username === 'admin');
                        if (adminUser) {
                            adminUser.password = 'admin123';
                        } else {
                            dbData.users.push({ username: 'admin', password: 'admin123', name: '主管/管理員', role: 'admin', position: 'other', compDays: 0, leaveLimit: 2 });
                        }
                        
                        saveData(false); // Save locally, DO NOT POST sync back
                        synced = true;
                    } else {
                        console.log("Local database is up-to-date or newer. Skip cloud sync.", { localUpdated, remoteUpdated });
                    }
                }
            }
        } catch (error) {
            console.warn("Failed to fetch database from Cloud KV Store:", error);
        }
    }
    
    // 2. GAS Webhook Sync (Secondary fallback)
    if (!synced && dbData.lineSettings && dbData.lineSettings.enabled && dbData.lineSettings.webhookUrl) {
        if (dbData.lineSettings.webhookUrl.includes('script.google.com')) {
            try {
                console.log("Fetching database update from GAS Webhook...");
                const response = await fetch(dbData.lineSettings.webhookUrl, {
                    method: 'GET',
                    mode: 'cors',
                    headers: {
                        'Accept': 'application/json'
                    }
                });
                if (response.ok) {
                    const remoteData = await response.json();
                    if (remoteData && remoteData.users && remoteData.shifts && remoteData.leaves && remoteData.tasks) {
                        const localUpdated = dbData.lastUpdated || 0;
                        const remoteUpdated = remoteData.lastUpdated || 0;
                        
                        if (remoteUpdated > localUpdated) {
                            console.log("Remote GAS database is newer. Overwriting local data...", { localUpdated, remoteUpdated });
                            dbData = remoteData;
                            
                            // Safety Recovery: Ensure admin user password is not compromised
                            let adminUser = dbData.users.find(u => u.username === 'admin');
                            if (adminUser) {
                                adminUser.password = 'admin123';
                            } else {
                                dbData.users.push({ username: 'admin', password: 'admin123', name: '主管/管理員', role: 'admin', position: 'other', compDays: 0, leaveLimit: 2 });
                            }
                            
                            saveData(false); // Save locally, DO NOT POST sync back
                            synced = true;
                        }
                    }
                }
            } catch (error) {
                console.warn("Failed to fetch database from Webhook:", error);
            }
        }
    }
    
    // If successfully synced data, refresh active page
    if (synced) {
        const activePage = document.querySelector('.page-content.active');
        if (activePage) {
            const pageId = activePage.id;
            if (pageId === 'dashboardPage') renderDashboard();
            else if (pageId === 'calendarPage') renderCalendar(currentYear, currentMonth);
            else if (pageId === 'cleaningPage') renderCleaningPage();
            else if (pageId === 'memberPage') renderMembers();
        }
        console.log("Active view successfully refreshed with synced data.");
    }
}

async function syncDatabaseToCloud() {
    if (dbData.syncSettings && dbData.syncSettings.enabled && dbData.syncSettings.syncKey) {
        try {
            await fetch(`https://kvdb.io/4jVV8b8bbLkHjBX9jQNbAP/${dbData.syncSettings.syncKey}`, {
                method: 'POST',
                body: JSON.stringify(dbData)
            });
            console.log("Database backup synced to Cloud successfully");
        } catch (error) {
            console.warn("Cloud sync failed:", error);
        }
    }
}

function triggerLineSimulatorToast(messageText) {
    if (!lineSimContainer) return;

    const toast = document.createElement('div');
    toast.className = 'line-sim-bubble';

    const now = new Date();
    const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

    toast.innerHTML = `
        <div class="line-sim-header">
            <div class="line-sim-header-left">
                <svg class="line-sim-logo" viewBox="0 0 24 24">
                    <path d="M12 2C6.48 2 2 5.58 2 10c0 2.45 1.5 4.6 3.86 5.86-.18.66-.65 2.37-.75 2.76-.1.39-.48 1.83.82 1.1 1.3-.73 6.02-4.08 6.07-4.12.33.05.66.08 1 .08 5.52 0 10-3.58 10-8s-4.48-8-10-8z"/>
                </svg>
                <span>LINE 群組通知模擬器</span>
            </div>
            <button class="line-sim-close-btn" title="關閉">
                <svg viewBox="0 0 24 24" style="width: 14px; height: 14px; fill: currentColor;"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
            </button>
        </div>
        <div class="line-sim-body">
            <div class="line-sim-avatar">L</div>
            <div class="line-sim-msg-content">
                <div class="line-sim-sender-name">打掃排班通知群</div>
                <div class="line-sim-text-bubble">${escapeHtml(messageText)}</div>
                <span class="line-sim-msg-time">${timeStr}</span>
            </div>
        </div>
    `;

    // Bind close button
    const closeBtn = toast.querySelector('.line-sim-close-btn');
    closeBtn.addEventListener('click', () => {
        toast.remove();
    });

    lineSimContainer.appendChild(toast);

    // Auto remove after 6 seconds (to match CSS fadeout transition animation of 0.5s ending at 6s)
    setTimeout(() => {
        if (toast.parentNode) {
            toast.remove();
        }
    }, 6000);
}

function escapeHtml(text) {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// ==========================================================================
// Event Listeners & Forms Submission Handling
// ==========================================================================

// Login Form Submit
loginForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const username = loginUsernameInput.value.trim();
    const password = loginPasswordInput.value;
    
    const matchedUser = dbData.users.find(u => u.username.toLowerCase() === username.toLowerCase() && u.password === password);
    
    if (matchedUser) {
        currentUser = matchedUser;
        sessionStorage.setItem('scheduler_current_user', JSON.stringify(currentUser));
        
        loginUsernameInput.value = '';
        loginPasswordInput.value = '';
        
        showMainApp();
    } else {
        alert('登入失敗：帳號或密碼錯誤！');
    }
});

// Logout Button
btnLogout.addEventListener('click', () => {
    sessionStorage.removeItem('scheduler_current_user');
    currentUser = null;
    showLogin();
});

if (btnMobileLogout) {
    btnMobileLogout.addEventListener('click', () => {
        sessionStorage.removeItem('scheduler_current_user');
        currentUser = null;
        showLogin();
    });
}

// Change Password Modal Trigger
const userProfileInfo = document.querySelector('.user-profile-info');
if (userProfileInfo) {
    userProfileInfo.addEventListener('click', () => {
        changePasswordForm.reset();
        openModal(changePasswordModal);
    });
}

if (mobileProfileSection) {
    mobileProfileSection.addEventListener('click', () => {
        changePasswordForm.reset();
        openModal(changePasswordModal);
    });
}

// Change Password Save
function handleSaveNewPassword() {
    const oldPassword = oldPasswordInput.value;
    const newPassword = newPasswordInput.value;
    const confirmNewPassword = confirmNewPasswordInput.value;

    if (!oldPassword || !newPassword || !confirmNewPassword) {
        alert('請填寫所有欄位！');
        return;
    }

    if (oldPassword !== currentUser.password) {
        alert('修改失敗：目前密碼輸入錯誤！');
        return;
    }

    if (newPassword.length < 3) {
        alert('修改失敗：新密碼長度至少需 3 位！');
        return;
    }

    if (newPassword !== confirmNewPassword) {
        alert('修改失敗：新密碼與確認密碼不符！');
        return;
    }

    // Update in database users list
    const matchedUser = dbData.users.find(u => u.username.toLowerCase() === currentUser.username.toLowerCase());
    if (matchedUser) {
        matchedUser.password = newPassword;
        currentUser.password = newPassword;
        sessionStorage.setItem('scheduler_current_user', JSON.stringify(currentUser));
        saveData();
        closeModal(changePasswordModal);
        alert('密碼修改成功！下次登入請使用新密碼。');
    } else {
        alert('修改失敗：找不到當前登入的使用者資料！');
    }
}

if (btnSaveNewPassword) {
    btnSaveNewPassword.addEventListener('click', handleSaveNewPassword);
}
if (changePasswordForm) {
    changePasswordForm.addEventListener('submit', (e) => {
        e.preventDefault();
        handleSaveNewPassword();
    });
}

// Navigation Items clicks
navItems.forEach(item => {
    item.addEventListener('click', () => {
        const target = item.getAttribute('data-target');
        switchPage(target);
    });
});

// Notification / Pending Leaves Modal Button (Admin only)
btnPendingLeaves.addEventListener('click', () => {
    renderLeaveApprovalList();
    openModal(leaveApprovalModal);
});

// Backup & Restore Modal triggers (Admin only)
btnBackupRestore.addEventListener('click', () => {
    importFile.value = ''; // Reset file input
    updateSyncUI();
    openModal(backupModal);
});

// Export Data (download JSON)
btnExportData.addEventListener('click', () => {
    try {
        const dataStr = JSON.stringify(dbData, null, 2);
        const dataBlob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(dataBlob);
        
        const tempLink = document.createElement('a');
        tempLink.href = url;
        tempLink.download = `time_off_backup_${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(tempLink);
        tempLink.click();
        document.body.removeChild(tempLink);
        URL.revokeObjectURL(url);
    } catch (err) {
        alert('匯出資料失敗：' + err.message);
    }
});

// Confirm Import Data
btnConfirmImport.addEventListener('click', () => {
    const file = importFile.files[0];
    if (!file) {
        alert('請先選擇要匯入的備份檔案 (.json)！');
        return;
    }
    
    if (!confirm('警告：匯入此備份檔案將會覆蓋您目前的全部員工、排休、打掃任務及設定！確定要繼續嗎？')) {
        return;
    }
    
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const importedData = JSON.parse(e.target.result);
            
            // Validate basic database structure
            if (!importedData || typeof importedData !== 'object') {
                throw new Error('無效的備份檔案格式');
            }
            
            // Determine users list (either users or members key)
            const users = Array.isArray(importedData.users) ? importedData.users : 
                          (Array.isArray(importedData.members) ? importedData.members : null);
            if (!users) {
                throw new Error('備份檔案中缺少「員工資料」或格式錯誤');
            }
            
            const leaves = Array.isArray(importedData.leaves) ? importedData.leaves : null;
            if (!leaves) {
                throw new Error('備份檔案中缺少「假單資料」或格式錯誤');
            }

            const tasks = Array.isArray(importedData.tasks) ? importedData.tasks : [];
            const shifts = Array.isArray(importedData.shifts) ? importedData.shifts : [];
            const shopEvents = Array.isArray(importedData.shopEvents) ? importedData.shopEvents : [];
            
            // Safe copy to dbData
            dbData = {
                users: users,
                shifts: shifts,
                leaves: leaves,
                tasks: tasks,
                shopEvents: shopEvents,
                lineSettings: importedData.lineSettings || { enabled: false, webhookUrl: '' }
            };
            
            saveData();
            alert('資料匯入成功！系統將自動重新整理網頁。');
            window.location.reload();
        } catch (err) {
            alert('匯入失敗：' + err.message + '\n請確定您選擇的是正確的系統備份檔案。');
        }
    };
    reader.onerror = function() {
        alert('讀取檔案時發生錯誤！');
    };
    reader.readAsText(file);
});

// --- Cloud Sync Logic & Listeners ---
function updateSyncUI() {
    if (!textSyncStatus) return;
    
    dbData.syncSettings = dbData.syncSettings || { enabled: false, syncKey: '' };
    
    if (dbData.syncSettings.enabled && dbData.syncSettings.syncKey) {
        textSyncStatus.textContent = '已啟用 (已連線雲端)';
        textSyncStatus.style.color = 'var(--color-success)';
        
        syncKeyContainer.style.display = 'block';
        syncKeyField.value = dbData.syncSettings.syncKey;
        if (syncUrlField) {
            const shareUrl = window.location.protocol + "//" + window.location.host + window.location.pathname + "?sync_key=" + dbData.syncSettings.syncKey;
            syncUrlField.value = shareUrl;
        }
        
        btnGenerateSyncKey.style.display = 'none';
        syncInputGroup.style.display = 'none';
        btnDisableSync.style.display = 'block';
    } else {
        textSyncStatus.textContent = '尚未啟用 (資料僅保留在本地)';
        textSyncStatus.style.color = 'var(--text-muted)';
        
        syncKeyContainer.style.display = 'none';
        syncKeyField.value = '';
        if (syncUrlField) {
            syncUrlField.value = '';
        }
        
        btnGenerateSyncKey.style.display = 'block';
        syncInputGroup.style.display = 'flex';
        btnDisableSync.style.display = 'none';
    }
}

if (btnGenerateSyncKey) {
    btnGenerateSyncKey.addEventListener('click', () => {
        if (confirm('確定要啟用雲端同步並生成全新的金鑰嗎？\n這將會在雲端建立一個專屬您系統的同步資料空間。')) {
            const newKey = 's_' + Math.random().toString(36).substr(2, 9) + Math.random().toString(36).substr(2, 9);
            dbData.syncSettings = {
                enabled: true,
                syncKey: newKey
            };
            saveData(); // Save and post to Cloud KV store immediately
            updateSyncUI();
            alert('全新雲端同步密鑰生成成功！\n請複製此密鑰，並在其他手機或電腦的備份對話框中貼上啟用。');
        }
    });
}

if (btnEnableSync) {
    btnEnableSync.addEventListener('click', async () => {
        const key = inputSyncKey.value.trim();
        if (!key) {
            alert('請先輸入或貼上同步密鑰！');
            return;
        }
        if (!key.startsWith('s_')) {
            alert('無效的同步密鑰格式！密鑰格式應為 s_ 開頭。');
            return;
        }
        
        if (!confirm('啟用此同步密鑰將會下載雲端的排班假單資料，並覆蓋您目前這台裝置上的所有本地資料！確定要繼續嗎？')) {
            return;
        }
        
        try {
            btnEnableSync.disabled = true;
            btnEnableSync.textContent = '連線中...';
            console.log(`Attempting to fetch remote db using key: ${key}`);
            const response = await fetch(`https://kvdb.io/4jVV8b8bbLkHjBX9jQNbAP/${key}`, {
                method: 'GET',
                mode: 'cors'
            });
            if (!response.ok) {
                throw new Error('找不到該密鑰對應的雲端備份，請確認密鑰是否正確，且曾在其他裝置上點選「生成全新密鑰」。');
            }
            const remoteData = await response.json();
            if (remoteData && remoteData.users && remoteData.shifts) {
                dbData = remoteData;
                dbData.syncSettings = {
                    enabled: true,
                    syncKey: key
                };
                saveData(false); // Save locally without pushing back
                alert('雲端同步成功連線！本裝置資料已更新，網頁即將自動重新整理。');
                location.reload();
            } else {
                throw new Error('雲端資料格式不正確。');
            }
        } catch (e) {
            alert('啟用同步失敗：' + e.message);
        } finally {
            btnEnableSync.disabled = false;
            btnEnableSync.textContent = '啟用同步';
        }
    });
}

if (btnDisableSync) {
    btnDisableSync.addEventListener('click', () => {
        if (confirm('確定要停用雲端同步嗎？停用後兩台裝置將不再同步，資料仍會保留在本地。')) {
            dbData.syncSettings = {
                enabled: false,
                syncKey: ''
            };
            saveData(false);
            updateSyncUI();
            alert('雲端同步已關閉！');
        }
    });
}

if (btnCopySyncKey) {
    btnCopySyncKey.addEventListener('click', () => {
        syncKeyField.select();
        syncKeyField.setSelectionRange(0, 99999);
        navigator.clipboard.writeText(syncKeyField.value).then(() => {
            alert('同步密鑰已複製到剪貼簿！');
        }).catch(err => {
            console.error('無法複製金鑰:', err);
        });
    });
}

if (btnCopySyncUrl) {
    btnCopySyncUrl.addEventListener('click', () => {
        syncUrlField.select();
        syncUrlField.setSelectionRange(0, 99999);
        navigator.clipboard.writeText(syncUrlField.value).then(() => {
            alert('一鍵同步網址已複製到剪貼簿！可以傳送給員工或在手機上點開直接同步。');
        }).catch(err => {
            console.error('無法複製網址:', err);
        });
    });
}

if (btnMobileBackupRestore) {
    btnMobileBackupRestore.addEventListener('click', () => {
        closeModal(changePasswordModal);
        btnBackupRestore.click();
    });
}

if (btnMobileLineSettings) {
    btnMobileLineSettings.addEventListener('click', () => {
        closeModal(changePasswordModal);
        btnLineSettings.click();
    });
}


// LINE Settings Modal triggers (Admin only)
btnLineSettings.addEventListener('click', () => {
    // Populate form fields with current values from dbData.lineSettings
    lineNotifyEnabled.checked = dbData.lineSettings ? dbData.lineSettings.enabled : false;
    lineWebhookUrl.value = dbData.lineSettings ? dbData.lineSettings.webhookUrl : '';
    openModal(lineSettingsModal);
});

btnSaveLineSettings.addEventListener('click', () => {
    dbData.lineSettings = {
        enabled: lineNotifyEnabled.checked,
        webhookUrl: lineWebhookUrl.value.trim()
    };
    saveData();
    closeModal(lineSettingsModal);
    alert('LINE 通知設定已儲存！');
});

btnTestLineMessage.addEventListener('click', () => {
    const testMessage = `📢 【系統測試通知】\n這是一則來自「排班與打掃管理系統」的測試訊息。\n設定正常運作中！`;
    sendLineNotification(testMessage);
});

btnSendDailyReport.addEventListener('click', () => {
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const msg = getDailyReportMessage(todayStr);
    sendLineNotification(msg);
    alert('今日排班與打掃日報已送出！');
});

btnCopyGASCode.addEventListener('click', () => {
    const gasCode = `// ==========================================
// Google Apps Script (GAS) 中繼傳送與自動化日報腳本
// ==========================================

const LINE_ACCESS_TOKEN = "您的_LINE_BOT_CHANNEL_ACCESS_TOKEN";
const LINE_GROUP_ID = "您的_LINE_工作群組_ID_或_ROOM_ID";

// 1. 接收網頁發送的 GET 請求，回傳最新備份資料庫（用於多裝置自動同步）
function doGet(e) {
  try {
    const backup = PropertiesService.getScriptProperties().getProperty("db_backup");
    if (backup) {
      return ContentService.createTextOutput(backup)
                           .setMimeType(ContentService.MimeType.JSON);
    } else {
      return ContentService.createTextOutput(JSON.stringify({ error: "No backup found" }))
                           .setMimeType(ContentService.MimeType.JSON);
    }
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ error: err.toString() }))
                         .setMimeType(ContentService.MimeType.JSON);
  }
}

// 2. 接收網頁發送的 POST 請求
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    
    // 處理資料同步備份 (用於離線 10:30 AM 定時日報)
    if (data.action === "sync" && data.dbData) {
      PropertiesService.getScriptProperties().setProperty("db_backup", JSON.stringify(data.dbData));
      return ContentService.createTextOutput(JSON.stringify({ status: "synced" }))
                           .setMimeType(ContentService.MimeType.JSON);
    }
    
    // 處理直接傳送 LINE 訊息
    const message = data.message;
    if (message) {
      sendLinePush(message);
      return ContentService.createTextOutput(JSON.stringify({ status: "success" }))
                           .setMimeType(ContentService.MimeType.JSON);
    }
    
    return ContentService.createTextOutput(JSON.stringify({ status: "ignored" }))
                         .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ status: "error", error: err.toString() }))
                         .setMimeType(ContentService.MimeType.JSON);
  }
}

// 【重要步驟】部署後，請在 GAS 中手動執行此函數一次，以啟用自動精確排程
function setupDaily1030Trigger() {
  const triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    const handler = triggers[i].getHandlerFunction();
    if (handler === "sendDailyReportTimer" || 
        handler === "setDailyReportTriggerForToday" || 
        handler === "setupDaily1030Trigger") {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  
  // 每天清晨 4:00 - 5:00 執行分配，動態設定當天 10:30 精確時間發送
  ScriptApp.newTrigger("setDailyReportTriggerForToday")
           .timeBased()
           .everyDays(1)
           .atHour(4)
           .create();
           
  // 同步立刻設定今天的 10:30 觸發
  setDailyReportTriggerForToday();
}

// 動態排程當天/隔天的 10:30 AM 單次定時器 (台北時間)
function setDailyReportTriggerForToday() {
  const now = new Date();
  const targetTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 10, 30, 0);
  
  if (now.getTime() > targetTime.getTime()) {
    targetTime.setDate(targetTime.getDate() + 1);
  }
  
  const triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === "sendDailyReportTimer") {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  
  ScriptApp.newTrigger("sendDailyReportTimer")
           .timeBased()
           .at(targetTime)
           .create();
}

// 3. 早上 10:30 自動觸發的時間驅動程序 (每日定時日報)
function sendDailyReportTimer() {
  const dbJson = PropertiesService.getScriptProperties().getProperty("db_backup");
  if (!dbJson) {
    Logger.log("無備份資料庫，無法發送日報。");
    return;
  }
  
  const dbData = JSON.parse(dbJson);
  
  // 取得今日台北時間日期字串 (格式: yyyy-MM-dd)
  const dateStr = Utilities.formatDate(new Date(), "Asia/Taipei", "yyyy-MM-dd");
  
  // 1. 篩選今日排休人員
  const leavesToday = dbData.shifts.filter(function(s) {
    return s.date === dateStr && s.type === 'leave';
  });
  const leaveNames = leavesToday.map(function(s) {
    const userObj = dbData.users.find(function(u) { return u.username === s.username; });
    return userObj ? userObj.name : s.username;
  });
  
  // 2. 篩選今日打掃安排
  const tasksToday = dbData.tasks.filter(function(t) {
    return t.date === dateStr;
  });
  
  let msg = "📅 【今日排班與打掃日報 - " + dateStr + "】\\n\\n";
  
  msg += "🏖️ 今日排休人員：\\n";
  if (leaveNames.length > 0) {
    leaveNames.forEach(function(name) {
      msg += "- " + name + "\\n";
    });
    msg += "*(其餘人員皆正常上班)*\\n\\n";
  } else {
    msg += "(今日無人排休，全體正常上班)\\n\\n";
  }
  
  msg += "🧹 今日打掃安排：\\n";
  if (tasksToday.length > 0) {
    tasksToday.forEach(function(t, index) {
      const userObj = dbData.users.find(function(u) { return u.username === t.username; });
      const name = userObj ? userObj.name : t.username;
      msg += (index + 1) + ". " + name + " - " + t.area + (t.status === 'completed' ? ' [已完成]' : '') + "\\n";
    });
    msg += "\\n*請相關負責人於今日完成後登入系統點擊「完成」。*";
  } else {
    msg += "(今日無指派打掃工作)\\n";
  }
  
  sendLinePush(msg);
  Logger.log("日報已成功發送：" + msg);
}

// 4. 呼叫 LINE Messaging API
function sendLinePush(text) {
  const url = "https://api.line.me/v2/bot/message/push";
  const payload = {
    to: LINE_GROUP_ID,
    messages: [
      {
        type: "text",
        text: text
      }
    ]
  };
  
  const options = {
    method: "post",
    contentType: "application/json",
    headers: {
      "Authorization": "Bearer " + LINE_ACCESS_TOKEN
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };
  
  const response = UrlFetchApp.fetch(url, options);
  Logger.log(response.getContentText());
}`;

    navigator.clipboard.writeText(gasCode).then(() => {
        alert('已成功複製 Google Apps Script 完整中繼與日報腳本碼到剪貼簿！');
    }).catch(err => {
        console.error('複製失敗: ', err);
        alert('複製失敗，請手動複製程式碼。');
    });
});

function openLeaveRequestModal(dateStr = '') {
    leaveRequestForm.reset();
    leaveRequestId.value = '';
    leaveRequestId.removeAttribute('data-approved');
    leaveCompDurationGroup.style.display = 'none';
    
    leaveRequestModalTitle.textContent = '申請休假 / 排休';
    btnSubmitLeaveRequest.textContent = '送出申請';
    btnDeleteLeaveRequest.style.display = 'none';
    
    if (currentUser.role === 'admin') {
        leaveRequestEmployee.disabled = false;
        leaveRequestEmployee.value = currentUser.username;
    } else {
        leaveRequestEmployee.value = currentUser.username;
        leaveRequestEmployee.disabled = true;
    }
    
    if (dateStr) {
        leaveRequestDate.value = dateStr;
    } else {
        const today = new Date();
        leaveRequestDate.value = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    }
    
    updateLimitBadge(leaveRequestEmployee.value, 'leaveLimitNotice');
    openModal(leaveRequestModal);
}

function openEditLeaveRequestModal(id, isApproved) {
    leaveRequestForm.reset();
    
    let dateVal = '';
    let typeVal = 'regular';
    let reasonVal = '';
    let durationVal = 1.0;
    
    if (isApproved) {
        const shift = dbData.shifts.find(s => s.id === id);
        if (!shift) return;
        dateVal = shift.date;
        typeVal = shift.leaveType || 'regular';
        durationVal = shift.duration !== undefined ? shift.duration : 1.0;
        
        // Find corresponding leave request to get reason
        const leave = dbData.leaves.find(l => l.date === shift.date && l.username === shift.username);
        reasonVal = leave ? leave.reason : '';
    } else {
        const leave = dbData.leaves.find(l => l.id === id);
        if (!leave) return;
        dateVal = leave.date;
        typeVal = leave.leaveType || 'regular';
        reasonVal = leave.reason;
        durationVal = leave.duration !== undefined ? leave.duration : 1.0;
    }
    
    leaveRequestId.value = id;
    leaveRequestId.setAttribute('data-approved', isApproved ? 'true' : 'false');
    
    leaveRequestModalTitle.textContent = '修改排休申請';
    btnSubmitLeaveRequest.textContent = '確認修改';
    btnDeleteLeaveRequest.style.display = 'block';
    
    leaveRequestEmployee.value = currentUser.username;
    leaveRequestEmployee.disabled = true;
    
    leaveRequestDate.value = dateVal;
    leaveRequestType.value = typeVal;
    leaveReason.value = reasonVal;
    
    if (typeVal === 'comp') {
        leaveCompDurationGroup.style.display = 'block';
        leaveCompDuration.value = String(durationVal);
    } else {
        leaveCompDurationGroup.style.display = 'none';
    }
    
    updateLimitBadge(currentUser.username, 'leaveLimitNotice');
    openModal(leaveRequestModal);
}

// --- Modal Action Centers listeners ---
actionRequestLeave.addEventListener('click', () => {
    openLeaveRequestModal();
});

actionAddTask.addEventListener('click', () => {
    taskModalTitle.textContent = '指派新打掃任務';
    taskForm.reset();
    taskIdField.value = '';
    btnDeleteTask.style.display = 'none';
    customTaskAreaContainer.style.display = 'none';
    taskAreaCustom.value = '';
    
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    taskDate.value = todayStr;
    updateTaskEmployeeDropdownForDate(todayStr);
    
    openModal(taskModal);
});

btnAddNewTask.addEventListener('click', () => {
    actionAddTask.click();
});

actionAddMember.addEventListener('click', () => {
    memberModalTitle.textContent = '新增員工資料';
    memberForm.reset();
    memberIdField.value = '';
    memberUsername.disabled = false;
    openModal(memberModal);
});

btnAddNewMember.addEventListener('click', () => {
    actionAddMember.click();
});

actionGoToCalendar.addEventListener('click', () => {
    switchPage('calendarPage');
});

if (actionPendingLeaves) {
    actionPendingLeaves.addEventListener('click', () => {
        renderLeaveApprovalList();
        openModal(leaveApprovalModal);
    });
}

if (actionBackupRestore) {
    actionBackupRestore.addEventListener('click', () => {
        importFile.value = ''; // Reset file input
        updateSyncUI();
        openModal(backupModal);
    });
}

if (actionLineSettings) {
    actionLineSettings.addEventListener('click', () => {
        openModal(lineSettingsModal);
    });
}

// --- Month Navigation listeners ---
btnPrevMonth.addEventListener('click', () => {
    currentMonth--;
    if (currentMonth < 0) {
        currentMonth = 11;
        currentYear--;
    }
    renderCalendar(currentYear, currentMonth);
});

btnNextMonth.addEventListener('click', () => {
    currentMonth++;
    if (currentMonth > 11) {
        currentMonth = 0;
        currentYear++;
    }
    renderCalendar(currentYear, currentMonth);
});

// --- Form submission details ---

// Shift allocation save (Admin only)
btnSaveShift.addEventListener('click', () => {
    const date = shiftDate.value;
    const username = shiftEmployee.value;
    const type = shiftType.value;
    const shiftId = btnDeleteShift.getAttribute('data-id');
    const leaveLType = shiftLeaveType.value; // 'regular' or 'comp'
    
    const dateObj = new Date(date);
    const targetYear = dateObj.getFullYear();
    const targetMonth = dateObj.getMonth();
    
    if (type === 'leave') {
        // Daily Limit Check
        const limitCheck = checkDailyLeaveLimit(date, username);
        if (!limitCheck.allowed) {
            alert(limitCheck.message);
            return;
        }

        const userObj = dbData.users.find(u => u.username === username);
        const oldShift = dbData.shifts.find(s => s.date === date && s.username === username);
        
        // Restore old compDays if old shift was comp
        if (oldShift && oldShift.type === 'leave' && oldShift.leaveType === 'comp') {
            const oldDuration = oldShift.duration !== undefined ? oldShift.duration : 1.0;
            if (userObj) userObj.compDays += oldDuration;
        }
        
        // Deduct new compDays if new shift is comp
        const duration = leaveLType === 'comp' ? parseFloat(shiftCompDuration.value) : 1.0;
        if (leaveLType === 'comp') {
            if (userObj) userObj.compDays -= duration;
        }
        
        // Save leave shift
        dbData.shifts = dbData.shifts.filter(s => !(s.date === date && s.username === username));
        dbData.shifts.push({
            id: shiftId || ('s_' + Math.random().toString(36).substr(2, 9)),
            username: username,
            date: date,
            type: 'leave',
            leaveType: leaveLType,
            duration: duration
        });
    } else {
        // If type is work, delete explicit shift record (defaults to work)
        const oldShift = dbData.shifts.find(s => s.date === date && s.username === username);
        if (oldShift && oldShift.type === 'leave' && oldShift.leaveType === 'comp') {
            const oldDuration = oldShift.duration !== undefined ? oldShift.duration : 1.0;
            const userObj = dbData.users.find(u => u.username === username);
            if (userObj) userObj.compDays += oldDuration;
        }
        dbData.shifts = dbData.shifts.filter(s => !(s.date === date && s.username === username));
    }
    
    saveData();
    closeModal(shiftModal);
    renderCalendar(currentYear, currentMonth);
    renderDashboard();
    renderMembers(); // Re-render members grid to update compDays counts
});

// Shift allocation delete (Admin only)
btnDeleteShift.addEventListener('click', () => {
    const shiftId = btnDeleteShift.getAttribute('data-id');
    if (shiftId) {
        const shiftObj = dbData.shifts.find(s => s.id === shiftId);
        if (shiftObj && shiftObj.type === 'leave' && shiftObj.leaveType === 'comp') {
            const userObj = dbData.users.find(u => u.username === shiftObj.username);
            const duration = shiftObj.duration !== undefined ? shiftObj.duration : 1.0;
            if (userObj) userObj.compDays += duration;
        }
        dbData.shifts = dbData.shifts.filter(s => s.id !== shiftId);
        saveData();
        closeModal(shiftModal);
        renderCalendar(currentYear, currentMonth);
        renderDashboard();
        renderMembers(); // Re-render members grid to update compDays counts
    }
});

// Leave Request submission
btnSubmitLeaveRequest.addEventListener('click', () => {
    const username = leaveRequestEmployee.value;
    const date = leaveRequestDate.value;
    const reason = leaveReason.value.trim();
    const leaveLType = leaveRequestType.value; // 'regular' or 'comp'
    
    if (!date) {
        alert('請選擇排休日期。');
        return;
    }
    
    // Check if date scheduling is open (Only for employees, admin bypasses)
    if (currentUser.role !== 'admin' && !isDateSchedulingOpen(date)) {
        alert('申請失敗：該排休日期已過期，無法申請過去的休假。如需調整，請聯絡主管手動調整。');
        return;
    }

    // Check consecutive leaves of 3 days or more (Only for employees, admin bypasses)
    if (currentUser.role !== 'admin') {
        const consecutiveDays = getConsecutiveLeaveDays(username, date, recordId);
        if (consecutiveDays >= 3) {
            const today = new Date();
            const leaveDateObj = new Date(date);
            today.setHours(0,0,0,0);
            leaveDateObj.setHours(0,0,0,0);
            const diffTime = leaveDateObj.getTime() - today.getTime();
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            if (diffDays < 30) {
                alert(`申請失敗：連休 3 天以上需提前一個月告知！當前離排休日期僅剩 ${diffDays} 天。`);
                return;
            }
        }
    }

    const isEdit = !!leaveRequestId.value;
    const isApprovedEdit = leaveRequestId.getAttribute('data-approved') === 'true';
    const recordId = leaveRequestId.value;
    const userObj = dbData.users.find(u => u.username === username);

    // If editing, we check the daily limit for the *new* date/user
    const limitCheck = checkDailyLeaveLimit(date, username);
    if (!limitCheck.allowed) {
        alert(limitCheck.message);
        return;
    }
    
    const dateObj = new Date(date);
    const targetYear = dateObj.getFullYear();
    const targetMonth = dateObj.getMonth();
    
    // Check Sunday closure
    if (dateObj.getDay() === 0) {
        alert('申請失敗：週日為公休日，無需申請排休。');
        return;
    }
    
    if (isEdit) {
        // Find the old details
        let oldDate = '';
        let oldType = 'regular';
        
        if (isApprovedEdit) {
            const oldShift = dbData.shifts.find(s => s.id === recordId);
            if (oldShift) {
                oldDate = oldShift.date;
                oldType = oldShift.leaveType || 'regular';
            }
        } else {
            const oldLeave = dbData.leaves.find(l => l.id === recordId);
            if (oldLeave) {
                oldDate = oldLeave.date;
                oldType = oldLeave.leaveType || 'regular';
            }
        }
        
        const isChanged = oldDate !== date || oldType !== leaveLType;
        
        if (isChanged) {
            // Delete old approved shift if it was approved and restore compDay
            // Delete old approved shift if it was approved and restore compDay
            if (isApprovedEdit) {
                const oldShift = dbData.shifts.find(s => s.id === recordId);
                const oldDuration = oldShift ? (oldShift.duration || 1.0) : 1.0;
                if (oldType === 'comp') {
                    if (userObj) userObj.compDays += oldDuration;
                }
                dbData.shifts = dbData.shifts.filter(s => s.id !== recordId);
            }
            
            // Delete old leave request
            dbData.leaves = dbData.leaves.filter(l => {
                if (isApprovedEdit) {
                    return !(l.date === oldDate && l.username === username);
                } else {
                    return l.id !== recordId;
                }
            });
            
            // Validate limits for the new settings (only for non-admin)
            if (currentUser.role !== 'admin') {
                if (leaveLType === 'comp') {
                    if (!userObj || userObj.compDays < duration) {
                        alert(`修改失敗：您的可補休天數不足 ${duration} 天（目前僅剩 ${userObj ? userObj.compDays : 0} 天）！`);
                        return;
                    }
                } else {
                    const currentCount = getLeaveCountForMonth(username, targetYear, targetMonth);
                    const userLimit = (userObj && userObj.leaveLimit !== undefined) ? userObj.leaveLimit : 2;
                    if (currentCount >= userLimit) {
                        alert(`修改失敗：您在本月 (${targetMonth + 1}月) 的一般排休額度已達上限 ${userLimit} 天！`);
                        return;
                    }
                }
            }
            
            // If admin is doing it, it's auto-approved
            if (currentUser.role === 'admin' && leaveLType === 'comp') {
                userObj.compDays -= duration;
            }
            
            const newLeave = {
                id: 'l_' + Math.random().toString(36).substr(2, 9),
                username: username,
                date: date,
                reason: reason,
                leaveType: leaveLType,
                duration: duration,
                status: currentUser.role === 'admin' ? 'approved' : 'pending'
            };
            dbData.leaves.push(newLeave);
            
            if (currentUser.role === 'admin') {
                dbData.shifts = dbData.shifts.filter(s => !(s.date === date && s.username === username));
                dbData.shifts.push({
                    id: 's_auto_' + Math.random().toString(36).substr(2, 9),
                    username: username,
                    date: date,
                    type: 'leave',
                    leaveType: leaveLType,
                    duration: duration
                });
            }
            
            saveData();
            closeModal(leaveRequestModal);
            renderCalendar(currentYear, currentMonth);
            renderNotificationCount();
            renderDashboard();
            renderMembers();
            alert(currentUser.role === 'admin' ? '排休修改成功！' : '排休已重新提交申請，等待主管審核！');
            return;
        } else {
            // Just updated reason, no date/type change
            if (isApprovedEdit) {
                const leave = dbData.leaves.find(l => l.date === oldDate && l.username === username);
                if (leave) {
                    leave.reason = reason;
                    saveData();
                }
            } else {
                const leave = dbData.leaves.find(l => l.id === recordId);
                if (leave) {
                    leave.reason = reason;
                    saveData();
                }
            }
            closeModal(leaveRequestModal);
            renderCalendar(currentYear, currentMonth);
            return;
        }
    }

    // Check limit for regular leave (creating new)
    if (leaveLType === 'regular') {
        const currentCount = getLeaveCountForMonth(username, targetYear, targetMonth);
        const alreadyRequested = dbData.leaves.some(l => l.date === date && l.username === username && (l.status === 'pending' || l.status === 'approved') && l.leaveType !== 'comp');
        
        if (alreadyRequested) {
            alert('該日期已申請過一般排休！');
            return;
        }
        
        const userLimit = (userObj && userObj.leaveLimit !== undefined) ? userObj.leaveLimit : 2;
        if (currentUser.role !== 'admin' && currentCount >= userLimit) {
            alert(`申請失敗：您在本月 (${targetMonth + 1}月) 的一般排休額度已達上限 ${userLimit} 天！`);
            return;
        }
    } else {
        // If it's a comp leave
        if (currentUser.role !== 'admin' && (!userObj || userObj.compDays < duration)) {
            alert(`申請失敗：您的可補休天數不足 ${duration} 天（目前僅剩 ${userObj ? userObj.compDays : 0} 天）！`);
            return;
        }
        
        const alreadyRequested = dbData.leaves.some(l => l.date === date && l.username === username && (l.status === 'pending' || l.status === 'approved'));
        if (alreadyRequested) {
            alert('該日期已申請過排休！');
            return;
        }
    }
    
    // If admin is submitting (which auto-approves), we deduct compDays immediately
    if (currentUser.role === 'admin' && leaveLType === 'comp') {
        userObj.compDays -= duration;
    }

    // Add leave request
    const newLeave = {
        id: 'l_' + Math.random().toString(36).substr(2, 9),
        username: username,
        date: date,
        reason: reason,
        leaveType: leaveLType,
        duration: duration,
        status: currentUser.role === 'admin' ? 'approved' : 'pending' // Admin auto-approved
    };
    
    dbData.leaves.push(newLeave);
    
    // If admin approved automatically, also create a shift leave
    if (currentUser.role === 'admin') {
        dbData.shifts = dbData.shifts.filter(s => !(s.date === date && s.username === username));
        dbData.shifts.push({
            id: 's_auto_' + Math.random().toString(36).substr(2, 9),
            username: username,
            date: date,
            type: 'leave',
            leaveType: leaveLType,
            duration: duration
        });
    }
    
    saveData();
    closeModal(leaveRequestModal);
    renderCalendar(currentYear, currentMonth);
    renderNotificationCount();
    renderDashboard();
    renderMembers(); // Re-render members grid to update compDays counts
    alert(currentUser.role === 'admin' ? '排休指派成功！' : '排休申請已送出，等待主管審核！');
});

// Leave Request cancel/delete
btnDeleteLeaveRequest.addEventListener('click', () => {
    const recordId = leaveRequestId.value;
    const isApprovedEdit = leaveRequestId.getAttribute('data-approved') === 'true';
    const username = currentUser.username;
    
    if (confirm('確定要取消此排休申請嗎？')) {
        const userObj = dbData.users.find(u => u.username === username);
        
        if (isApprovedEdit) {
            const oldShift = dbData.shifts.find(s => s.id === recordId);
            if (oldShift) {
                // If it was comp, restore the compDay
                if (oldShift.leaveType === 'comp') {
                    const duration = oldShift.duration !== undefined ? oldShift.duration : 1.0;
                    if (userObj) userObj.compDays += duration;
                }
                // Delete shift
                dbData.shifts = dbData.shifts.filter(s => s.id !== recordId);
                // Also delete matching approved leave request
                dbData.leaves = dbData.leaves.filter(l => !(l.date === oldShift.date && l.username === username));
            }
        } else {
            const oldLeave = dbData.leaves.find(l => l.id === recordId);
            if (oldLeave) {
                dbData.leaves = dbData.leaves.filter(l => l.id !== recordId);
            }
        }
        
        saveData();
        closeModal(leaveRequestModal);
        renderCalendar(currentYear, currentMonth);
        renderNotificationCount();
        renderDashboard();
        renderMembers();
        alert('排休申請已取消！');
    }
});

// Task modal submit (Admin only)
btnSaveTask.addEventListener('click', () => {
    const taskId = taskIdField.value;
    let area = taskArea.value;
    if (area === 'other') {
        area = taskAreaCustom.value.trim();
        if (!area) {
            alert('請輸入自訂打掃項目名稱。');
            return;
        }
    }
    const username = taskEmployee.value;
    const date = taskDate.value;
    
    if (!date || !username) {
        alert('請填寫完整正確的欄位資訊。');
        return;
    }
    
    // Check if employee is on leave on taskDate
    const isEmpOnLeave = dbData.shifts.some(s => s.username === username && s.date === date && s.type === 'leave');
    if (isEmpOnLeave) {
        const empName = dbData.users.find(u => u.username === username)?.name || username;
        alert(`無法指派打掃任務：員工「${empName}」在 ${date} 當天休假！`);
        return;
    }
    
    const isNew = !taskId;
    if (taskId) {
        // Edit existing
        const taskIndex = dbData.tasks.findIndex(t => t.id === taskId);
        if (taskIndex !== -1) {
            dbData.tasks[taskIndex].area = area;
            dbData.tasks[taskIndex].username = username;
            dbData.tasks[taskIndex].date = date;
            dbData.tasks[taskIndex].estHours = null;
        }
    } else {
        // Add new
        dbData.tasks.push({
            id: 't_' + Math.random().toString(36).substr(2, 9),
            area: area,
            username: username,
            date: date,
            estHours: null,
            actHours: null,
            status: 'pending'
        });
    }
    
    saveData();
    closeModal(taskModal);
    renderCleaningPage();
    renderDashboard();

    if (isNew) {
        const userObj = dbData.users.find(u => u.username === username);
        const employeeName = userObj ? userObj.name : username;
        const msg = `📢 【打掃任務指派】\n負責人：${employeeName}\n工作項目：${area}\n執行日期：${date}\n預估工時：${est.toFixed(1)} 小時\n*請於當天完成後登入系統回報實際時數。*`;
        sendLineNotification(msg);
    }
});

// Delete task (Admin only)
btnDeleteTask.addEventListener('click', () => {
    const taskId = taskIdField.value;
    if (taskId) {
        dbData.tasks = dbData.tasks.filter(t => t.id !== taskId);
        saveData();
        closeModal(taskModal);
        renderCleaningPage();
        renderDashboard();
    }
});



// Member details save (Admin only)
btnSaveMember.addEventListener('click', () => {
    const memberId = memberIdField.value;
    const name = memberName.value.trim();
    const username = memberUsername.value.trim().toLowerCase();
    const password = memberPassword.value;
    const role = memberRole.value;
    const position = memberPosition.value;
    const compDays = parseFloat(memberCompDays.value) || 0;
    const leaveLimit = parseInt(memberLeaveLimit.value) || 2;
    
    if (!name || !username || !password || isNaN(compDays) || compDays < 0 || isNaN(leaveLimit) || leaveLimit < 0) {
        alert('請填寫完整正確的員工欄位資料。');
        return;
    }
    
    if (memberId) {
        // Edit existing
        const user = dbData.users.find(u => u.username === memberId);
        if (user) {
            user.name = name;
            user.password = password;
            user.role = role;
            user.position = position;
            user.compDays = compDays;
            user.leaveLimit = leaveLimit;
        }
    } else {
        // Add new
        // Check if username already exists
        const exists = dbData.users.some(u => u.username === username);
        if (exists) {
            alert('此登入帳號已被註冊使用！請換一個。');
            return;
        }
        
        dbData.users.push({
            username: username,
            password: password,
            name: name,
            role: role,
            position: position,
            compDays: compDays,
            leaveLimit: leaveLimit
        });
    }
    
    saveData();
    closeModal(memberModal);
    renderMembers();
    populateEmployeeDropdowns();
});

// --- Compensatory Leave Duration Toggles ---
shiftLeaveType.addEventListener('change', () => {
    if (shiftLeaveType.value === 'comp') {
        shiftCompDurationGroup.style.display = 'block';
    } else {
        shiftCompDurationGroup.style.display = 'none';
    }
});

leaveRequestType.addEventListener('change', () => {
    if (leaveRequestType.value === 'comp') {
        leaveCompDurationGroup.style.display = 'block';
    } else {
        leaveCompDurationGroup.style.display = 'none';
    }
});

// --- Smart Task Assignment & Task Modal Custom Area Toggles ---
taskArea.addEventListener('change', () => {
    if (taskArea.value === 'other') {
        customTaskAreaContainer.style.display = 'block';
        taskAreaCustom.focus();
    } else {
        customTaskAreaContainer.style.display = 'none';
    }
});

taskDate.addEventListener('change', () => {
    updateTaskEmployeeDropdownForDate(taskDate.value);
});

function updateTaskEmployeeDropdownForDate(dateStr) {
    const currentValue = taskEmployee.value;
    taskEmployee.innerHTML = '';
    
    dbData.users.forEach(user => {
        if (user.username === 'admin') return; // Skip admin in task assignment dropdown
        const isOnLeave = dbData.shifts.some(s => s.username === user.username && s.date === dateStr && s.type === 'leave');
        const opt = document.createElement('option');
        opt.value = user.username;
        opt.textContent = isOnLeave ? `${user.name} (休假)` : user.name;
        taskEmployee.appendChild(opt);
    });
    
    if (currentValue && [...taskEmployee.options].some(o => o.value === currentValue)) {
        taskEmployee.value = currentValue;
    }
}

// Auto Assign Triggers & Logic
btnAutoAssignTasks.addEventListener('click', () => {
    const today = new Date();
    autoAssignDate.value = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    openModal(autoAssignModal);
});

btnExecuteAutoAssign.addEventListener('click', () => {
    const dateStr = autoAssignDate.value;
    const mode = parseInt(autoAssignMode.value) || 1;
    if (!dateStr) {
        alert('請選擇日期！');
        return;
    }
    executeAutoAssign(dateStr, mode);
});

btnClearAllTasks.addEventListener('click', () => {
    if (confirm('確定要清空系統中的所有打掃任務嗎？這將會清除所有歷史紀錄且無法還原！')) {
        dbData.tasks = [];
        saveData();
        renderCleaningPage();
        renderDashboard();
        alert('已成功清空所有打掃任務！');
    }
});

function executeAutoAssign(startDateStr, numDays) {
    let currentDate = new Date(startDateStr);
    let datesAssigned = [];
    let skippedDates = [];
    
    let combinedMsg = `📢 【⚡ 智慧打掃自動分配通知】\n`;
    if (numDays === 7) {
        combinedMsg += `📅 分配範圍：整週分配 (7 天)\n\n`;
    } else {
        combinedMsg += `📅 分配日期：${startDateStr}\n\n`;
    }
    
    for (let d = 0; d < numDays; d++) {
        const y = currentDate.getFullYear();
        const m = String(currentDate.getMonth() + 1).padStart(2, '0');
        const day = String(currentDate.getDate()).padStart(2, '0');
        const dateStr = `${y}-${m}-${day}`;
        
        const result = assignTasksForSingleDate(dateStr);
        if (result.success) {
            datesAssigned.push(dateStr);
            combinedMsg += `🧹 ${dateStr} 分配結果：\n`;
            Object.keys(result.tasksByArea).forEach(area => {
                let areaLabel = area;
                if (area === '處理好指定空間') {
                    areaLabel = '處理好指定空間 (後勤人員)';
                }
                combinedMsg += `- ${areaLabel}：${result.tasksByArea[area].join('、')}\n`;
            });
            combinedMsg += `\n`;
        } else {
            skippedDates.push({ date: dateStr, reason: result.reason });
        }
        
        currentDate.setDate(currentDate.getDate() + 1);
    }
    
    saveData();
    renderCleaningPage();
    renderDashboard();
    
    if (datesAssigned.length > 0) {
        combinedMsg += `*請於當天完成後登入系統點擊「完成」。*`;
        sendLineNotification(combinedMsg);
    }
    
    closeModal(autoAssignModal);
    
    let alertMsg = `已完成 ${datesAssigned.length} 天的打掃自動分配，並已發送 LINE 通知！`;
    if (skippedDates.length > 0) {
        alertMsg += `\n\n注意：以下日期已被跳過：\n` + skippedDates.map(sd => `- ${sd.date}: ${sd.reason}`).join('\n');
    }
    alert(alertMsg);
}

function assignTasksForSingleDate(dateStr) {
    // 1. Filter out employees on leave on dateStr
    const activeUsers = dbData.users.filter(u => {
        if (u.username === 'admin') return false; // Skip admin
        const isOnLeave = dbData.shifts.some(s => s.username === u.username && s.date === dateStr && s.type === 'leave');
        return !isOnLeave;
    });
    
    if (activeUsers.length === 0) {
        return { success: false, reason: '當天沒有上班的員工，無法分配打掃。' };
    }
    
    // 2. Clear existing tasks for this date
    dbData.tasks = dbData.tasks.filter(t => t.date !== dateStr);
    
    // 3. Group employees
    const groupA = activeUsers.filter(u => ['master', 'semi', 'apprentice'].includes(u.position));
    const groupB = activeUsers.filter(u => !['master', 'semi', 'apprentice'].includes(u.position));
    
    // 4. Distribute Group A tasks: floor, potion, smoke, tools (with tools having the minimum workforce)
    const groupATasks = ['室內地板環境整理', '藥水補充', '室外吸煙區整理', '工具歸位整理'];
    const N = groupA.length;
    
    if (N > 0) {
        // 1. Count occurrences of each task in history (dbData.tasks)
        const taskCounts = {};
        groupATasks.forEach(area => {
            taskCounts[area] = 0;
        });
        dbData.tasks.forEach(t => {
            if (groupATasks.includes(t.area)) {
                taskCounts[t.area] = (taskCounts[t.area] || 0) + 1;
            }
        });
        
        // 2. Sort tasks by historical counts (with small noise for random tie-breaking)
        const sortedTasks = [...groupATasks].sort((a, b) => {
            const countA = taskCounts[a] + Math.random() * 0.01;
            const countB = taskCounts[b] + Math.random() * 0.01;
            return countA - countB;
        });
        
        // 3. Determine counts per task to distribute N people as evenly as possible (max diff of 1)
        const base = Math.floor(N / 4);
        const extra = N % 4;
        const counts = {};
        sortedTasks.forEach((area, idx) => {
            counts[area] = base + (idx < extra ? 1 : 0);
        });
        
        // Define penalty scoring helper for rotation and long-term balance
        function getPenalty(username, area) {
            let lastDate = "";
            let historyCount = 0;
            dbData.tasks.forEach(t => {
                if (t.username === username && t.area === area) {
                    historyCount++;
                    if (!lastDate || t.date > lastDate) {
                        lastDate = t.date;
                    }
                }
            });
            
            const noise = Math.random() * 0.0001; // tie-breaker to randomize equal histories
            
            let recencyScore = 0;
            if (lastDate) {
                const d1 = new Date(dateStr);
                const d2 = new Date(lastDate);
                const diffTime = Math.abs(d1 - d2);
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                recencyScore = diffDays > 0 ? (10 / diffDays) : 20.0;
            }
            
            // Prioritize lowest total count (historyCount * 100), using recency score to handle rotation
            return (historyCount * 100) + recencyScore + noise;
        }

        // Find optimal 1-to-1 assignment of users to required tasks using backtracking
        function findOptimalAssignment(users, tasks) {
            let bestAssignment = null;
            let minPenalty = Infinity;
            
            function permute(userIndex, currentAssignment, currentPenalty) {
                if (currentPenalty >= minPenalty) return; // Prune
                
                if (userIndex === users.length) {
                    minPenalty = currentPenalty;
                    bestAssignment = [...currentAssignment];
                    return;
                }
                
                const username = users[userIndex].username;
                const tried = new Set();
                
                for (let i = 0; i < tasks.length; i++) {
                    if (tasks[i] === null) continue;
                    
                    const taskArea = tasks[i];
                    if (tried.has(taskArea)) continue; // Optimization: avoid duplicate task structures
                    tried.add(taskArea);
                    
                    const penalty = getPenalty(username, taskArea);
                    
                    tasks[i] = null; // Assign
                    currentAssignment.push({ username, area: taskArea });
                    
                    permute(userIndex + 1, currentAssignment, currentPenalty + penalty);
                    
                    currentAssignment.pop(); // Revert
                    tasks[i] = taskArea;
                }
            }
            
            permute(0, [], 0);
            return bestAssignment;
        }

        // Build the flat array of required tasks based on the calculated counts
        const requiredTasks = [];
        sortedTasks.forEach(area => {
            const numPeople = counts[area];
            for (let i = 0; i < numPeople; i++) {
                requiredTasks.push(area);
            }
        });

        // Distribute Group A tasks using optimal rotation assignment
        const optimalAssignments = findOptimalAssignment(groupA, requiredTasks);
        if (optimalAssignments) {
            optimalAssignments.forEach(assign => {
                dbData.tasks.push({
                    id: 't_' + Math.random().toString(36).substr(2, 9),
                    area: assign.area,
                    username: assign.username,
                    date: dateStr,
                    estHours: null,
                    actHours: null,
                    status: 'pending'
                });
            });
        }
    }
    
    // 5. Distribute Group B tasks: 處理好指定空間 (後勤/行政/汽美)
    groupB.forEach(user => {
        dbData.tasks.push({
            id: 't_' + Math.random().toString(36).substr(2, 9),
            area: '處理好指定空間',
            username: user.username,
            date: dateStr,
            estHours: null,
            actHours: null,
            status: 'pending'
        });
    });
    
    // 6. Gather assignments for reporting
    const dayTasks = dbData.tasks.filter(t => t.date === dateStr);
    const tasksByArea = {};
    dayTasks.forEach(t => {
        if (!tasksByArea[t.area]) {
            tasksByArea[t.area] = [];
        }
        const userObj = dbData.users.find(u => u.username === t.username);
        const name = userObj ? userObj.name : t.username;
        tasksByArea[t.area].push(name);
    });
    
    return { success: true, tasksByArea };
}



// Global callbacks window mapping for dynamic elements rendering inside HTML strings
window.completeTaskDirectly = completeTaskDirectly;
window.openEditTaskModal = openEditTaskModal;
window.openEditMemberModal = openEditMemberModal;
window.deleteMember = deleteMember;
window.approveLeave = approveLeave;
window.openEditEventModal = openEditEventModal;

async function handleUrlSyncKey() {
    const urlParams = new URLSearchParams(window.location.search);
    const urlSyncKey = urlParams.get('sync_key');
    if (urlSyncKey && urlSyncKey.startsWith('s_')) {
        if (dbData.syncSettings && dbData.syncSettings.enabled && dbData.syncSettings.syncKey === urlSyncKey) {
            // Clean URL parameter
            const newUrl = window.location.protocol + "//" + window.location.host + window.location.pathname;
            window.history.replaceState({ path: newUrl }, '', newUrl);
            return;
        }
        
        try {
            console.log(`URL parameter sync_key detected: ${urlSyncKey}. Attempting to fetch cloud data...`);
            
            // Set a timeout of 5 seconds for the fetch
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);
            
            const response = await fetch(`https://kvdb.io/4jVV8b8bbLkHjBX9jQNbAP/${urlSyncKey}`, {
                method: 'GET',
                mode: 'cors',
                signal: controller.signal
            });
            clearTimeout(timeoutId);
            
            if (response.ok) {
                const remoteData = await response.json();
                if (remoteData && remoteData.users && remoteData.shifts && remoteData.leaves && remoteData.tasks) {
                    dbData = remoteData;
                    dbData.syncSettings = {
                        enabled: true,
                        syncKey: urlSyncKey
                    };
                    saveData(false); // save locally
                    console.log("Database initialized from URL sync_key successfully.");
                    
                    // Clean URL parameter so it doesn't prompt or reload again
                    const newUrl = window.location.protocol + "//" + window.location.host + window.location.pathname;
                    window.history.replaceState({ path: newUrl }, '', newUrl);
                    
                    alert('已成功透過一鍵同步連結，連結並同步雲端排班資料庫！');
                } else {
                    console.warn("Fetched cloud database is invalid or empty.");
                }
            } else {
                console.warn("URL sync_key invalid or no remote database found.");
            }
        } catch (error) {
            console.error("Failed to sync from URL sync_key:", error);
            alert('自動同步失敗，請確認網路連線或金鑰是否正確。');
        }
    }
}

// Load App on Script load
async function initApp() {
    loadData();
    await handleUrlSyncKey();
    await fetchAndSyncDatabase();
    checkSession();
}
initApp();
