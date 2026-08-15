export type PairingSnapshot = {
  id:string;
  status:"waiting"|"paired"|"expired";
  code?:string;
  [key:string]:unknown;
};

// Status polling intentionally does not return the one-time pairing code.
// Keep the code only while the same in-memory attempt is still waiting, then
// discard it as soon as the attempt reaches a terminal state.
export function mergePairingStatus(current:PairingSnapshot,next:PairingSnapshot):PairingSnapshot{
  const merged={...current,...next};
  if(next.status==="waiting"&&!next.code&&current.id===next.id&&current.code)merged.code=current.code;
  if(next.status!=="waiting")delete merged.code;
  return merged;
}
