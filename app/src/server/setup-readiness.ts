/**
 * Composes the setup screen's per-provider readiness from two probes that are
 * allowed to be late independently.
 *
 * The runtime list and the connection accounts describe different things and
 * cost different amounts: the accounts alone reach the authentication refresh
 * and, off the managed-Worker path, the DeepSeek and Ollama health checks. So
 * one of them routinely answers inside the setup budget while the other is
 * still running, and a missing row means "still checking" or "genuinely not
 * there" depending on *which* probe was late. Inferring that from both results
 * being empty made the fast probe's answer imply the slow one had reported
 * nothing — which is how an installed, signed-in provider was shown as needing
 * diagnosis.
 */
export type SetupProbeResult<T>={value:T;pending:boolean};

export type SetupProviderReadiness={
  provider:"claude"|"codex";
  name:string;
  state:"checking"|"not-installed"|"ready"|"login-required"|"diagnostic-required";
  installed:boolean;
  version:string|null;
  accountState:string;
  errorCategory:string|null;
  probePending:boolean;
};

export function setupProviderReadiness(
  runtimeResult:SetupProbeResult<any[]>,
  accountResult:SetupProbeResult<any[]>
):SetupProviderReadiness[]{
  const probePending=runtimeResult.pending||accountResult.pending;
  return(["claude","codex"] as const).map(provider=>{
    const runtime=runtimeResult.value.find(item=>item?.provider===provider);
    const account=accountResult.value.find(item=>item?.provider===provider);
    const installed=Boolean(runtime?.current);
    const state=probePending
      ?"checking" as const
      :!installed
        ?"not-installed" as const
        :account?.state==="connected"
          ?"ready" as const
          :account?.state==="disconnected"
            ?"login-required" as const
            :"diagnostic-required" as const;
    return{
      provider,
      name:provider==="claude"?"Claude Code":"Codex",
      state,
      installed,
      version:runtime?.current??null,
      // Only the accounts probe can answer this one, so only its own lateness
      // turns it into `checking`.
      accountState:accountResult.pending?"checking":account?.state??"unavailable",
      errorCategory:account?.errorCategory??null,
      probePending
    };
  });
}
