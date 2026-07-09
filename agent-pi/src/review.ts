/**
 * Review center storage — JSON file-based, same pattern as sessions.ts.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STORAGE_DIR = path.resolve(__dirname, "../../storage");
const REVIEW_FILE = "reviews.json";

function ensureDir() {
  fs.mkdirSync(STORAGE_DIR, { recursive: true });
}

function loadReviews() {
  ensureDir();
  const fp = path.join(STORAGE_DIR, REVIEW_FILE);
  if (fs.existsSync(fp)) {
    try { return JSON.parse(fs.readFileSync(fp, "utf-8")); } catch { return []; }
  }
  return [];
}

function saveReviews(reviews: any[]) {
  ensureDir();
  // Atomic write: temp file + rename (see sessions.ts) so readers never see
  // a partially-written file.
  const target = path.join(STORAGE_DIR, REVIEW_FILE);
  const tmp = path.join(STORAGE_DIR, `.${REVIEW_FILE}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`);
  try {
    fs.writeFileSync(tmp, JSON.stringify(reviews, null, 2), "utf-8");
    fs.renameSync(tmp, target);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
    throw e;
  }
}

export function listReviews(status?: string) {
  const reviews = loadReviews();
  reviews.sort((a: any, b: any) => (b.created_at || "").localeCompare(a.created_at || ""));
  if (status) return reviews.filter((r: any) => r.status === status);
  return reviews;
}

export function getReview(id: string) {
  return loadReviews().find((r: any) => r.id === id) || null;
}

export function createReview(entry: {
  filename: string;
  file_path: string;
  document_type: string;
  vendor: string;
  method: string;
  fields: Array<{ name: string; label: string; value: any; confidence: string; location?: string }>;
  line_items?: any[];
  markdown?: string;
  source: string; // "extraction" or "agent"
}) {
  const reviews = loadReviews();
  const now = new Date().toISOString();
  const review = {
    id: randomUUID().slice(0, 8),
    ...entry,
    status: "pending", // pending | confirmed | modified
    corrections: [],
    created_at: now,
    updated_at: now,
  };
  reviews.push(review);
  saveReviews(reviews);
  return review;
}

export function updateReview(id: string, updates: {
  status?: string;
  fields?: any[];
  corrections?: any[];
}) {
  const reviews = loadReviews();
  const review = reviews.find((r: any) => r.id === id);
  if (!review) return null;
  if (updates.status) review.status = updates.status;
  if (updates.fields) review.fields = updates.fields;
  if (updates.corrections) review.corrections = updates.corrections;
  review.updated_at = new Date().toISOString();
  saveReviews(reviews);
  return review;
}

export function deleteReview(id: string) {
  const reviews = loadReviews();
  const idx = reviews.findIndex((r: any) => r.id === id);
  if (idx === -1) return false;
  reviews.splice(idx, 1);
  saveReviews(reviews);
  return true;
}
