/**
 * 열린소통 익명신문고 Core Script
 * - SPA HashRouter 기반 단독 페이지 전환
 * - DC 커뮤니티 + 공공기관 신문고 하이브리드 인터페이스
 */

const STORAGE_KEY = 'gov_complaint_board_data_v3';
const ADMIN_SESSION_KEY = 'gov_complaint_board_admin_session';
const USER_SESSION_KEY = 'gov_complaint_board_user_session';
const USER_ACCOUNTS_KEY = 'gov_complaint_board_user_accounts';

// State
let posts = [];
let isAdmin = false;
let currentUser = null; // { id: string, name: string } | null
let unlockedPostIds = new Set(); // Session cache for unlocked secret posts

/**
 * SHA-256 단방향 암호화 (Web Crypto API)
 */
async function hashPassword(plainText) {
  if (!plainText) return '';
  const encoder = new TextEncoder();
  const data = encoder.encode(plainText);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * 비밀번호 유효성 검증
 * - 최소 4자리 ~ 최대 8자리
 * - 공백 및 특수문자 입력 불가, 영문(대소문자) 및 숫자만 허용
 */
function validatePassword(pw, isOptional = false) {
  if (isOptional && !pw) return { valid: true };
  if (!pw) {
    return { valid: false, message: '비밀번호를 입력해 주세요.' };
  }
  if (pw.length < 4 || pw.length > 8) {
    return { valid: false, message: '비밀번호는 최소 4자리에서 최대 8자리까지 가능합니다.' };
  }
  if (!/^[a-zA-Z0-9]+$/.test(pw)) {
    return { valid: false, message: '비밀번호는 공백이나 특수문자 없이 영문과 숫자만 입력할 수 있습니다.' };
  }
  return { valid: true };
}

/**
 * 비밀번호 입력 실시간 정제 (영문 대소문자 및 숫자 이외 문자 자동 제거, 최대 8자리 제한)
 */
function attachPasswordInputSanitizer(inputId) {
  const el = document.getElementById(inputId);
  if (!el) return;
  el.addEventListener('input', () => {
    const clean = el.value.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8);
    if (el.value !== clean) {
      el.value = clean;
    }
  });
}

/**
 * ========================================================
 * 회원 계정 저장소 (localStorage 기반)
 * - accounts: [{ id, passwordHash, nickname }]
 * ========================================================
 */
function loadUserAccounts() {
  try {
    return JSON.parse(localStorage.getItem(USER_ACCOUNTS_KEY)) || [];
  } catch {
    return [];
  }
}

function saveUserAccounts(accounts) {
  localStorage.setItem(USER_ACCOUNTS_KEY, JSON.stringify(accounts));
}

async function registerUser(id, password, nickname) {
  const accounts = loadUserAccounts();
  if (accounts.find(a => a.id === id)) {
    return { success: false, message: '이미 사용 중인 아이디입니다.' };
  }
  const val = validatePassword(password);
  if (!val.valid) {
    return { success: false, message: val.message };
  }
  if (!nickname || nickname.trim().length === 0) {
    return { success: false, message: '닉네임을 입력해 주세요.' };
  }
  const passwordHash = await hashPassword(password);
  accounts.push({ id, passwordHash, nickname: nickname.trim() });
  saveUserAccounts(accounts);
  return { success: true, user: { id, name: nickname.trim() } };
}

async function loginUser(id, password) {
  const accounts = loadUserAccounts();
  const account = accounts.find(a => a.id === id);
  if (!account) {
    return { success: false, message: '존재하지 않는 아이디입니다. 회원가입을 먼저 진행해 주세요.' };
  }
  const inputHash = await hashPassword(password);
  if (inputHash !== account.passwordHash) {
    return { success: false, message: '비밀번호가 일치하지 않습니다.' };
  }
  return { success: true, user: { id: account.id, name: account.nickname } };
}

/**
 * 회원 메뉴 드롭다운 열기/닫기
 */
function toggleUserMenu(forceState) {
  const panel = document.getElementById('user-menu-panel');
  if (!panel) return;
  const isOpening = forceState !== undefined ? forceState : (panel.style.display === 'none');
  panel.style.display = isOpening ? 'block' : 'none';
}

function closeUserMenu() {
  toggleUserMenu(false);
}

/**
 * 전체 카테고리 드롭다운 패널 열기/닫기
 */
function toggleCategoryDropdown(forceState) {
  const panel = document.getElementById('category-dropdown-panel');
  const btn = document.getElementById('gnb-toggle-all');
  if (!panel || !btn) return;
  const isOpening = forceState !== undefined ? forceState : (panel.style.display === 'none');
  panel.style.display = isOpening ? 'block' : 'none';
  btn.classList.toggle('active-dropdown', isOpening);
  btn.setAttribute('aria-expanded', isOpening ? 'true' : 'false');
}

/**
 * ========================================================
 * 카테고리 및 필터 전용 컨트롤러 클래스 (CategoryController)
 * - 전체보기, 카테고리별 조회, 익명글/비밀글/답변완료 필터 제어
 * ========================================================
 */
class CategoryController {
  /**
   * [전체보기] 모든 민원 목록 초기화 및 전체 조회
   */
  static viewAll() {
    toggleCategoryDropdown(false);
    const filterCat = document.getElementById('filter-category');
    const filterStatus = document.getElementById('filter-status');
    const filterAnon = document.getElementById('filter-anon-only');
    const filterSecret = document.getElementById('filter-secret-only');
    const searchInput = document.getElementById('board-search-input');

    if (filterCat) filterCat.value = 'all';
    if (filterStatus) filterStatus.value = 'all';
    if (filterAnon) filterAnon.checked = false;
    if (filterSecret) filterSecret.checked = false;
    if (searchInput) searchInput.value = '';

    highlightGnb('all');

    if (window.location.hash !== '#/list' && window.location.hash !== '' && window.location.hash !== '#/') {
      window.location.hash = '#/list';
    } else {
      renderListView();
    }
    showToast('전체보기: 등록된 모든 민원 목록을 불러왔습니다.');
  }

  /**
   * [카테고리 선택] 특정 카테고리 민원 조회 (1. 시설/환경, 2. 건의사항 등)
   */
  static selectCategory(categoryName) {
    toggleCategoryDropdown(false);
    const filterCat = document.getElementById('filter-category');
    const filterAnon = document.getElementById('filter-anon-only');
    const filterSecret = document.getElementById('filter-secret-only');

    if (filterCat) filterCat.value = categoryName;
    if (filterAnon) filterAnon.checked = false;
    if (filterSecret) filterSecret.checked = false;

    highlightGnb(categoryName);

    const targetHash = `#/list?cat=${encodeURIComponent(categoryName)}`;
    if (window.location.hash === targetHash) {
      renderListView();
    } else {
      window.location.hash = targetHash;
    }
    showToast(`'${categoryName}' 카테고리 민원을 조회합니다.`);
  }

