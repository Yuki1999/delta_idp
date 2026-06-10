<template>
  <div>
    <div v-if="!items.length" class="empty-state"><p>暂无商品明细数据</p></div>
    <table v-else class="data-table">
      <thead>
        <tr><th v-for="k in keys" :key="k">{{ colLabel(k) }}</th></tr>
      </thead>
      <tbody>
        <tr v-for="(item, i) in items" :key="i">
          <td v-for="k in keys" :key="k">{{ item[k] ?? '' }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<script setup>
import { computed } from 'vue'
const props = defineProps({ items: { type: Array, default: () => [] } })

const labels = {
  item_no: '序号', po_no: '采购订单号', part_no: '产品编号', samsung_pn: '三星料号',
  description: '品名', quantity: '数量', unit: '单位', unit_price: '单价', amount: '金额',
  carton_no: '箱号', carton_qty: '箱数', net_weight: '净重(KG)', gross_weight: '毛重(KG)', measurement: '体积(CBM)',
}

const keys = computed(() => {
  const s = new Set()
  props.items.forEach(it => Object.keys(it).forEach(k => { if (!k.startsWith('_')) s.add(k) }))
  return [...s]
})

function colLabel(k) { return labels[k] || k }
</script>

<style scoped>
.data-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.data-table th { background: var(--c-gray-50); padding: 10px 12px; text-align: left; font-weight: 600; color: var(--c-gray-700); border-bottom: 2px solid var(--c-gray-200); white-space: nowrap; }
.data-table td { padding: 8px 12px; border-bottom: 1px solid var(--c-gray-100); color: var(--c-gray-800); }
.data-table tr:hover td { background: var(--c-gray-50); }
.empty-state { text-align: center; padding: 60px 20px; color: var(--c-gray-400); }
</style>
