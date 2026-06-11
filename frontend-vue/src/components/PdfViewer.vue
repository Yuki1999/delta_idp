<template>
  <div class="pdf-viewer-container" ref="containerRef">
    <div class="pdf-pages" ref="pagesRef">
      <div
        v-for="page in renderedPages"
        :key="page.num"
        class="pdf-page-wrapper"
        :style="{ width: page.width + 'px', height: page.height + 'px' }"
      >
        <canvas :ref="el => setCanvasRef(page.num, el)"></canvas>
        <!-- Highlight overlays for this page -->
        <div
          v-for="(hl, hi) in getPageHighlights(page.num)"
          :key="hi"
          class="pdf-highlight-box"
          :class="{ first: hl.isFirst }"
          :style="hl.style"
        ></div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import * as pdfjsLib from 'pdfjs-dist/build/pdf.mjs'
import workerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url'

// Configure worker
pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

const props = defineProps({
  src: { type: String, required: true }
})

const containerRef = ref(null)
const pagesRef = ref(null)
const renderedPages = ref([])
const highlights = ref([]) // { pageNum, style, isFirst }
const canvasRefs = {}
const textItems = ref([]) // { pageNum, str, x, y, width, height }

let pdfDoc = null
let currentScale = 1.5

function setCanvasRef(pageNum, el) {
  if (el) canvasRefs[pageNum] = el
}

function getPageHighlights(pageNum) {
  return highlights.value.filter(h => h.pageNum === pageNum)
}

async function loadPdf(url) {
  try {
    // Destroy previous
    if (pdfDoc) {
      pdfDoc.destroy()
      pdfDoc = null
    }
    renderedPages.value = []
    highlights.value = []
    textItems.value = []

    // Fetch PDF as ArrayBuffer first to avoid URL encoding issues with PDF.js
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} fetching PDF`)
    }
    const arrayBuffer = await response.arrayBuffer()

    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer })
    pdfDoc = await loadingTask.promise
    const numPages = pdfDoc.numPages

    // Determine scale based on container width
    const containerWidth = containerRef.value?.clientWidth || 600
    const firstPage = await pdfDoc.getPage(1)
    const unscaledViewport = firstPage.getViewport({ scale: 1.0 })
    currentScale = (containerWidth - 20) / unscaledViewport.width

    // Render all pages
    const pages = []
    for (let i = 1; i <= numPages; i++) {
      const page = await pdfDoc.getPage(i)
      const viewport = page.getViewport({ scale: currentScale })
      pages.push({ num: i, width: viewport.width, height: viewport.height })
    }
    renderedPages.value = pages

    await nextTick()

    // Render canvases and extract text
    const allTextItems = []
    for (let i = 1; i <= numPages; i++) {
      const page = await pdfDoc.getPage(i)
      const viewport = page.getViewport({ scale: currentScale })
      const canvas = canvasRefs[i]
      if (!canvas) continue

      canvas.width = viewport.width
      canvas.height = viewport.height
      const ctx = canvas.getContext('2d')

      await page.render({ canvasContext: ctx, viewport }).promise

      // Extract text with positions
      const textContent = await page.getTextContent()
      for (const item of textContent.items) {
        if (!item.str || !item.str.trim()) continue
        const tx = item.transform
        // transform: [scaleX, skewX, skewY, scaleY, translateX, translateY]
        const x = tx[4] * currentScale
        const y = viewport.height - (tx[5] * currentScale) - (item.height * currentScale)
        const w = item.width * currentScale
        const h = item.height * currentScale
        allTextItems.push({
          pageNum: i,
          str: item.str,
          x, y, w, h
        })
      }
    }
    textItems.value = allTextItems
  } catch (err) {
    console.error('[PdfViewer] Failed to load PDF:', err.message || err, err.stack || '')
  }
}

function highlight(searchText) {
  if (!searchText || !searchText.trim()) {
    clearHighlight()
    return
  }

  const needle = searchText.trim()
  const newHighlights = []
  let isFirst = true

  for (const item of textItems.value) {
    // Check if the text item contains the search text (case-insensitive partial match)
    if (matchText(item.str, needle)) {
      newHighlights.push({
        pageNum: item.pageNum,
        isFirst,
        style: {
          left: item.x + 'px',
          top: item.y + 'px',
          width: item.w + 'px',
          height: item.h + 'px',
        }
      })
      isFirst = false
    }
  }

  // If no exact/partial match found, try word-level matching
  if (newHighlights.length === 0 && needle.length > 3) {
    const words = needle.split(/[\s,\-/]+/).filter(w => w.length > 2)
    for (const word of words.slice(0, 5)) {
      for (const item of textItems.value) {
        if (item.str.toLowerCase().includes(word.toLowerCase())) {
          newHighlights.push({
            pageNum: item.pageNum,
            isFirst,
            style: {
              left: item.x + 'px',
              top: item.y + 'px',
              width: item.w + 'px',
              height: item.h + 'px',
            }
          })
          isFirst = false
        }
      }
      if (newHighlights.length > 0) break
    }
  }

  highlights.value = newHighlights

  // Scroll to first highlight
  if (newHighlights.length > 0) {
    nextTick(() => {
      const firstEl = containerRef.value?.querySelector('.pdf-highlight-box.first')
      if (firstEl) {
        firstEl.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
    })
  }
}

function matchText(source, needle) {
  const s = source.toLowerCase()
  const n = needle.toLowerCase()
  // Exact containment
  if (s.includes(n) || n.includes(s)) return true
  // For short source text, check if needle starts/ends with it
  if (source.length >= 3 && n.includes(s)) return true
  return false
}

function clearHighlight() {
  highlights.value = []
}

// Watch src changes
watch(() => props.src, (newSrc) => {
  if (newSrc) loadPdf(newSrc)
}, { immediate: false })

onMounted(() => {
  if (props.src) loadPdf(props.src)
})

onBeforeUnmount(() => {
  if (pdfDoc) {
    pdfDoc.destroy()
    pdfDoc = null
  }
})

// Expose methods
defineExpose({ highlight, clearHighlight })
</script>

<style scoped>
.pdf-viewer-container {
  width: 100%;
  height: 100%;
  overflow: auto;
  background: #525659;
}

.pdf-pages {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 10px;
}

.pdf-page-wrapper {
  position: relative;
  background: white;
  box-shadow: 0 2px 8px rgba(0,0,0,0.15);
}

.pdf-page-wrapper canvas {
  display: block;
  width: 100%;
  height: 100%;
}

.pdf-highlight-box {
  position: absolute;
  background: rgba(255, 213, 0, 0.35);
  border: 1.5px solid rgba(245, 158, 11, 0.7);
  border-radius: 2px;
  pointer-events: none;
  animation: highlight-fade-in 0.3s ease;
  z-index: 10;
}

.pdf-highlight-box.first {
  background: rgba(255, 180, 0, 0.45);
  border-color: rgba(217, 119, 6, 0.9);
  box-shadow: 0 0 6px rgba(245, 158, 11, 0.4);
}

@keyframes highlight-fade-in {
  from { opacity: 0; transform: scale(1.1); }
  to { opacity: 1; transform: scale(1); }
}
</style>
