import {readFile,mkdir,stat} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
const git=spawnSync('git',['rev-parse','HEAD'],{encoding:'utf8'});if(git.status)throw Error('Commit source before packaging.');const sha=git.stdout.trim();
const source=JSON.parse(await readFile('.openai/hosting.json','utf8'));const built=JSON.parse(await readFile('dist/.openai/hosting.json','utf8'));if(JSON.stringify(source)!==JSON.stringify(built))throw Error('Build manifest differs from source.');
await stat('dist/server/index.js');await stat('dist/.openai/drizzle/meta/_journal.json');await mkdir('outputs',{recursive:true});
const archive=path.resolve(`outputs/bird-family-hub-${sha.slice(0,8)}.tar`);
// Native Sites archive discovery resolves dist/server, with the hosting manifest at root.
const tar=spawnSync('tar',['-cf',archive,'.openai','dist'],{stdio:'inherit'});if(tar.status)process.exit(tar.status);
console.log(JSON.stringify({project_id:source.project_id,commit_sha:sha,archive}));
