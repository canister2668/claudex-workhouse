<script lang="ts">
  import { CheckCircle2, Clipboard, KeyRound, LoaderCircle, RefreshCw, ShieldCheck } from "@lucide/svelte";
  import { onMount } from "svelte";
  import QRCode from "qrcode";
  import { t } from "./i18n";

  export let api:(path:string,init?:RequestInit)=>Promise<any>;
  export let initialStatus:any=null;
  export let onclaimed:()=>void=()=>{};

  let status:any=initialStatus;
  let localPayload:any=null;
  let qrDataUrl="";
  let loading=true;
  let completing=false;
  let renewing=false;
  let copied=false;
  let error="";
  let remaining="";
  let countdown:ReturnType<typeof setInterval>|null=null;
  let parsedClaimFields:{enrollmentId:string|null;claimToken:string|null;serverFingerprint:string|null}|null=null;

  type ClaimFields={enrollmentId:string|null;claimToken:string|null;serverFingerprint:string|null};
  function claimFields():ClaimFields|null{
    return parsedClaimFields;
  }
  function localClaimFields():ClaimFields|null{
    const qr=localPayload?.qr;
    return qr?{enrollmentId:qr.enrollmentId??null,claimToken:qr.claimToken??null,serverFingerprint:qr.serverFingerprint??null}:null;
  }
  function updateRemaining(){
    const expiresAt=localPayload?.qr?.expiresAt??status?.enrollment?.expiresAt;
    const milliseconds=typeof expiresAt==="string"?new Date(expiresAt).getTime()-Date.now():0;
    if(milliseconds<=0){remaining=$t("ownerClaim.expired");return;}
    const seconds=Math.ceil(milliseconds/1000);
    remaining=`${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,"0")}`;
  }
  async function renderQr(){
    const qr=localPayload?.qr;
    if(!qr)return;
    qrDataUrl=await QRCode.toDataURL(JSON.stringify(qr),{
      errorCorrectionLevel:"M",
      margin:2,
      width:320,
      color:{dark:"#101218",light:"#ffffff"}
    });
  }
  async function loadLocalPayload(){
    try{
      localPayload=await api("/api/bootstrap/owner-claim/local");
      await renderQr();
    }catch{/* A remote browser receives the token through the claim URL fragment instead. */}
  }
  async function completeClaim(fields:ClaimFields|null=claimFields()){
    if(!fields)return;
    if(!fields.enrollmentId||!fields.claimToken||!fields.serverFingerprint){
      error=$t("ownerClaim.invalidLink");
      return;
    }
    if(status?.serverFingerprint&&status.serverFingerprint!==fields.serverFingerprint){
      error=$t("ownerClaim.mismatch");
      return;
    }
    completing=true;
    error="";
    try{
      await api("/api/bootstrap/owner-claim/complete",{
        method:"POST",
        body:JSON.stringify(fields)
      });
      history.replaceState(null,"","/");
      onclaimed();
    }catch(value){
      error=value instanceof Error?value.message:String(value);
    }finally{completing=false;}
  }
  async function renew(){
    renewing=true;
    error="";
    try{
      localPayload=await api("/api/bootstrap/owner-claim/renew",{
        method:"POST",
        body:JSON.stringify({confirm:true})
      });
      status=localPayload;
      await renderQr();
      updateRemaining();
    }catch(value){error=value instanceof Error?value.message:String(value)}
    finally{renewing=false;}
  }
  async function copyClaimLink(){
    if(!localPayload?.claimUrl)return;
    await navigator.clipboard.writeText(localPayload.claimUrl);
    copied=true;
    setTimeout(()=>copied=false,1800);
  }

  onMount(()=>{
    const fragment=new URLSearchParams(location.hash.replace(/^#/,""));
    const enrollmentId=fragment.get("enrollmentId"),claimToken=fragment.get("claimToken"),serverFingerprint=fragment.get("serverFingerprint");
    if(enrollmentId||claimToken||serverFingerprint){
      parsedClaimFields={enrollmentId,claimToken,serverFingerprint};
      history.replaceState(null,"",`${location.pathname}${location.search}`);
    }
    void (async()=>{
      try{
        status=status??await api("/api/bootstrap/owner-claim/status");
        if(!status?.required){onclaimed();return;}
        const fields=claimFields();
        if(fields)await completeClaim();
        else await loadLocalPayload();
      }catch(value){error=value instanceof Error?value.message:String(value)}
      finally{loading=false;updateRemaining();}
    })();
    countdown=setInterval(updateRemaining,1000);
    return()=>{if(countdown)clearInterval(countdown);}
  });
</script>

<svelte:head><title>{$t("brand.name")} · {$t("ownerClaim.title")}</title></svelte:head>

<main class="claim-shell">
  <section class="claim-card" aria-labelledby="owner-claim-title">
    <header>
      <span class="claim-mark"><ShieldCheck size={28}/></span>
      <span><h1 id="owner-claim-title">{$t("ownerClaim.title")}</h1><p>{$t("ownerClaim.body")}</p></span>
    </header>

    {#if loading||completing}
      <div class="claim-progress" aria-live="polite"><LoaderCircle class="spin" size={28}/><strong>{$t(completing?"ownerClaim.completing":"ownerClaim.scanning")}</strong></div>
    {:else if status?.claimed}
      <div class="claim-progress complete"><CheckCircle2 size={30}/><strong>{$t("ownerClaim.complete")}</strong></div>
    {:else}
      {#if localPayload?.qr}
        <section class="this-device">
          <strong>{$t("ownerClaim.thisDeviceTitle")}</strong>
          <p>{$t("ownerClaim.thisDeviceBody")}</p>
          <button class="continue" type="button" onclick={()=>completeClaim(localClaimFields())}><ShieldCheck size={17}/>{$t("ownerClaim.continueThisDevice")}</button>
        </section>
        <details class="other-device">
          <summary>{$t("ownerClaim.otherDeviceTitle")}</summary>
          <p class="local-copy">{$t("ownerClaim.otherDeviceBody")}</p>
          <div class="qr-wrap">{#if qrDataUrl}<img src={qrDataUrl} alt={$t("ownerClaim.otherDeviceTitle")}/>{/if}</div>
          <div class="claim-link"><code>{localPayload.claimUrl}</code><button type="button" onclick={copyClaimLink}><Clipboard size={15}/>{$t(copied?"common.copied":"ownerClaim.copyLink")}</button></div>
        </details>
      {:else if !claimFields()}
        <div class="claim-progress"><KeyRound size={28}/><strong>{$t("ownerClaim.localOnly")}</strong></div>
      {/if}
      <details class="technical">
        <summary>{$t("ownerClaim.technicalDetails")}</summary>
        <dl>
          <div><dt>{$t("ownerClaim.fingerprint")}</dt><dd>{status?.serverFingerprint??"—"}</dd></div>
          <div><dt>{$t("ownerClaim.expiresIn",{time:remaining||"—"})}</dt><dd>{status?.enrollment?.expiresAt??"—"}</dd></div>
        </dl>
      </details>
      {#if status?.enrollment?.expired&&localPayload?.localAccess}<button class="renew" type="button" disabled={renewing} onclick={renew}><RefreshCw class={renewing?"spin":""} size={16}/>{$t(renewing?"ownerClaim.renewing":"ownerClaim.renew")}</button>{/if}
    {/if}
    {#if error}<p class="claim-error" role="alert">{error}</p>{/if}
  </section>
</main>

<style>
  .claim-shell{position:fixed;inset:0;z-index:200;display:grid;place-items:center;padding:1rem;background:radial-gradient(circle at top,color-mix(in srgb,var(--accent) 18%,var(--bg)),var(--bg) 52%)}.claim-card{width:min(560px,100%);max-height:calc(100dvh - 2rem);overflow:auto;display:grid;gap:1rem;padding:1.2rem;border:1px solid var(--line);border-radius:22px;background:var(--panel);box-shadow:0 20px 70px #0006}.claim-card>header{display:grid;grid-template-columns:auto 1fr;align-items:start;gap:.8rem}.claim-mark{display:grid;place-items:center;width:52px;height:52px;border-radius:15px;color:var(--accent);background:var(--accent-soft)}h1,p{margin:0}.claim-card header p,.local-copy,.this-device p{margin-top:.28rem;color:var(--muted);line-height:1.5}.claim-progress{min-height:180px;display:grid;place-items:center;align-content:center;gap:.7rem;text-align:center;color:var(--muted)}.claim-progress.complete{color:var(--good)}.this-device{display:grid;gap:.7rem;padding:1rem;border:1px solid color-mix(in srgb,var(--accent) 45%,var(--line));border-radius:14px;background:color-mix(in srgb,var(--accent) 7%,var(--panel))}.continue{min-height:46px;display:inline-flex;align-items:center;justify-content:center;gap:.4rem;border-color:var(--accent);background:var(--accent);color:white;font-weight:700}.other-device,.technical{border:1px solid var(--line);border-radius:12px;padding:.75rem}.other-device summary,.technical summary{cursor:pointer;font-weight:700}.qr-wrap{display:grid;place-items:center;margin-top:.7rem}.qr-wrap img{width:min(280px,75vw);height:auto;border-radius:14px;background:white}.claim-link{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:.45rem;margin-top:.7rem}.claim-link code{padding:.65rem;border-radius:10px;background:var(--bg);overflow:auto;white-space:nowrap}.claim-link button,.renew{display:inline-flex;align-items:center;justify-content:center;gap:.35rem}dl{display:grid;gap:.45rem;margin:.7rem 0 0}dl div{display:grid;gap:.18rem;padding:.55rem;border-radius:10px;background:var(--bg)}dt{font-size:.72rem;color:var(--muted)}dd{margin:0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.76rem;overflow-wrap:anywhere}.renew{justify-self:start}.claim-error{padding:.65rem;border:1px solid color-mix(in srgb,var(--danger) 48%,var(--line));border-radius:10px;color:var(--danger);background:color-mix(in srgb,var(--danger) 8%,var(--panel))}@media(max-width:600px){.claim-shell{padding:0}.claim-card{width:100%;height:100dvh;max-height:none;border:0;border-radius:0;padding:max(1rem,env(safe-area-inset-top)) 1rem max(1rem,env(safe-area-inset-bottom))}.claim-link{grid-template-columns:1fr}.claim-link button{min-height:44px}}
</style>