  /**
   * [익명글 필터] 익명으로 등록된 민원만 조회
   */
  static viewAnonymous() {
    toggleCategoryDropdown(false);
    const filterCat = document.getElementById('filter-category');
    const filterAnon = document.getElementById('filter-anon-only');
    const filterSecret = document.getElementById('filter-secret-only');

    if (filterCat) filterCat.value = 'all';
    if (filterAnon) filterAnon.checked = true;
    if (filterSecret) filterSecret.checked = false;

    highlightGnb('all');

    const targetHash = '#/list?filter=anon';
    if (window.location.hash === targetHash) {
      renderListView();
    } else {
      window.location.hash = targetHash;
    }
    showToast('익명글: 신원이 보호된 익명 민원만 조회합니다.');
  }

  /**
   * [비밀글 필터] 비밀번호로 잠긴 비공개 민원만 조회
   */
  static viewSecret() {
    toggleCategoryDropdown(false);
    const filterCat = document.getElementById('filter-category');
    const filterAnon = document.getElementById('filter-anon-only');
    const filterSecret = document.getElementById('filter-secret-only');

    if (filterCat) filterCat.value = 'all';
    if (filterAnon) filterAnon.checked = false;
    if (filterSecret) filterSecret.checked = true;

    highlightGnb('all');

    const targetHash = '#/list?filter=secret';
    if (window.location.hash === targetHash) {
      renderListView();
    } else {
      window.location.hash = targetHash;
    }
    showToast('비밀글: 비밀(비공개) 민원 목록을 조회합니다.');
  }

  /**
   * [답변완료 필터] 교육청/관리자 답변이 완료된 민원만 조회
   */
  static viewResolved() {
    toggleCategoryDropdown(false);
    const filterCat = document.getElementById('filter-category');
    const filterStatus = document.getElementById('filter-status');
    const filterAnon = document.getElementById('filter-anon-only');
    const filterSecret = document.getElementById('filter-secret-only');

    if (filterCat) filterCat.value = 'all';
    if (filterStatus) filterStatus.value = 'resolved';
    if (filterAnon) filterAnon.checked = false;
    if (filterSecret) filterSecret.checked = false;

    highlightGnb('all');

    const targetHash = '#/list?filter=resolved';
    if (window.location.hash === targetHash) {
      renderListView();
    } else {
      window.location.hash = targetHash;
    }
    showToast('답변완료: 처리가 완료된 민원 목록을 조회합니다.');
  }
}

// 전역 스코프 바인딩 (인라인 호출 및 기존 함수 호환)
window.CategoryController = CategoryController;
window.closeUserMenu = closeUserMenu;
function selectCategoryFromMenu(cat) {
  if (cat === 'all') CategoryController.viewAll();
  else CategoryController.selectCategory(cat);
}
function applyQuickFilter(type) {
  if (type === 'all') CategoryController.viewAll();
  else if (type === 'anon') CategoryController.viewAnonymous();
  else if (type === 'secret') CategoryController.viewSecret();
  else if (type === 'resolved') CategoryController.viewResolved();
}

/**
 * 날짜 포맷팅 (YYYY-MM-DD 또는 YYYY-MM-DD HH:mm)
 */
function formatDate(isoString, includeTime = false) {
  if (!isoString) return '-';
  const d = new Date(isoString);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  if (!includeTime) {
    return `${month}.${day}`; // DC 커뮤니티 리스트형 날짜 (MM.DD)
  }
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  return `${year}.${month}.${day} ${hours}:${minutes}`;
}

/**
 * 오늘 등록된 글인지 확인
 */
function isToday(isoString) {
  if (!isoString) return false;
  const d = new Date(isoString);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() &&
         d.getMonth() === now.getMonth() &&
         d.getDate() === now.getDate();
}

/**
 * 토스트 알림 표시
 */
function showToast(message, isError = false) {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = 'toast';
  if (isError) {
    toast.style.backgroundColor = '#dc2626';
  }
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(8px)';
    toast.style.transition = 'all 0.25s ease';
    setTimeout(() => toast.remove(), 250);
  }, 3000);
}

/**
 * HTML 이스케이프 (XSS 방어)
 */
function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * 카테고리 정규화 헬퍼 (번호순 임시 카테고리 매핑 및 호환성 유지)
 */
function normalizeCategory(cat) {
  if (!cat) return '1. 시설/환경';
  if (cat.includes('시설') || cat.includes('환경')) return '1. 시설/환경';
  if (cat.includes('건의')) return '2. 건의사항';
  if (cat.includes('서비스')) return '3. 서비스 불만';
  if (cat.includes('기타') || cat.includes('상담')) return '4. 기타';
  return cat;
}

/**
 * 초기 교육청/공공기관 샘플 데이터 시딩 (비밀번호: 1234)
 */
async function initDefaultData() {
  const defaultPwHash = await hashPassword('1234');
  const now = Date.now();

  const samplePosts = [
    {
      id: 'post-201',
      title: '초등학교 정문 앞 횡단보도 옐로카펫 재도색 및 과속단속 카메라 설치 요청',
      content: '등하교 시간에 차량 과속 및 불법 주정차로 인해 어린이 시야 확보가 어렵습니다. 안전을 위해 옐로카펫 재도색과 이동식 단속을 건의합니다.',
      category: '1. 시설/환경',
      authorName: '익명',
      isAnonymous: true,
      isSecret: false,
      passwordHash: defaultPwHash,
      status: 'processing',
      adminReply: null,
      createdAt: new Date(now - 1000 * 60 * 45).toISOString(), // 45분 전 (오늘)
      updatedAt: null
    },
    {
      id: 'post-202',
      title: '구내식당 및 조리실 위생 상태 불시 점검 건의',
      content: '기온이 올라가면서 식재료 보관 및 급식 배식 과정에서 위생 관리가 더욱 철저히 이루어졌으면 좋겠습니다.',
      category: '2. 건의사항',
      authorName: '박서현',
      isAnonymous: false,
      isSecret: false,
      passwordHash: defaultPwHash,
      status: 'pending',
      adminReply: null,
      createdAt: new Date(now - 1000 * 60 * 180).toISOString(), // 3시간 전 (오늘)
      updatedAt: null
    },
    {
      id: 'post-203',
      title: '부서 내 부당 업무 지시 및 인사 고충 관련 비밀 상담 요청',
      content: '직장 내 괴롭힘 및 부당한 업무 지시와 관련하여 보호받을 수 있는 비공개 채널을 통해 고충 상담 및 감사를 요청드립니다.',
      category: '3. 서비스 불만',
      authorName: '익명',
      isAnonymous: true,
      isSecret: true,
      passwordHash: defaultPwHash,
      status: 'resolved',
      adminReply: {
        content: '접수해 주신 고충 사항은 감사관실에서 신속히 접수하였습니다. 제보자의 신원은 철저히 비밀 보장되며, 1:1 안전 채널을 통해 사실관계 조사 및 상담 조치가 진행될 예정입니다.',
        answeredAt: new Date(now - 1000 * 60 * 30).toISOString(),
        adminName: '시교육청 감사관실'
      },
      createdAt: new Date(now - 1000 * 60 * 60 * 24).toISOString(), // 어제
      updatedAt: null
    },
    {
      id: 'post-204',
      title: '방과후 늘봄교실 프로그램 다양화 및 강사 배치 문의',
      content: '2학기 늘봄교실 강좌 수강신청 관련하여 공지된 일정과 프로그램 세부 목록을 어디서 확인할 수 있는지 문의드립니다.',
      category: '4. 기타',
      authorName: '익명',
      isAnonymous: true,
      isSecret: true,
      passwordHash: defaultPwHash,
      status: 'pending',
      adminReply: null,
      createdAt: new Date(now - 1000 * 60 * 60 * 28).toISOString(),
      updatedAt: null
    }
  ];

  localStorage.setItem(STORAGE_KEY, JSON.stringify(samplePosts));
  return samplePosts;
}

