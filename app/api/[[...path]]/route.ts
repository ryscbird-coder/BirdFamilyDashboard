import {env} from 'cloudflare:workers';
import {handleApi} from '../../../server/api';
export const dynamic='force-dynamic';
const route=(request:Request)=>handleApi(request,env as never);
export {route as GET,route as POST,route as PATCH,route as PUT,route as DELETE};
