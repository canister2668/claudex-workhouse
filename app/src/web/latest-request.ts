export function createLatestRequestGate(){
  let current=0;
  return{
    begin(){return++current;},
    isCurrent(ticket:number){return ticket===current;},
    value(){return current;}
  };
}
