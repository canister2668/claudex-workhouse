"use strict";
const vscode=require("vscode");
const path=require("path");

function severity(value){return value===vscode.DiagnosticSeverity.Error?"error":value===vscode.DiagnosticSeverity.Warning?"warning":value===vscode.DiagnosticSeverity.Information?"information":"hint";}
function base64url(value){return Buffer.from(JSON.stringify(value),"utf8").toString("base64url");}
function configuredOrigin(){
  const raw=String(vscode.workspace.getConfiguration("claudexWorkhouse").get("serverUrl")||"").trim();
  const url=new URL(raw);
  if(!["http:","https:"].includes(url.protocol)||url.username||url.password)throw new Error("serverUrl must be an HTTP(S) origin without credentials.");
  url.pathname="/";url.search="";url.hash="";
  return url;
}
function workspaceFor(document){
  return vscode.workspace.getWorkspaceFolder(document.uri)??vscode.workspace.workspaceFolders?.[0]??null;
}
async function sendSelection(){
  const editor=vscode.window.activeTextEditor;
  if(!editor){void vscode.window.showWarningMessage("Open a text editor before sending context.");return;}
  const workspace=workspaceFor(editor.document);
  if(!workspace){void vscode.window.showWarningMessage("Open a VS Code workspace before sending context.");return;}
  const request=await vscode.window.showInputBox({title:"Send to Claudex Workhouse",prompt:"What should the agent do? You can edit the full prompt in Workhouse.",placeHolder:"Review this selection and make the necessary change",ignoreFocusOut:true});
  if(request===undefined)return;
  const selected=editor.document.getText(editor.selection).slice(0,20_000);
  const diagnostics=vscode.languages.getDiagnostics(editor.document.uri).filter(item=>editor.selection.isEmpty||item.range.intersection(editor.selection)).slice(0,20).map(item=>({severity:severity(item.severity),message:item.message.slice(0,1000),line:item.range.start.line,column:item.range.start.character}));
  const payload={version:1,workspacePath:workspace.uri.fsPath,filePath:path.relative(workspace.uri.fsPath,editor.document.uri.fsPath).replace(/\\/g,"/"),languageId:editor.document.languageId,startLine:editor.selection.start.line,startColumn:editor.selection.start.character,endLine:editor.selection.end.line,endColumn:editor.selection.end.character,selectedText:selected,diagnostics,request};
  try{
    const url=configuredOrigin();
    url.hash=`vscode-context=${base64url(payload)}`;
    await vscode.env.openExternal(vscode.Uri.parse(url.toString(),true));
  }catch(error){void vscode.window.showErrorMessage(`Cannot open Claudex Workhouse: ${error instanceof Error?error.message:String(error)}`);}
}
function activate(context){context.subscriptions.push(vscode.commands.registerCommand("claudexWorkhouse.sendSelection",sendSelection));}
function deactivate(){}
module.exports={activate,deactivate};
