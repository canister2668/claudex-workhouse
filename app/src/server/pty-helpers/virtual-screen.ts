/** A small terminal screen for reading Claude Code's TUI through ConPTY.
 *
 * On Linux the helpers read the program's own byte stream from a pty and only
 * strip escape sequences. A Windows pseudo console does not forward that
 * stream: conhost renders the program into its screen buffer and emits the
 * *difference* as VT output — cursor jumps instead of spaces, repainted rows,
 * erase-in-line instead of blanks. Stripping escapes from that would glue
 * words together ("Quicksafetycheck"). This keeps just enough of a terminal to
 * rebuild the visible text: a character grid, the cursor, erase and scroll
 * operations, and the rows that scrolled off the top.
 *
 * Rows that wrapped because the cursor ran past the last column are joined
 * back without a line break, so a long URL stays one token. */

const MAX_HISTORY_ROWS=4000;

export class VirtualScreen{
  private grid:string[][];
  private wrapped:boolean[];
  private history:string[]=[];
  private row=0;
  private col=0;
  private pendingWrap=false;
  private savedCursor:[number,number]=[0,0];
  private pending="";
  constructor(readonly cols:number,readonly rows:number){
    this.grid=Array.from({length:rows},()=>this.blank());
    this.wrapped=Array.from({length:rows},()=>false);
  }
  private blank(){return Array.from({length:this.cols},()=>" ");}

  /** Feeds output; an escape sequence split across chunks is completed by the next call. */
  write(data:string){
    let text=this.pending+data;this.pending="";
    for(let index=0;index<text.length;){
      const char=text[index];
      if(char==="\x1b"){
        const consumed=this.escape(text,index);
        if(consumed<0){this.pending=text.slice(index);if(this.pending.length>4096)this.pending="";return;}
        index+=consumed;continue;
      }
      index++;
      if(char==="\r"){this.col=0;this.pendingWrap=false;}
      else if(char==="\n"||char==="\v"||char==="\f")this.lineFeed(false);
      else if(char==="\b"){this.col=Math.max(0,this.col-1);this.pendingWrap=false;}
      else if(char==="\t"){this.col=Math.min(this.cols-1,(Math.floor(this.col/8)+1)*8);}
      else if(char==="\x07"||char==="\x0e"||char==="\x0f"||char<" "||char==="\x7f")continue;
      else this.put(char);
    }
  }

  private put(char:string){
    if(this.pendingWrap){this.pendingWrap=false;this.wrapped[this.row]=true;this.col=0;this.lineFeed(true);}
    this.grid[this.row][this.col]=char;
    if(this.col===this.cols-1)this.pendingWrap=true;else this.col++;
  }

  private lineFeed(continuation:boolean){
    this.pendingWrap=false;
    if(!continuation)this.wrapped[this.row]=false;
    if(this.row===this.rows-1)this.scrollUp(1,true);else this.row++;
  }

  private scrollUp(count:number,keepHistory:boolean){
    for(let step=0;step<count;step++){
      const line=this.grid.shift()!,wrapped=this.wrapped.shift()!;
      if(keepHistory){
        const text=line.join("").replace(/\s+$/,"");
        // A wrapped row continues on the next one, so join without a newline.
        if(this.history.length&&this.historyContinues)this.history[this.history.length-1]+=text;else this.history.push(text);
        this.historyContinues=wrapped;
        if(this.history.length>MAX_HISTORY_ROWS)this.history.splice(0,this.history.length-MAX_HISTORY_ROWS);
      }
      this.grid.push(this.blank());this.wrapped.push(false);
    }
  }
  private historyContinues=false;

  private eraseLine(mode:number,row=this.row){
    const line=this.grid[row];
    const [from,to]=mode===1?[0,this.col+1]:mode===2?[0,this.cols]:[this.col,this.cols];
    for(let index=from;index<to;index++)line[index]=" ";
    if(mode!==1)this.wrapped[row]=false;
  }

  /** Returns the number of characters consumed, or -1 when the sequence is incomplete. */
  private escape(text:string,start:number):number{
    if(start+1>=text.length)return -1;
    const kind=text[start+1];
    if(kind==="["){
      let index=start+2;
      while(index<text.length&&/[0-?]/.test(text[index]))index++;
      while(index<text.length&&/[ -/]/.test(text[index]))index++;
      if(index>=text.length)return -1;
      const parameters=text.slice(start+2,index),final=text[index];
      this.csi(parameters,final);
      return index-start+1;
    }
    if(kind==="]"||kind==="P"||kind==="_"||kind==="^"){
      // OSC / DCS / APC / PM: skip to BEL or ST.
      for(let index=start+2;index<text.length;index++){
        if(text[index]==="\x07")return index-start+1;
        if(text[index]==="\x1b"&&index+1<text.length&&text[index+1]==="\\")return index-start+2;
        if(text[index]==="\x1b"&&index+1>=text.length)return -1;
      }
      return -1;
    }
    if(kind==="("||kind===")"||kind==="*"||kind==="+"||kind==="#"){if(start+2>=text.length)return -1;return 3;}
    if(kind==="7"){this.savedCursor=[this.row,this.col];return 2;}
    if(kind==="8"){[this.row,this.col]=this.savedCursor;this.pendingWrap=false;return 2;}
    if(kind==="D"){this.lineFeed(false);return 2;}
    if(kind==="E"){this.col=0;this.lineFeed(false);return 2;}
    if(kind==="M"){if(this.row>0)this.row--;return 2;}
    if(kind==="c"){this.reset();return 2;}
    return 2;
  }

