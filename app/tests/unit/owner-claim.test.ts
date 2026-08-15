import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  OwnerClaimManager,
  isStrictLoopbackBootstrapRequest,
  ownerClaimApiAccess,
  ownerRecoveryMessage
} from "../../src/server/bootstrap/owner-claim.js";
import { DeckDatabase } from "../../src/server/db/client.js";

const created:string[]=[];
afterEach(()=>{
  for(const root of created.splice(0))fs.rmSync(root,{recursive:true,force:true});
});

async function fixture(options:{now?:()=>Date;existingInstallation?:boolean;forceRequired?:boolean}={}){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"claudex-owner-claim-"));created.push(root);
  fs.mkdirSync(path.join(root,"data"),{recursive:true});
  const db=new DeckDatabase(path.resolve("src/server/db/sqlite-worker.py"),path.join(root,"data","workhouse.sqlite"));
  await db.ping();
  const installationId=crypto.randomUUID();
  const manager=new OwnerClaimManager({
    root,
    db,
    installationId,
    serverUrls:["http://192.168.10.20:8787"],
    existingInstallation:options.existingInstallation??false,
    forceRequired:options.forceRequired??true,
    now:options.now
  });
  await manager.initialize();
  return{root,db,manager,installationId};
}
function recoveryProof(root:string,installationId:string,issuedAt=Date.now()){
  const identity=JSON.parse(
    fs.readFileSync(path.join(root,"data","infrastructure","server-identity.json"),"utf8")
  ) as{privateKeyPem:string};
  const nonce=crypto.randomUUID();
  return{
    issuedAt,
    nonce,
    signature:crypto.sign(
      null,
      Buffer.from(ownerRecoveryMessage(installationId,issuedAt,nonce)),
      crypto.createPrivateKey(identity.privateKeyPem)
    ).toString("base64url")
  };
}