/**
 * 데이터 로드 & 저장
 */
async function loadPosts() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) {
    posts = await initDefaultData();
  } else {
    try {
      posts = JSON.parse(saved);
      // 기존 저장 데이터의 카테고리를 새 번호순 카테고리로 정규화
      posts.forEach(post => {
        post.category = normalizeCategory(post.category);
      });
    } catch (e) {
      console.error(e);
      posts = await initDefaultData();
    }
  }
}

function savePosts() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(posts));
  updateGnbCounters();
}

/**
 * GNB 상단 통계 카운터 갱신 (DC풍 오늘 등록 / 전체 등록 수)
 */
function updateGnbCounters() {
  const todayCount = posts.filter(p => isToday(p.createdAt)).length;
  const totalCount = posts.length;

  const todayEl = document.getElementById('gnb-today-count');
  const totalEl = document.getElementById('gnb-total-count');
  if (todayEl) todayEl.textContent = todayCount;
  if (totalEl) totalEl.textContent = totalCount;
}

/**
 * 관리자 세션 체크
 */
function checkAdminSession() {
  isAdmin = sessionStorage.getItem(ADMIN_SESSION_KEY) === 'true';
  const badge = document.getElementById('top-admin-badge');
  const loginLink = document.getElementById('btn-admin-link');
  const logoutBtn = document.getElementById('btn-admin-logout');

  if (isAdmin) {
    if (badge) badge.style.display = 'inline-flex';
    if (loginLink) loginLink.style.display = 'none';
    if (logoutBtn) logoutBtn.style.display = 'inline-block';
  } else {
    if (badge) badge.style.display = 'none';
    if (loginLink) loginLink.style.display = 'inline-block';
    if (logoutBtn) logoutBtn.style.display = 'none';
  }
}

/**
 * 회원 세션 체크 및 상단 UI 업데이트
 */
function checkUserSession() {
  const session = sessionStorage.getItem(USER_SESSION_KEY);
  if (session) {
    try {
      currentUser = JSON.parse(session);
    } catch {
      currentUser = null;
    }
  } else {
    currentUser = null;
  }

  const loginLink = document.getElementById('btn-user-link');
  const userMenuBtn = document.getElementById('btn-user-menu-toggle');
  const userIdSpan = document.getElementById('top-user-id');

  if (currentUser) {
    if (loginLink) loginLink.style.display = 'none';
    if (userMenuBtn) userMenuBtn.style.display = 'inline-flex';
    if (userIdSpan) userIdSpan.textContent = currentUser.id;
  } else {
    if (loginLink) loginLink.style.display = 'inline-flex';
    if (userMenuBtn) userMenuBtn.style.display = 'none';
  }
}

/**
 * 상태 배지 렌더링
 */
function getStatusChip(status) {
  switch (status) {
    case 'resolved':
      return '<span class="status-chip resolved">답변완료</span>';
    case 'processing':
      return '<span class="status-chip processing">처리중</span>';
    case 'pending':
    default:
      return '<span class="status-chip pending">접수대기</span>';
  }
}

/**
 * ========================================================
 * SPA 라우터 (HashRouter)
 * URL 형태:
 * - #/ or #/list : 목록 페이지
 * - #/new : 새 민원 작성 페이지 (팝업 없는 사이트 내부 페이지)
 * - #/detail?id=... : 민원 상세 페이지
 * - #/edit?id=... : 민원 수정 페이지
 * - #/admin/login : 관리자 로그인 페이지 (아이디/비번 빈공란)
 * - #/verify?id=...&action=... : 본인 인증 페이지
 * ========================================================
 */
function router() {
  const hash = window.location.hash || '#/list';
  const [routePath, queryString] = hash.split('?');
  const params = new URLSearchParams(queryString || '');

  // 모든 뷰 숨김
  document.querySelectorAll('.page-view').forEach(view => view.classList.remove('active'));
  document.querySelectorAll('.dc-gnb-item').forEach(item => item.classList.remove('active'));

  window.scrollTo({ top: 0, behavior: 'smooth' });

  if (routePath === '#/new') {
    // [페이지 2] 새 민원 작성 페이지
    document.getElementById('view-new').classList.add('active');
    initNewPostView();
  } else if (routePath === '#/detail') {
    // [페이지 3] 민원 상세 페이지
    const id = params.get('id');
    document.getElementById('view-detail').classList.add('active');
    initDetailView(id);
  } else if (routePath === '#/edit') {
    // [페이지 4] 민원 수정 페이지
    const id = params.get('id');
    document.getElementById('view-edit').classList.add('active');
    initEditView(id);
  } else if (routePath === '#/admin/login') {
    // [페이지 5] 관리자 로그인 페이지
    document.getElementById('view-login').classList.add('active');
    initAdminLoginView(); // 빈공란으로 초기화!
  } else if (routePath === '#/user/login') {
    // [페이지 7] 회원 로그인 페이지
    document.getElementById('view-user-login').classList.add('active');
    initUserLoginView();
  } else if (routePath === '#/user/menu') {
    // [페이지 8] 회원 메뉴 및 정보 설정 페이지
    if (!currentUser) {
      showToast('로그인이 필요한 서비스입니다.', true);
      location.hash = '#/user/login';
      return;
    }
    document.getElementById('view-user-menu').classList.add('active');
    initUserMenuView();
  } else if (routePath === '#/verify') {
    // [페이지 6] 비밀번호 확인 페이지
    const id = params.get('id');
    const action = params.get('action');
    document.getElementById('view-verify').classList.add('active');
    initVerifyView(id, action);
  } else {
    // [페이지 1] 목록 페이지 (#/ 또는 #/list)
    document.getElementById('view-list').classList.add('active');

    // 카테고리 쿼리 파라미터 처리
    const cat = params.get('cat');
    if (cat) {
      document.getElementById('filter-category').value = cat;
      highlightGnb(cat);
    } else {
      document.getElementById('filter-category').value = 'all';
      highlightGnb('all');
    }

    const filter = params.get('filter');
    if (filter === 'anon') {
      document.getElementById('filter-anon-only').checked = true;
      document.getElementById('filter-secret-only').checked = false;
    } else if (filter === 'secret') {
      document.getElementById('filter-secret-only').checked = true;
      document.getElementById('filter-anon-only').checked = false;
    } else if (filter === 'resolved') {
      document.getElementById('filter-status').value = 'resolved';
    }

    renderListView();
  }
}

