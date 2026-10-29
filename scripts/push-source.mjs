import {spawnSync} from 'node:child_process';
process.stdout.write('Ready for source credential JSON on stdin (input hidden).\n');
let raw='';for await(const chunk of process.stdin){raw+=chunk;if(raw.includes('\n'))break;}
const credential=JSON.parse(raw.trim());raw='';
if(!credential.remote_url||!credential.branch)throw Error('Missing repository access');
const remote='sites';const names=spawnSync('git',['remote'],{encoding:'utf8'}).stdout.split('\n');
const set=spawnSync('git',['remote',names.includes(remote)?'set-url':'add',remote,credential.remote_url],{stdio:'inherit'});if(set.status)process.exit(set.status);
const auth=credential.auth_mode==='work_proxy'?{}:{GIT_CONFIG_COUNT:'1',GIT_CONFIG_KEY_0:`http.${credential.remote_url}.extraHeader`,GIT_CONFIG_VALUE_0:`Authorization: Bearer ${credential.token}`};
const result=spawnSync('git',['push',remote,`HEAD:refs/heads/${credential.branch}`],{stdio:'inherit',env:{...process.env,...auth,GIT_TERMINAL_PROMPT:'0'}});
credential.token='';process.exit(result.status||0);
