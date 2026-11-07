/** Generate the app's public runtime projection. Does not copy authoring/research metadata. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const catalog = path.resolve(root, '../hq-buddies-catalog');
const read = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const records = read(path.join(catalog, 'data/buddies.json'));
const manifest = read(path.join(catalog, 'art/asset-manifest.json'));
const overlay = read(path.join(catalog, 'data/asset-references.json'));
const published = read(path.resolve(root, '../hq-infra-setup/asset-publishing/record-asset-map.json'));
const assert = (ok, message) => { if (!ok) throw new Error(message); };
const ids = records.map(r => r.id).sort();
assert(ids.length === 24 && new Set(ids).size === 24, 'Expected 24 canonical buddy IDs');
assert(JSON.stringify(ids) === JSON.stringify(Object.keys(published.buddies).sort()), 'Published ID mismatch');
assert(manifest.version === '0.1.0' && manifest.status === 'complete', 'Unpinned/incomplete art manifest');
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
let totalBytes = 0;
const buddies = records.map(r => {
  assert(r.catalog_version === '0.1.0', `Unpinned catalog: ${r.id}`);
  const assets = published.buddies[r.id];
  const art = manifest.subjects.find(s => s.id === r.id);
  const refs = overlay.records[r.id]?.metadata;
  assert(art?.status === 'ready' && refs && assets.art_version === '0.1.0', `Unready buddy: ${r.id}`);
  const image = (key, width) => {
    const file = art[key];
    const bytes = fs.readFileSync(path.join(catalog, file.path));
    const hash = sha256(bytes);
    const url = assets[`${key}_https_url`];
    assert(file.width === width && file.height === width && file.bytes === bytes.length, `Wrong dimensions/bytes: ${r.id}/${key}`);
    assert(hash === file.sha256 && hash === assets[`${key}_sha256`] && hash === refs[`${key}_sha256`], `Asset hash mismatch: ${r.id}/${key}`);
    assert(url === `https://habbit-quest-assets.s3.us-east-1.amazonaws.com/${assets[`${key}_s3_key`]}` && assets[`${key}_s3_key`].startsWith('buddies/catalog-0.1.0/art-0.1.0/9717ad52fb16/'), `Unpinned URL: ${r.id}/${key}`);
    totalBytes += bytes.length;
    return { url, width, height: width, alt: r.assets[`${key}_alt`] };
  };
  return { id:r.id, name:r.name, kind:r.kind, groupId:r.group_id, speciesOrForm:r.species_or_form,
    primaryAgeBand:r.primary_age_band, supportedAgeMin:r.supported_age_min, supportedAgeMax:r.supported_age_max,
    tone:r.tone, interestTags:r.interest_tags, description:r.description, visualComplexity:r.appearance.visual_complexity,
    altText:r.assets.image_alt, available:true, portrait:image('icon',128), full:image('image',768) };
});
const output = `${JSON.stringify({catalogVersion:'0.1.0',artVersion:'0.1.0',buddies},null,2)}\n`;
const destination = path.join(root, 'frontend/src/data/buddyCatalog.json');
if (process.argv.includes('--check')) assert(fs.readFileSync(destination, 'utf8') === output, 'Generated buddy catalog is stale');
else fs.writeFileSync(destination, output);
console.log(`${process.argv.includes('--check') ? 'Checked' : 'Packaged'} ${buddies.length} buddies, 48 assets, ${totalBytes} verified bytes; projection sha256 ${sha256(output)}`);