/**
 * GNB 탭 활성화 헬퍼
 */
function highlightGnb(cat) {
  document.querySelectorAll('.dc-gnb-item').forEach(item => item.classList.remove('active'));
  const gnbAllBtn = document.getElementById('gnb-toggle-all');

  if (!cat || cat === 'all') {
    if (gnbAllBtn) gnbAllBtn.classList.add('active');
    return;
  }
  if (cat.includes('시설') || cat.includes('환경')) {
    const el = document.getElementById('gnb-cat-1');
    if (el) el.classList.add('active');
  } else if (cat.includes('건의')) {
    const el = document.getElementById('gnb-cat-2');
    if (el) el.classList.add('active');
  } else if (cat.includes('서비스')) {
    const el = document.getElementById('gnb-cat-3');
    if (el) el.classList.add('active');
  } else if (cat.includes('기타')) {
    const el = document.getElementById('gnb-cat-4');
    if (el) el.classList.add('active');
  } else {
    if (gnbAllBtn) gnbAllBtn.classList.add('active');
  }
}

/**
 * ========================================================
 * 1. 민원 목록 뷰 렌더링
 * ========================================================
 */
function renderListView() {
  const categoryFilter = document.getElementById('filter-category').value;
  const statusFilter = document.getElementById('filter-status').value;
  const anonOnly = document.getElementById('filter-anon-only').checked;
  const secretOnly = document.getElementById('filter-secret-only').checked;
  const searchWord = document.getElementById('board-search-input').value.trim().toLowerCase();

  // 사용자 요청: 체크박스 레이블 스타일 토글
  document.getElementById('label-filter-anon').classList.toggle('active', anonOnly);
  document.getElementById('label-filter-secret').classList.toggle('active', secretOnly);

  const filtered = posts.filter(post => {
    if (categoryFilter !== 'all' && post.category !== categoryFilter) return false;
    if (statusFilter !== 'all' && post.status !== statusFilter) return false;
    if (anonOnly && !post.isAnonymous) return false;
    if (secretOnly && !post.isSecret) return false;

    if (searchWord) {
      const isUnlocked = !post.isSecret || isAdmin || unlockedPostIds.has(post.id);
      const titleMatch = post.title.toLowerCase().includes(searchWord);
      const contentMatch = isUnlocked && post.content.toLowerCase().includes(searchWord);
      if (!titleMatch && !contentMatch) return false;
    }
    return true;
  });

  const listCountEl = document.getElementById('list-count-text');
  if (listCountEl) listCountEl.textContent = filtered.length;

  const tbody = document.getElementById('board-tbody');
  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" style="padding: 3rem 1rem; color: #6b7280; text-align: center;">
          <div style="font-size: 1.8rem; margin-bottom: 0.4rem;">📭</div>
          등록된 민원 내역이 없습니다.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = filtered.map((post, idx) => {
    const isSecretLocked = post.isSecret && !isAdmin && !unlockedPostIds.has(post.id);
    const displayTitle = isSecretLocked ? '🔒 비밀글입니다.' : escapeHtml(post.title);
    const rowNumber = filtered.length - idx;

    return `
      <tr class="board-row" onclick="location.hash='#/detail?id=${post.id}'">
        <td>${rowNumber}</td>
        <td><span class="tag-badge tag-cat">${escapeHtml(post.category)}</span></td>
        <td class="col-title">
          <div class="board-post-title">
            ${post.isSecret ? '<span class="tag-badge tag-secret">비밀</span>' : ''}
            ${post.isAnonymous ? '<span class="tag-badge tag-anon">익명</span>' : ''}
            <span>${displayTitle}</span>
            ${post.adminReply ? '<span class="tag-resolved-mark">[답변완료]</span>' : ''}
          </div>
        </td>
        <td>${escapeHtml(post.authorName)}</td>
        <td>${formatDate(post.createdAt)}</td>
        <td>${getStatusChip(post.status)}</td>
      </tr>
    `;
  }).join('');
}

/**
 * 퀵 필터 버튼 동작 헬퍼 (CategoryController로 위임)
 */
function applyQuickFilter(type) {
  document.querySelectorAll('.cat-pill').forEach(btn => btn.classList.remove('active'));
  if (type === 'all') CategoryController.viewAll();
  else if (type === 'anon') CategoryController.viewAnonymous();
  else if (type === 'secret') CategoryController.viewSecret();
  else if (type === 'resolved') CategoryController.viewResolved();
}

/**
 * ========================================================
 * 2. 새 민원 작성 뷰 초기화 (#/new)
 * ========================================================
 */
function initNewPostView() {
  document.getElementById('form-create-post').reset();
  document.getElementById('create-category').value = '1. 시설/환경';

  const isMember = currentUser !== null;
  const anonCheck = document.getElementById('create-is-anonymous');
  const authorRow = document.getElementById('row-create-author');
  const authorInput = document.getElementById('create-author');
  const hintText = document.getElementById('author-hint-text');
  const anonLabel = document.getElementById('label-create-is-anonymous');
  const nonMemberBadge = document.getElementById('badge-nonmember-fixed-anon');
  const noticeBox = document.getElementById('new-post-notice-box');

  if (!isMember) {
    // [비회원 상태]: 익명 고정, '작성자 이름' 칸은 지워주고, 비밀번호는 남김
    if (authorRow) authorRow.style.display = 'none';
    if (anonLabel) anonLabel.style.display = 'none';
    if (nonMemberBadge) nonMemberBadge.style.display = 'block';

    anonCheck.checked = true;
    authorInput.value = '익명';
    authorInput.disabled = true;

    if (noticeBox) {
      noticeBox.innerHTML = `
        <strong>🔒 비회원 익명 작성 안내:</strong> 회원으로 로그인하지 않은 경우 신원 보호를 위해 작성자 이름 없이 <strong>'익명'</strong>으로 고정 등록됩니다.
        입력하시는 <strong>비밀번호(영문/숫자 4~8자리)</strong>는 글 수정/삭제 및 비밀글 확인을 위한 본인확인용이므로 반드시 기억해 주세요.
        (실명/닉네임으로 작성하시려면 상단 <strong>[회원 로그인]</strong>을 이용해 주세요.)
      `;
    }
  } else {
    // [회원 로그인 상태]: '작성자 이름' 칸 표시 및 실명/익명 선택 가능
    if (authorRow) authorRow.style.display = 'table-row';
    if (anonLabel) anonLabel.style.display = 'flex';
    if (nonMemberBadge) nonMemberBadge.style.display = 'none';

    anonCheck.checked = false;
    authorInput.disabled = false;
    authorInput.value = currentUser.name || '회원';
    if (hintText) hintText.textContent = `'${currentUser.name}' 회원명으로 등록됩니다. (익명 체크 시 익명으로 전환)`;

    if (noticeBox) {
      noticeBox.innerHTML = `
        <strong>👤 회원 작성 안내:</strong> <strong>${escapeHtml(currentUser.name)}</strong> 회원님으로 로그인 중입니다.
        작성자 실명/닉네임 또는 [익명으로 작성하기]를 선택하여 민원을 자유롭게 접수하실 수 있습니다.
      `;
    }
  }
}

