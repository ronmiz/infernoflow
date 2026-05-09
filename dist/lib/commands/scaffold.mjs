import*as p from"node:fs";import*as a from"node:path";import{bold as U,cyan as T,gray as l,green as O,yellow as Q,red as b}from"../ui/output.mjs";function P(t){try{return JSON.parse(p.readFileSync(t,"utf8"))}catch{return null}}function z(t,e){p.writeFileSync(t,JSON.stringify(e,null,2)+`
`)}function d(t){return t.split(/[-_]/).map(e=>e.charAt(0).toUpperCase()+e.slice(1)).join("")}function fe(t){return t.replace(/([A-Z]+)([A-Z][a-z])/g,"$1-$2").replace(/([a-z\d])([A-Z])/g,"$1-$2").toLowerCase().replace(/[_\s]+/g,"-").replace(/^-+|-+$/g,"")}function X(t){if(!t||typeof t!="string")return null;const e=t.trim();if(!/^[A-Za-z][A-Za-z0-9 _-]*$/.test(e))return null;const n=e.replace(/([A-Z]+)([A-Z][a-z])/g,"$1 $2").replace(/([a-z\d])([A-Z])/g,"$1 $2").split(/[-_\s]+/).filter(Boolean);return n.length?n.map(r=>r.charAt(0).toUpperCase()+r.slice(1).toLowerCase()).join(""):null}function R(t){const e=d(t);return e.charAt(0).toLowerCase()+e.slice(1)}function Y(t){return t.split(/[-_]/).map(e=>e.charAt(0).toUpperCase()+e.slice(1)).join(" ")}function ee(t){const e=t.split(/[-_]/);if(e.length===1)return R(t);const n=["auth","login","logout","register","refresh","validate","verify","process","refund","charge","send","fetch","create","update","delete","get","list","search","sync","import","export","scan","check","notify"],r=e[e.length-1],i=e[0];if(n.includes(i)){const o={auth:"authenticate",get:"get",list:"list",send:"send",check:"check",notify:"notify"}[i]||i,u=e.slice(1).map((g,v)=>v===0?g.charAt(0).toUpperCase()+g.slice(1):g).join("");return o+u.charAt(0).toUpperCase()+u.slice(1)}if(n.includes(r)){const s=e.slice(0,-1).map((o,u)=>u===0?o.charAt(0).toUpperCase()+o.slice(1):o).join("");return r+s}return R(t)}function te(t,e,n){if(t?.capabilities?.length){const s=t.capabilities.flatMap(o=>o.codeAnalysis?.sourceFiles||[]).map(o=>a.extname(o));if(s.filter(o=>o===".ts").length>s.filter(o=>o===".js").length)return"ts";if(s.includes(".py"))return"py";if(s.includes(".go"))return"go";if(s.some(o=>o===".js"||o===".mjs"))return"js"}const r=e?.language||e?.lang;return r?r.toLowerCase().replace("javascript","js").replace("typescript","ts"):p.existsSync(a.join(n,"tsconfig.json"))?"ts":p.existsSync(a.join(n,"pyproject.toml"))?"py":p.existsSync(a.join(n,"go.mod"))?"go":"js"}function ne(t,e){if(!t?.capabilities?.length)return null;const n=t.capabilities.flatMap(s=>s.codeAnalysis?.sourceFiles||[]);if(!n.length)return null;const r={};for(const s of n){const o=a.dirname(s).split("/")[0];r[o]=(r[o]||0)+1}const i=Object.entries(r).sort((s,o)=>o[1]-s[1])[0];return i?i[0]:null}function oe(t){if(!t?.capabilities?.length)return[];const e=t.capabilities.flatMap(n=>n.codeAnalysis?.services||[]);return[...new Set(e)]}function re(t,e,n,r,i){const s=d(t),o=`${s}Error`,u=J("ts",i);return`/**
 * ${e}
 *
 * ${n}
 *
 * @capability ${t}
 * @stability  experimental
 */
${u}

// \u2500\u2500 errors \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

export class ${o} extends Error {
  constructor(message: string, public readonly code?: string) {
    super(message);
    this.name = "${o}";
  }
}

// \u2500\u2500 types \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

export interface ${s}Input {
  // TODO: define input fields
}

export interface ${s}Result {
  // TODO: define result fields
  success: boolean;
}

// \u2500\u2500 implementation \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

/**
 * ${r} \u2014 primary entry point for ${e}.
 * TODO: implement this function.
 */
export async function ${r}(input: ${s}Input): Promise<${s}Result> {
  // TODO: implement
  throw new ${o}("Not implemented yet");
}
`}function se(t,e,n,r,i){const o=`${d(t)}Error`,u=J("js",i);return`/**
 * ${e}
 *
 * ${n}
 *
 * @capability ${t}
 * @stability  experimental
 */
${u}

// \u2500\u2500 errors \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

export class ${o} extends Error {
  constructor(message, code) {
    super(message);
    this.name  = "${o}";
    this.code  = code;
  }
}

// \u2500\u2500 implementation \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

/**
 * ${r} \u2014 primary entry point for ${e}.
 * TODO: implement this function.
 *
 * @param {object} input
 * @returns {Promise<object>}
 */
export async function ${r}(input = {}) {
  // TODO: implement
  throw new ${o}("Not implemented yet");
}
`}function ie(t,e,n,r){const i=d(t);return`"""
${e}

${n}

capability: ${t}
stability:  experimental
"""

from typing import Any


class ${i}Error(Exception):
    """Raised when ${e} operations fail."""
    def __init__(self, message: str, code: str | None = None):
        super().__init__(message)
        self.code = code


async def ${r.replace(/([A-Z])/g,"_$1").toLowerCase().replace(/^_/,"")}(input: dict[str, Any]) -> dict[str, Any]:
    """Primary entry point for ${e}.

    TODO: implement this function.
    """
    raise ${i}Error("Not implemented yet")
`}function ce(t,e,n,r){const i=t.split("-")[0];return`// Package ${i} implements ${e}.
//
// ${n}
//
// capability: ${t}
// stability:  experimental
package ${i}

import "errors"

// Err${d(t)} is returned when ${e} operations fail.
var Err${d(t)} = errors.New("${t}: operation failed")

// ${d(r)} is the primary entry point for ${e}.
// TODO: implement this function.
func ${d(r)}(input map[string]any) (map[string]any, error) {
	return nil, Err${d(t)}
}
`}function J(t,e){if(!e.length)return"";const n=[];if(t==="ts"||t==="js"){const r={stripe:"// import Stripe from 'stripe';",postgres:"// import { Pool } from 'pg';",mysql:"// import mysql from 'mysql2/promise';",redis:"// import { createClient } from 'redis';",s3:"// import { S3Client } from '@aws-sdk/client-s3';",sendgrid:"// import sgMail from '@sendgrid/mail';",twilio:"// import twilio from 'twilio';",openai:"// import OpenAI from 'openai';"};for(const i of e){const s=r[i.toLowerCase()];s&&n.push(s)}}return n.length?n.join(`
`)+`
`:""}function le(t,e,n){return{scenarioId:`${t}-happy-path`,description:`Happy path for ${e}`,capabilitiesCovered:[t],createdAt:new Date().toISOString(),steps:[{step:1,action:`Call ${n} with valid input`,expected:"Returns success result"},{step:2,action:`Call ${n} with invalid input`,expected:"Throws appropriate error"}]}}function ae({id:t,filePath:e,scenarioPath:n,lang:r,fn:i,dryRun:s}){console.log(),console.log(U(`  \u{1F30A} ${O(t)}`)),console.log(l("     stability: experimental \u2014 free to evolve")),console.log(),console.log(l("  Generated:")),console.log(`    ${O("+")}  ${T(e)}   ${l(`(${r} source skeleton)`)}`),console.log(`    ${O("+")}  ${T("inferno/capabilities.json")}   ${l("(capability registered)")}`),console.log(`    ${O("+")}  ${T(n)}   ${l("(placeholder scenario)")}`),console.log(),s?console.log(Q("  [dry-run] \u2014 no files were written")):(console.log(l("  Next steps:")),console.log(l(`    1. Implement ${i}() in ${e}`)),console.log(l("    2. Run: infernoflow scan    \u2014 to extract call graph")),console.log(l("    3. Run: infernoflow graph   \u2014 to see dependencies")),console.log(l("    4. Run: infernoflow check   \u2014 to validate contract"))),console.log()}async function ue(t){const e=(t||[]).slice(1),n=e.includes("--dry-run"),r=e.includes("--json"),i=e.indexOf("--lang"),s=i!==-1?e[i+1]:null,o=e.indexOf("--dir"),u=o!==-1?e[o+1]:null,g=e.indexOf("--description"),v=g!==-1?e[g+1]:null,M=new Set([i+1,o+1,g+1].filter(f=>f>0));let c=e.find((f,A)=>!f.startsWith("--")&&!M.has(A));c||(console.error(b("\u2717 Usage: infernoflow scaffold <capability-id> [--dir <src>] [--lang ts|js|py|go] [--dry-run] [--json]")),console.error(l("  Example: infernoflow scaffold CreateItem   (or payment-refund \u2014 both work)")),process.exit(1));const I=c,F=X(I);F||(console.error(b(`\u2717 Invalid capability ID: "${I}"`)),console.error(l('  Try: CreateItem, payment-refund, user_auth, or "Send Email".')),process.exit(1)),c=F;const h=process.cwd(),D=a.join(h,"inferno"),_=a.join(D,"capabilities.json");p.existsSync(_)||(console.error(b("\u2717 inferno/capabilities.json not found \u2014 run `infernoflow init` first.")),process.exit(1));let w=[];const C=P(_);C&&(w=Array.isArray(C)?C:C.capabilities||[]),w.some(f=>f.id===c||f.id===I)&&(console.error(b(`\u2717 Capability "${c}" already exists in capabilities.json`)),console.error(l("  Use a different ID, or run: infernoflow why "+c)),process.exit(1));const E=P(a.join(D,"scan.json")),q=P(a.join(D,"developer-profile.json")),x=s||te(E,q,h),B=u||ne(E,h)||"src",G={ts:".ts",js:".js",py:".py",go:".go"}[x]||".js",m=Y(c),j=v||`TODO: describe ${m}`,y=ee(c),Z=oe(E);let $;x==="ts"?$=re(c,m,j,y,Z):x==="py"?$=ie(c,m,j,y):x==="go"?$=ce(c,m,j,y):$=se(c,m,j,y,Z);const H=R(c)+G,S=a.join(B,H),N=a.join(h,S),k=a.join("inferno","scenarios",`${c}.json`),L=a.join(h,k),K=le(c,m,y),V={id:c,name:m,description:j,stability:"experimental",since:new Date().toISOString().slice(0,10)};if(r){console.log(JSON.stringify({capId:c,name:m,stability:"experimental",lang:x,filePath:S,scenarioPath:k,primaryFn:y,dryRun:n,code:$},null,2));return}if(console.log(l(`
  infernoflow scaffold  \u2192  ${U(c)}`)),console.log(l("  \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500")),!n){const f=a.dirname(N);p.existsSync(f)||p.mkdirSync(f,{recursive:!0}),p.existsSync(N)&&(console.error(b(`  \u2717 File already exists: ${S}`)),console.error(l("    Delete it first or choose a different --dir")),process.exit(1)),p.writeFileSync(N,$,"utf8"),w.push(V),z(_,w);const A=a.join(h,"inferno","scenarios");p.existsSync(A)||p.mkdirSync(A,{recursive:!0}),p.existsSync(L)||z(L,K)}const W=$.split(`
`).slice(0,12).map(f=>"    "+f).join(`
`);console.log(l(`
  Preview:`)),console.log(l(W)),console.log(l("    ...")),ae({id:c,filePath:S,scenarioPath:k,lang:x,fn:y,dryRun:n})}export{ue as scaffoldCommand};