  private reset(){this.grid=Array.from({length:this.rows},()=>this.blank());this.wrapped=this.wrapped.map(()=>false);this.row=0;this.col=0;this.pendingWrap=false;}

  private csi(parameters:string,final:string){
    if(parameters.startsWith("?")||parameters.startsWith(">")||parameters.startsWith("="))return;// modes, device queries
    const values=parameters.split(";").map(item=>{const value=Number.parseInt(item,10);return Number.isFinite(value)?value:0;});
    const first=values[0]||0,count=Math.max(1,first);
    const clampRow=(value:number)=>Math.max(0,Math.min(this.rows-1,value)),clampCol=(value:number)=>Math.max(0,Math.min(this.cols-1,value));
    switch(final){
      case"H":case"f":this.row=clampRow((values[0]||1)-1);this.col=clampCol((values[1]||1)-1);this.pendingWrap=false;return;
      case"A":this.row=clampRow(this.row-count);this.pendingWrap=false;return;
      case"B":case"e":this.row=clampRow(this.row+count);this.pendingWrap=false;return;
      case"C":case"a":this.col=clampCol(this.col+count);this.pendingWrap=false;return;
      case"D":this.col=clampCol(this.col-count);this.pendingWrap=false;return;
      case"E":this.row=clampRow(this.row+count);this.col=0;this.pendingWrap=false;return;
      case"F":this.row=clampRow(this.row-count);this.col=0;this.pendingWrap=false;return;
      case"G":case"`":this.col=clampCol(count-1);this.pendingWrap=false;return;
      case"d":this.row=clampRow(count-1);this.pendingWrap=false;return;
      case"K":this.eraseLine(first);return;
      case"J":
        if(first===2||first===3){
          // A full clear keeps what was on screen as history, the way a real
          // terminal's scrollback would, so earlier output stays readable.
          for(let row=0;row<this.rows;row++){const text=this.grid[row].join("").replace(/\s+$/,"");if(text)this.history.push(text);}
          this.historyContinues=false;
          if(this.history.length>MAX_HISTORY_ROWS)this.history.splice(0,this.history.length-MAX_HISTORY_ROWS);
          this.grid=Array.from({length:this.rows},()=>this.blank());this.wrapped=this.wrapped.map(()=>false);
          return;
        }
        if(first===1){for(let row=0;row<this.row;row++)this.eraseLine(2,row);this.eraseLine(1);return;}
        this.eraseLine(0);for(let row=this.row+1;row<this.rows;row++)this.eraseLine(2,row);return;
      case"X":{const line=this.grid[this.row];for(let index=this.col;index<Math.min(this.cols,this.col+count);index++)line[index]=" ";return;}
      case"P":{const line=this.grid[this.row];line.splice(this.col,count);while(line.length<this.cols)line.push(" ");return;}
      case"@":{const line=this.grid[this.row];line.splice(this.col,0,...Array.from({length:count},()=>" "));line.length=this.cols;return;}
      case"L":{for(let step=0;step<count;step++){this.grid.splice(this.row,0,this.blank());this.grid.length=this.rows;this.wrapped.splice(this.row,0,false);this.wrapped.length=this.rows;}return;}
      case"M":{for(let step=0;step<count;step++){this.grid.splice(this.row,1);this.grid.push(this.blank());this.wrapped.splice(this.row,1);this.wrapped.push(false);}return;}
      case"S":this.scrollUp(count,true);return;
      case"T":{for(let step=0;step<count;step++){this.grid.pop();this.grid.unshift(this.blank());this.wrapped.pop();this.wrapped.unshift(false);}return;}
      case"s":this.savedCursor=[this.row,this.col];return;
      case"u":[this.row,this.col]=this.savedCursor;this.pendingWrap=false;return;
      default:return;// SGR and anything else that does not move text
    }
  }

  /** Forgets everything already scrolled away, for a caller that restarts reading. */
  clearHistory(){this.history=[];this.historyContinues=false;}

  /** Scrollback followed by the visible screen, trailing blanks trimmed. */
  text(){
    const lines=[...this.history];let continues=this.historyContinues;
    for(let row=0;row<this.rows;row++){
      const text=this.grid[row].join("").replace(/\s+$/,"");
      if(continues&&lines.length)lines[lines.length-1]+=text;else lines.push(text);
      continues=this.wrapped[row];
    }
    while(lines.length&&!lines[lines.length-1])lines.pop();
    return lines.join("\n").replace(/\n{3,}/g,"\n\n");
  }
}