/**
 * ========================================================
 * 3. 민원 상세 뷰 초기화 (#/detail?id=...)
 * ========================================================
 */
function initDetailView(postId) {
  const post = posts.find(p => p.id === postId);
  if (!post) {
    showToast('존재하지 않거나 삭제된 게시글입니다.', true);
    location.hash = '#/list';
    return;
  }

  const isUnlocked = !post.isSecret || isAdmin || unlockedPostIds.has(post.id);

  document.getElementById('detail-category-badge').textContent = post.category;
  document.getElementById('detail-status-badge').innerHTML = getStatusChip(post.status);
  document.getElementById('detail-anon-badge').style.display = post.isAnonymous ? 'inline-flex' : 'none';
  document.getElementById('detail-secret-badge').style.display = post.isSecret ? 'inline-flex' : 'none';

  document.getElementById('detail-title').textContent = (post.isSecret && !isUnlocked) ? '🔒 비밀글(비공개) 민원입니다' : post.title;
  document.getElementById('detail-author').textContent = post.authorName;
  document.getElementById('detail-created').textContent = formatDate(post.createdAt, true);

  const updatedRow = document.getElementById('detail-updated-row');
  if (post.updatedAt) {
    updatedRow.style.display = 'table-row';
    document.getElementById('detail-updated').textContent = formatDate(post.updatedAt, true);
  } else {
    updatedRow.style.display = 'none';
  }

  // 본문 & 비밀글 인라인 잠금 영역 제어 (팝업 없이 페이지 내부 처리)
  const lockedBox = document.getElementById('detail-locked-box');
  const contentArea = document.getElementById('detail-content-area');

  if (isUnlocked) {
    lockedBox.style.display = 'none';
    contentArea.style.display = 'block';
    contentArea.textContent = post.content;
  } else {
    lockedBox.style.display = 'block';
    contentArea.style.display = 'none';
    document.getElementById('input-detail-password').value = '';
  }

  // 관리자 공식 답변 영역
  const officialAnswerBox = document.getElementById('detail-official-answer');
  if (post.adminReply && isUnlocked) {
    officialAnswerBox.style.display = 'block';
    document.getElementById('detail-answer-date').textContent = formatDate(post.adminReply.answeredAt, true);
    document.getElementById('detail-answer-content').textContent = post.adminReply.content;
  } else {
    officialAnswerBox.style.display = 'none';
  }

  // 관리자 전용 답변/상태 에디터
  const adminEditor = document.getElementById('detail-admin-editor');
  if (isAdmin) {
    adminEditor.style.display = 'block';
    document.getElementById('admin-select-status').value = post.status;
    document.getElementById('admin-input-reply').value = post.adminReply ? post.adminReply.content : '';

    const delReplyBtn = document.getElementById('btn-admin-delete-reply');
    delReplyBtn.style.display = post.adminReply ? 'inline-block' : 'none';
  } else {
    adminEditor.style.display = 'none';
  }

  // 인라인 비밀번호 잠금해제 버튼 리스너
  document.getElementById('btn-detail-unlock').onclick = async () => {
    const inputPw = document.getElementById('input-detail-password').value.trim();
    const val = validatePassword(inputPw);
    if (!val.valid) {
      showToast(val.message, true);
      return;
    }
    const inputHash = await hashPassword(inputPw);
    if (inputHash === post.passwordHash) {
      unlockedPostIds.add(post.id);
      showToast('비밀글이 열렸습니다.');
      initDetailView(post.id);
    } else {
      showToast('비밀번호가 일치하지 않습니다.', true);
    }
  };

  // 상세 페이지 내 [수정]
  document.getElementById('btn-detail-edit').onclick = () => {
    if (isAdmin) {
      location.hash = `#/edit?id=${post.id}`;
    } else {
      location.hash = `#/verify?id=${post.id}&action=edit`;
    }
  };

  // 상세 페이지 내 [삭제]
  document.getElementById('btn-detail-delete').onclick = () => {
    if (isAdmin) {
      if (confirm('관리자 권한으로 이 민원을 영구 삭제하시겠습니까?')) {
        posts = posts.filter(p => p.id !== post.id);
        unlockedPostIds.delete(post.id);
        savePosts();
        showToast('게시물이 정상 삭제되었습니다.');
        location.hash = '#/list';
      }
    } else {
      location.hash = `#/verify?id=${post.id}&action=delete`;
    }
  };

  // 관리자 답변 저장
  document.getElementById('btn-admin-save-reply').onclick = () => {
    if (!isAdmin) return;
    const newStatus = document.getElementById('admin-select-status').value;
    const replyContent = document.getElementById('admin-input-reply').value.trim();

    post.status = newStatus;
    if (replyContent) {
      post.adminReply = {
        content: replyContent,
        answeredAt: new Date().toISOString(),
        adminName: '시교육청 담당부서'
      };
      if (post.status === 'pending') {
        post.status = 'resolved';
      }
    } else {
      post.adminReply = null;
    }

    savePosts();
    showToast('공식 답변 및 처리 상태가 저장되었습니다.');
    initDetailView(post.id);
  };

  // 관리자 답변 삭제
  document.getElementById('btn-admin-delete-reply').onclick = () => {
    if (!isAdmin || !post.adminReply) return;
    if (confirm('등록된 관리자 공식 답변을 삭제하시겠습니까?')) {
      post.adminReply = null;
      if (post.status === 'resolved') {
        post.status = 'processing';
      }
      savePosts();
      showToast('답변이 삭제되었습니다.');
      initDetailView(post.id);
    }
  };
}

