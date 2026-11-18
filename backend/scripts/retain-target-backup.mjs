// Local file operation only. Never opens a network/database connection.
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';

process.umask(0o077);
const source='/private/tmp/atany-target-audit-d3Aw9E';
const target='/Users/honeycar/ATANY_Backups/2026-11-19/target-audit-d3Aw9E';
const keys='/Users/honeycar/.atany-backup-keys/2026-11-19-target-audit-d3Aw9E';
const original=JSON.parse(fs.readFileSync(path.join(source,'backup-result.json'),'utf8'));
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
assert.equal(original.backup.status,'verified');
function directory(p){
  if(fs.existsSync(p)){const s=fs.lstatSync(p);assert.ok(s.isDirectory()&&!s.isSymbolicLink()&&s.uid===process.getuid());}
  else fs.mkdirSync(p,{recursive:true,mode:0o700});
  fs.chmodSync(p,0o700);
}
for(const p of ['/Users/honeycar/ATANY_Backups','/Users/honeycar/ATANY_Backups/2026-11-19',target,'/Users/honeycar/.atany-backup-keys',keys])directory(p);
function copy(from,to){
  if(!fs.existsSync(to))fs.copyFileSync(from,to,fs.constants.COPYFILE_EXCL);
  assert.ok(!fs.lstatSync(to).isSymbolicLink());
  fs.chmodSync(to,0o600);
  assert.equal(sha(fs.readFileSync(from)),sha(fs.readFileSync(to)));
  const fd=fs.openSync(to,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
}
const encrypted=path.join(target,'database.dump.aesgcm'),keyFile=path.join(keys,'database.key');
copy(original.backup.encrypted_file,encrypted);copy(original.backup.key_file,keyFile);
const bytes=fs.readFileSync(encrypted),key=fs.readFileSync(keyFile);
assert.equal(sha(bytes),original.backup.encrypted_sha256);
assert.equal(bytes.subarray(0,8).toString(),'ATANYPG1');
const decipher=crypto.createDecipheriv('aes-256-gcm',key,bytes.subarray(8,20));
decipher.setAAD(bytes.subarray(0,8));decipher.setAuthTag(bytes.subarray(-16));
const plain=Buffer.concat([decipher.update(bytes.subarray(20,-16)),decipher.final()]);
assert.equal(sha(plain),original.backup.plain_sha256);
for(const name of ['audit.json','backup-result.json','local-restore-error.log'])copy(path.join(source,name),path.join(target,name));
const manifest={verified_at:new Date().toISOString(),archive:encrypted,key_file:keyFile,
  encrypted_sha256:sha(bytes),plaintext_sha256:sha(plain),archive_bytes:plain.length,
  checksum_matches_original:true,authenticated_decryption_verified:true,original_retained:true,
  file_mode:'0600',directory_mode:'0700',scope:'durable local copy; separate key directory; no cloud escrow'};
if(process.argv[2]){
  const recovery=process.argv[2];
  assert.ok(/^\/private\/tmp\/atany-compatible-recovery-[A-Za-z0-9]+$/.test(recovery));
  const verified=JSON.parse(fs.readFileSync(path.join(recovery,'verification.json'),'utf8'));
  const permissions=JSON.parse(fs.readFileSync(path.join(recovery,'permissions-verification.json'),'utf8'));
  assert.equal(verified.application_database_recovery,'verified');assert.equal(verified.local_server_stopped,true);
  assert.equal(permissions.findings_confirmed,true);assert.equal(permissions.local_server_stopped,true);
  const evidenceDir=path.join(target,'verification');directory(evidenceDir);
  for(const file of ['verification.json','permissions-verification.json'])copy(path.join(recovery,file),path.join(evidenceDir,file));
  manifest.recovery_evidence=evidenceDir;manifest.application_database_recovery_verified=true;manifest.full_supabase_project_recovery_verified=false;
}
fs.writeFileSync(path.join(target,'retention.json'),JSON.stringify(manifest,null,2),{mode:0o600});
const manifestFd=fs.openSync(path.join(target,'retention.json'),'r');try{fs.fsyncSync(manifestFd);}finally{fs.closeSync(manifestFd);}
for(const p of [target,keys]){const fd=fs.openSync(p,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
plain.fill(0);key.fill(0);
console.log(JSON.stringify({durable_archive:encrypted,checksum_matches_original:true,authenticated_decryption_verified:true,
  key_stored_in_separate_private_directory:true,original_retained:true}));
