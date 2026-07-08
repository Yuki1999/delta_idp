<template>
  <header class="app-header">
    <router-link to="/" class="logo">
      <svg width="28" height="28" viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="var(--c-primary)"/><text x="16" y="22" text-anchor="middle" fill="white" font-size="18" font-weight="bold">D</text></svg>
      <span class="logo-text">Delta IDP</span>
    </router-link>
    <div class="header-inner">
      <nav class="main-nav">
        <router-link to="/" class="nav-link" active-class="active">单据抽取</router-link>
        <!-- <router-link to="/agent" class="nav-link" active-class="active">智能助手 Agent</router-link> -->
        <router-link to="/templates" class="nav-link" active-class="active">模板管理</router-link>
      </nav>
    </div>
    <span class="header-subtitle">苏州得尔达国际物流有限公司</span>
  </header>
</template>

<style scoped>
.app-header { background: white; border-bottom: 1px solid var(--c-gray-200); position: sticky; top: 0; z-index: var(--z-sticky); display: flex; }
.header-inner { max-width: 1440px; margin: 0 auto; display: flex; align-items: center; justify-content: center; padding: 0 24px; height: 56px; }
.logo { display: flex; align-items: center; gap: 10px; text-decoration: none; flex-shrink: 0; position: absolute; left: 24px; top: 50%; transform: translateY(-50%); }
.logo-text { font-size: 18px; font-weight: 700; color: var(--c-gray-900); letter-spacing: -.01em; }
.main-nav { display: flex; gap: 4px; }
.nav-link { padding: 8px 16px; border-radius: var(--radius); text-decoration: none; color: var(--c-gray-600); font-size: 14px; font-weight: 500; transition: all var(--t-fast); white-space: nowrap; position: relative; }
.nav-link:hover { background: var(--c-gray-100); color: var(--c-gray-900); }
.nav-link.active { background: var(--c-primary-light); color: var(--c-primary); font-weight: 600; }
.nav-link.active::before { content: ''; position: absolute; left: 50%; bottom: -1px; transform: translateX(-50%); width: 60%; height: 2px; background: var(--c-primary); border-radius: 2px 2px 0 0; }
.header-subtitle { font-size: 13px; color: var(--c-gray-400); position: absolute; right: 24px; top: 50%; transform: translateY(-50%); }
</style>