/**
 * ========================================================
 * 4. 민원 수정 뷰 초기화 (#/edit?id=...)
 * ========================================================
 */
function initEditView(postId) {
  const post = posts.find(p => p.id === postId);
  if (!post) {
    showToast('수정할 게시물을 찾을 수 없습니다.', true);
    location.hash = '#/list';
    return;
  }

  document.getElementById('edit-id').value = post.id;
  document.getElementById('edit-category').value = post.category;
  document.getElementById('edit-title').value = post.title;
  document.getElementById('edit-content').value = post.content;
  document.getElementById('edit-is-secret').checked = post.isSecret;
  document.getElementById('edit-password').value = '';

  const isMember = currentUser !== null;
  const editAuthorRow = document.getElementById('row-edit-author');
  const editAnonLabel = document.getElementById('label-edit-is-anonymous');
  const editNonMemberBadge = document.getElementById('badge-edit-nonmember-fixed-anon');
  const editAnonCheck = document.getElementById('edit-is-anonymous');
  const editAuthorInput = document.getElementById('edit-author');

  if (!isMember) {
    // 비회원 상태: '작성자 이름' 칸 숨김(지움), 익명 고정
    if (editAuthorRow) editAuthorRow.style.display = 'none';
    if (editAnonLabel) editAnonLabel.style.display = 'none';
    if (editNonMemberBadge) editNonMemberBadge.style.display = 'block';

    editAnonCheck.checked = true;
    editAuthorInput.value = '익명';
    editAuthorInput.disabled = true;
  } else {
    // 회원 로그인 상태: 작성자 이름 표시 및 자율 수정 가능
    if (editAuthorRow) editAuthorRow.style.display = 'table-row';
    if (editAnonLabel) editAnonLabel.style.display = 'flex';
    if (editNonMemberBadge) editNonMemberBadge.style.display = 'none';

    editAnonCheck.checked = post.isAnonymous;
    editAuthorInput.value = post.isAnonymous ? '익명' : post.authorName;
    editAuthorInput.disabled = post.isAnonymous;
  }
}

/**
 * ========================================================
 * 5. 관리자 로그인 뷰 초기화 (#/admin/login)
 * - 사용자 요청: 아이디 및 비밀번호를 처음부터 빈공란으로 유지!
 * ========================================================
 */
function initAdminLoginView() {
  const idInput = document.getElementById('login-id');
  const pwInput = document.getElementById('login-pw');
  if (idInput) {
    idInput.value = ''; // 빈공란
    idInput.focus();
  }
  if (pwInput) {
    pwInput.value = ''; // 빈공란
  }
}

/**
 * ========================================================
 * 6. 회원 로그인/가입 뷰 초기화 (#/user/login)
 * ========================================================
 */
function initUserLoginView() {
  const loginId = document.getElementById('user-login-id');
  const loginPw = document.getElementById('user-login-pw');
  const regId = document.getElementById('register-id');
  const regPw = document.getElementById('register-pw');
  const regNick = document.getElementById('register-nickname');

  if (loginId) { loginId.value = ''; loginId.focus(); }
  if (loginPw) loginPw.value = '';
  if (regId) regId.value = '';
  if (regPw) regPw.value = '';
  if (regNick) regNick.value = '';
}

/**
 * ========================================================
 * 7. 회원 메뉴 및 정보 설정 뷰 초기화 (#/user/menu)
 * ========================================================
 */
function initUserMenuView() {
  if (!currentUser) return;
  const pageUserId = document.getElementById('page-user-id');
  const pageUserNick = document.getElementById('page-user-current-nick');
  const inputNewNick = document.getElementById('menu-new-nickname');

  if (pageUserId) pageUserId.textContent = currentUser.id;
  if (pageUserNick) pageUserNick.textContent = currentUser.name || currentUser.id;
  if (inputNewNick) {
    inputNewNick.value = '';
    inputNewNick.focus();
  }
}

/**
 * ========================================================
 * 6. 본인 인증 뷰 초기화 (#/verify?id=...&action=...)
 * ========================================================
 */
function initVerifyView(postId, action) {
  const post = posts.find(p => p.id === postId);
  if (!post) {
    location.hash = '#/list';
    return;
  }

  const actionText = action === 'edit' ? '민원 수정' : '민원 삭제';
  document.getElementById('verify-page-title').textContent = `${actionText} 본인 인증`;
  document.getElementById('verify-page-desc').textContent = '게시글 등록 시 설정한 4자리 비밀번호를 입력해 주세요.';

  const inputPw = document.getElementById('input-verify-pw');
  inputPw.value = '';
  inputPw.focus();

  document.getElementById('btn-verify-cancel').onclick = () => {
    location.hash = `#/detail?id=${post.id}`;
  };

  document.getElementById('form-verify-password').onsubmit = async (e) => {
    e.preventDefault();
    const pw = inputPw.value.trim();
    const val = validatePassword(pw);
    if (!val.valid) {
      showToast(val.message, true);
      return;
    }
    const hash = await hashPassword(pw);

    if (hash === post.passwordHash) {
      if (action === 'edit') {
        location.hash = `#/edit?id=${post.id}`;
      } else if (action === 'delete') {
        if (confirm('정말로 이 민원을 영구 삭제하시겠습니까?')) {
          posts = posts.filter(p => p.id !== post.id);
          unlockedPostIds.delete(post.id);
          savePosts();
          showToast('게시물이 정상 삭제되었습니다.');
          location.hash = '#/list';
        }
      }
    } else {
      showToast('비밀번호가 일치하지 않습니다.', true);
    }
  };
}

/**
 * ========================================================
 * 전역 이벤트 리스너 등록
 * ========================================================
 */
