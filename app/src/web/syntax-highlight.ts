export type SyntaxTokenKind=
  |"plain"|"comment"|"string"|"number"|"keyword"|"literal"|"type"|"function"|"property"|"operator"|"punctuation"
  |`bracket-${0|1|2|3|4|5}`;

export type SyntaxToken={text:string;kind:SyntaxTokenKind};
export type PositionedSyntaxToken=SyntaxToken&{offset:number};

const keywords=new Set([
  "abstract","and","as","async","await","break","case","catch","class","const","continue","debugger","declare","default","defer",
  "delete","do","elif","else","elseif","end","enum","export","extends","fallthrough","finally","for","from","function","global",
  "goto","if","implements","import","in","infer","instanceof","interface","is","keyof","let","local","match","module","namespace",
  "new","nonlocal","not","of","or","override","package","pass","private","protected","public","readonly","repeat","require","return",
  "select","static","struct","super","switch","then","throw","trait","try","type","typeof","until","using","var","virtual","when",
  "where","while","with","yield"
]);
const literals=new Set(["true","false","null","nil","none","undefined","nan","infinity","self","this"]);
const builtinTypes=new Set([
  "any","bigint","boolean","byte","char","double","float","int","integer","long","never","number","object","short","string","symbol",
  "unknown","void","array","map","record","set","promise","date","error"
]);
const opening=new Set(["(","[","{"]),closing=new Set([")","]","}"]);
const operatorCharacters=new Set([..."+-*/%=!<>&|^~?:"]);
const punctuationCharacters=new Set([",",";",".","@"]);

function push(tokens:SyntaxToken[],text:string,kind:SyntaxTokenKind){
  if(!text)return;
  const previous=tokens.at(-1);
  if(previous?.kind===kind)previous.text+=text;
  else tokens.push({text,kind});
}

function previousNonSpace(line:string,index:number){
  for(let cursor=index-1;cursor>=0;cursor--)if(!/\s/.test(line[cursor]))return line[cursor];
  return "";
}

function nextNonSpace(line:string,index:number){
  for(let cursor=index;cursor<line.length;cursor++)if(!/\s/.test(line[cursor]))return line[cursor];
  return "";
}

function quotedEnd(line:string,start:number,quote:string){
  for(let cursor=start+1;cursor<line.length;cursor++){
    if(line[cursor]==="\\"){cursor++;continue;}
    if(line[cursor]===quote)return cursor+1;
  }
  return line.length;
}

