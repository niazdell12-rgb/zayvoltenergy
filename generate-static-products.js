/**
 * ZayVolt Energy — Static product page generator (GitHub Pages version)
 * ------------------------------------------------------------------------
 * Generates a real static HTML file per product, with the correct
 * title/description/og:image already baked in, so Google indexes the
 * actual product instead of a generic placeholder.
 *
 * Output: product/<id>/index.html at the repo root, which GitHub Pages
 * serves at:  https://yourusername.github.io/repo-name/product/<id>/
 * (or your custom domain root, e.g. https://zayvoltenergy.site/product/<id>/
 *  if you've set up a CNAME — see README)
 *
 * Your existing product.html script already reads the product ID from
 * this path format, so cart/WhatsApp/etc. keep working unchanged.
 *
 * USAGE (local):
 *   npm install firebase-admin
 *   node scripts/generate-static-products.js
 *   git add . && git commit -m "regenerate product pages" && git push
 *
 * Or let the GitHub Action in .github/workflows do all of this
 * automatically — see README.md.
 */

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

const SITE_URL = 'https://zayvoltenergy.site'; // change if using github.io URL instead
const DEFAULT_OG_IMAGE = `${SITE_URL}/default-og.jpg`; // set a real fallback image

const TEMPLATE_PATH = path.join(__dirname, '..', 'product.html');
const OUTPUT_ROOT = path.join(__dirname, '..', 'product');
const SITEMAP_PATH = path.join(__dirname, '..', 'sitemap-products.xml');

// Service account JSON comes from an env var in CI, or a local file when run manually
let credential;
const envKey = process.env.FIREBASE_SERVICE_ACCOUNT;
const localKeyPath = path.join(__dirname, 'serviceAccountKey.json');

if (envKey) {
  credential = admin.credential.cert(JSON.parse(envKey));
} else if (fs.existsSync(localKeyPath)) {
  credential = admin.credential.cert(require(localKeyPath));
} else {
  console.error(
    'No service account found. Either set FIREBASE_SERVICE_ACCOUNT env var, ' +
      'or save a key locally as scripts/serviceAccountKey.json (see README).'
  );
  process.exit(1);
}

admin.initializeApp({ credential });
const db = admin.firestore();

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeJsonForScriptTag(json) {
  return json.replace(/</g, '\\u003c');
}

function buildHtmlForProduct(template, id, p) {
  const name = [p.brand, p.model].filter(Boolean).join(' ').trim() || 'Product';
  const title = `${name} — ZayVolt Energy`;
  const desc = p.description || `${name} — solar product from ZayVolt Energy.`;
  const image = p.imageUrl || p.img || DEFAULT_OG_IMAGE;
  const url = `${SITE_URL}/product/${encodeURIComponent(id)}/`;
  const price = p.discountPrice || p.realPrice;

  const ldJson = {
    '@context': 'https://schema.org/',
    '@type': 'Product',
    name,
    description: p.description || undefined,
    image: image || undefined,
    brand: p.brand ? { '@type': 'Brand', name: p.brand } : undefined,
    offers: price
      ? {
          '@type': 'Offer',
          url,
          priceCurrency: 'PKR',
          price: String(price),
          availability: 'https://schema.org/InStock',
        }
      : undefined,
  };

  return template
    .replace(
      /<title id="pageTitle">.*?<\/title>/,
      `<title id="pageTitle">${escapeHtml(title)}</title>`
    )
    .replace(
      /(<meta name="description" id="pageDescription" content=")(.*?)(")/,
      `$1${escapeHtml(desc)}$3`
    )
    .replace(
      /(<link rel="canonical" id="canonicalLink" href=")(.*?)(")/,
      `$1${url}$3`
    )
    .replace(
      /(<meta property="og:url" id="ogUrl" content=")(.*?)(")/,
      `$1${url}$3`
    )
    .replace(
      /<script type="application\/ld\+json" id="productSchema">\{\}<\/script>/,
      `<script type="application/ld+json" id="productSchema">${escapeJsonForScriptTag(
        JSON.stringify(ldJson)
      )}</script>`
    )
    .replace(
      '</head>',
      [
        `<meta property="og:title" content="${escapeHtml(title)}" />`,
        `<meta property="og:description" content="${escapeHtml(desc)}" />`,
        `<meta property="og:image" content="${image}" />`,
        `<meta name="twitter:card" content="summary_large_image" />`,
        `<meta name="twitter:title" content="${escapeHtml(title)}" />`,
        `<meta name="twitter:description" content="${escapeHtml(desc)}" />`,
        `<meta name="twitter:image" content="${image}" />`,
        '</head>',
      ].join('\n')
    );
}

async function main() {
  const template = fs.readFileSync(TEMPLATE_PATH, 'utf8');
  const snapshot = await db.collection('products').get();

  if (snapshot.empty) {
    console.log('No products found — nothing to generate.');
    return;
  }

  fs.mkdirSync(OUTPUT_ROOT, { recursive: true });
  const sitemapEntries = [];

  snapshot.forEach((doc) => {
    const id = doc.id;
    const html = buildHtmlForProduct(template, id, doc.data());
    const dir = path.join(OUTPUT_ROOT, id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.html'), html, 'utf8');
    sitemapEntries.push(`  <url><loc>${SITE_URL}/product/${encodeURIComponent(id)}/</loc></url>`);
    console.log(`generated product/${id}/index.html`);
  });

  fs.writeFileSync(
    SITEMAP_PATH,
    '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
      sitemapEntries.join('\n') +
      '\n</urlset>\n',
    'utf8'
  );

  console.log(`\nDone — generated ${snapshot.size} product pages.`);
}

main().catch((err) => {
  console.error('Generation failed:', err);
  process.exit(1);
});
