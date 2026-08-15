import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GitHubLoginManager, sanitizedGitHubAuthText } from "../../src/server/github-login.js";

const TOKEN=["github","pat","AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"].join("_");
let root="",previousPath="";

beforeEach(()=>{
  root=fs.mkdtempSync(path.join(process.cwd(),".tmp-github-login-"));
  const bin=path.join(root,"bin"),script=path.join(bin,"gh");
  fs.mkdirSync(bin);
  fs.writeFileSync(script,`#!/bin/sh
set -eu
case "$1:$2" in
  api:user)
    printf '{"login":"%s","name":"Test Account"}\\n' "\${FAKE_GH_LOGIN:-octocat}"
    ;;
  auth:login)
    printf '%s\\n' "$@" > "$FAKE_GH_ARGS"
    IFS= read -r secret
    printf '%s' "$secret" > "$FAKE_GH_CAPTURE"
    if [ "\${FAKE_GH_FAIL_LOGIN:-0}" = "1" ]; then
      printf 'token=%s\\n' "$secret" >&2
      exit 1
    fi
    ;;
  auth:switch)
    printf '%s\\n' "$@" >> "$FAKE_GH_ARGS"
    ;;
  *)
    printf 'unexpected command\\n' >&2
    exit 2
    ;;
esac
`,{mode:0o700});
  previousPath=process.env.PATH??"";
  process.env.PATH=`${bin}${path.delimiter}${previousPath}`;
  process.env.CLAUDEX_WORKHOUSE_GH_BIN=script;
  process.env.FAKE_GH_ARGS=path.join(root,"args");
  process.env.FAKE_GH_CAPTURE=path.join(root,"capture");
  delete process.env.FAKE_GH_LOGIN;
  delete process.env.FAKE_GH_FAIL_LOGIN;
});

afterEach(()=>{
  process.env.PATH=previousPath;
  delete process.env.CLAUDEX_WORKHOUSE_GH_BIN;
  delete process.env.FAKE_GH_ARGS;
  delete process.env.FAKE_GH_CAPTURE;
  delete process.env.FAKE_GH_LOGIN;
  delete process.env.FAKE_GH_FAIL_LOGIN;
  fs.rmSync(root,{recursive:true,force:true});
});

describe("GitHub token connection",()=>{
  it("verifies the expected account and passes the token through stdin only",async()=>{
    const manager=new GitHubLoginManager();
    const result=await manager.connectToken(root,{token:TOKEN,username:"octocat",protocol:"https"});
    expect(result).toEqual({username:"octocat",name:"Test Account",protocol:"https"});
    expect(fs.readFileSync(process.env.FAKE_GH_CAPTURE!,"utf8")).toBe(TOKEN);
    const args=fs.readFileSync(process.env.FAKE_GH_ARGS!,"utf8");
    expect(args).toContain("--with-token");
    expect(args).toContain("octocat");
    expect(args).not.toContain(TOKEN);
    expect(JSON.stringify(result)).not.toContain(TOKEN);
    manager.close();
  });

  it("rejects a token for a different account before storing it",async()=>{
    process.env.FAKE_GH_LOGIN="someone-else";
    const manager=new GitHubLoginManager();
    await expect(manager.connectToken(root,{token:TOKEN,username:"octocat",protocol:"https"})).rejects.toMatchObject({code:"GITHUB_ACCOUNT_MISMATCH",statusCode:409});
    expect(fs.existsSync(process.env.FAKE_GH_CAPTURE!)).toBe(false);
    manager.close();
  });

  it("rejects non-PAT input before starting GitHub CLI",async()=>{
    const manager=new GitHubLoginManager();
    await expect(manager.connectToken(root,{token:"not_a_personal_access_token",username:"octocat",protocol:"https"})).rejects.toMatchObject({code:"GITHUB_TOKEN_INVALID_FORMAT",statusCode:400});
    expect(fs.existsSync(process.env.FAKE_GH_ARGS!)).toBe(false);
    manager.close();
  });

  it("redacts a token even when GitHub CLI echoes it in an error",async()=>{
    process.env.FAKE_GH_FAIL_LOGIN="1";
    const manager=new GitHubLoginManager();
    await expect(manager.connectToken(root,{token:TOKEN,username:"octocat",protocol:"https"})).rejects.toMatchObject({code:"GITHUB_TOKEN_STORE_FAILED",message:"token=[REDACTED]"});
    expect(sanitizedGitHubAuthText(`authorization: ${TOKEN}`)).not.toContain(TOKEN);
    manager.close();
  });
});
