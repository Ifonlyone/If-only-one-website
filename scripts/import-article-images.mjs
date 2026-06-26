#!/usr/bin/env node
/**
 * Extract article thumbnail CDN URLs and body image CDN URLs from the
 * Squarespace XML export.  Writes article-thumbs/_map.json with:
 *   - slugToThumbCdn:  htmlSlug → canonical CDN thumbnail URL
 *   - slugToBodyImgs:  htmlSlug → ordered array of inline CDN image URLs
 *
 * No files are downloaded — all URLs point directly to the Squarespace CDN,
 * consistent with how article body images are already referenced in the HTML.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const XML_PATH = path.join(ROOT, 'attached_assets', 'Squarespace-Wordpress-Export-06-11-2026_1782430472376.xml');
const MAP_PATH = path.join(ROOT, 'article-thumbs', '_map.json');

if (!fs.existsSync(path.join(ROOT, 'article-thumbs'))) {
  fs.mkdirSync(path.join(ROOT, 'article-thumbs'), { recursive: true });
}

// ── Parse XML ──────────────────────────────────────────────────────────────

const xml = fs.readFileSync(XML_PATH, 'utf-8');
const itemBlocks = xml.split(/<item>/).slice(1).map(b => b.split('</item>')[0]);

function tag(block, name) {
  const re = new RegExp(`<${name}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${name}>`, 'i');
  const m = block.match(re);
  return m ? m[1].trim() : null;
}

// post_id → HTTPS CDN URL
const attachments = {};
for (const block of itemBlocks) {
  if (tag(block, 'wp:post_type') !== 'attachment') continue;
  const id  = tag(block, 'wp:post_id');
  let url   = tag(block, 'wp:attachment_url') || '';
  url = url.replace(/^http:\/\//, 'https://');  // normalise to HTTPS
  if (id && url) attachments[id] = url;
}

// Posts: { title, thumbnail_id, bodyImgs[] }
const posts = [];
for (const block of itemBlocks) {
  const post_type = tag(block, 'wp:post_type');
  if (post_type !== 'post') continue;
  const status = tag(block, 'wp:status') || '';
  if (status !== 'publish' && status !== 'draft') continue;

  const title = tag(block, 'title') || '';

  let thumbnail_id = null;
  const metaRe = /<wp:postmeta>([\s\S]*?)<\/wp:postmeta>/g;
  let mm;
  while ((mm = metaRe.exec(block)) !== null) {
    if (tag(mm[1], 'wp:meta_key') === '_thumbnail_id') {
      thumbnail_id = tag(mm[1], 'wp:meta_value');
      break;
    }
  }

  // Extract inline body image URLs from content:encoded
  const encoded = tag(block, 'content:encoded') || '';
  const bodyImgs = [];
  // Squarespace stores images as custom SQS blocks; the image CDN URLs appear
  // as src attributes or as data-src within the encoded HTML.
  const imgRe = /(?:src|data-src)="(https?:\/\/images\.squarespace-cdn\.com[^"]+)"/g;
  let imgM;
  while ((imgM = imgRe.exec(encoded)) !== null) {
    const u = imgM[1].replace(/^http:\/\//, 'https://');
    if (!bodyImgs.includes(u)) bodyImgs.push(u);
  }

  posts.push({ title, thumbnail_id, bodyImgs });
}

console.log(`Parsed ${posts.length} posts (publish+draft), ${Object.keys(attachments).length} attachments`);

// ── Title normalisation (strips all punctuation for robust matching) ────────

function normTitle(t) {
  return t.normalize('NFD').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

// normTitle → { thumbnailCdnUrl, bodyImgs }
const titleMap = {};
for (const p of posts) {
  const key = normTitle(p.title);
  if (!key) continue;
  titleMap[key] = {
    thumbnailCdnUrl: p.thumbnail_id ? attachments[p.thumbnail_id] : null,
    bodyImgs: p.bodyImgs,
  };
}

// ── HTML slug → title ─────────────────────────────────────────────────────

const HTML_SLUG_TITLES = {
  'art-nf':                                 'Not Forgotten Not Overlooked',
  'the-navigators-and-other-things-that-are': 'The Navigators and Other Things That Are Not the Church',
  'what-makes-waiting-so-hard--me':          'What makes waiting so hard Me',
  'vacuuming-the-red-carpet---a-paen-for-th':'Vacuuming the Red Carpet a Paen for the Small Church Pastor',
  'grace-for-the-mind--the-christian-and-me':'Grace for the Mind The Christian and Mental Health Treatment',
  'what-does-it-mean-to--sin-willfully----h':'What does it mean to sin willfully Hebrews 10 26',
  'the-church--more-than-a-building':        'The Church More Than a Building',
  'the-burden-of-bible-reading':             'The Burden of Bible Reading',
  'if-you-love-me--you-ll-obey-me-----not': 'If you love me you ll obey me Not a Litmus Test but a Promise',
  'to-the-christian-wrestling-with-sin-and': 'To the Christian wrestling with sin and shame',
  'the-red-letter-bible-and-the-doctrine-of':'The Red Letter Bible and the Doctrine of the Trinity',
  'no-christian--god-is-not-going-to-judge': 'No Christian God is Not Going to Judge You For Your Careless Words',
  'why-matthew-7-21-23-is-not-the-scariest': 'Why Matthew 7 21 23 is not the Scariest Passage in the Bible',
  'which-bible-translation-should-you-read': 'Which Bible Translation Should You Read',
  'it-s-okay-not-to-be-okay--okay':          'It s Okay Not to be Okay Okay',
  'total-depravity-and-why-it-matters':      'Total Depravity and Why It Matters',
  'suffer-to-the-glory-of-god':              'Suffer to the Glory of God',
  'yes-to-female-deacons-a-comprehensive-st':'Yes to Female Deacons A Comprehensive Study',
  'you-re-suffering-a-different-look':       'You re Suffering A Different Look',
  'church-hurt-a-pastor-s-wife-s-perspectiv':"Church Hurt a Pastor s Wife s Perspective",
  'israel-vs--hamas-an-effort-at-lazy-reduc': 'Israel vs Hamas an Effort at Lazy Reductionism',
  'something-is-wrong-with--what-is-a-woman':"Something is Wrong with What is a Woman",
  'the-gospel-famine-of-contemporary-christ':'The Gospel Famine of Contemporary Christian Music',
  'varying-degrees-of-reward-in-heaven-work':'Varying Degrees of Reward in Heaven Works Smuggled In',
  'revival-fatigue-a-cold-take':             'Revival Fatigue a Cold Take',
  'biblical-masculinity-is-toxic-masculinit':'Biblical Masculinity is Toxic Masculinity',
  'america-and-the-slow-death-of-godless-de':'America and the Slow Death of Godless Democracy',
  'the-three-layers-of-biblical-discipleshi':'The Three Layers of Biblical Discipleship',
  'why-the-end-of-war-hurts-but-doesn-t-hav':"Why the End of War Hurts but Doesn t Have to",
  'global-gospel-proclamation-and-the-olive':'Global Gospel Proclamation and the Olivet Discourse Matthew 24 14',
  'the-olivet-discourse-and-a-study-in-cont':'The Olivet Discourse and a Study in Context Matthew 24',
  'god--i-hate-marijuana':                   'God I Hate Marijuana',
  'the-gaiety-of-men-loving-men':            'The Gaiety of Men Loving Men',
  'why-you-won-t-keep-your-resolutions':     "Why You Won t Keep Your Resolutions",
  'youth-ministry-isn-t-working':            "Youth Ministry Isn t Working",
  'church-hurt-the-worst-kind-of-hurt':      'Church Hurt the Worst Kind of Hurt',
  'the-good-dude-the-worst-kind-of-dude':    'The Good Dude the Worst Kind of Dude',
  'the-power-of-a-godly-father':             'The Power of a Godly Father',
};

// Special: "Not Forgotten" is a draft with no title in XML; its thumbnail attachment is post_id=2
const NOT_FORGOTTEN_CDN_THUMB = (attachments['2'] || '').replace(/^http:\/\//, 'https://') ||
  'https://images.squarespace-cdn.com/content/v1/61a5330be0560757006d218c/1774052721074-3CEUIXP8TAS0Q7THQGRN/Article-vertical+jpeg.jpg';

function findForSlug(htmlSlug, htmlTitle) {
  if (htmlSlug === 'art-nf') {
    return { thumbnailCdnUrl: NOT_FORGOTTEN_CDN_THUMB, bodyImgs: [] };
  }
  const norm = normTitle(htmlTitle);
  if (titleMap[norm]) return titleMap[norm];
  // Fuzzy prefix match
  const prefix = norm.slice(0, 30);
  for (const [k, v] of Object.entries(titleMap)) {
    if (k.startsWith(prefix) || norm.startsWith(k.slice(0, 30))) return v;
  }
  return null;
}

// ── Build the map ─────────────────────────────────────────────────────────

const slugToThumbCdn = {};
const slugToBodyImgs = {};
const misses = [];

for (const [htmlSlug, htmlTitle] of Object.entries(HTML_SLUG_TITLES)) {
  const data = findForSlug(htmlSlug, htmlTitle);
  if (!data) { misses.push(htmlSlug); continue; }
  if (data.thumbnailCdnUrl) slugToThumbCdn[htmlSlug] = data.thumbnailCdnUrl;
  if (data.bodyImgs && data.bodyImgs.length > 0) slugToBodyImgs[htmlSlug] = data.bodyImgs;
}

if (misses.length) console.warn('Misses:', misses);

console.log(`Matched ${Object.keys(slugToThumbCdn).length} thumbnail CDN URLs`);
console.log(`Matched ${Object.keys(slugToBodyImgs).length} article body-image sets`);

// Save map
fs.writeFileSync(MAP_PATH, JSON.stringify({ slugToThumbCdn, slugToBodyImgs }, null, 2));
console.log('\nWrote', MAP_PATH);

// Print the CDN map
for (const [slug, url] of Object.entries(slugToThumbCdn)) {
  console.log(`  ${slug}\n    → ${url}`);
}
