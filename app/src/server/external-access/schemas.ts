import {z} from"zod";
export const providerSchema=z.enum(["local","tailscale","cloudflare"]);
const hostname=z.string().trim().min(1).max(253).regex(/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/i).refine(value=>!value.toLowerCase().endsWith(".local")&&!value.toLowerCase().endsWith(".localhost"),"A public DNS hostname is required.");
const localTarget=z.string().trim().regex(/^http:\/\/(?:127\.0\.0\.1|localhost|\[::1\]):(?:[1-9]\d{0,4})$/);
export const detectSchema=z.object({provider:providerSchema.optional()}).strict();
export const planInputSchema=z.union([
 z.object({provider:z.literal("local"),action:z.enum(["local_configuration_apply","external_access_test"])}).strict(),
 z.object({provider:z.literal("tailscale"),action:z.enum(["tailscale_serve_apply","tailscale_serve_remove","external_access_test"]),hostname:hostname.optional(),allowedEmail:z.string().trim().email().max(320).optional(),localTarget:localTarget.default("http://127.0.0.1:3410")}).strict(),
 z.object({provider:z.literal("cloudflare"),action:z.enum(["cloudflare_validate","cloudflare_managed_config_apply","cloudflare_managed_config_remove","external_access_test"]),hostname:hostname,teamDomain:z.string().url().max(2048).refine(value=>{try{return new URL(value).protocol==="https:"&&new URL(value).hostname.endsWith(".cloudflareaccess.com");}catch{return false;}},"A Cloudflare Access team domain is required.").optional(),audience:z.string().trim().min(1).max(256).regex(/^[A-Za-z0-9_-]+$/).optional(),allowedEmail:z.string().trim().email().max(320).optional(),localTarget:localTarget.default("http://127.0.0.1:3410"),runMode:z.enum(["existing","host","sidecar"]).default("existing"),token:z.string().min(40).max(4096).optional()}).strict()
]).superRefine((value,context)=>{if(value.provider==="tailscale"&&value.action==="tailscale_serve_apply"&&!value.allowedEmail)context.addIssue({code:z.ZodIssueCode.custom,path:["allowedEmail"],message:"An exact allowed email is required."});if(value.provider==="cloudflare"&&value.action==="cloudflare_managed_config_apply"){for(const key of["teamDomain","audience","allowedEmail","token"] as const)if(!value[key])context.addIssue({code:z.ZodIssueCode.custom,path:[key],message:`${key} is required for managed Cloudflare configuration.`});}});
export const applySchema=z.object({planDigest:z.string().regex(/^[a-f0-9]{64}$/),configurationRevision:z.number().int().nonnegative()}).strict();
export const testSchema=z.object({provider:providerSchema,profileId:z.string().uuid().optional()}).strict();
export const operationParamsSchema=z.object({id:z.string().uuid()}).strict();
export const profileParamsSchema=z.object({profileId:z.string().uuid()}).strict();
