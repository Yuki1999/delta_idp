<template>
  <div class="app-shell">
    <AppHeader />
    <router-view />
  </div>
</template>

<script setup>
import AppHeader from './components/AppHeader.vue'
</script>

<style>
.app-shell { height: 100%; display: flex; flex-direction: column; }
</style>
