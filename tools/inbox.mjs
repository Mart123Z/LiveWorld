#!/usr/bin/env node
// LiveWorld — outil de la veille automatique (utilisé par la tâche planifiée Claude)
//
//   node tools/inbox.mjs context [--days 90]   → écrit sur la sortie standard le dossier de session autonome
//                                                (instructions + demande + état reconstitué à partir de inbox/)
//   node tools/inbox.mjs add <lot.json>        → valide le lot, l'enregistre dans inbox/<batch_id>.json
//                                                et met à jour inbox/index.json (code de sortie 1 si invalide)
//   node tools/inbox.mjs status                → résumé de la boîte de réception
//
// Le site lit inbox/index.json sur la branche INBOX.branch (voir js/config.js) et importe les lots manquants.
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
// LW_INBOX : dossier inbox à utiliser (par défaut <dépôt>/inbox ; la tâche planifiée pointe vers la branche claude/liveworld-inbox)
const inboxDir = process.env.LW_INBOX ? process.env.LW_INBOX : join(root, 'inbox');
const { analyzeBatch, applyBatch, parseInput } = await import(join(root, 'js/model.js'));
const { contextMd, dailyPrompt } = await import(join(root, 'js/exporter.js'));
const { emptyDb, COLLECTIONS } = await import(join(root, 'js/store.js'));
const { addDays, today } = await import(join(root, 'js/util.js'));

const readIndex = () => existsSync(join(inboxDir, 'index.json')) ? JSON.parse(readFileSync(join(inboxDir, 'index.json'), 'utf8')) : { schema: 'liveworld.inbox/v1', batches: [] };
function applyChanges(db, changes) { for (const c of COLLECTIONS) for (const d of changes[c] || []) { if (d._deleted) delete db[c][d.id]; else db[c][d.id] = d; } }

// Reconstitue la base à partir de tous les lots de la boîte de réception, dans l'ordre chronologique
function rebuild() {
  const db = emptyDb();
  for (const b of readIndex().batches.slice().sort((x, y) => x.generated_at < y.generated_at ? -1 : 1)) {
    const f = join(inboxDir, b.file); if (!existsSync(f)) continue;
    for (const raw of parseInput(readFileSync(f, 'utf8'))) { const an = analyzeBatch(raw, db); if (an.fatal.length) continue; applyChanges(db, applyBatch(db, an).changes); }
  }
  return db;
}

const [cmd, arg, arg2] = process.argv.slice(2);
if (cmd === 'context') {
  const days = arg === '--days' ? +arg2 || 90 : 90;
  const db = rebuild();
  const instructions = readFileSync(join(root, 'templates/INSTRUCTIONS_CLAUDE.md'), 'utf8');
  const prompt = dailyPrompt(db, 'daily', '') + `\n\nTu travailles en autonomie (tâche planifiée) : personne ne répondra à tes questions. Prends les décisions raisonnables toi-même et signale-les dans "notes".`;
  process.stdout.write(contextMd(db, { kind: 'range', from: addDays(today(), -(days - 1)), to: today() }, 'compact', { instructions, prompt }));
} else if (cmd === 'add') {
  if (!arg) { console.error('Usage : node tools/inbox.mjs add <lot.json>'); process.exit(2); }
  const db = rebuild();
  let raws; try { raws = parseInput(readFileSync(arg, 'utf8')); } catch (e) { console.error('JSON invalide : ' + e.message); process.exit(1); }
  if (!existsSync(inboxDir)) mkdirSync(inboxDir);
  const idx = readIndex(); let ok = true;
  for (const raw of raws) {
    const an = analyzeBatch(raw, db);
    if (an.fatal.length) { console.error('REFUSÉ : ' + an.fatal.join(' ; ')); ok = false; continue; }
    const k = t => an.events.filter(x => x.kind === t);
    const rej = k('rejected');
    console.log(`Lot ${an.meta.batch_id} : ${k('new').length} nouveaux, ${k('update').length} mises à jour, ${k('dup').length} doublons probables, ${rej.length} rejetés, ${an.links.valid.length} liens, ${an.markets.length} cotations, briefing : ${an.briefing ? 'oui' : 'non'}`);
    rej.forEach(x => console.error(`  REJETÉ ${x.inc?.id || '?'} : ${x.reasons.join(' ; ')}`));
    k('dup').forEach(x => console.error(`  DOUBLON PROBABLE ${x.inc.id} ≈ ${x.dupOf.id} (« ${x.dupOf.title} ») → réutilise l'id existant si c'est le même sujet`));
    an.warnings.forEach(w => console.error('  avertissement : ' + w));
    if (rej.length || k('dup').length) { console.error('Corrige les entrées signalées puis relance la commande.'); ok = false; continue; }
    if (!k('new').length && !k('update').length && !an.briefing && !an.markets.length) { console.error('REFUSÉ : lot vide.'); ok = false; continue; }
    if (idx.batches.some(b => b.batch_id === an.meta.batch_id)) { console.error(`REFUSÉ : batch_id ${an.meta.batch_id} déjà présent, choisis-en un nouveau.`); ok = false; continue; }
    const file = an.meta.batch_id.replace(/[^A-Za-z0-9_.-]/g, '-') + '.json';
    writeFileSync(join(inboxDir, file), JSON.stringify({ ...raw, batch_id: an.meta.batch_id, generated_at: an.meta.generated_at }, null, 1));
    idx.batches.push({ file, batch_id: an.meta.batch_id, generated_at: an.meta.generated_at, request: an.meta.request || '', events: k('new').length + k('update').length });
    idx.updated_at = new Date().toISOString();
    writeFileSync(join(inboxDir, 'index.json'), JSON.stringify(idx, null, 1));
    applyChanges(db, applyBatch(db, an).changes);
    console.log(`Enregistré : inbox/${file}`);
  }
  process.exit(ok ? 0 : 1);
} else if (cmd === 'status') {
  const idx = readIndex(); const db = rebuild();
  console.log(`${idx.batches.length} lot(s) · ${Object.keys(db.events).length} événement(s) · dernier : ${idx.batches.at(-1)?.generated_at || 'aucun'}`);
  for (const f of existsSync(inboxDir) ? readdirSync(inboxDir) : []) if (f.endsWith('.json') && f !== 'index.json' && !idx.batches.some(b => b.file === f)) console.log('  fichier hors index : ' + f);
} else {
  console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 11).join('\n'));
}