export function highlightCode(source:string){
  let depth=0,blockEnd:string|null=null,multilineQuote:string|null=null;
  return source.split("\n").map(line=>{
    const tokens:SyntaxToken[]=[];
    let cursor=0;
    while(cursor<line.length){
      if(blockEnd){
        const end=line.indexOf(blockEnd,cursor);
        if(end<0){push(tokens,line.slice(cursor),"comment");cursor=line.length;continue;}
        push(tokens,line.slice(cursor,end+blockEnd.length),"comment");cursor=end+blockEnd.length;blockEnd=null;continue;
      }
      if(multilineQuote){
        const end=quotedEnd(line,cursor-1,multilineQuote);
        push(tokens,line.slice(cursor,end),"string");
        if(end<line.length||line[end-1]===multilineQuote)multilineQuote=null;
        cursor=end;continue;
      }
      const rest=line.slice(cursor),firstNonSpace=line.slice(0,cursor).trim().length===0;
      if(rest.startsWith("/*")){const end=line.indexOf("*/",cursor+2);if(end<0){push(tokens,rest,"comment");blockEnd="*/";break;}push(tokens,line.slice(cursor,end+2),"comment");cursor=end+2;continue;}
      if(rest.startsWith("<!--")){const end=line.indexOf("-->",cursor+4);if(end<0){push(tokens,rest,"comment");blockEnd="-->";break;}push(tokens,line.slice(cursor,end+3),"comment");cursor=end+3;continue;}
      if(rest.startsWith("//")||(rest.startsWith("--")&&(firstNonSpace||/\s/.test(line[cursor-1]??"")))||(rest[0]==="#"&&firstNonSpace)){push(tokens,rest,"comment");break;}
      const character=line[cursor];
      if(character==='"'||character==="'"||character==="`"){
        const end=quotedEnd(line,cursor,character);
        push(tokens,line.slice(cursor,end),"string");
        if(character==="`"&&line[end-1]!==character)multilineQuote=character;
        cursor=end;continue;
      }
      if(/\s/.test(character)){let end=cursor+1;while(end<line.length&&/\s/.test(line[end]))end++;push(tokens,line.slice(cursor,end),"plain");cursor=end;continue;}
      if(opening.has(character)){push(tokens,character,`bracket-${depth%6}` as SyntaxTokenKind);depth++;cursor++;continue;}
      if(closing.has(character)){depth=Math.max(0,depth-1);push(tokens,character,`bracket-${depth%6}` as SyntaxTokenKind);cursor++;continue;}
      const number=rest.match(/^(?:0[xob][\da-f_]+|\d[\d_]*(?:\.\d[\d_]*)?(?:e[+-]?\d+)?)/i);
      if(number){push(tokens,number[0],"number");cursor+=number[0].length;continue;}
      const identifier=rest.match(/^[A-Za-z_$][\w$]*/);
      if(identifier){
        const text=identifier[0],lower=text.toLocaleLowerCase(),previous=previousNonSpace(line,cursor),next=nextNonSpace(line,cursor+text.length);
        const kind:SyntaxTokenKind=keywords.has(lower)?"keyword":literals.has(lower)?"literal":builtinTypes.has(lower)||/^[A-Z][A-Za-z0-9_$]*$/.test(text)?"type":next==="("?"function":previous==="."||next===":"?"property":"plain";
        push(tokens,text,kind);cursor+=text.length;continue;
      }
      if(operatorCharacters.has(character)){let end=cursor+1;while(end<line.length&&operatorCharacters.has(line[end]))end++;push(tokens,line.slice(cursor,end),"operator");cursor=end;continue;}
      if(punctuationCharacters.has(character)){push(tokens,character,"punctuation");cursor++;continue;}
      push(tokens,character,"plain");cursor++;
    }
    return tokens;
  });
}

export function positionedHighlightCode(source:string){
  const lines=highlightCode(source);
  let lineOffset=0;
  return lines.map((line,lineIndex)=>{
    let column=0;
    const positioned=line.map(token=>{const next:PositionedSyntaxToken={...token,offset:lineOffset+column};column+=token.text.length;return next;});
    lineOffset+=column+(lineIndex<lines.length-1?1:0);
    return positioned;
  });
}

const bracketPartner:Record<string,string>={"(":")","[":"]","{":"}",")":"(","]":"[","}":"{"};
function bracketTokens(lines:PositionedSyntaxToken[][]){return lines.flat().filter(token=>token.kind.startsWith("bracket-"));}

export function matchingBracketOffsets(source:string,caret:number,lines=positionedHighlightCode(source)){
  const brackets=bracketTokens(lines),candidate=brackets.find(token=>token.offset===caret)??brackets.find(token=>token.offset===caret-1);
  if(!candidate)return[] as number[];
  const index=brackets.indexOf(candidate),opens=opening.has(candidate.text),stack:string[]=[];
  if(opens){
    for(let cursor=index;cursor<brackets.length;cursor++){
      const token=brackets[cursor];
      if(opening.has(token.text))stack.push(token.text);
      else if(closing.has(token.text)){
        const open=stack.pop();
        if(!open||bracketPartner[open]!==token.text)return[];
        if(!stack.length)return[candidate.offset,token.offset];
      }
    }
  }else{
    for(let cursor=index;cursor>=0;cursor--){
      const token=brackets[cursor];
      if(closing.has(token.text))stack.push(token.text);
      else if(opening.has(token.text)){
        const close=stack.pop();
        if(!close||bracketPartner[close]!==token.text)return[];
        if(!stack.length)return[token.offset,candidate.offset];
      }
    }
  }
  return[];
}
