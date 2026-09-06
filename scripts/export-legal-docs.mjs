#!/usr/bin/env node
/**
 * Export the three legal documents from the i18n dictionaries to docs/legal/.
 *
 * The published text lives in `src/lib/i18n/{vi,en,ja}.ts` — that is what a
 * visitor reads, so that is the source of truth. Hand-copying it into markdown
 * guarantees the two drift, and a policy file that no longer matches the page
 * it claims to reproduce is worse than no file at all. Run this after any edit
 * to the legal keys:
 *
 *   npm run docs:legal
 *
 * The dictionaries carry no type annotations, so Node can import the .ts files
 * directly under --experimental-strip-types (see the npm script).
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { vi } from '../src/lib/i18n/vi.ts';
import { en } from '../src/lib/i18n/en.ts';
import { ja } from '../src/lib/i18n/ja.ts';
import { LEGAL_LAST_UPDATED } from '../src/lib/legal.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'docs', 'legal');

const LANGS = [
  { dir: 'vi', dict: vi, locale: 'vi-VN', label: 'Tiếng Việt' },
  { dir: 'en', dict: en, locale: 'en-US', label: 'English' },
  { dir: 'ja', dict: ja, locale: 'ja-JP', label: '日本語' },
];

/** Section counts must match `src/lib/legal.ts`. */
const DOCS = [
  {
    prefix: 'terms',
    sections: 15,
    titleKey: 'page_terms_title',
    introKey: 'terms_intro',
    updatedKey: 'terms_last_updated',
    page: '/terms',
    file: { vi: 'dieu-khoan-dich-vu', en: 'terms-of-service', ja: 'terms-of-service' },
  },
  {
    prefix: 'privacy',
    sections: 13,
    titleKey: 'page_privacy_title',
    introKey: 'privacy_intro',
    updatedKey: 'privacy_last_updated',
    page: '/privacy',
    file: { vi: 'chinh-sach-bao-mat', en: 'privacy-policy', ja: 'privacy-policy' },
  },
  {
    prefix: 'complaints',
    sections: 12,
    titleKey: 'page_complaints_title',
    introKey: 'complaints_intro',
    updatedKey: 'complaints_last_updated',
    page: '/complaints',
    file: { vi: 'co-che-khieu-nai', en: 'complaint-mechanism', ja: 'complaint-mechanism' },
  },
];

const GENERATED_NOTE = {
  vi: 'Tài liệu này được xuất tự động từ nội dung đang hiển thị trên website. Không sửa trực tiếp file này: sửa `src/lib/i18n/vi.ts` rồi chạy `npm run docs:legal`.',
  en: 'This file is generated from the copy currently published on the site. Do not edit it directly: edit `src/lib/i18n/en.ts` and run `npm run docs:legal`.',
  ja: 'このファイルは、サイトで公開中の文面から自動生成されています。直接編集せず、`src/lib/i18n/ja.ts` を編集して `npm run docs:legal` を実行してください。',
};

const PAGE_LABEL = { vi: 'Trang công bố', en: 'Published at', ja: '公開ページ' };

/**
 * Turn a dictionary value into markdown.
 *
 * The stored strings use `\n\n` between paragraphs and a `•` prefix for list
 * items. Markdown needs a real list marker and a blank line ahead of the list,
 * and it needs a hard break for the lines that are deliberately stacked (the
 * address block at the end of every document). Without this the address would
 * collapse onto one line and a bullet list would render as one long paragraph.
 */
function toMarkdown(text) {
  const out = [];
  let previousWasBullet = false;
  let previousWasText = false;

  for (const raw of text.split('\n')) {
    const trimmed = raw.trim();

    if (!trimmed) {
      out.push('');
      previousWasBullet = false;
      previousWasText = false;
      continue;
    }

    if (trimmed.startsWith('•')) {
      // A list has to start on its own block, otherwise the first item glues
      // itself to the sentence that introduces it.
      if (previousWasText) out.push('');
      out.push(`* ${trimmed.slice(1).trim()}`);
      previousWasBullet = true;
      previousWasText = false;
      continue;
    }

    if (previousWasBullet) out.push('');
    // Two trailing spaces on the previous line is a markdown hard break, which
    // is what keeps stacked lines (name, address, email, phone) stacked.
    if (previousWasText) out[out.length - 1] += '  ';
    out.push(trimmed);
    previousWasBullet = false;
    previousWasText = true;
  }

  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function renderDocument(doc, lang) {
  const { dict, locale, dir } = lang;
  const updatedOn = new Date(`${LEGAL_LAST_UPDATED}T00:00:00`).toLocaleDateString(locale, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const parts = [
    `# ${dict[doc.titleKey]}`,
    '',
    '**CardVerseHub**',
    '',
    `${dict[doc.updatedKey]} ${updatedOn}`,
    '',
    `${PAGE_LABEL[dir]}: \`${doc.page}\``,
    '',
    `> ${dict[doc.introKey]}`,
    '',
    `_${GENERATED_NOTE[dir]}_`,
    '',
  ];

  for (let i = 1; i <= doc.sections; i += 1) {
    const title = dict[`${doc.prefix}_section_${i}_title`];
    const body = dict[`${doc.prefix}_section_${i}_desc`];
    if (!title || !body) throw new Error(`[${dir}] missing ${doc.prefix} section ${i}`);
    parts.push(`## ${title}`, '', toMarkdown(body), '');
  }

  return `${parts.join('\n').trimEnd()}\n`;
}

/**
 * Guard the one rule the copy has to keep: no hyphen or dash anywhere in the
 * prose. Markdown list markers and headings are structure, not prose, and this
 * runs over the dictionary values rather than the rendered file so it checks
 * exactly the published sentences.
 */
const DASHES = /[-‐‑‒–—−]/;

function assertNoDashes(doc, lang) {
  const keys = [doc.titleKey, doc.introKey, doc.updatedKey];
  for (let i = 1; i <= doc.sections; i += 1) {
    keys.push(`${doc.prefix}_section_${i}_title`, `${doc.prefix}_section_${i}_desc`);
  }
  const offenders = keys.filter((key) => DASHES.test(lang.dict[key] ?? ''));
  if (offenders.length) {
    throw new Error(`[${lang.dir}] dash found in: ${offenders.join(', ')}`);
  }
}

const written = [];

for (const lang of LANGS) {
  await mkdir(join(OUT, lang.dir), { recursive: true });
  for (const doc of DOCS) {
    assertNoDashes(doc, lang);
    const path = join(OUT, lang.dir, `${doc.file[lang.dir]}.md`);
    await writeFile(path, renderDocument(doc, lang), 'utf8');
    written.push(path.slice(ROOT.length + 1));
  }
}

for (const path of written) console.log(`wrote ${path}`);
console.log(`\n${written.length} files, last updated ${LEGAL_LAST_UPDATED}`);
