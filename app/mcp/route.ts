import {env} from 'cloudflare:workers';
import {handleMcp} from '../../server/mcp';
export const dynamic='force-dynamic';
export const POST=(request:Request)=>handleMcp(request,env as never);
