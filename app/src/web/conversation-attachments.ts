// The composer appends attachments to the prompt as "- <absolute path> (<name>)"
// lines so the models get a path they can open. Those lines are addressed to the
// model, not to the reader: on the phone they push the actual message off the
// card and say nothing about what was sent. Lift them back out and show the
// picture instead, and leave the message text exactly as it was typed.
export type ConversationAttachment={name:string;url:string|null;fileName:string};
export type ConversationUserContent={text:string;attachments:ConversationAttachment[]};

const IMAGE_EXTENSIONS=["png","jpg","jpeg","gif","webp","avif","bmp"];
// saveUploadPart writes "<8 hex>-<sanitised name>" directly inside the uploads
// directory. Matching that shape is what keeps an arbitrary path in a
// model-authored line from turning into a request for someone else's file.
const UPLOAD_FILE=/^[0-9a-f]{8}-[^/\\]+$/;
const ATTACHMENT_LINE=/^\s*-\s+(\S[^()]*?)\s*\(([^()]+)\)\s*$/;

function uploadFileName(candidate:string){
  const normalized=candidate.replace(/\\/g,"/");
  if(!/\/uploads\//.test(normalized))return null;
  const name=normalized.slice(normalized.lastIndexOf("/")+1);
  return UPLOAD_FILE.test(name)?name:null;
}

export function isDisplayableImage(fileName:string){
  const extension=fileName.slice(fileName.lastIndexOf(".")+1).toLowerCase();
  return fileName.includes(".")&&IMAGE_EXTENSIONS.includes(extension);
}

export function parseConversationUserContent(content:string):ConversationUserContent{
  if(!content)return{text:"",attachments:[]};
  const lines=content.split("\n"),kept:string[]=[],attachments:ConversationAttachment[]=[];
  for(const line of lines){
    const match=line.match(ATTACHMENT_LINE),fileName=match?uploadFileName(match[1]):null;
    if(!match||!fileName){kept.push(line);continue;}
    const name=match[2].trim()||fileName;
    if(!attachments.some(item=>item.fileName===fileName))attachments.push({name,fileName,url:isDisplayableImage(fileName)?`/api/uploads/${encodeURIComponent(fileName)}`:null});
  }
  // Removing the list leaves the sentence that introduced it dangling, and the
  // blank lines that separated it from the message.
  while(kept.length&&attachments.length&&!kept[kept.length-1].trim())kept.pop();
  // "[Attached files — read them with file tools when needed]" is an instruction
  // to the model in every locale; the reader gets the pictures themselves.
  if(kept.length&&attachments.length&&/^\s*[[［].*[\]］]\s*$|[:：]\s*$/.test(kept[kept.length-1]))kept.pop();
  while(kept.length&&!kept[kept.length-1].trim())kept.pop();
  return{text:kept.join("\n").trimEnd(),attachments};
}
