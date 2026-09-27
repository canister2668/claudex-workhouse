// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Claudex Workhouse.

import fs from"node:fs";
import path from"node:path";
import zlib from"node:zlib";
import{validateWindowsPayloadPath}from"./payload.js";

/** Builds the portable Windows ZIP without depending on the host archiver.
 *
 * `Compress-Archive` differs between Windows PowerShell and PowerShell 7 in
 * separator, timestamp and hidden-file handling, and a Linux `zip` records
 * POSIX modes. This writer produces the same bytes on every host for the same
 * tree and date: forward-slash UTF-8 names under one root folder, sorted,
 * MS-DOS attributes, no links, and a fixed timestamp. Explorer's "Extract all",
 * `Expand-Archive`, and the in-app updater's ZIP inspection all accept it. */

export type PortableZipEntry={name:string;size:number;compressedSize:number;crc32:number;method:0|8};
export type PortableZipResult={file:string;entries:PortableZipEntry[];bytes:number;longestPath:number};

// Explorer's built-in extractor still stops at MAX_PATH (260 characters,
// including the terminating NUL). A user extracting into
// `C:\Users\<name>\Downloads\<zip name>\` already spends about 100 of those, so
// the archive keeps every name, root folder included, well below the limit.
export const PORTABLE_ZIP_MAX_ENTRY_PATH=150;
const MAX_ENTRIES=50_000,MAX_TOTAL=2_147_483_648;

function dosDateTime(date:Date){
  const year=Math.min(Math.max(date.getUTCFullYear(),1980),2107);
  return{time:(date.getUTCHours()<<11)|(date.getUTCMinutes()<<5)|Math.floor(date.getUTCSeconds()/2),date:((year-1980)<<9)|((date.getUTCMonth()+1)<<5)|date.getUTCDate()};
}
function listFiles(root:string,current="",files:string[]=[]){
  const directory=path.join(root,...(current?current.split("/"):[]));
  for(const entry of fs.readdirSync(directory,{withFileTypes:true}).sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0)){
    const relative=current?`${current}/${entry.name}`:entry.name;
    if(entry.isSymbolicLink())throw new Error(`Portable ZIP input contains a symbolic link: ${relative}`);
    if(entry.isDirectory())listFiles(root,relative,files);
    else if(entry.isFile())files.push(relative);
    else throw new Error(`Portable ZIP input contains an unsupported file type: ${relative}`);
  }
  return files;
}

export function createPortableZip(input:{sourceRoot:string;rootName:string;output:string;date?:Date}):PortableZipResult{
  const rootName=validateWindowsPayloadPath(input.rootName);
  if(rootName.includes("/"))throw new Error("Portable ZIP root must be a single folder name.");
  const files=listFiles(input.sourceRoot);
  if(!files.length)throw new Error("Portable ZIP input is empty.");
  if(files.length>MAX_ENTRIES)throw new Error(`Portable ZIP has too many entries (${files.length}).`);
  const seen=new Set<string>();let longestPath=0;
  for(const relative of files){
    const name=`${rootName}/${validateWindowsPayloadPath(relative)}`,key=name.toLowerCase();
    // Every archiver and extractor on Windows agrees on printable ASCII names;
    // they do not agree on anything else (the ZIP UTF-8 flag, OEM code pages).
    // The single EXE writes its own files and is not bound by this.
    if(!/^[\x20-\x7e]+$/.test(name))throw new Error(`Portable ZIP entry is not printable ASCII: ${name}`);
    if(seen.has(key))throw new Error(`Portable ZIP has a case-insensitive path collision: ${name}`);seen.add(key);
    longestPath=Math.max(longestPath,name.length);
    if(name.length>PORTABLE_ZIP_MAX_ENTRY_PATH)throw new Error(`Portable ZIP entry exceeds ${PORTABLE_ZIP_MAX_ENTRY_PATH} characters and would not extract with Explorer: ${name}`);
  }
  const{time,date}=dosDateTime(input.date??new Date());
  fs.mkdirSync(path.dirname(input.output),{recursive:true});
  const temporary=`${input.output}.${process.pid}.tmp`;fs.rmSync(temporary,{force:true});
  const fd=fs.openSync(temporary,"wx",0o644),central:Buffer[]=[],entries:PortableZipEntry[]=[];
  let offset=0,expanded=0;
  const write=(buffer:Buffer)=>{fs.writeSync(fd,buffer);offset+=buffer.length;};
  try{
    for(const relative of files){
      const name=`${rootName}/${relative}`,nameBytes=Buffer.from(name,"utf8"),body=fs.readFileSync(path.join(input.sourceRoot,...relative.split("/")));
      if((expanded+=body.length)>MAX_TOTAL)throw new Error("Portable ZIP exceeds the 2 GiB expansion limit.");
      const crc=zlib.crc32(body)>>>0,deflated=zlib.deflateRawSync(body,{level:9}),method:0|8=deflated.length<body.length?8:0,stored=method===8?deflated:body;
      if(offset>0xffffffff-30-nameBytes.length-stored.length)throw new Error("Portable ZIP exceeds the 4 GiB ZIP32 limit.");
      const local=Buffer.alloc(30);
      local.writeUInt32LE(0x04034b50,0);local.writeUInt16LE(20,4);local.writeUInt16LE(0x0800,6);local.writeUInt16LE(method,8);local.writeUInt16LE(time,10);local.writeUInt16LE(date,12);
      local.writeUInt32LE(crc,14);local.writeUInt32LE(stored.length,18);local.writeUInt32LE(body.length,22);local.writeUInt16LE(nameBytes.length,26);local.writeUInt16LE(0,28);
      const headerOffset=offset;write(local);write(nameBytes);write(stored);
      const record=Buffer.alloc(46);
      // Version made by 2.0 on MS-DOS/FAT: external attributes are DOS bits
      // (0x20 archive), so no extractor can read a POSIX mode or a link type.
      record.writeUInt32LE(0x02014b50,0);record.writeUInt16LE(20,4);record.writeUInt16LE(20,6);record.writeUInt16LE(0x0800,8);record.writeUInt16LE(method,10);record.writeUInt16LE(time,12);record.writeUInt16LE(date,14);
      record.writeUInt32LE(crc,16);record.writeUInt32LE(stored.length,20);record.writeUInt32LE(body.length,24);record.writeUInt16LE(nameBytes.length,28);record.writeUInt16LE(0,30);record.writeUInt16LE(0,32);
      record.writeUInt16LE(0,34);record.writeUInt16LE(0,36);record.writeUInt32LE(0x20,38);record.writeUInt32LE(headerOffset,42);
      central.push(record,nameBytes);
      entries.push({name,size:body.length,compressedSize:stored.length,crc32:crc,method});
    }
    const centralOffset=offset;for(const part of central)write(part);const centralSize=offset-centralOffset;
    const end=Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(0,4);end.writeUInt16LE(0,6);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(centralSize,12);end.writeUInt32LE(centralOffset,16);end.writeUInt16LE(0,20);
    write(end);fs.fsyncSync(fd);
  }catch(error){fs.closeSync(fd);fs.rmSync(temporary,{force:true});throw error;}
  fs.closeSync(fd);fs.renameSync(temporary,input.output);
  return{file:input.output,entries,bytes:offset,longestPath};
}
