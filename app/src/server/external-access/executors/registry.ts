import{z}from"zod";
import type{ExternalAccessAction}from"../types.js";
const noInput=z.object({}).strict();
const loopbackTarget=z.object({localTarget:z.string().regex(/^http:\/\/(?:127\.0\.0\.1|localhost|\[::1\]):[1-9]\d{0,4}$/)}).strict();
export const externalAccessActionRegistry:Record<ExternalAccessAction,{input:z.ZodTypeAny;mutates:boolean;secretInput:boolean}>={
 local_configuration_apply:{input:noInput,mutates:true,secretInput:false},
 tailscale_detect:{input:noInput,mutates:false,secretInput:false},tailscale_serve_plan:{input:loopbackTarget,mutates:false,secretInput:false},tailscale_serve_apply:{input:loopbackTarget,mutates:true,secretInput:false},tailscale_serve_remove:{input:noInput,mutates:true,secretInput:false},tailscale_recheck:{input:noInput,mutates:false,secretInput:false},
 cloudflare_detect:{input:noInput,mutates:false,secretInput:false},cloudflare_validate:{input:noInput,mutates:false,secretInput:false},cloudflare_managed_config_plan:{input:noInput,mutates:false,secretInput:false},cloudflare_managed_config_apply:{input:noInput,mutates:true,secretInput:true},cloudflare_managed_config_remove:{input:noInput,mutates:true,secretInput:false},cloudflare_service_start:{input:noInput,mutates:true,secretInput:false},cloudflare_service_restart:{input:noInput,mutates:true,secretInput:false},cloudflare_service_stop:{input:noInput,mutates:true,secretInput:false},cloudflare_recheck:{input:noInput,mutates:false,secretInput:false},external_access_test:{input:noInput,mutates:false,secretInput:false},external_access_rollback:{input:noInput,mutates:true,secretInput:false}
};
export const forbiddenBrowserExecutionFields=new Set(["executable","argv","command","shell","cwd","arbitraryPath","arbitraryUrl","rawConfigFile","rawDockerArgs"]);
export function assertNoBrowserExecutionFields(value:unknown,path="body"){
 if(!value||typeof value!=="object")return;
 for(const[key,item]of Object.entries(value)){if(forbiddenBrowserExecutionFields.has(key))throw Object.assign(new Error(`Forbidden execution field at ${path}.${key}.`),{statusCode:400,code:"ARBITRARY_EXECUTION_FIELD"});assertNoBrowserExecutionFields(item,`${path}.${key}`);}
}
