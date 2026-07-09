<template>
  <header class="app-header">
    <div class="header-inner">
      <router-link to="/" class="logo">
        <svg width="30" height="30" viewBox="0 0 32 32" aria-hidden="true">
          <rect width="32" height="32" rx="8" fill="var(--c-primary)"/>
          <text x="16" y="22" text-anchor="middle" fill="white" font-size="17" font-weight="700" font-family="Inter, sans-serif">D</text>
        </svg>
        <span class="logo-text">Delta IDP</span>
      </router-link>

      <nav class="main-nav">
        <router-link to="/" class="nav-link" active-class="active">单据抽取</router-link>
        <router-link to="/templates" class="nav-link" active-class="active">模板管理</router-link>
      </nav>

      <span class="header-subtitle">苏州得尔达国际物流有限公司</span>
    </div>
  </header>
</template>

<style scoped>
.app-header {
  background: rgba(255, 255, 255, .85);
  backdrop-filter: saturate(180%) blur(12px);
  -webkit-backdrop-filter: saturate(180%) blur(12px);
  border-bottom: 1px solid var(--c-border);
  position: sticky;
  top: 0;
  z-index: var(--z-sticky);
}
/* 3-column grid keeps the nav perfectly centered while logo/subtitle flank it —
   no absolute positioning, so they can never overlap. */
.header-inner {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  height: 60px;
  padding: 0 24px;
  gap: 16px;
}
.logo { display: inline-flex; align-items: center; gap: 10px; text-decoration: none; justify-self: start; }
.logo svg { border-radius: 8px; box-shadow: 0 2px 6px rgba(37,99,235,.28); }
.logo-text { font-size: 18px; font-weight: 700; color: var(--c-gray-900); letter-spacing: -.02em; }

.main-nav { display: flex; gap: 4px; background: var(--c-gray-100); padding: 4px; border-radius: 10px; }
.nav-link {
  padding: 7px 18px; border-radius: 7px; text-decoration: none;
  color: var(--c-gray-600); font-size: 14px; font-weight: 500;
  transition: all var(--t-fast); white-space: nowrap;
}
.nav-link:hover { color: var(--c-gray-900); }
.nav-link.active {
  background: white; color: var(--c-primary); font-weight: 600;
  box-shadow: var(--shadow-sm);
}

.header-subtitle { font-size: 13px; color: var(--c-gray-400); justify-self: end; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

@media (max-width: 860px) {
  .header-subtitle { display: none; }
  .header-inner { grid-template-columns: auto 1fr; }
  .main-nav { justify-self: end; }
}
</style>