document.addEventListener('DOMContentLoaded', async () => {
  await loadPosts();
  checkAdminSession();
  checkUserSession();
  updateGnbCounters();

  // 상단 날짜 표시 (디시인사이드 스타일 헤더 바)
  const now = new Date();
  const weekDays = ['일', '월', '화', '수', '목', '금', '토'];
  const dateStr = `${now.getFullYear()}.${now.getMonth() + 1}.${now.getDate()} (${weekDays[now.getDay()]})`;
  const headerDateEl = document.getElementById('header-date-display');
  if (headerDateEl) headerDateEl.textContent = dateStr;

  // SPA 해시 변경 감지
  window.addEventListener('hashchange', router);
  router(); // 초기 실행

  // 비밀번호 입력 실시간 영문/숫자 제한 (최대 8자리, 특수문자/공백 차단)
  attachPasswordInputSanitizer('create-password');
  attachPasswordInputSanitizer('edit-password');
  attachPasswordInputSanitizer('input-detail-password');
  attachPasswordInputSanitizer('input-verify-pw');

  // 전체 카테고리 드롭다운 패널 토글 리스너
  const gnbToggleBtn = document.getElementById('gnb-toggle-all');
  if (gnbToggleBtn) {
    gnbToggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleCategoryDropdown();
    });
  }

  const closeDropdownBtn = document.getElementById('btn-close-dropdown');
  if (closeDropdownBtn) {
    closeDropdownBtn.addEventListener('click', () => {
      toggleCategoryDropdown(false);
    });
  }

  // 외부 클릭 시 카테고리 드롭다운 닫기
  document.addEventListener('click', (e) => {
    const panel = document.getElementById('category-dropdown-panel');
    const btn = document.getElementById('gnb-toggle-all');
    if (panel && btn && panel.style.display !== 'none') {
      if (!panel.contains(e.target) && !btn.contains(e.target)) {
        toggleCategoryDropdown(false);
      }
    }
  });

  // 상단 관리자 로그아웃 버튼
  document.getElementById('btn-admin-logout').addEventListener('click', () => {
    sessionStorage.removeItem(ADMIN_SESSION_KEY);
    isAdmin = false;
    checkAdminSession();
    showToast('관리자 계정에서 로그아웃되었습니다.');
    router();
  });

  // 회원 로그아웃 버튼 (상단 및 회원 메뉴 페이지 공통)
  function handleUserLogout() {
    sessionStorage.removeItem(USER_SESSION_KEY);
    currentUser = null;
    checkUserSession();
    showToast('회원 계정에서 로그아웃되었습니다. (비회원 익명 모드로 전환)');
    location.hash = '#/list';
  }

  const btnUserLogout = document.getElementById('btn-user-logout');
  if (btnUserLogout) {
    btnUserLogout.addEventListener('click', handleUserLogout);
  }

  const btnMenuLogout = document.getElementById('btn-menu-logout');
  if (btnMenuLogout) {
    btnMenuLogout.addEventListener('click', handleUserLogout);
  }

  // 회원 메뉴 페이지: 내 작성 민원 모아보기 버튼
  const btnMenuMyPosts = document.getElementById('btn-menu-my-posts');
  if (btnMenuMyPosts) {
    btnMenuMyPosts.addEventListener('click', () => {
      if (!currentUser) return;
      const myName = currentUser.name;
      const searchInput = document.getElementById('board-search-input');
      if (searchInput) searchInput.value = '';
      location.hash = '#/list';
      setTimeout(() => {
        const filtered = posts.filter(p => p.authorName === myName || (currentUser.id && p.authorName === currentUser.id));
        const tbody = document.getElementById('board-tbody');
        const listCount = document.getElementById('list-count-text');
        if (listCount) listCount.textContent = filtered.length;
        if (filtered.length === 0) {
          tbody.innerHTML = `<tr><td colspan="6" style="padding: 3rem 1rem; color: #6b7280; text-align: center;"><div style="font-size: 1.8rem; margin-bottom: 0.4rem;">📭</div>작성하신 민원이 없습니다.</td></tr>`;
        } else {
          tbody.innerHTML = filtered.map((post, idx) => {
            const isSecretLocked = post.isSecret && !isAdmin && !unlockedPostIds.has(post.id);
            const displayTitle = isSecretLocked ? '🔒 비밀글입니다.' : escapeHtml(post.title);
            const rowNumber = filtered.length - idx;
            return `<tr class="board-row" onclick="location.hash='#/detail?id=${post.id}'"><td>${rowNumber}</td><td><span class="tag-badge tag-cat">${escapeHtml(post.category)}</span></td><td class="col-title"><div class="board-post-title">${post.isSecret ? '<span class="tag-badge tag-secret">비밀</span>' : ''}${post.isAnonymous ? '<span class="tag-badge tag-anon">익명</span>' : ''}<span>${displayTitle}</span>${post.adminReply ? '<span class="tag-resolved-mark">[답변완료]</span>' : ''}</div></td><td>${escapeHtml(post.authorName)}</td><td>${formatDate(post.createdAt)}</td><td>${getStatusChip(post.status)}</td></tr>`;
          }).join('');
        }
        showToast(`📋 '${myName}' 님이 작성한 민원 ${filtered.length}건을 조회합니다.`);
      }, 100);
    });
  }

  // 회원 메뉴 페이지: 닉네임 설정 폼 (화면 옆에서 직접 작성 및 저장)
  const formUpdateNickname = document.getElementById('form-update-nickname');
  if (formUpdateNickname) {
    formUpdateNickname.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!currentUser) return;
      const inputNewNick = document.getElementById('menu-new-nickname');
      const newNick = inputNewNick ? inputNewNick.value.trim() : '';

      if (!newNick) {
        showToast('변경할 닉네임을 입력해 주세요.', true);
        return;
      }
      if (newNick === currentUser.name) {
        showToast('현재 설정된 닉네임과 동일합니다.', true);
        return;
      }

      // 계정 정보 저장소(localStorage) 업데이트
      const accounts = loadUserAccounts();
      const account = accounts.find(a => a.id === currentUser.id);
      if (account) {
        account.nickname = newNick;
        saveUserAccounts(accounts);
      }

      // 세션 정보 업데이트
      currentUser.name = newNick;
      sessionStorage.setItem(USER_SESSION_KEY, JSON.stringify(currentUser));

      // 화면 내부 닉네임 표시 갱신
      const pageUserNick = document.getElementById('page-user-current-nick');
      if (pageUserNick) pageUserNick.textContent = newNick;
      if (inputNewNick) inputNewNick.value = '';

      checkUserSession();
      showToast(`🎉 닉네임이 '${newNick}'(으)로 성공적으로 변경되었습니다.`);
    });
  }

  // 상단 큼직한 통합 검색창 폼 제출 이벤트
  document.getElementById('top-search-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const query = document.getElementById('top-search-input').value.trim();
    document.getElementById('board-search-input').value = query;
    location.hash = '#/list';
    renderListView();
  });

  // 새 글 작성 시 익명 체크박스 토글
  const createAnonCheck = document.getElementById('create-is-anonymous');
  const createAuthorInput = document.getElementById('create-author');
  const createHintText = document.getElementById('author-hint-text');

  createAnonCheck.addEventListener('change', () => {
    if (createAnonCheck.checked) {
      createAuthorInput.value = '익명';
      createAuthorInput.disabled = true;
      createHintText.textContent = "익명 설정 시 '익명'으로 자동 지정됩니다.";
    } else {
      createAuthorInput.disabled = false;
      createAuthorInput.value = (currentUser && currentUser.name) ? currentUser.name : '';
      createAuthorInput.placeholder = '성명 또는 닉네임 입력';
      createHintText.textContent = (currentUser && currentUser.name) ? `'${currentUser.name}' 회원명으로 지정됩니다.` : '실명 또는 사용할 닉네임을 입력하세요.';
      createAuthorInput.focus();
    }
  });

  // 새 글 작성 폼 제출 (#/new)
  document.getElementById('form-create-post').addEventListener('submit', async (e) => {
    e.preventDefault();

    const isMember = currentUser !== null;
    const category = document.getElementById('create-category').value;
    // 비회원일 경우 무조건 익명 고정, 회원일 경우 체크박스 상태 반영
    const isAnonymous = !isMember || document.getElementById('create-is-anonymous').checked;
    const isSecret = document.getElementById('create-is-secret').checked;
    const authorName = isAnonymous ? '익명' : (document.getElementById('create-author').value.trim() || (isMember ? currentUser.name : '익명'));
    const password = document.getElementById('create-password').value.trim();
    const title = document.getElementById('create-title').value.trim();
    const content = document.getElementById('create-content').value.trim();

    const val = validatePassword(password);
    if (!val.valid) {
      showToast(val.message, true);
      return;
    }

    const passwordHash = await hashPassword(password);
    const newPost = {
      id: 'post-' + Date.now(),
      title,
      content,
      category,
      authorName,
      isAnonymous,
      isSecret,
      passwordHash,
      status: 'pending',
      adminReply: null,
      createdAt: new Date().toISOString(),
      updatedAt: null
    };

    posts.unshift(newPost);
    if (newPost.isSecret) {
      unlockedPostIds.add(newPost.id); // 작성 본인은 즉시 열람 허용
    }

    savePosts();
    showToast(isAnonymous ? '익명으로 민원이 안전하게 등록되었습니다.' : `'${authorName}' 이름으로 민원이 등록되었습니다.`);
    location.hash = `#/detail?id=${newPost.id}`;
  });

  // 글 수정 시 익명 체크박스 토글
  const editAnonCheck = document.getElementById('edit-is-anonymous');
  const editAuthorInput = document.getElementById('edit-author');
  editAnonCheck.addEventListener('change', () => {
    if (editAnonCheck.checked) {
      editAuthorInput.value = '익명';
      editAuthorInput.disabled = true;
    } else {
      editAuthorInput.disabled = false;
      editAuthorInput.value = (currentUser && currentUser.name) ? currentUser.name : '';
      editAuthorInput.placeholder = '성명 또는 닉네임 입력';
      editAuthorInput.focus();
    }
  });

  // 글 수정 폼 제출 (#/edit)
  document.getElementById('form-edit-post').addEventListener('submit', async (e) => {
    e.preventDefault();
    const postId = document.getElementById('edit-id').value;
    const post = posts.find(p => p.id === postId);
    if (!post) return;

    const isMember = currentUser !== null;
    const isAnonymous = !isMember || document.getElementById('edit-is-anonymous').checked;
    post.category = document.getElementById('edit-category').value;
    post.isAnonymous = isAnonymous;
    post.isSecret = document.getElementById('edit-is-secret').checked;
    post.authorName = isAnonymous ? '익명' : (document.getElementById('edit-author').value.trim() || (isMember ? currentUser.name : '익명'));
    post.title = document.getElementById('edit-title').value.trim();
    post.content = document.getElementById('edit-content').value.trim();
    post.updatedAt = new Date().toISOString();

    const newPw = document.getElementById('edit-password').value.trim();
    if (newPw) {
      const val = validatePassword(newPw);
      if (!val.valid) {
        showToast(val.message, true);
        return;
      }
      post.passwordHash = await hashPassword(newPw);
    }

    savePosts();
    showToast('민원 내용이 수정되었습니다.');
    location.hash = `#/detail?id=${post.id}`;
  });

  // 관리자 로그인 폼 제출 (#/admin/login)
  document.getElementById('form-admin-login').addEventListener('submit', (e) => {
    e.preventDefault();
    const id = document.getElementById('login-id').value.trim();
    const pw = document.getElementById('login-pw').value.trim();

    if (id === 'admin' && pw === 'admin1234') {
      sessionStorage.setItem(ADMIN_SESSION_KEY, 'true');
      isAdmin = true;
      checkAdminSession();
      showToast('🛡️ 관리자로 로그인되었습니다. 모든 비밀글 열람 및 답변 권한이 활성화되었습니다.');
      location.hash = '#/list';
    } else {
      showToast('관리자 아이디 또는 비밀번호가 올바르지 않습니다.', true);
    }
  });

  // 회원 로그인 폼 제출 (#/user/login — 좌측 로그인)
  const formUserLogin = document.getElementById('form-user-login');
  if (formUserLogin) {
    formUserLogin.addEventListener('submit', async (e) => {
      e.preventDefault();
      const id = document.getElementById('user-login-id').value.trim();
      const pw = document.getElementById('user-login-pw').value.trim();

      if (!id || !pw) {
        showToast('아이디와 비밀번호를 모두 입력해 주세요.', true);
        return;
      }

      const result = await loginUser(id, pw);
      if (!result.success) {
        showToast(result.message, true);
        return;
      }

      sessionStorage.setItem(USER_SESSION_KEY, JSON.stringify(result.user));
      currentUser = result.user;
      checkUserSession();
      showToast(`👤 '${result.user.name}' 회원님으로 로그인되었습니다.`);
      location.hash = '#/list';
    });
  }

  // 회원가입 폼 제출 (#/user/login — 우측 회원가입)
  const formUserRegister = document.getElementById('form-user-register');
  if (formUserRegister) {
    formUserRegister.addEventListener('submit', async (e) => {
      e.preventDefault();
      const id = document.getElementById('register-id').value.trim();
      const pw = document.getElementById('register-pw').value.trim();
      const nickname = document.getElementById('register-nickname').value.trim();

      if (!id) {
        showToast('아이디를 입력해 주세요.', true);
        return;
      }

      const result = await registerUser(id, pw, nickname);
      if (!result.success) {
        showToast(result.message, true);
        return;
      }

      // 가입 성공 → 자동 로그인
      sessionStorage.setItem(USER_SESSION_KEY, JSON.stringify(result.user));
      currentUser = result.user;
      checkUserSession();
      showToast(`🎉 회원가입 완료! '${result.user.name}' 님으로 자동 로그인되었습니다.`);
      location.hash = '#/list';
    });
  }

  // 회원가입 비밀번호 입력 실시간 정제
  attachPasswordInputSanitizer('register-pw');

  // 검색 및 필터 변경 리스너
  document.getElementById('filter-category').addEventListener('change', renderListView);
  document.getElementById('filter-status').addEventListener('change', renderListView);
  document.getElementById('filter-anon-only').addEventListener('change', renderListView);
  document.getElementById('filter-secret-only').addEventListener('change', renderListView);
  document.getElementById('board-search-input').addEventListener('input', renderListView);
  document.getElementById('btn-board-search').addEventListener('click', renderListView);
});
