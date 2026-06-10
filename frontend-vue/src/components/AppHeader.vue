<template>
  <header class="app-header">
    <div class="header-inner">
      <router-link to="/" class="logo">
        <svg width="28" height="28" viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="var(--c-primary)"/><text x="16" y="22" text-anchor="middle" fill="white" font-size="18" font-weight="bold">D</text></svg>
        <span class="logo-text">Delta IDP</span>
      </router-link>
      <nav class="main-nav">
        <router-link to="/" class="nav-link" active-class="active">单据抽取</router-link>
        <router-link to="/agent" class="nav-link" active-class="active">智能助手 Agent</router-link>
        <router-link to="/review" class="nav-link" active-class="active">审核中心</router-link>
        <router-link to="/templates" class="nav-link" active-class="active">模板管理</router-link>
      </nav>
      <span class="header-subtitle">苏州得尔达国际物流有限公司</span>
    </div>
  </header>
</template>

<style scoped>
.app-header { background: white; border-bottom: 1px solid var(--c-gray-200); position: sticky; top: 0; z-index: 100; }
.header-inner { max-width: 1440px; margin: 0 auto; display: flex; align-items: center; padding: 0 24px; height: 56px; gap: 24px; }
.logo { display: flex; align-items: center; gap: 10px; text-decoration: none; }
.logo-text { font-size: 18px; font-weight: 700; color: var(--c-gray-900); }
.main-nav { display: flex; gap: 4px; }
.nav-link { padding: 6px 16px; border-radius: var(--radius); text-decoration: none; color: var(--c-gray-600); font-size: 14px; font-weight: 500; transition: all .15s; }
.nav-link:hover { background: var(--c-gray-100); color: var(--c-gray-900); }
.nav-link.active { background: var(--c-primary-light); color: var(--c-primary); }
.header-subtitle { font-size: 13px; color: var(--c-gray-400); margin-left: auto; }
</style>