describe("main server owner claim",()=>{
  it("stores only a token hash and consumes the enrollment exactly once",async()=>{
    const{db,manager}=await fixture();
    try{
      const local=manager.localPayload();
      const stored=await db.getBootstrapEnrollment(local.qr.enrollmentId);
      expect(stored.scope).toBe("server-owner");
      expect(stored.tokenHash).toMatch(/^[a-f0-9]{64}$/);
      expect(JSON.stringify(stored)).not.toContain(local.qr.claimToken);
      expect(local.claimUrl).toContain("/claim#");
      expect(local.claimUrl).not.toContain("?claimToken=");
      expect(JSON.stringify(manager.publicStatus())).not.toContain(local.qr.claimToken);

      const result=await manager.complete({
        enrollmentId:local.qr.enrollmentId,
        claimToken:local.qr.claimToken,
        serverFingerprint:local.qr.serverFingerprint
      });
      expect(result.ownerCredential).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect((await db.getBootstrapEnrollment(local.qr.enrollmentId)).consumedAt).toBeTruthy();
      expect(manager.authenticate({headers:{authorization:`Claudex-Owner ${result.ownerCredential}`}} as any)).toBe("owner");
      await expect(manager.complete({
        enrollmentId:local.qr.enrollmentId,
        claimToken:local.qr.claimToken,
        serverFingerprint:local.qr.serverFingerprint
      })).rejects.toMatchObject({code:"OWNER_ALREADY_CLAIMED"});
    }finally{await db.close();}
  });

  it("rejects expired tokens and a mismatched server fingerprint",async()=>{
    let now=new Date("2026-07-27T00:00:00.000Z");
    const{db,manager}=await fixture({now:()=>now});
    try{
      const local=manager.localPayload();
      await expect(manager.complete({
        enrollmentId:local.qr.enrollmentId,
        claimToken:local.qr.claimToken,
        serverFingerprint:"0".repeat(64)
      })).rejects.toMatchObject({code:"OWNER_FINGERPRINT_MISMATCH"});
      now=new Date("2026-07-27T00:10:01.000Z");
      await expect(manager.complete({
        enrollmentId:local.qr.enrollmentId,
        claimToken:local.qr.claimToken,
        serverFingerprint:local.qr.serverFingerprint
      })).rejects.toMatchObject({code:"OWNER_CLAIM_INVALID"});
    }finally{await db.close();}
  });

  it("invalidates an earlier unconsumed claim when a local renewal is created",async()=>{
    const{db,manager}=await fixture();
    try{
      const first=manager.localPayload();
      const second=await manager.rotate();
      expect(second.qr.enrollmentId).not.toBe(first.qr.enrollmentId);
      expect((await db.getBootstrapEnrollment(first.qr.enrollmentId)).consumedAt).toBeTruthy();
      await expect(manager.complete({
        enrollmentId:first.qr.enrollmentId,
        claimToken:first.qr.claimToken,
        serverFingerprint:first.qr.serverFingerprint
      })).rejects.toMatchObject({code:"OWNER_CLAIM_INVALID"});
    }finally{await db.close();}
  });

  it("keeps an existing authenticated installation usable unless claim is forced",async()=>{
    const{db,manager,installationId}=await fixture({existingInstallation:true,forceRequired:false});
    try{
      expect(manager.publicStatus()).toMatchObject({claimed:true,required:false,enrollment:null});
      expect((await db.getSystemSetting("owner.claim"))?.value).toMatchObject({
        claimed:true,
        migrated:true,
        installationId
      });
    }finally{await db.close();}
  });

  it("keeps an unclaimed fresh server claim-required across restarts",async()=>{
    const{root,db,manager,installationId}=await fixture({existingInstallation:false,forceRequired:false});
    try{
      const first=manager.localPayload();
      const restarted=new OwnerClaimManager({
        root,
        db,
        installationId,
        serverUrls:["http://192.168.10.20:8787"],
        existingInstallation:true,
        forceRequired:false
      });
      await restarted.initialize();
      const second=restarted.localPayload();
      expect(restarted.publicStatus()).toMatchObject({claimed:false,required:true});
      expect(second.qr.enrollmentId).not.toBe(first.qr.enrollmentId);
      expect((await db.getBootstrapEnrollment(first.qr.enrollmentId)).consumedAt).toBeTruthy();
      expect((await db.getSystemSetting("owner.claim"))?.value).toMatchObject({
        claimed:false,
        installationId
      });
      expect((await db.getSystemSetting("owner.claim"))?.value).not.toMatchObject({migrated:true});
    }finally{await db.close();}
  });

  it("allows exactly one concurrent completion for the same enrollment",async()=>{
    const{db,manager}=await fixture();
    try{
      const local=manager.localPayload(),input={
        enrollmentId:local.qr.enrollmentId,
        claimToken:local.qr.claimToken,
        serverFingerprint:local.qr.serverFingerprint
      };
      const results=await Promise.allSettled([manager.complete(input),manager.complete(input)]);
      expect(results.filter(result=>result.status==="fulfilled")).toHaveLength(1);
      expect(results.filter(result=>result.status==="rejected")).toHaveLength(1);
      const enrollment=await db.getBootstrapEnrollment(local.qr.enrollmentId);
      expect(enrollment.consumedAt).toBeTruthy();
    }finally{await db.close();}
  });

  it("serializes claim completion against local enrollment renewal",async()=>{
    const{root,db,manager,installationId}=await fixture();
    try{
      const local=manager.localPayload(),input={
        enrollmentId:local.qr.enrollmentId,
        claimToken:local.qr.claimToken,
        serverFingerprint:local.qr.serverFingerprint
      };
      const[completion,renewal]=await Promise.allSettled([
        manager.complete(input),
        manager.rotate()
      ]);
      expect(completion.status).toBe("fulfilled");
      expect(renewal).toMatchObject({
        status:"rejected",
        reason:{code:"OWNER_ALREADY_CLAIMED"}
      });
      const ownerCredential=completion.status==="fulfilled"?completion.value.ownerCredential:"";
      const restarted=new OwnerClaimManager({
        root,
        db,
        installationId,
        serverUrls:["http://192.168.10.20:8787"],
        existingInstallation:true,
        forceRequired:true
      });
      await restarted.initialize();
      expect(restarted.publicStatus()).toMatchObject({claimed:true,required:false,enrollment:null});
      expect(restarted.authenticate({
        headers:{authorization:`Claudex-Owner ${ownerCredential}`}
      } as any)).toBe("owner");
    }finally{await db.close();}
  });

  it("restores claimed owner authentication after a server restart",async()=>{
    const{root,db,manager,installationId}=await fixture();
    try{
      const local=manager.localPayload();
      const claimed=await manager.complete({
        enrollmentId:local.qr.enrollmentId,
        claimToken:local.qr.claimToken,
        serverFingerprint:local.qr.serverFingerprint
      });
      const restarted=new OwnerClaimManager({
        root,
        db,
        installationId,
        serverUrls:["http://192.168.10.20:8787"],
        existingInstallation:true,
        forceRequired:true
      });
      await restarted.initialize();
      expect(restarted.publicStatus()).toMatchObject({claimed:true,required:false});
      expect(restarted.authenticate({
        headers:{cookie:`claudex_owner=${claimed.ownerCredential}`}
      } as any)).toBe("owner");
    }finally{await db.close();}
  });

  it("recovers from a lost claim response by revoking the previous credential",async()=>{
    const{root,db,manager,installationId}=await fixture();
    try{
      const first=manager.localPayload();
      const claimed=await manager.complete({
        enrollmentId:first.qr.enrollmentId,
        claimToken:first.qr.claimToken,
        serverFingerprint:first.qr.serverFingerprint
      });
      const proof=recoveryProof(root,installationId);
      const replacement=await manager.recover(proof);
      expect(replacement.qr.enrollmentId).not.toBe(first.qr.enrollmentId);
      expect(manager.publicStatus()).toMatchObject({claimed:false,required:true});
      expect(manager.authenticate({
        headers:{authorization:`Claudex-Owner ${claimed.ownerCredential}`}
      } as any)).toBeNull();
      await expect(manager.recover(proof)).rejects.toMatchObject({
        code:"OWNER_RECOVERY_PROOF_REUSED"
      });

      const second=await manager.complete({
        enrollmentId:replacement.qr.enrollmentId,
        claimToken:replacement.qr.claimToken,
        serverFingerprint:replacement.qr.serverFingerprint
      });
      expect(second.ownerCredential).not.toBe(claimed.ownerCredential);
      expect(manager.authenticate({
        headers:{authorization:`Claudex-Owner ${second.ownerCredential}`}
      } as any)).toBe("owner");
    }finally{await db.close();}
  });

  it("fails closed into a new claim when owner state or server identity is corrupt",async()=>{
    const{root,db,manager,installationId}=await fixture();
    try{
      const first=manager.localPayload();
      await db.putSystemSetting("owner.claim",{
        claimed:true,
        claimedAt:new Date().toISOString(),
        fingerprint:first.qr.serverFingerprint,
        installationId,
        credentialHash:null,
        protocolVersion:1
      },new Date().toISOString());
      const malformedRestart=new OwnerClaimManager({
        root,
        db,
        installationId,
        serverUrls:["http://192.168.10.20:8787"],
        existingInstallation:true,
        forceRequired:true
      });
      await malformedRestart.initialize();
      expect(malformedRestart.publicStatus()).toMatchObject({claimed:false,required:true});
      expect((await db.getSystemSetting("owner.claim"))?.value).toMatchObject({
        claimed:false,
        installationId
      });

      const identityPath=path.join(root,"data","infrastructure","server-identity.json");
      const identity=JSON.parse(fs.readFileSync(identityPath,"utf8"));
      fs.writeFileSync(identityPath,`${JSON.stringify({...identity,fingerprint:"0".repeat(64)},null,2)}\n`);
      const identityRestart=new OwnerClaimManager({
        root,
        db,
        installationId,
        serverUrls:["http://192.168.10.20:8787"],
        existingInstallation:true,
        forceRequired:true
      });
      await identityRestart.initialize();
      expect(identityRestart.publicStatus()).toMatchObject({claimed:false,required:true});
      expect(identityRestart.fingerprint()).not.toBe(first.qr.serverFingerprint);
    }finally{await db.close();}
  });
});

describe("owner claim request boundaries",()=>{
  it("blocks general APIs before claim while keeping only bootstrap endpoints public",()=>{
    expect(ownerClaimApiAccess("/api/bootstrap/owner-claim/status",false)).toBe("public");
    expect(ownerClaimApiAccess("/api/tasks",false)).toBe("blocked");
    expect(ownerClaimApiAccess("/api/tasks",true)).toBe("normal");
  });

  it("allows raw claim payload access only over a direct loopback request",()=>{
    const direct={ip:"127.0.0.1",headers:{host:"localhost:8787"},raw:{socket:{remoteAddress:"127.0.0.1"}}};
    expect(isStrictLoopbackBootstrapRequest(direct as any)).toBe(true);
    for(const header of ["forwarded","x-forwarded-for","x-forwarded-host","x-forwarded-proto","x-real-ip","cf-connecting-ip"]){
      expect(isStrictLoopbackBootstrapRequest({
        ...direct,
        headers:{...direct.headers,[header]:"203.0.113.9"}
      } as any)).toBe(false);
    }
    expect(isStrictLoopbackBootstrapRequest({...direct,headers:{host:"192.168.10.20:8787"}} as any)).toBe(false);
  });
});
