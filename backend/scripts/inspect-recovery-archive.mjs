// Offline archive metadata inspection; decrypted data stays in memory.
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {spawnSync} from 'node:child_process';import assert from 'node:assert/strict';
process.umask(0o077);
const source='/Users/honeycar/ATANY_Backups/2026-11-19/target-audit-d3Aw9E';
const manifest=JSON.parse(fs.readFileSync(path.join(source,'retention.json'),'utf8'));
const bytes=fs.readFileSync(manifest.archive),key=fs.readFileSync(manifest.key_file);
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');assert.equal(hash(bytes),manifest.encrypted_sha256);
const d=crypto.createDecipheriv('aes-256-gcm',key,bytes.subarray(8,20));d.setAAD(bytes.subarray(0,8));d.setAuthTag(bytes.subarray(-16));
const archive=Buffer.concat([d.update(bytes.subarray(20,-16)),d.final()]);assert.equal(hash(archive),manifest.plaintext_sha256);
const root=fs.mkdtempSync('/private/tmp/atany-recovery-analysis-');fs.chmodSync(root,0o700);
function restore(args){const r=spawnSync('/opt/homebrew/bin/pg_restore',args,{input:archive,maxBuffer:32*1024*1024});assert.equal(r.status,0);return r.stdout.toString();}
const toc=restore(['--list','--verbose']);fs.writeFileSync(path.join(root,'toc.private.txt'),toc,{mode:0o600});
const schema=restore(['--schema-only','--file','-']);fs.writeFileSync(path.join(root,'schema.private.sql'),schema,{mode:0o600});
const sections=schema.split(/(?=-- Name: )/);
const dependencies=sections.filter(s=>/\b(?:supabase_vault|vault)\b/i.test(s)).map(s=>s.match(/^-- Name: (.*); Type: (.*); Schema: (.*); Owner: (.*)$/m)?.slice(1)||['preamble']);
const publicReferences=sections.filter(s=>/; Schema: public;/.test(s.split('\n')[0])&&/\b(?:supabase_vault|vault)\b/i.test(s)).map(s=>s.split('\n')[0]);
const tables=JSON.parse(fs.readFileSync(path.join(source,'backup-result.json'),'utf8')).backup.source_tables;
const result={analysis_directory:root,vault_toc_entries:toc.split('\n').filter(l=>/vault|supabase_vault/i.test(l)&&!l.trim().startsWith(';')),
  vault_schema_dependencies:dependencies,public_objects_referencing_vault:publicReferences,
  vault_table_rows:Object.fromEntries(Object.entries(tables).filter(([k])=>k.startsWith('vault.')).map(([k,v])=>[k,v.rows])),
  schemas:[...new Set(Object.keys(tables).map(k=>k.split('.')[0]))].sort()};
fs.writeFileSync(path.join(root,'analysis.json'),JSON.stringify(result,null,2),{mode:0o600});
console.log(JSON.stringify(result,null,2));archive.fill(0);key.fill(0);
