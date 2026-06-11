import { createRouter, createWebHistory } from 'vue-router'
import ExtractionView from '../views/ExtractionView.vue'
import AgentView from '../views/AgentView.vue'
import TemplateManager from '../views/TemplateManager.vue'

const routes = [
  { path: '/', name: 'extraction', component: ExtractionView, meta: { title: '单据抽取' } },
  { path: '/agent', name: 'agent', component: AgentView, meta: { title: '智能助手 Agent' } },
  { path: '/templates', name: 'templates', component: TemplateManager, meta: { title: '模板管理' } },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
})

export default router
