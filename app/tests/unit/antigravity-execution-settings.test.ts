import{describe,expect,it}from"vitest";
import{antigravityExecutionKey,antigravityExecutionSettingsSchema,normalizeAntigravityExecutionSettings,parseGoogleCredentialJson}from"../../src/server/antigravity-execution-settings";

describe("Antigravity execution settings",()=>{
  it("keeps existing installations on consumer OAuth",()=>expect(normalizeAntigravityExecutionSettings(null).backend).toBe("consumer"));
  it("requires a project for Vertex",()=>expect(antigravityExecutionSettingsSchema.safeParse({version:1,backend:"vertex",vertex:{projectId:"",location:"global",credentialsPath:""}}).success).toBe(false));
  it("accepts ADC-backed Vertex settings and isolates their cache key",()=>{
    const settings=antigravityExecutionSettingsSchema.parse({version:1,backend:"vertex",vertex:{projectId:"my-vertex-project",location:"asia-northeast3",credentialsPath:"/secure/adc.json"}});
    expect(antigravityExecutionKey(settings)).toBe("vertex:my-vertex-project:asia-northeast3:/secure/adc.json");
  });
  it("accepts only the exact Google Cloud Billing credits page shape",()=>{const base={version:1,backend:"vertex",vertex:{projectId:"my-vertex-project",location:"global",credentialsPath:"/secure/adc.json"}};expect(antigravityExecutionSettingsSchema.safeParse({...base,vertex:{...base.vertex,creditsUrl:"https://console.cloud.google.com/billing/ABCDEF-123456-7890AB/credits/all?authuser=4&organizationId=0"}}).success).toBe(true);expect(antigravityExecutionSettingsSchema.safeParse({...base,vertex:{...base.vertex,creditsUrl:"https://evil.example/billing/ABCDEF-123456-7890AB/credits/all"}}).success).toBe(false);});
  it("accepts a complete Google service-account key without exposing the private key",()=>{
    expect(parseGoogleCredentialJson({type:"service_account",project_id:"sample-project-123",client_email:"worker@sample-project-123.iam.gserviceaccount.com",private_key:"-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----"})).toEqual({type:"service_account",projectId:"sample-project-123",accountLabel:"worker@sample-project-123.iam.gserviceaccount.com"});
  });
  it("rejects arbitrary JSON and incomplete credential objects",()=>{
    expect(()=>parseGoogleCredentialJson({hello:"world"})).toThrow(/Supported Google credential types/);expect(()=>parseGoogleCredentialJson({type:"service_account",client_email:"missing@example.com"})).toThrow(/private_key/);
  });
});
